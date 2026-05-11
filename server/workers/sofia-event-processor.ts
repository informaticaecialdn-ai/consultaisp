/**
 * Spec 004 — Sofia event processor (T036).
 *
 * Consumer BullMQ da queue `sofia-thank`. Disparado pelo webhook Asaas após
 * inserção bem-sucedida em `payment_events`. Para cada job:
 *
 *   1. Carrega customer + provider + toggle (multi-tenant gate).
 *   2. Skip se opt-out / Sofia disabled.
 *   3. Janela horária — fora → re-enqueue com delay até reabertura.
 *   4. Cria outbound_attempts (step='THANK_YOU', status='awaiting_compliance').
 *   5. Invoca Sofia → {templateName, variables, freeFormText}.
 *   6. invokeJulia → APPROVED/BLOCKED.
 *   7. Aprovado → sendTemplate (ou sendText se janela 24h) → markSent + audit.
 *   8. Veto → markVetoed + audit.
 *
 * Idempotência: o webhook é a primeira camada (UNIQUE em payment_events). Este
 * worker NÃO precisa re-verificar — se chegou aqui, o evento é novo. Mas faz
 * defesa: o paymentEventId já vem no payload e re-execução do mesmo paymentEventId
 * deve gerar resultado equivalente (mensagem reenviada é aceitável; cliente recebe
 * 2 thanks no pior caso, vs nenhuma).
 */

import { Worker, type Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../logger";
import {
  agentToggles, customers, providers, whatsappOptouts,
} from "@shared/schema";
import { storage } from "../storage";
import { getQueue, getRedisConnection, OUTBOUND_JOB_DEFAULTS, QUEUE_NAMES } from "../lib/queue";
import { invokeSofia, SOFIA_AGENT_ID, type SofiaInput } from "../agents/sofia";
import { invokeJulia } from "../agents/julia";
import { createMetaClient, MetaApiError } from "../communications/whatsapp/client";
import { auditAction } from "../agents/audit-actions";
import type { SofiaJobData } from "../routes/webhook.routes";

/** TZ helpers — replicados (não exporta para evitar import circular). */
const STATE_TIMEZONE: Record<string, string> = {
  AC: "America/Rio_Branco",
  AM: "America/Manaus",
  RO: "America/Porto_Velho",
  RR: "America/Boa_Vista",
  MT: "America/Cuiaba",
  MS: "America/Campo_Grande",
  AP: "America/Belem",
  PA: "America/Belem",
};
const DEFAULT_TZ = "America/Sao_Paulo";

function resolveTz(state?: string | null): string {
  if (!state) return DEFAULT_TZ;
  return STATE_TIMEZONE[state.toUpperCase()] ?? DEFAULT_TZ;
}

interface LocalClock { hour: number; minute: number; weekday: number; }

function localClock(tz: string, now = new Date()): LocalClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(now);
  const obj: Record<string, string> = {};
  for (const p of parts) obj[p.type] = p.value;
  const hourRaw = obj.hour === "24" ? "00" : obj.hour;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: Number.parseInt(hourRaw, 10) || 0,
    minute: Number.parseInt(obj.minute, 10) || 0,
    weekday: weekdayMap[obj.weekday] ?? 0,
  };
}

function parseHourMin(hhmmss: string): { hour: number; minute: number } {
  const [hh, mm] = hhmmss.split(":");
  return {
    hour: Math.max(0, Math.min(23, Number.parseInt(hh, 10) || 0)),
    minute: Math.max(0, Math.min(59, Number.parseInt(mm, 10) || 0)),
  };
}

function isWithinWindow(clock: LocalClock, inicio: string, fim: string, permiteSabado: boolean, permiteDomingo: boolean): boolean {
  if (clock.weekday === 0 && !permiteDomingo) return false;
  if (clock.weekday === 6 && !permiteSabado) return false;
  const start = parseHourMin(inicio);
  const end = parseHourMin(fim);
  const cur = clock.hour * 60 + clock.minute;
  return cur >= start.hour * 60 + start.minute && cur < end.hour * 60 + end.minute;
}

