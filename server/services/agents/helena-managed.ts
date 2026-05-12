/**
 * Spec 008.6 Batch 6 — Helena (atendente reativo WhatsApp) via Managed Agents.
 *
 * Helena é a invocação mais complexa: até 8 turnos, 8 tools custom, memória
 * persistente cross-session. O agent na plataforma deve ter registrado:
 *   - consultar_fatura, gerar_pix, gerar_segunda_via, consultar_pagamento,
 *     registrar_promessa, handoff_humano, handoff_rafael, enviar_whatsapp,
 *     consultar_memoria_cliente, julia_validate
 *   - Memory Tool da plataforma (ou agent_memories via custom HTTP — dual-write
 *     enquanto migração)
 *
 * Adapter MVP:
 *   1. Carrega contexto enriquecido (memória, conversa recente) no backend
 *   2. Serializa como user message contendo conversação + memórias
 *   3. invokeAgent gerencia o loop tool-use sozinho
 *   4. Adapter parseia escalação / outboundMessageId do output final
 *
 * **Limitações desta versão MVP:**
 *   - Memória cross-session: por enquanto carregada do agent_memories LOCAL
 *     e injetada na user message. Próximo passo (Spec 008.6.1+): Memory Tool
 *     nativa da plataforma como source-of-truth.
 *   - Compliance check (Júlia) é responsabilidade do agent: ele DEVE chamar
 *     `enviar_whatsapp` que internamente faz o gate Júlia (Batch 2).
 */

import { logger } from "../../logger";
import { invokeAgent } from "./platform-client";
import { logInvocation, hashInput } from "./invocation-log";
import { loadEnrichedContext } from "../../agents/memory";
import { CommunicationsStorage } from "../../storage/communications.storage";
import { buildCustomerContext } from "./context-enricher";
import type { HelenaInput, HelenaResult } from "../../agents/helena";

const HELENA_AGENT_ID = "agt_reativo_v1";
const commStorage = new CommunicationsStorage();

function safeJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try {
    const v = JSON.parse(cleaned);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const v = JSON.parse(match[0]);
      return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

export async function invokeHelenaManaged(input: HelenaInput): Promise<HelenaResult> {
  const started = Date.now();

  // 1. Pre-carrega contexto + persiste inbound (mesma lógica do direct)
  const ctx = await loadEnrichedContext(input.tenantId, input.customerId, HELENA_AGENT_ID);

  try {
    await commStorage.create(input.tenantId, {
      customerId: input.customerId,
      channel: "whatsapp",
      direction: "inbound",
      content: input.messageText,
      status: "delivered",
      externalMessageId: input.whatsappMessageId,
      sentAt: new Date(),
      agentId: HELENA_AGENT_ID,
    } as Parameters<CommunicationsStorage["create"]>[1]);
  } catch (err) {
    logger.warn(
      { action: "helena_managed_inbound_persist_failed", err: (err as Error)?.message },
      "[helena-managed] inbound persist failed",
    );
  }

  // 2. Enriquece com customer health context (Spec 010A integration).
  // Falha graciosa: null não bloqueia conversação, agente segue sem.
  const healthContext = await buildCustomerContext(input.tenantId, input.customerId);

  // 3. Monta payload com tudo que a Helena precisa
  const userMessage = JSON.stringify({
    instruction:
      "Atenda o cliente. Use as tools necessárias (consultar_fatura, gerar_pix, etc.) " +
      "e SEMPRE passe outbound text por enviar_whatsapp (que faz gate Júlia automaticamente). " +
      "Calibre tom conforme healthTier do customerHealth: gold=cortês, healthy=normal, " +
      "warning=cordial extra, critical=respeitoso máximo. Se severity=human_intervention, " +
      "escale imediato. " +
      "Quando concluir, emita JSON: { outboundMessageId?, escalated, escalationType?, escalationReason?, " +
      "memoryUpdated: {facts:[], promises:[]} }",
    customerId: input.customerId,
    senderPhone: input.senderPhone,
    messageText: input.messageText,
    whatsappMessageId: input.whatsappMessageId,
    enrichedContext: ctx,
    customerHealth: healthContext,  // null se erro; agente segue sem
  });

  const invocation = await invokeAgent({
    agent: "helena",
    providerId: input.tenantId,
    userMessage,
    correlationId: input.correlationId,
    maxTurns: 8,
    timeoutMs: 60_000,
  });

  // 3. Parseia final state
  const parsed = invocation.finalText ? safeJson(invocation.finalText) : null;

  const escalated = !!parsed?.escalated;
  const escalationType = typeof parsed?.escalationType === "string"
    ? (parsed.escalationType as HelenaResult["escalationType"])
    : undefined;
  const escalationReason = typeof parsed?.escalationReason === "string"
    ? parsed.escalationReason
    : undefined;
  const outboundMessageId = typeof parsed?.outboundMessageId === "string"
    ? parsed.outboundMessageId
    : undefined;
  const memoryUpdated = (parsed?.memoryUpdated as HelenaResult["memoryUpdated"]) ?? { facts: [], promises: [] };

  // taskCreated quando handoff_humano foi chamado
  const handoffCall = invocation.toolCalls.find((c) => c.toolName === "handoff_humano");
  let taskCreated: HelenaResult["taskCreated"] | undefined;
  if (handoffCall?.output && typeof handoffCall.output === "object") {
    const out = handoffCall.output as { taskId?: string };
    if (out.taskId) {
      taskCreated = { taskId: out.taskId, priority: "normal" };
    }
  }

  const result: HelenaResult = {
    success: invocation.status === "idled" && !!parsed,
    outboundMessageId,
    escalated,
    escalationType,
    escalationReason,
    taskCreated,
    turnsUsed: invocation.turnsUsed,
    toolsCalled: invocation.toolCalls.map((c) => c.toolName),
    memoryUpdated,
    complianceCheckIds: [], // platform faz Júlia via enviar_whatsapp tool; backend não tem visibility direta
    latencyMs: invocation.latencyMs,
    tokensInput: invocation.tokensInput,
    tokensOutput: invocation.tokensOutput,
  };

  void logInvocation({
    providerId: input.tenantId,
    agentId: "helena",
    runtime: "managed",
    anthropicSessionId: invocation.anthropicSessionId,
    anthropicAgentId: invocation.anthropicAgentId,
    inputHash: hashInput({
      customerId: input.customerId,
      whatsappMessageId: input.whatsappMessageId,
    }),
    outputJson: result,
    tokensInput: invocation.tokensInput,
    tokensOutput: invocation.tokensOutput,
    latencyMs: invocation.latencyMs,
    status: invocation.status === "idled" ? "ok" : "error",
    errorMessage: invocation.errorMessage ?? null,
    correlationId: input.correlationId ?? null,
  });

  logger.info(
    {
      action: "helena_managed_done",
      tenantId: input.tenantId,
      customerId: input.customerId,
      sessionId: invocation.anthropicSessionId,
      success: result.success,
      escalated,
      escalationType,
      turnsUsed: invocation.turnsUsed,
      toolsCount: invocation.toolCalls.length,
      latencyMs: Date.now() - started,
      correlationId: input.correlationId,
    },
    "Helena managed invocation finished",
  );

  return result;
}

/**
 * Comparison para shadow mode. Helena tem muito output text — não comparamos
 * mensagem exata (variabilidade LLM). Critério: escalation flag + outbound
 * existence + tools count.
 */
export function compareHelenaOutputs(
  direct: HelenaResult,
  managed: HelenaResult,
): { identical: boolean; significantDiff: boolean; summary: string } {
  const directHasOutbound = !!direct.outboundMessageId;
  const managedHasOutbound = !!managed.outboundMessageId;
  const identical =
    direct.escalated === managed.escalated &&
    direct.escalationType === managed.escalationType &&
    directHasOutbound === managedHasOutbound &&
    direct.toolsCalled.length === managed.toolsCalled.length;
  const significantDiff =
    direct.escalated !== managed.escalated ||
    direct.escalationType !== managed.escalationType ||
    directHasOutbound !== managedHasOutbound;
  const summary = significantDiff
    ? `DIFF: direct(esc=${direct.escalated}/type=${direct.escalationType}/outbound=${directHasOutbound}) vs managed(esc=${managed.escalated}/type=${managed.escalationType}/outbound=${managedHasOutbound})`
    : identical
      ? "identical"
      : "cosmetic_diff (tools/text variance)";
  return { identical, significantDiff, summary };
}
