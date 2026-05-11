/**
 * Spec 004 — Bruno worker (T025).
 *
 * Consumer BullMQ da queue `bruno-process-invoice`. Para cada job:
 *
 *   1. Carrega fatura + customer + provider + toggle (multi-tenant gate).
 *   2. Re-verifica janela horária no TZ do tenant. Fora → status='waiting_window'.
 *   3. Invoca `invokeBruno(...)` (LLM Haiku + tool gerar_pix_dinamico).
 *   4. Passa output para Júlia via `invokeJulia({proposedAction})`.
 *      - BLOCKED → markVetoed + audit, encerra.
 *      - APPROVED (com ou sem ajuste) → envia via Meta WhatsApp template.
 *   5. Persiste comunicação + markSent + audit `bruno_send_message`.
 *
 * Falhas Meta → markFailed + nextRetryAt para janela seguinte (outbound-retry pega).
 */

import { eq } from "drizzle-orm";
import { Worker, type Job } from "bullmq";
import { db } from "../db";
import { logger } from "../logger";
import {
  agentToggles,
  customers,
  invoices,
  providers,
  whatsappOptouts,
} from "@shared/schema";
import { storage } from "../storage";
import { getRedisConnection, QUEUE_NAMES } from "../lib/queue";
import { invokeBruno, BRUNO_AGENT_ID, type BrunoInput } from "../agents/bruno";
import { invokeJulia } from "../agents/julia";
import { createMetaClient, MetaApiError } from "../communications/whatsapp/client";
import { auditAction } from "../agents/audit-actions";
import type { BrunoSchedulerJobData } from "./bruno-scheduler";

/** TZ helpers replicados para evitar dependência circular (scheduler também os define). */
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
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const obj: Record<string, string> = {};
  for (const p of parts) obj[p.type] = p.value;
  const hourRaw = obj.hour === "24" ? "00" : obj.hour;
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
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

/** Determina se `clock` está dentro da janela [inicio, fim) e respeita sabado/domingo. */
function isWithinWindow(
  clock: LocalClock,
  inicio: string,
  fim: string,
  permiteSabado: boolean,
  permiteDomingo: boolean,
): boolean {
  if (clock.weekday === 0 && !permiteDomingo) return false;
  if (clock.weekday === 6 && !permiteSabado) return false;
  const start = parseHourMin(inicio);
  const end = parseHourMin(fim);
  const cur = clock.hour * 60 + clock.minute;
  const s = start.hour * 60 + start.minute;
  const e = end.hour * 60 + end.minute;
  return cur >= s && cur < e;
}

/** Calcula próximo momento que reentra na janela (para nextRetryAt). */
function nextWindowOpenUtc(
  tz: string,
  inicio: string,
  permiteSabado: boolean,
  permiteDomingo: boolean,
  now = new Date(),
): Date {
  const { hour: hi, minute: mi } = parseHourMin(inicio);
  for (let addDays = 0; addDays < 8; addDays++) {
    const candidate = new Date(now.getTime() + addDays * 24 * 3600 * 1000);
    const clock = localClock(tz, candidate);
    // weekday gate
    if (clock.weekday === 0 && !permiteDomingo) continue;
    if (clock.weekday === 6 && !permiteSabado) continue;
    // Para hoje, só serve se ainda não passamos da hora de início
    if (addDays === 0) {
      const cur = clock.hour * 60 + clock.minute;
      const open = hi * 60 + mi;
      if (cur >= open) continue;
    }
    // Reconstrói o instante UTC correspondente à abertura local (aprox via offset)
    // Estratégia: produz uma string "YYYY-MM-DD HH:MM" no fuso e converte usando new Date(str + tzOffset).
    // Atalho: assume offset BR (-03:00); precisão de minuto é suficiente para retry.
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(candidate);
    const offsetMinutes = (() => {
      // Calcula offset corrente do TZ em minutos vs UTC, usando trick com Date.UTC.
      const local = new Date(candidate.toLocaleString("en-US", { timeZone: tz }));
      const utc = new Date(candidate.toLocaleString("en-US", { timeZone: "UTC" }));
      return Math.round((local.getTime() - utc.getTime()) / 60000);
    })();
    const [y, mo, d] = ymd.split("-").map(Number);
    // Construímos como "esta data local às `hi`:`mi`" e convertemos pro UTC subtraindo offset.
    const localUtcMs = Date.UTC(y, mo - 1, d, hi, mi, 0, 0);
    return new Date(localUtcMs - offsetMinutes * 60_000);
  }
  // Fallback: 1h à frente
  return new Date(now.getTime() + 3600_000);
}