function nextWindowOpenDelayMs(tz: string, inicio: string, permiteSabado: boolean, permiteDomingo: boolean, now = new Date()): number {
  const { hour: hi, minute: mi } = parseHourMin(inicio);
  for (let addDays = 0; addDays < 8; addDays++) {
    const candidate = new Date(now.getTime() + addDays * 24 * 3600_000);
    const clock = localClock(tz, candidate);
    if (clock.weekday === 0 && !permiteDomingo) continue;
    if (clock.weekday === 6 && !permiteSabado) continue;
    if (addDays === 0) {
      const cur = clock.hour * 60 + clock.minute;
      const open = hi * 60 + mi;
      if (cur >= open) continue;
    }
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(candidate);
    const local = new Date(candidate.toLocaleString("en-US", { timeZone: tz }));
    const utc = new Date(candidate.toLocaleString("en-US", { timeZone: "UTC" }));
    const offsetMinutes = Math.round((local.getTime() - utc.getTime()) / 60_000);
    const [y, mo, d] = ymd.split("-").map(Number);
    const localUtcMs = Date.UTC(y, mo - 1, d, hi, mi, 0, 0);
    const ms = localUtcMs - offsetMinutes * 60_000 - now.getTime();
    return Math.max(60_000, ms); // ao menos 1min
  }
  return 3600_000;
}

