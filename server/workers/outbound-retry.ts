/**
 * Spec 004 — Outbound retry worker (T026).
 *
 * Tick a cada 15min. Seleciona `outbound_attempts` com status='failed' E
 * attempt_count < 2 E next_retry_at <= now. Para cada um:
 *   - Re-enfileira o job correspondente (Bruno ou Sofia) com o mesmo payload original.
 *   - `markFailed` já incrementou attempt_count; após 2 falhas, marca `needs_human_review`.
 *
 * Política simples (MVP): retry leva o attempt de volta para o consumer correspondente.
 * Se ele falhar novamente, attempt_count==2 — próximo tick promove a needs_human_review.
 */

import { logger } from "../logger";
import { storage } from "../storage";
import { getQueue, OUTBOUND_JOB_DEFAULTS, QUEUE_NAMES } from "../lib/queue";
import { auditAction } from "../agents/audit-actions";
import type { BrunoSchedulerJobData } from "./bruno-scheduler";

const TICK_INTERVAL_MS = 15 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 60 * 1000;

let _timer: NodeJS.Timeout | null = null;
let _ticking = false;

export async function runOutboundRetryTick(): Promise<{ requeued: number; escalated: number }> {
  let requeued = 0;
  let escalated = 0;

  const candidates = await storage.outboundAttempt.selectForRetry(50);
  if (candidates.length === 0) return { requeued, escalated };

  const brunoQueue = getQueue(QUEUE_NAMES.BRUNO_PROCESS_INVOICE);

  for (const att of candidates) {
    // Após 2 tentativas falhas, escalonar.
    if (att.attemptCount >= 2) {
      await storage.outboundAttempt.markNeedsHumanReview(
        att.id,
        att.failureReason ?? "max_retries_exceeded",
      );
      await storage.auditLog.registrarAcao(att.providerId, {
        ...auditAction("outbound_needs_review"),
        resourceId: String(att.customerId),
        actorType: "system",
        actorId: "outbound-retry-worker",
        payload: {
          attemptId: att.id,
          step: att.step,
          agentId: att.agentId,
          invoiceId: att.invoiceId,
          attemptCount: att.attemptCount,
          failureReason: att.failureReason,
        },
      });
      escalated++;
      continue;
    }

    if (att.agentId === "bruno_v1" && att.invoiceId) {
      const data: BrunoSchedulerJobData = {
        providerId: att.providerId,
        invoiceId: att.invoiceId,
        customerId: att.customerId,
        attemptId: att.id,
        step: att.step as "D-3" | "D-1",
        scheduledForIso: new Date().toISOString(),
        correlationId: `bruno-retry-${att.id}`,
      };
      try {
        await brunoQueue.add("process", data, {
          ...OUTBOUND_JOB_DEFAULTS,
          jobId: `bruno-retry-${att.id}-${att.attemptCount + 1}`,
        });
        requeued++;
      } catch (err) {
        logger.error(
          { action: "outbound_retry_enqueue_failed", attemptId: att.id, err: (err as Error)?.message },
          "Falha ao re-enfileirar attempt",
        );
      }
    } else {
      // Sofia retry (T034+) — placeholder. Por ora marca needs_human_review.
      await storage.outboundAttempt.markNeedsHumanReview(att.id, "no_retry_handler_for_agent");
      escalated++;
    }
  }

  return { requeued, escalated };
}

export function startOutboundRetry(): void {
  if (_timer) return;
  logger.info({ action: "outbound_retry_start", intervalMs: TICK_INTERVAL_MS }, "Outbound retry worker iniciado");

  const tick = async () => {
    if (_ticking) return;
    _ticking = true;
    try {
      const result = await runOutboundRetryTick();
      if (result.requeued > 0 || result.escalated > 0) {
        logger.info({ action: "outbound_retry_tick", ...result }, "Outbound retry tick concluído");
      }
    } catch (err) {
      logger.error({ action: "outbound_retry_tick_error", err: (err as Error)?.message }, "Outbound retry tick falhou");
    } finally {
      _ticking = false;
    }
  };

  setTimeout(tick, FIRST_TICK_DELAY_MS);
  _timer = setInterval(tick, TICK_INTERVAL_MS);
}

export function stopOutboundRetry(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
