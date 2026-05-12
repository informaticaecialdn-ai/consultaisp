/**
 * Helena — Atendente Master (Spec 003).
 *
 * Reactive WhatsApp inbound. Direct API tool-use loop (max 8 turns).
 * Each turn:
 *   1. Send messages[] + tools to Anthropic (Sonnet 4.6).
 *   2. If stop_reason === "tool_use": execute each tool, append tool_result, loop.
 *   3. If stop_reason === "end_turn": loop ends.
 *
 * Outbound text always passes through Júlia (in the `enviar_whatsapp` tool dispatcher).
 */

import type {
  ContentBlock,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { logger } from "../logger";
import { CommunicationsStorage } from "../storage/communications.storage";
import { AgentMemoryStorage } from "../storage/agent-memory.storage";
import { createMessage } from "./anthropic-client";
import { loadPrompt } from "./prompt-loader";
import { loadEnrichedContext, extractFactsFromTurn, detectPromise, compactSummary } from "./memory";
import { executeTool, helenaTools, type ToolContext, type ToolResult } from "./tools";
// Spec 008.6 — Managed Agents adapter + shadow comparison
import { getAgentRuntime } from "../env";
import {
  invokeHelenaManaged,
  compareHelenaOutputs,
} from "../services/agents/helena-managed";
import { logInvocation, hashInput } from "../services/agents/invocation-log";

const HELENA_AGENT_ID = "agt_reativo_v1";
// Use a known-supported Sonnet model; we keep this central for easy rotation.
const HELENA_MODEL = process.env.HELENA_MODEL ?? "claude-sonnet-4-5-20250514";
const MAX_TURNS = 8;

const memStorage = new AgentMemoryStorage();
const commStorage = new CommunicationsStorage();

export interface HelenaInput {
  tenantId: number;
  customerId: number;
  messageText: string;
  senderPhone: string;
  whatsappMessageId: string;
  correlationId?: string;
}

export interface HelenaResult {
  success: boolean;
  outboundMessageId?: string;
  escalated: boolean;
  escalationType?: "humano" | "rafael" | "julia_blocked";
  escalationReason?: string;
  taskCreated?: { taskId: string; priority: "urgent" | "normal" };
  turnsUsed: number;
  toolsCalled: string[];
  memoryUpdated: { facts: string[]; promises: { date: string; value?: number }[] };
  complianceCheckIds: string[];
  latencyMs: number;
  tokensInput: number;
  tokensOutput: number;
}

export class HelenaEscalationError extends Error {
  constructor(public readonly result: HelenaResult) {
    super(`Helena escalated: ${result.escalationType} — ${result.escalationReason}`);
    this.name = "HelenaEscalationError";
  }
}

// ============================================================
// Sentiment heuristic
// ============================================================

const HOSTILE_TERMS = [
  "merda", "porra", "caralho", "imbecil", "idiot", "lixo", "ladr[ãa]o",
  "absurdo", "vergonha", "p[ée]ssimo", "horr[íi]vel", "odeio", "burro",
  "incompetente", "advogado", "procon",
];
const POSITIVE_TERMS = ["obrigad", "valeu", "ótimo", "otimo", "show", "perfeito", "legal"];

function scoreSentiment(text: string): number {
  const lower = text.toLowerCase();
  let s = 0;
  for (const t of HOSTILE_TERMS) if (new RegExp(t, "i").test(lower)) s -= 0.4;
  for (const t of POSITIVE_TERMS) if (lower.includes(t)) s += 0.3;
  return Math.max(-1, Math.min(1, s));
}

const CANCEL_HINTS = /\b(quero cancelar|cancelamento|encerrar contrato|me d[ée] baixa)\b/i;

// ============================================================
// Main loop
// ============================================================

export async function invokeHelena(input: HelenaInput): Promise<HelenaResult> {
  // Spec 008.6 — runtime feature flag
  const runtime = getAgentRuntime("helena");
  if (runtime === "managed") {
    return invokeHelenaManaged(input);
  }
  if (runtime === "shadow") {
    const [directResult, managedResult] = await Promise.allSettled([
      invokeHelenaDirect(input),
      invokeHelenaManaged(input),
    ]);
    if (directResult.status !== "fulfilled") throw directResult.reason;
    if (managedResult.status === "fulfilled") {
      const cmp = compareHelenaOutputs(directResult.value, managedResult.value);
      void logInvocation({
        providerId: input.tenantId,
        agentId: "helena",
        runtime: "shadow",
        inputHash: hashInput({
          customerId: input.customerId,
          whatsappMessageId: input.whatsappMessageId,
        }),
        outputJson: { direct: directResult.value, managed: managedResult.value, comparison: cmp },
        status: cmp.significantDiff ? "diff" : "ok",
        errorMessage: cmp.significantDiff ? cmp.summary : null,
        correlationId: input.correlationId ?? null,
      });
    }
    return directResult.value;
  }
  return invokeHelenaDirect(input);
}

async function invokeHelenaDirect(input: HelenaInput): Promise<HelenaResult> {
  const started = Date.now();
  const toolsCalled: string[] = [];
  const complianceCheckIds: string[] = [];
  let tokensInput = 0;
  let tokensOutput = 0;
  let outboundMessageId: string | undefined;
  let escalated = false;
  let escalationType: HelenaResult["escalationType"];
  let escalationReason: string | undefined;
  let taskCreated: HelenaResult["taskCreated"];

  // 1. Load context.
  const ctx = await loadEnrichedContext(input.tenantId, input.customerId, HELENA_AGENT_ID);

  // 2. Persist inbound communication (best-effort).
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
    logger.warn({ action: "helena_inbound_persist_failed", err: (err as Error)?.message }, "inbound persist failed");
  }

  // 3. Sentiment + early escalation.
  const sentiment = scoreSentiment(input.messageText);
  const recentSentiments = ((ctx.memory?.sentimentHistory ?? []) as Array<{ score?: number }>).slice(-2);
  const consecutiveHostile = sentiment < -0.5 && recentSentiments.every((s) => (s.score ?? 0) < -0.5);

  if (consecutiveHostile) {
    return finalize({
      escalated: true,
      escalationType: "humano",
      escalationReason: `Sentimento hostil persistente (score ${sentiment.toFixed(2)})`,
      priority: "urgent",
    });
  }
  if (CANCEL_HINTS.test(input.messageText)) {
    return finalize({
      escalated: true,
      escalationType: "humano",
      escalationReason: "Cliente solicitou cancelamento — encaminhar para retenção",
      priority: "urgent",
    });
  }

  // 4. Build initial messages + system prompt.
  const { systemPrompt } = loadPrompt("helena");
  const contextSnippet = JSON.stringify({
    customer: ctx.customer
      ? { id: ctx.customer.id, name: ctx.customer.name, status: ctx.customer.status, paymentStatus: ctx.customer.paymentStatus }
      : null,
    contract: ctx.contract ? { id: ctx.contract.id, plan: ctx.contract.plan, value: ctx.contract.value } : null,
    recentInvoices: ctx.recentInvoices.slice(0, 5).map((i) => ({
      id: i.id, value: i.value, dueDate: i.dueDate, status: i.status,
    })),
    paymentHistory: ctx.paymentHistory,
    score: ctx.score,
    memory: ctx.memory ? { summary: ctx.memory.summary, topics: ctx.memory.topics } : null,
  });

  const toolCtx: ToolContext = {
    tenantId: input.tenantId,
    customerId: input.customerId,
    senderPhone: input.senderPhone,
    agentId: HELENA_AGENT_ID,
    correlationId: input.correlationId,
    complianceCheckIds,
  };

  const messages: MessageParam[] = [
    {
      role: "user",
      content:
        `Contexto enriquecido (NÃO repita ao cliente):\n${contextSnippet}\n\n` +
        `Mensagem do cliente (${input.senderPhone}):\n${input.messageText}`,
    },
  ];

  let turn = 0;
  let stop = false;
  let lastEscalation: ToolResult["escalation"];

  while (turn < MAX_TURNS && !stop) {
    turn++;
    const res = await createMessage({
      model: HELENA_MODEL,
      max_tokens: 1024,
      temperature: 0.2,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages,
      tools: helenaTools,
      correlationId: input.correlationId,
    });

    tokensInput += res.tokensInput;
    tokensOutput += res.tokensOutput;

    const assistantBlocks: ContentBlock[] = res.message.content;
    // Push assistant response (full content blocks) back into history so the
    // subsequent tool_result has something to attach to.
    messages.push({ role: "assistant", content: assistantBlocks });

    const toolUses = assistantBlocks.filter((b): b is ToolUseBlock => b.type === "tool_use");
    const textBlocks = assistantBlocks.filter((b) => b.type === "text") as Array<{ type: "text"; text: string }>;

    if (res.message.stop_reason !== "tool_use" || toolUses.length === 0) {
      // Helena finished without producing a WhatsApp send — log the final text.
      if (textBlocks.length > 0) {
        logger.debug(
          { tenantId: input.tenantId, customerId: input.customerId, action: "helena_end_turn", text: textBlocks.map((b) => b.text).join("\n").slice(0, 200) },
          "Helena end_turn without enviar_whatsapp",
        );
      }
      stop = true;
      break;
    }

    const toolResults: ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      toolsCalled.push(tu.name);
      const result = await executeTool(tu.name, tu.input, toolCtx);

      if (result.outboundMessageId) outboundMessageId = result.outboundMessageId;
      if (result.escalation) {
        lastEscalation = result.escalation;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error }),
        ...(result.ok ? {} : { is_error: true }),
      });

      if (result.escalation) stop = true;
      if (tu.name === "enviar_whatsapp" && result.ok) stop = true; // Successful send ends the run.
    }

    messages.push({ role: "user", content: toolResults });
  }

  if (lastEscalation) {
    escalated = true;
    escalationType = lastEscalation.type;
    escalationReason = lastEscalation.reason;
    if (lastEscalation.type === "humano") {
      taskCreated = { taskId: `task_${Date.now()}`, priority: lastEscalation.priority ?? "normal" };
    }
  } else if (turn >= MAX_TURNS && !outboundMessageId) {
    escalated = true;
    escalationType = "humano";
    escalationReason = "8 turnos sem resolução";
    taskCreated = { taskId: `task_${Date.now()}`, priority: "normal" };
  }

  // 5. Update memory: facts, promise, sentiment, summary.
  const factsExtracted = extractFactsFromTurn(input.messageText);
  for (const f of factsExtracted) {
    try {
      await memStorage.appendFact(input.customerId, HELENA_AGENT_ID, f);
    } catch (err) {
      logger.warn({ action: "helena_fact_persist_failed", err: (err as Error)?.message }, "fact persist failed");
    }
  }

  const promise = detectPromise(input.messageText);
  if (promise) {
    try {
      await memStorage.addPromise(input.customerId, HELENA_AGENT_ID, {
        promise: `pagamento ${promise.date}${promise.value ? ` R$ ${promise.value}` : ""}`,
        dueDate: promise.date,
        status: "pending",
        recordedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn({ action: "helena_promise_persist_failed", err: (err as Error)?.message }, "promise persist failed");
    }
  }

  try {
    await memStorage.addSentiment(input.customerId, HELENA_AGENT_ID, {
      sentiment: sentiment > 0.2 ? "positive" : sentiment < -0.2 ? "negative" : "neutral",
      score: sentiment,
      recordedAt: new Date().toISOString(),
      context: input.messageText.slice(0, 200),
    });
  } catch (err) {
    logger.warn({ action: "helena_sentiment_persist_failed", err: (err as Error)?.message }, "sentiment persist failed");
  }

  // Every 5 interactions, refresh summary.
  try {
    const refreshed = await memStorage.load(input.customerId, HELENA_AGENT_ID);
    if (refreshed && ((refreshed.facts as unknown[])?.length ?? 0) % 5 === 0) {
      const summary = await compactSummary(refreshed);
      await memStorage.save(input.customerId, HELENA_AGENT_ID, { summary });
    }
  } catch (err) {
    logger.warn({ action: "helena_summary_failed", err: (err as Error)?.message }, "summary refresh failed");
  }

  const latencyMs = Date.now() - started;

  logger.info(
    {
      tenantId: input.tenantId,
      customerId: input.customerId,
      agentId: HELENA_AGENT_ID,
      action: "helena_done",
      latencyMs,
      turnsUsed: turn,
      toolsCalled,
      escalated,
      escalationType,
      tokensInput,
      tokensOutput,
      cacheHit: false,
      correlationId: input.correlationId,
    },
    "Helena turn complete",
  );

  return {
    success: !!outboundMessageId || !escalated,
    outboundMessageId,
    escalated,
    escalationType,
    escalationReason,
    taskCreated,
    turnsUsed: turn,
    toolsCalled,
    memoryUpdated: {
      facts: factsExtracted.map((f) => f.tag),
      promises: promise ? [promise] : [],
    },
    complianceCheckIds,
    latencyMs,
    tokensInput,
    tokensOutput,
  };

  // ---- helper ----
  function finalize(args: {
    escalated: boolean;
    escalationType: HelenaResult["escalationType"];
    escalationReason: string;
    priority?: "urgent" | "normal";
  }): HelenaResult {
    const latency = Date.now() - started;
    logger.info(
      {
        tenantId: input.tenantId, customerId: input.customerId, agentId: HELENA_AGENT_ID,
        action: "helena_early_escalation", escalationType: args.escalationType, latencyMs: latency,
      },
      "Helena early escalation",
    );
    return {
      success: false,
      escalated: args.escalated,
      escalationType: args.escalationType,
      escalationReason: args.escalationReason,
      taskCreated: { taskId: `task_${Date.now()}`, priority: args.priority ?? "normal" },
      turnsUsed: 0,
      toolsCalled,
      memoryUpdated: { facts: [], promises: [] },
      complianceCheckIds,
      latencyMs: latency,
      tokensInput,
      tokensOutput,
    };
  }
}