function formatBR(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function formatDateBR(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

interface ProcessOutcome {
  status: "sent" | "vetoed" | "deferred" | "failed" | "skipped";
  reason?: string;
}

export async function processSofiaJob(data: SofiaJobData): Promise<ProcessOutcome> {
  const auditStorage = storage.auditLog;
  const correlationId = data.correlationId;

  // 1. Carrega customer + provider + toggle
  const [cust] = await db.select().from(customers).where(eq(customers.id, data.customerId)).limit(1);
  if (!cust || cust.providerId !== data.providerId) {
    logger.warn({ action: "sofia_customer_mismatch", providerId: data.providerId, customerId: data.customerId }, "Sofia: customer não pertence ao provider");
    return { status: "failed", reason: "customer_mismatch" };
  }
  if (!cust.phone) {
    return { status: "skipped", reason: "no_phone" };
  }

  // Opt-out
  const [opt] = await db.select().from(whatsappOptouts)
    .where(and(eq(whatsappOptouts.providerId, data.providerId), eq(whatsappOptouts.phoneNumber, cust.phone)))
    .limit(1);
  if (opt) {
    await auditStorage.registrarAcao(data.providerId, {
      ...auditAction("sofia_skipped_optout"),
      resourceId: String(data.customerId),
      actorType: "agent",
      actorId: SOFIA_AGENT_ID,
      actorName: "Sofia — Atendente de Relacionamento",
      payload: { invoiceId: data.invoiceId, asaasPaymentId: data.asaasPaymentId, correlationId },
    });
    return { status: "skipped", reason: "opt_out" };
  }

  const [prov] = await db.select().from(providers).where(eq(providers.id, data.providerId)).limit(1);
  if (!prov) return { status: "failed", reason: "provider_not_found" };

  const [toggle] = await db.select().from(agentToggles).where(eq(agentToggles.providerId, data.providerId)).limit(1);
  if (!toggle || !toggle.sofiaAtiva) {
    return { status: "skipped", reason: "sofia_disabled" };
  }

  // 2. Janela horária — se fora, re-enqueue com delay
  const tz = resolveTz(prov.addressState);
  const clock = localClock(tz);
  if (!isWithinWindow(clock, toggle.janelaInicio, toggle.janelaFim, toggle.permiteSabado, toggle.permiteDomingo)) {
    const delay = nextWindowOpenDelayMs(tz, toggle.janelaInicio, toggle.permiteSabado, toggle.permiteDomingo);
    try {
      const queue = getQueue(QUEUE_NAMES.SOFIA_THANK);
      await queue.add("thank", data, {
        ...OUTBOUND_JOB_DEFAULTS,
        delay,
        jobId: `sofia-evt${data.paymentEventId}-deferred`,
      });
    } catch (err) {
      logger.error({ action: "sofia_window_requeue_failed", err: (err as Error)?.message }, "Sofia: falha ao re-enfileirar");
    }
    await auditStorage.registrarAcao(data.providerId, {
      ...auditAction("sofia_skipped_window"),
      resourceId: String(data.customerId),
      actorType: "agent",
      actorId: SOFIA_AGENT_ID,
      actorName: "Sofia — Atendente de Relacionamento",
      payload: { delayMs: delay, correlationId },
    });
    return { status: "deferred", reason: "outside_window" };
  }

  // 3. Cria outbound_attempts step=THANK_YOU
  const reserved = await storage.outboundAttempt.tryReserve({
    providerId: data.providerId,
    customerId: data.customerId,
    invoiceId: data.invoiceId ?? undefined,
    agentId: "sofia_v1",
    step: "THANK_YOU",
    scheduledFor: new Date(),
  });
  if (!reserved) {
    return { status: "skipped", reason: "attempt_reserve_failed" };
  }
  await storage.outboundAttempt.markAwaitingCompliance(reserved.id);

  // 4. Invoca Sofia
  const sofiaInput: SofiaInput = {
    providerName: prov.tradeName ?? prov.name,
    customerName: cust.name,
    paidAmount: data.value,
    paidAt: data.paidAt,
    isFirstPaymentEver: false, // TODO: detectar via histórico de payment_events
    isWithin24hWindow: false, // TODO: detectar via última comunicação inbound
    availableTemplates: [{
      name: toggle.templateSofiaNome ?? "agradecimento_pagamento_v1",
      variables: ["nome_cliente", "valor", "data_pagamento"],
    }],
  };

  const sofiaResult = await invokeSofia(data.providerId, sofiaInput, {
    customerId: data.customerId,
    correlationId,
  });

  if (!sofiaResult.success || !sofiaResult.output) {
    await storage.outboundAttempt.markFailed(reserved.id, `sofia_failed: ${sofiaResult.error ?? "unknown"}`, new Date(Date.now() + 3600_000));
    return { status: "failed", reason: sofiaResult.error };
  }

  const output = sofiaResult.output;
  const renderedBody = output.freeFormText ??
    `Obrigado, ${output.variables["nome_cliente"] ?? firstName(cust.name)}! ` +
    `Pagamento de ${output.variables["valor"] ?? formatBR(data.value)} ` +
    `confirmado em ${output.variables["data_pagamento"] ?? formatDateBR(data.paidAt)}.`;

  // 5. Júlia
  const decision = await invokeJulia({
    tenantId: data.providerId,
    customerId: data.customerId,
    agentId: SOFIA_AGENT_ID,
    actionType: "send_message",
    channel: "whatsapp",
    content: renderedBody,
    scheduledAt: new Date().toISOString(),
    actionPayload: {
      templateName: output.templateName,
      variables: output.variables,
      step: "THANK_YOU",
      paymentEventId: data.paymentEventId,
    },
    correlationId,
  });

  if (decision.decision === "BLOCKED") {
    await storage.outboundAttempt.markVetoed(
      reserved.id,
      decision.complianceCheckId ?? "no-id",
      decision.blockingReasons?.join("; ") ?? "compliance",
    );
    await auditStorage.registrarAcao(data.providerId, {
      ...auditAction("sofia_blocked_julia"),
      resourceId: String(data.customerId),
      actorType: "agent",
      actorId: SOFIA_AGENT_ID,
      actorName: "Sofia — Atendente de Relacionamento",
      payload: { blockingReasons: decision.blockingReasons, complianceCheckId: decision.complianceCheckId, correlationId },
    });
    return { status: "vetoed", reason: decision.blockingReasons?.join("; ") };
  }

  // 6. Envia via Meta
  const meta = await createMetaClient(data.providerId).catch((err) => {
    logger.error({ action: "sofia_meta_client_failed", providerId: data.providerId, err: (err as Error)?.message }, "Sofia: cliente Meta indisponível");
    return null;
  });
  if (!meta) {
    await storage.outboundAttempt.markFailed(reserved.id, "meta_client_unavailable", new Date(Date.now() + 3600_000));
    return { status: "failed", reason: "meta_client_unavailable" };
  }

  let messageId: string;
  try {
    if (output.freeFormText && sofiaInput.isWithin24hWindow) {
      const r = await meta.sendText({ to: cust.phone, text: output.freeFormText });
      messageId = r.messageId;
    } else {
      const r = await meta.sendTemplate({
        to: cust.phone,
        templateName: output.templateName,
        language: "pt_BR",
        params: [
          { type: "text", text: output.variables["nome_cliente"] ?? firstName(cust.name) },
          { type: "text", text: output.variables["valor"] ?? formatBR(data.value) },
          { type: "text", text: output.variables["data_pagamento"] ?? formatDateBR(data.paidAt) },
        ],
      });
      messageId = r.messageId;
    }
  } catch (err) {
    const msg = err instanceof MetaApiError ? `meta:${err.status}:${err.message}` : (err as Error)?.message ?? "unknown";
    await storage.outboundAttempt.markFailed(reserved.id, msg, new Date(Date.now() + 3600_000));
    return { status: "failed", reason: msg };
  }

  // 7. Persist comunicação + markSent + audit
  let communicationId: number | null = null;
  try {
    const created = await storage.communications.create(data.providerId, {
      customerId: data.customerId,
      channel: "whatsapp",
      direction: "outbound",
      content: renderedBody,
      status: "sent",
      externalMessageId: messageId,
      sentAt: new Date(),
      agentId: SOFIA_AGENT_ID,
      templateName: output.templateName,
    } as Parameters<typeof storage.communications.create>[1]);
    communicationId = created.id;
  } catch (err) {
    logger.warn({ action: "sofia_comm_persist_failed", err: (err as Error)?.message }, "Sofia: falha persistir comunicação");
  }

  await storage.outboundAttempt.markSent(
    reserved.id,
    decision.complianceCheckId ?? "unknown",
    communicationId ?? 0,
  );

  await auditStorage.registrarAcao(data.providerId, {
    ...auditAction("sofia_send_thanks"),
    resourceId: String(data.customerId),
    actorType: "agent",
    actorId: SOFIA_AGENT_ID,
    actorName: "Sofia — Atendente de Relacionamento",
    payload: {
      asaasPaymentId: data.asaasPaymentId,
      paymentEventId: data.paymentEventId,
      templateName: output.templateName,
      variables: output.variables,
      messageId,
      communicationId,
      complianceCheckId: decision.complianceCheckId,
      correlationId,
    },
  });

  return { status: "sent" };
}

let _worker: Worker<SofiaJobData> | null = null;

export function startSofiaEventProcessor(): Worker<SofiaJobData> {
  if (_worker) return _worker;
  _worker = new Worker<SofiaJobData>(
    QUEUE_NAMES.SOFIA_THANK,
    async (job: Job<SofiaJobData>) => {
      const result = await processSofiaJob(job.data);
      logger.info(
        {
          action: "sofia_job_done",
          jobId: job.id,
          providerId: job.data.providerId,
          paymentEventId: job.data.paymentEventId,
          status: result.status,
          reason: result.reason,
        },
        "Sofia job concluído",
      );
      return result;
    },
    { connection: getRedisConnection(), concurrency: 5 },
  );
  _worker.on("failed", (job, err) => {
    logger.error(
      { action: "sofia_job_failed", jobId: job?.id, providerId: job?.data?.providerId, err: err.message },
      "Sofia job falhou",
    );
  });
  return _worker;
}

export async function stopSofiaEventProcessor(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
  }
}
