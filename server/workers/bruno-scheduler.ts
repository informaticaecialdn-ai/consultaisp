/**
 * Spec 004 — Bruno Scheduler (T024).
 *
 * Cron diário por tenant. A cada hora, identifica providers cuja
 * `agent_toggles.schedulerHoraLocal` cai no slot da hora atual no fuso do tenant
 * (derivado de `providers.address_state`). Para cada provider sortudo:
 *
 *   1. Lista faturas com `dueDate IN (hoje+3, hoje+1) AND status='pendente'`.
 *   2. Filtra customers com phone preenchido e SEM entrada em `whatsapp_optouts`.
 *   3. Para cada fatura sobrevivente: `outbound-attempt.tryReserve()` (UNIQUE
 *      protege re-execução no mesmo dia / mesmo step). Se reservou, enfileira
 *      job na queue `bruno-process-invoice`.
 *
 * Idempotência: a UNIQUE em `outbound_attempts(invoice_id, step, scheduled_for::date)`
 * cobre o caso de Bruno rodar duas vezes no mesmo dia (corrida do scheduler ou
 * múltiplos processos).
 */

import { and, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
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
import { getQueue, OUTBOUND_JOB_DEFAULTS, QUEUE_NAMES } from "../lib/queue";

const TICK_INTERVAL_MS = 60 * 60 * 1000; // hourly
const FIRST_TICK_DELAY_MS = 30 * 1000;   // 30s após boot

/** Maioria das UFs usam São_Paulo. Apenas algumas exceções (Amazonas/Mato Grosso/Acre/Rondônia). */
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

interface ProviderClock {
  /** Hour 0-23 no fuso local do provider. */
  hour: number;
  /** Dia da semana 0-6 (0=domingo) no fuso local. */
  weekday: number;
  /** YYYY-MM-DD no fuso local. */
  ymd: string;
}

function nowInTz(tz: string, now = new Date()): ProviderClock {
  // pt-BR locale com `weekday: short` + horas no fuso. Usamos `Intl.DateTimeFormat`
  // com partes para extrair hora/dia/semana sem libs.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const obj: Record<string, string> = {};
  for (const p of parts) obj[p.type] = p.value;

  const ymd = `${obj.year}-${obj.month}-${obj.day}`;
  const hourRaw = obj.hour === "24" ? "00" : obj.hour;
  const hour = Number.parseInt(hourRaw, 10);

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = weekdayMap[obj.weekday] ?? new Date(`${ymd}T00:00:00Z`).getUTCDay();

  return { hour, weekday, ymd };
}

function parseHour(hhmmss: string): number {
  const [hh] = hhmmss.split(":");
  return Math.max(0, Math.min(23, Number.parseInt(hh, 10) || 0));
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

interface SchedulerCandidate {
  providerId: number;
  providerName: string;
  providerState: string | null;
  customerId: number;
  customerName: string;
  customerPhone: string;
  invoiceId: number;
  invoiceValue: number; // reais (parsed de numeric)
  invoiceDueDate: string; // YYYY-MM-DD
  step: "D-3" | "D-1";
}

/**
 * Varre faturas a vencer em D+3 ou D+1 para o provider e retorna candidatos
 * elegíveis (cliente com phone, sem opt-out).
 */
async function findCandidates(
  providerId: number,
  todayYmd: string,
): Promise<SchedulerCandidate[]> {
  const dueIn3 = addDays(todayYmd, 3);
  const dueIn1 = addDays(todayYmd, 1);

  // Faturas em status pendente com vencimento nessas datas (compara dueDate como date).
  const rows = await db
    .select({
      providerId: invoices.providerId,
      providerName: providers.name,
      providerState: providers.addressState,
      invoiceId: invoices.id,
      invoiceValue: invoices.value,
      invoiceDueDate: invoices.dueDate,
      customerId: customers.id,
      customerName: customers.name,
      customerPhone: customers.phone,
    })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .innerJoin(providers, eq(providers.id, invoices.providerId))
    .where(
      and(
        eq(invoices.providerId, providerId),
        ne(invoices.status, "paid"),
        ne(invoices.status, "cancelled"),
        isNotNull(customers.phone),
        sql`${invoices.dueDate}::date IN (${dueIn3}::date, ${dueIn1}::date)`,
      ),
    );

  if (rows.length === 0) return [];

  // Resolve opt-outs num único query, filtra in-memory.
  const phones = Array.from(new Set(rows.map((r) => r.customerPhone).filter((p): p is string => !!p)));
  const optedOut = phones.length > 0
    ? new Set(
        (await db
          .select({ phone: whatsappOptouts.phoneNumber })
          .from(whatsappOptouts)
          .where(and(
            eq(whatsappOptouts.providerId, providerId),
            inArray(whatsappOptouts.phoneNumber, phones),
          ))).map((r) => r.phone),
      )
    : new Set<string>();

  const out: SchedulerCandidate[] = [];
  for (const r of rows) {
    if (!r.customerPhone) continue;
    if (optedOut.has(r.customerPhone)) continue;

    // Determina step pela data
    const dueDateStr = (r.invoiceDueDate instanceof Date
      ? r.invoiceDueDate.toISOString().slice(0, 10)
      : String(r.invoiceDueDate)).slice(0, 10);

    let step: "D-3" | "D-1";
    if (dueDateStr === dueIn3) step = "D-3";
    else if (dueDateStr === dueIn1) step = "D-1";
    else continue;

    const valueNum = typeof r.invoiceValue === "number"
      ? r.invoiceValue
      : Number(r.invoiceValue);
    if (!Number.isFinite(valueNum) || valueNum <= 0) continue;

    out.push({
      providerId: r.providerId,
      providerName: r.providerName,
      providerState: r.providerState,
      customerId: r.customerId,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      invoiceId: r.invoiceId,
      invoiceValue: valueNum,
      invoiceDueDate: dueDateStr,
      step,
    });
  }
  return out;
}

export interface BrunoSchedulerJobData {
  providerId: number;
  invoiceId: number;
  customerId: number;
  attemptId: number;
  step: "D-3" | "D-1";
  scheduledForIso: string;
  correlationId: string;
}

let _schedulerTimer: NodeJS.Timeout | null = null;
let _ticking = false;

/**
 * Tick principal: percorre tenants com bruno_ativo e dispara varredura
 * para aqueles cujo `schedulerHoraLocal` casa com a hora atual no fuso do tenant.
 */
export async function runBrunoSchedulerTick(now = new Date()): Promise<{
  providersScanned: number;
  jobsEnqueued: number;
  reservationsSkipped: number;
}> {
  let providersScanned = 0;
  let jobsEnqueued = 0;
  let reservationsSkipped = 0;

  const toggles = await storage.agentToggle.listProvidersWithBrunoActive();
  if (toggles.length === 0) {
    return { providersScanned, jobsEnqueued, reservationsSkipped };
  }

  // Resolve UF de cada provider em batch.
  const providerIds = toggles.map((t) => t.providerId);
  const provRows = await db
    .select({ id: providers.id, addressState: providers.addressState })
    .from(providers)
    .where(inArray(providers.id, providerIds));
  const stateById = new Map(provRows.map((p) => [p.id, p.addressState]));

  const queue = getQueue(QUEUE_NAMES.BRUNO_PROCESS_INVOICE);

  for (const t of toggles) {
    const state = stateById.get(t.providerId) ?? null;
    const tz = resolveTz(state);
    const clock = nowInTz(tz, now);
    const schedulerHour = parseHour(t.schedulerHoraLocal);

    if (clock.hour !== schedulerHour) continue;

    // Pula final de semana se config não permitir
    if (clock.weekday === 6 && !t.permiteSabado) continue;
    if (clock.weekday === 0 && !t.permiteDomingo) continue;

    providersScanned++;

    let candidates: SchedulerCandidate[];
    try {
      candidates = await findCandidates(t.providerId, clock.ymd);
    } catch (err) {
      logger.error(
        { action: "bruno_scheduler_find_candidates_failed", providerId: t.providerId, err: (err as Error)?.message },
        "Bruno scheduler: falha ao listar candidatos",
      );
      continue;
    }

    if (candidates.length === 0) {
      logger.info(
        { action: "bruno_scheduler_no_candidates", providerId: t.providerId, ymd: clock.ymd },
        "Bruno scheduler: nenhum candidato para hoje",
      );
      continue;
    }

    const scheduledFor = new Date(now);
    const correlationId = `bruno-${t.providerId}-${clock.ymd}`;

    for (const c of candidates) {
      try {
        const reserved = await storage.outboundAttempt.tryReserve({
          providerId: c.providerId,
          customerId: c.customerId,
          invoiceId: c.invoiceId,
          agentId: "bruno_v1",
          step: c.step,
          scheduledFor,
        });

        if (!reserved) {
          reservationsSkipped++;
          continue;
        }

        const jobData: BrunoSchedulerJobData = {
          providerId: c.providerId,
          invoiceId: c.invoiceId,
          customerId: c.customerId,
          attemptId: reserved.id,
          step: c.step,
          scheduledForIso: scheduledFor.toISOString(),
          correlationId: `${correlationId}-inv${c.invoiceId}`,
        };

        await queue.add("process", jobData, {
          ...OUTBOUND_JOB_DEFAULTS,
          jobId: `bruno-${c.providerId}-${c.invoiceId}-${c.step}-${clock.ymd}`,
        });
        jobsEnqueued++;
      } catch (err) {
        logger.error(
          {
            action: "bruno_scheduler_enqueue_failed",
            providerId: c.providerId,
            invoiceId: c.invoiceId,
            err: (err as Error)?.message,
          },
          "Bruno scheduler: falha ao reservar/enfileirar",
        );
      }
    }

    logger.info(
      {
        action: "bruno_scheduler_provider_done",
        providerId: t.providerId,
        candidates: candidates.length,
        ymd: clock.ymd,
      },
      "Bruno scheduler concluiu provider",
    );
  }

  return { providersScanned, jobsEnqueued, reservationsSkipped };
}

export function startBrunoScheduler(): void {
  if (_schedulerTimer) return;
  logger.info({ action: "bruno_scheduler_start" }, "Bruno scheduler ligado (tick horário)");

  const tick = async () => {
    if (_ticking) return;
    _ticking = true;
    try {
      const result = await runBrunoSchedulerTick();
      if (result.providersScanned > 0 || result.jobsEnqueued > 0) {
        logger.info({ action: "bruno_scheduler_tick", ...result }, "Bruno scheduler tick concluído");
      }
    } catch (err) {
      logger.error({ action: "bruno_scheduler_tick_error", err: (err as Error)?.message }, "Bruno scheduler tick falhou");
    } finally {
      _ticking = false;
    }
  };

  setTimeout(tick, FIRST_TICK_DELAY_MS);
  _schedulerTimer = setInterval(tick, TICK_INTERVAL_MS);
}

export function stopBrunoScheduler(): void {
  if (_schedulerTimer) {
    clearInterval(_schedulerTimer);
    _schedulerTimer = null;
  }
}

// Exports para testes
export const _internals = {
  findCandidates,
  nowInTz,
  resolveTz,
  parseHour,
  addDays,
};
