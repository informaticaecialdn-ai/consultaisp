/**
 * Spec 004 — Queue helpers compartilhados (Bruno, Sofia, outbound-retry).
 *
 * Lazy singletons de IORedis + BullMQ Queue. Cada queue é instanciada na
 * primeira chamada e reusada. Workers separados criam suas próprias `new Worker(...)`
 * com a mesma `connection`.
 *
 * Nome de queues centralizado para evitar typos cross-arquivo.
 */

import { Queue, type QueueOptions } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { logger } from "../logger";

export const QUEUE_NAMES = {
  BRUNO_PROCESS_INVOICE: "bruno-process-invoice",
  SOFIA_THANK: "sofia-thank",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

let _redis: Redis | null = null;
const _queues = new Map<string, Queue>();

export function getRedisConnection(): Redis {
  if (_redis) return _redis;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error(
      "REDIS_URL não configurado — Bruno/Sofia workers + outbound retry exigem Redis.",
    );
  }
  _redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null, // exigido pelo BullMQ
  });
  _redis.on("error", (err: Error) => {
    logger.error({ action: "redis_error", err: err.message }, "Redis connection error");
  });
  return _redis;
}

export function getQueue(name: QueueName, options?: Partial<QueueOptions>): Queue {
  const cached = _queues.get(name);
  if (cached) return cached;
  const q = new Queue(name, {
    connection: getRedisConnection(),
    ...(options ?? {}),
  });
  _queues.set(name, q);
  return q;
}

/** Default job options for outbound jobs — Bruno + Sofia compartilham. */
export const OUTBOUND_JOB_DEFAULTS = {
  attempts: 1, // Retry é orquestrado por outbound-retry worker (controle de janela horária).
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
} as const;

/** Fecha conexões — usado em shutdown limpo. */
export async function closeQueueResources(): Promise<void> {
  for (const q of Array.from(_queues.values())) {
    try { await q.close(); } catch { /* ignore */ }
  }
  _queues.clear();
  if (_redis) {
    try { await _redis.quit(); } catch { /* ignore */ }
    _redis = null;
  }
}