function formatBR(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function formatDateBR(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

interface ProcessOutcome {
  status: "sent" | "vetoed" | "waiting_window" | "failed" | "skipped";
  reason?: string;
}

export async function processBrunoJob(data: BrunoSchedulerJobData): Promise<ProcessOutcome> {
  const auditStorage = storage.auditLog;
  const correlationId = data.correlationId;

  // 1. Carrega tudo
  const [inv] = await db.select().from(invoices)
    .where(eq(invoices.id, data.invoiceId))
    .limit(1);

  if (!inv || inv.providerId !== data.providerId || inv.customerId !== data.customerId) {
    await storage.outboundAttempt.markFailed(data.attemptId, "invoice_not_found_or_mismatch", new Date(Date.now() + 3600_000));
    return { status: "failed", reason: "invoice_not_found_or_mismatch" };
  }
  if (inv.status === "paid") {
    await auditStorage.registrarAcao(data.providerId, {
      ...auditAction("bruno_skipped_paid"),
      resourceId: String(data.customerId),
      actorType: "agent",
      actorId: BRUNO_AGENT_ID,
      actorName: "Bruno — Atendente Preventivo",
      payload: { invoiceId: data.invoiceId, step: data.step, correlationId },
    });
    await storage.outboundAttempt.markVetoed(data.attemptId, "self", "invoice already paid");
    return { status: "skipped", reason: "invoice_paid" };
  }

  const [cust] = await db.select().from(customers)
    .where(eq(customers.id, data.customerId))
    .limit(1);
  if (!cust || cust.providerId !== data.providerId) {
    await storage.outboundAttempt.markFailed(data.attemptId, "customer_mismatch", new Date(Date.now() + 3600_000));
    return { status: "failed", reason: "customer_mismatch" };
  }
  if (!cust.phone) {
    await storage.outboundAttempt.markFailed(data.attemptId, "customer_no_phone", new Date(Date.now() + 24 * 3600_000));
    return { status: "failed", reason: "customer_no_phone" };
  }

  // Opt-out de última hora (FR-013)
  const [opt] = await db.select().from(whatsappOptouts).where(eq(whatsappOptouts.phoneNumber, cust.phone)).limit(1);
  if (opt && opt.providerId === data.providerId) {
    await auditStorage.registrarAcao(data.providerId, {
      ...auditAction("bruno_skipped_optout"),
      resourceId: String(data.customerId),
      actorType: "agent",
      actorId: BRUNO_AGENT_ID,
      actorName: "Bruno — Atendente Preventivo",
      payload: { invoiceId: data.invoiceId, step: data.step, correlationId },
    });
    await storage.outboundAttempt.markVetoed(data.attemptId, "self", "customer opt-out");
    return { status: "skipped", reason: "opt_out" };
  }

  const [prov] = await db.select().from(providers).where(eq(providers.id, data.providerId)).limit(1);
  if (!prov) {
    await storage.outboundAttempt.markFailed(data.attemptId, "provider_not_found", new Date(Date.now() + 3600_000));
    return { status: "failed", reason: "provider_not_found" };
  }

  const [toggle] = await db.select().from(agentToggles).where(eq(agentToggles.providerId, data.providerId)).limit(1);
  if (!toggle || !toggle.brunoAtivo) {
    await storage.outboundAttempt.markVetoed(data.attemptId, "self", "bruno disabled mid-flight");
    return { status: "skipped", reason: "bruno_disabled" };
  }

  // 2. Janela horária
  const tz = resolveTz(prov.addressState);
  const clock = localClock(tz);
  const withinWindow = isWithinWindow(
    clock,
    toggle.janelaInicio,
    toggle.janelaFim,
    toggle.permiteSabado,
    toggle.permiteDomingo,
  );
  if (!withinWindow) {
    const reopen = nextWindowOpenUtc(tz, toggle.janelaInicio, toggle.permiteSabado, toggle.permiteDomingo);
    await storage.outboundAttempt.markWaitingWindow(data.attemptId, reopen);
    await auditStorage.registrarAcao(data.providerId, {
      ...auditAction("bruno_skipped_window"),
      resourceId: String(data.customerId),
      actorType: "agent",
      actorId: BRUNO_AGENT_ID,
      actorName: "Bruno — Atendente Preventivo",
      payload: { invoiceId: data.invoiceId, step: data.step, nextRetryAt: reopen.toISOString(), correlationId },
    });
    return { status: "waiting_window", reason: "outside_window" };
  }

  // 3. Invoca Bruno (LLM + tool)
  const dueDateStr = (inv.dueDate instanceof Date
    ? inv.dueDate.toISOString().slice(0, 10)
    : String(inv.dueDate).slice(0, 10));

  const invoiceValueNum = Number(inv.value);
  const brunoInput: BrunoInput = {
    providerName: prov.tradeName ?? prov.name,
    providerSupportPhone: prov.contactPhone ?? undefined,
    customerName: cust.name,
    invoiceNumber: `INV-${inv.id}`,
    invoiceId: inv.id,
    invoiceValue: invoiceValueNum,
    invoiceDueDate: dueDateStr,
    step: data.step,
    availableTemplates: toggle.templateBrunoNome
      ? [{
          name: toggle.templateBrunoNome,
          variables: ["nome_cliente", "valor", "data_vencimento"],
          hasMediaQrCode: true,
        }]
      : [{
          name: "lembrete_prevencimento_v1",
          variables: ["nome_cliente", "valor", "data_vencimento"],
          hasMediaQrCode: true,
        }],
  };

  const brunoResult = await invokeBruno(data.providerId, brunoInput, {
    attemptId: data.attemptId,
    customerId: data.customerId,
    correlationId,
  });

  if (!brunoResult.success || !brunoResult.output?.pix) {
    const reason = `bruno_failed: ${brunoResult.error ?? "no_pix"}`;
    await storage.outboundAttempt.markFailed(data.attemptId, reason, new Date(Date.now() + 3600_000));
    await auditStorage.registrarAcao(data.providerId, {
      ...auditAction("bruno_failed_send"),
      resourceId: String(data.customerId),
      actorType: "agent",
      actorId: BRUNO_AGENT_ID,
      actorName: "Bruno — Atendente Preventivo",
      payload: { invoiceId: data.invoiceId, step: data.step, error: brunoResult.error, correlationId },
    });
    return { status: "failed", reason };
  }

  const output = brunoResult.output;
  const pix = output.pix!; // narrowed pelo guard acima (success && output.pix presentes)

  // Audit: Bruno gerou Pix
  await auditStorage.registrarAcao(data.providerId, {
    ...auditAction("bruno_generate_pix"),
    resourceId: String(data.customerId),
    actorType: "agent",
    actorId: BRUNO_AGENT_ID,
    actorName: "Bruno — Atendente Preventivo",
    payload: {
      invoiceId: data.invoiceId,
      step: data.step,
      asaasPaymentId: pix.asaasPaymentId,
      pixChargeId: pix.pixChargeId,
      templateName: output.templateName,
      reused: brunoResult.pixReused ?? false,
      correlationId,
    },
  });

  // Linka pix_charge ao outbound_attempt para listagem em painel
  if (pix.pixChargeId) {
    try {
      const schema = await import("@shared/schema");
      await db.update(schema.outboundAttempts)
        .set({ pixChargeId: pix.pixChargeId, updatedAt: new Date() })
        .where(eq(schema.outboundAttempts.id, data.attemptId));
    } catch (err) {
      logger.warn({ action: "bruno_attempt_pix_link_failed", err: (err as Error)?.message }, "falha ao linkar pix_charge");
    }
  }

  // 4. Júlia compliance check (sobre conteúdo derivado do template)
  await storage.outboundAttempt.markAwaitingCompliance(data.attemptId);

  // Para Júlia avaliar o conteúdo semanticamente, montamos uma representação textual
  // do template com variáveis substituídas (o body Meta real virá igual).
  const renderedBody =
    `Olá, ${output.variables["nome_cliente"] ?? firstName(cust.name)}! ` +
    `Sua fatura de ${output.variables["valor"] ?? formatBR(invoiceValueNum)} ` +
    `vence em ${output.variables["data_vencimento"] ?? formatDateBR(dueDateStr)}. ` +
    `Pix em anexo.`;

  const decision = await invokeJulia({
    tenantId: data.providerId,
    customerId: data.customerId,
    agentId: BRUNO_AGENT_ID,
    actionType: "send_message",
    channel: "whatsapp",
    content: renderedBody,
    scheduledAt: new Date().toISOString(),
    actionPayload: {
      templateName: output.templateName,
      variables: output.variables,
      step: data.step,
      invoiceId: data.invoiceId,
    },
    correlationId,
  });

  if (decision.decision === "BLOCKED") {
    await storage.outboundAttempt.markVetoed(
      data.attemptId,
      decision.complianceCheckId ?? "no-id",
      decision.blockingReasons?.join("; ") ?? "compliance",
    );
    return { status: "vetoed", reason: decision.blockingReasons?.join("; ") };
  }

  // 5. Envia template HSM via Meta
  const meta = await createMetaClient(data.providerId).catch((err) => {
    logger.error({ action: "bruno_meta_client_failed", providerId: data.providerId, err: (err as Error)?.message }, "Bruno: cliente Meta indisponível");
    return null;
  });
  if (!meta) {
    await storage.outboundAttempt.markFailed(data.attemptId, "meta_client_unavailable", new Date(Date.now() + 3600_000));
    return { status: "failed", reason: "meta_client_unavailable" };
  }

  let messageId: string;
  try {
    const sendResult = await meta.sendTemplate({
      to: cust.phone,
      templateName: output.templateName,
      language: "pt_BR",
      params: [
        { type: "text", text: output.variables["nome_cliente"] ?? firstName(cust.name) },
        { type: "text", text: output.variables["valor"] ?? formatBR(invoiceValueNum) },
        { type: "text", text: output.variables["data_vencimento"] ?? formatDateBR(dueDateStr) },
      ],
    });
    messageId = sendResult.messageId;
  } catch (err) {
    const msg = err instanceof MetaApiError ? `meta:${err.status}:${err.message}` : (err as Error)?.message ?? "unknown";
    await storage.outboundAttempt.markFailed(data.attemptId, msg, new Date(Date.now() + 3600_000));
    await auditStorage.registrarAcao(data.providerId, {
      ...auditAction("bruno_failed_send"),
      resourceId: String(data.customerId),
      actorType: "agent",
      actorId: BRUNO_AGENT_ID,
      actorName: "Bruno — Atendente Preventivo",
      payload: { invoiceId: data.invoiceId, step: data.step, error: msg, correlationId },
    });
    return { status: "failed", reason: msg };
  }

  // 6. Persiste comunicação outbound + markSent
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
      agentId: BRUNO_AGENT_ID,
      templateName: output.templateName,
    } as Parameters<typeof storage.communications.create>[1]);
    communicationId = created.id;
  } catch (err) {
    logger.warn({ action: "bruno_comm_persist_failed", err: (err as Error)?.message }, "Bruno: falha ao persistir comunicação outbound");
  }

  await storage.outboundAttempt.markSent(
    data.attemptId,
    decision.complianceCheckId ?? "unknown",
    communicationId ?? 0,
  );

  await auditStorage.registrarAcao(data.providerId, {
    ...auditAction("bruno_send_message"),
    resourceId: String(data.customerId),
    actorType: "agent",
    actorId: BRUNO_AGENT_ID,
    actorName: "Bruno — Atendente Preventivo",
    payload: {
      invoiceId: data.invoiceId,
      step: data.step,
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

let _worker: Worker<BrunoSchedulerJobData> | null = null;

export function startBrunoWorker(): Worker<BrunoSchedulerJobData> {
  if (_worker) return _worker;
  _worker = new Worker<BrunoSchedulerJobData>(
    QUEUE_NAMES.BRUNO_PROCESS_INVOICE,
    async (job: Job<BrunoSchedulerJobData>) => {
      const result = await processBrunoJob(job.data);
      logger.info(
        {
          action: "bruno_job_done",
          jobId: job.id,
          providerId: job.data.providerId,
          invoiceId: job.data.invoiceId,
          step: job.data.step,
          status: result.status,
          reason: result.reason,
        },
        "Bruno job concluído",
      );
      return result;
    },
    {
      connection: getRedisConnection(),
      concurrency: 5,
    },
  );
  _worker.on("failed", (job, err) => {
    logger.error(
      { action: "bruno_job_failed", jobId: job?.id, providerId: job?.data?.providerId, err: err.message },
      "Bruno job falhou",
    );
  });
  return _worker;
}

export async function stopBrunoWorker(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
  }
}
