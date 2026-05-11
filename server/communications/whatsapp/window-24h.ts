/**
 * Spec 003 — Janela de 24h do WhatsApp (Customer Service Window)
 *
 * Meta exige: free-form text só pode ser enviado dentro de 24h após
 * a última mensagem INBOUND do cliente. Fora da janela só templates HSM aprovados.
 *
 * Esta helper consulta a tabela `communications` filtrando por:
 *   provider_id = X, customer_id = Y, channel = 'whatsapp', direction = 'inbound'
 *
 * Princípio I (multi-tenant): toda query filtra por providerId.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { communications, type InsertCommunication } from "@shared/schema";
import { logger } from "../../logger";

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Retorna true se a última inbound do customer está há menos de 24h.
 * Retorna false se nunca houve inbound ou se a última está expirada.
 */
export async function isWithin24hWindow(
  providerId: number,
  customerId: number,
): Promise<boolean> {
  const t0 = Date.now();
  const [last] = await db
    .select({ createdAt: communications.createdAt })
    .from(communications)
    .where(and(
      eq(communications.providerId, providerId),
      eq(communications.customerId, customerId),
      eq(communications.channel, "whatsapp"),
      eq(communications.direction, "inbound"),
    ))
    .orderBy(desc(communications.createdAt))
    .limit(1);

  const withinWindow = !!last?.createdAt
    && (Date.now() - new Date(last.createdAt).getTime()) < WINDOW_MS;

  logger.debug({
    tenantId: providerId,
    action: "whatsapp_window_check",
    customerId,
    withinWindow,
    latencyMs: Date.now() - t0,
  }, "24h window check");

  return withinWindow;
}

/**
 * Registra uma mensagem inbound em `communications` — atualiza implicitamente
 * a "última inbound" do customer, abrindo a janela de 24h.
 *
 * Esta função é usada pelo worker BullMQ ao processar webhooks.
 * Para outros callers que já fazem o insert completo via storage, basta
 * garantir que `direction='inbound'` e `channel='whatsapp'`.
 */
export async function updateLastInbound(args: {
  providerId: number;
  customerId: number;
  content: string;
  externalMessageId?: string;
  templateName?: string;
  timestamp?: Date;
}): Promise<void> {
  const t0 = Date.now();
  const payload: InsertCommunication = {
    providerId: args.providerId,
    customerId: args.customerId,
    channel: "whatsapp",
    direction: "inbound",
    content: args.content,
    status: "received",
    externalMessageId: args.externalMessageId ?? null,
    templateName: args.templateName ?? null,
    sentAt: args.timestamp ?? new Date(),
    deliveredAt: null,
    readAt: null,
    agentId: null,
  };

  await db.insert(communications).values(payload);

  logger.info({
    tenantId: args.providerId,
    action: "whatsapp_inbound_recorded",
    customerId: args.customerId,
    externalMessageId: args.externalMessageId,
    latencyMs: Date.now() - t0,
  }, "Inbound WhatsApp registrado");
}
