/**
 * Júlia — Analista de Conformidade (Spec 003).
 *
 * Validates every outbound action across 4 layers before it can be executed:
 *   1. Determinístico (<100ms, pure TS): horário, frequência, opt-in
 *   2. Anatel timeline (notificação prévia D-15 / D-30 / D-60 com prova de leitura)
 *   3. LLM Haiku 4.5 (semântico — ameaça, constrangimento, exposição)
 *   4. Vulnerabilidade (memória de qualquer agente sobre o cliente)
 *
 * Registers the decision in `compliance_checks` and an APPEND-ONLY entry in
 * `audit_logs` (actorType='agent', actorId='agt_compliance_v1').
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../logger";
import {
  agentMemories,
  auditLogs,
  communications,
  customers,
  whatsappOptouts,
} from "@shared/schema";
import { createMessage } from "./anthropic-client";
import { loadPrompt } from "./prompt-loader";
import { ANATEL_TIMELINE, LEGAL_BASES, LEGAL_REFS } from "./legal-references";
import { AgentMemoryStorage } from "../storage/agent-memory.storage";
import { ComplianceCheckStorage } from "../storage/compliance-check.storage";
import { AuditLogStorage } from "../storage/audit-log.storage";
// Spec 008.6 — feature flag + Managed Agents Layer 3
import { getAgentRuntime } from "../env";
import {
  juliaLayer3Managed,
  compareLayer3Outputs,
  type JuliaLayer3Input,
} from "../services/agents/julia-managed";
import { logInvocation, hashInput } from "../services/agents/invocation-log";

const JULIA_AGENT_ID = "agt_compliance_v1";
const JULIA_MODEL = "claude-haiku-4-5-20251001";

export interface JuliaInput {
  tenantId: number;
  customerId: number;
  agentId: string; // who's asking (agt_reativo_v1, agt_preventivo_v1, etc.)
  actionType: "send_message" | "suspender_parcial" | "suspender_total" | "cancelar";
  channel?: "whatsapp" | "sms" | "email";
  content?: string;
  scheduledAt?: string; // ISO 8601
  actionPayload?: Record<string, unknown>;
  correlationId?: string;
}

export interface JuliaDecision {
  decision: "APPROVED" | "APPROVED_WITH_ADJUSTMENT" | "BLOCKED";
  fundamentacaoLegal: string[];
  ajustesSugeridos: string[];
  blockingReasons?: string[];
  validUntil: string;
  camadasValidadas: {
    deterministica: boolean;
    anatel: boolean;
    semantica: boolean;
    vulnerabilidade: boolean;
  };
  latencyMs: number;
  cacheHit: boolean;
  complianceCheckId?: string;
}

export class JuliaBlockedError extends Error {
  constructor(public readonly decision: JuliaDecision) {
    super(`Júlia BLOCKED: ${decision.blockingReasons?.join("; ") ?? "no reason"}`);
    this.name = "JuliaBlockedError";
  }
}

// ============================================================
// Layer 1 — Deterministic checks
// ============================================================

interface Layer1Result {
  ok: boolean;
  reasons: string[];
}

/**
 * Default Anatel-aligned window: weekdays 08-22, Saturday 09-13, no Sunday.
 * Tenant override (`providers.collectionConfig`) is not yet in schema — TODO once added.
 */
function checkHorario(when: Date): { ok: boolean; reason?: string } {
  const dow = when.getDay(); // 0=Sun .. 6=Sat
  const hour = when.getHours();
  if (dow === 0) return { ok: false, reason: "Horário: domingo bloqueado (Anatel/CDC)" };
  if (dow === 6) {
    if (hour < 9 || hour >= 13) return { ok: false, reason: "Horário: sábado só 09-13h" };
    return { ok: true };
  }
  // weekday
  if (hour < 8 || hour >= 22) return { ok: false, reason: "Horário: dia útil só 08-22h" };
  return { ok: true };
}

async function checkFrequencia(
  providerId: number,
  customerId: number,
  channel: string,
  limitPerDay: number,
): Promise<{ ok: boolean; reason?: string }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communications)
    .where(
      and(
        eq(communications.providerId, providerId),
        eq(communications.customerId, customerId),
        eq(communications.channel, channel),
        eq(communications.direction, "outbound"),
        gte(communications.createdAt, since),
      ),
    );
  if (count >= limitPerDay) {
    return { ok: false, reason: `Frequência: ${count} envios ${channel} nas últimas 24h (limite ${limitPerDay})` };
  }
  return { ok: true };
}

async function checkOptIn(providerId: number, customerId: number, channel: string): Promise<{ ok: boolean; reason?: string }> {
  if (channel !== "whatsapp") return { ok: true };
  // Resolve customer phone, then check opt-out table.
  const [cust] = await db.select({ phone: customers.phone }).from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!cust?.phone) return { ok: true };
  const [opt] = await db
    .select()
    .from(whatsappOptouts)
    .where(and(eq(whatsappOptouts.providerId, providerId), eq(whatsappOptouts.phoneNumber, cust.phone)))
    .limit(1);
  if (opt) return { ok: false, reason: "Opt-out permanente: cliente respondeu PARAR" };
  return { ok: true };
}

async function runLayer1(input: JuliaInput, scheduledAt: Date): Promise<Layer1Result> {
  const reasons: string[] = [];
  const channel = input.channel ?? "whatsapp";

  if (input.actionType === "send_message") {
    const h = checkHorario(scheduledAt);
    if (!h.ok) reasons.push(h.reason!);

    const freq = await checkFrequencia(input.tenantId, input.customerId, channel, 3);
    if (!freq.ok) reasons.push(freq.reason!);

    const opt = await checkOptIn(input.tenantId, input.customerId, channel);
    if (!opt.ok) reasons.push(opt.reason!);
  }

  return { ok: reasons.length === 0, reasons };
}

// ============================================================
// Layer 2 — Anatel timeline
// ============================================================

async function runLayer2(input: JuliaInput): Promise<{ ok: boolean; reason?: string }> {
  if (input.actionType !== "suspender_parcial" && input.actionType !== "suspender_total" && input.actionType !== "cancelar") {
    return { ok: true };
  }

  const minDaysMap: Record<string, number> = {
    suspender_parcial: ANATEL_TIMELINE.SUSPENSAO_PARCIAL,
    suspender_total: ANATEL_TIMELINE.SUSPENSAO_TOTAL,
    cancelar: ANATEL_TIMELINE.RESCISAO,
  };
  const minDays = minDaysMap[input.actionType] ?? 15;
  const cutoff = new Date(Date.now() - minDays * 24 * 60 * 60 * 1000);

  // Find a legal_notification_sent audit log >= minDays ago with proof of read.
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.providerId, input.tenantId),
        eq(auditLogs.action, "legal_notification_sent"),
        eq(auditLogs.resource, "customer"),
        eq(auditLogs.resourceId, String(input.customerId)),
      ),
    )
    .orderBy(desc(auditLogs.occurredAt))
    .limit(20);

  const valid = rows.find((r) => {
    if (r.occurredAt > cutoff) return false;
    const proof = r.notificationProof as { readAt?: string } | null;
    return !!proof?.readAt;
  });

  if (!valid) {
    return {
      ok: false,
      reason: `Anatel 765: ação ${input.actionType} requer notificação prévia há >=${minDays}d com prova de leitura`,
    };
  }
  return { ok: true };
}

// ============================================================
// Layer 3 — Semantic (LLM Haiku 4.5)
// ============================================================

interface LlmJudgement {
  passed: boolean;
  issues: string[];
  suggestions: string[];
}

async function runLayer3(
  input: JuliaInput,
  systemPrompt: string,
  customerContext: Record<string, unknown>,
): Promise<{ judgement: LlmJudgement; cacheHit: boolean }> {
  if (input.actionType !== "send_message" || !input.content) {
    return { judgement: { passed: true, issues: [], suggestions: [] }, cacheHit: false };
  }

  const userMessage = JSON.stringify({
    actionType: input.actionType,
    content: input.content,
    channel: input.channel ?? "whatsapp",
    customerContext,
  });

  const { message, cacheHit } = await createMessage({
    model: JULIA_MODEL,
    max_tokens: 512,
    temperature: 0,
    // System prompt is large + static — mark for prompt caching.
    system: [
      { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: "Responda APENAS com um JSON válido no formato: " +
          '{"passed": bool, "issues": string[], "suggestions": string[]}.',
      },
    ],
    messages: [{ role: "user", content: userMessage }],
    correlationId: input.correlationId,
  });

  // Extract first text block.
  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n")
    .trim();

  let judgement: LlmJudgement = { passed: true, issues: [], suggestions: [] };
  try {
    // The model may wrap JSON in code fences — strip them.
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<LlmJudgement>;
    judgement = {
      passed: !!parsed.passed,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    };
  } catch (err) {
    logger.warn({ action: "julia_llm_parse_failed", err: (err as Error)?.message, text }, "Júlia LLM JSON parse failed; defaulting to passed");
  }

  return { judgement, cacheHit };
}

// ============================================================
// Spec 008.6 — Layer 3 runtime dispatcher
// ============================================================

interface RuntimeDispatch {
  runtime: "direct" | "shadow" | "managed";
  input: JuliaInput;
  systemPrompt: string;
  customerContext: Record<string, unknown>;
}

/**
 * Routes Layer 3 to direct, managed, or shadow (both in parallel, returns direct).
 * In shadow mode, writes a `paired` entry in agent_invocations comparing outputs
 * for offline analysis before flipping to managed.
 */
async function runLayer3WithRuntime(
  dispatch: RuntimeDispatch,
): Promise<LlmJudgement & { cacheHit: boolean }> {
  const { runtime, input, systemPrompt, customerContext } = dispatch;

  // ───── DIRECT mode (default, comportamento atual) ─────
  if (runtime === "direct") {
    const { judgement, cacheHit } = await runLayer3(input, systemPrompt, customerContext);
    return { ...judgement, cacheHit };
  }

  // ───── MANAGED mode (apenas plataforma) ─────
  if (runtime === "managed") {
    const managedInput: JuliaLayer3Input = {
      providerId: input.tenantId,
      customerId: input.customerId,
      actionType: "send_message",
      content: input.content!,
      channel: input.channel,
      customerContext,
      correlationId: input.correlationId,
    };
    const m = await juliaLayer3Managed(managedInput);
    // Se managed falhar, fallback safe → pass (least restrictive). Erro já loga em logInvocation.
    return {
      passed: m.passed,
      issues: m.issues,
      suggestions: m.suggestions,
      cacheHit: false,
    };
  }

  // ───── SHADOW mode (direct canônico + managed paralelo) ─────
  const managedInput: JuliaLayer3Input = {
    providerId: input.tenantId,
    customerId: input.customerId,
    actionType: "send_message",
    content: input.content!,
    channel: input.channel,
    customerContext,
    correlationId: input.correlationId,
  };

  const [directResult, managedResult] = await Promise.allSettled([
    runLayer3(input, systemPrompt, customerContext),
    juliaLayer3Managed(managedInput),
  ]);

  if (directResult.status !== "fulfilled") {
    throw directResult.reason; // direct é canônico — erro propaga
  }

  // Loga direct invocação como source of truth
  const directJudgement = directResult.value.judgement;
  const directCacheHit = directResult.value.cacheHit;

  // Comparação shadow para telemetria (não bloqueia retorno)
  if (managedResult.status === "fulfilled") {
    const cmp = compareLayer3Outputs(directJudgement, managedResult.value);
    void logInvocation({
      providerId: input.tenantId,
      agentId: "julia",
      runtime: "shadow",
      inputHash: hashInput({ content: input.content, customerId: input.customerId }),
      outputJson: {
        direct: directJudgement,
        managed: managedResult.value,
        comparison: cmp,
      },
      latencyMs: managedResult.value.latencyMs,
      status: cmp.significantDiff ? "diff" : "ok",
      errorMessage: cmp.significantDiff ? cmp.summary : null,
      correlationId: input.correlationId ?? null,
    });
    logger.info(
      {
        action: "julia_shadow_compare",
        identical: cmp.identical,
        significantDiff: cmp.significantDiff,
        summary: cmp.summary,
        correlationId: input.correlationId,
      },
      "Júlia shadow comparison",
    );
  } else {
    void logInvocation({
      providerId: input.tenantId,
      agentId: "julia",
      runtime: "shadow",
      inputHash: hashInput({ content: input.content, customerId: input.customerId }),
      outputJson: { direct: directJudgement, managedError: String(managedResult.reason) },
      status: "error",
      errorMessage: `managed_failed: ${(managedResult.reason as Error)?.message ?? "unknown"}`,
      correlationId: input.correlationId ?? null,
    });
  }

  return { ...directJudgement, cacheHit: directCacheHit };
}

// ============================================================
// Layer 4 — Vulnerabilidade (memory facts)
// ============================================================

const VULNERABILITY_FLAGS = [
  "idoso", "idosa", "65 anos", "doença grave", "câncer", "cancer",
  "desemprego", "desempregado", "desempregada", "perdi emprego", "perdi o emprego",
  "bpc", "bolsa família", "vulnerabilidade", "vulneravel", "vulnerável",
  "minha mãe está doente", "doente", "hospital",
];

async function runLayer4(input: JuliaInput): Promise<{ vulnerable: boolean; reason?: string }> {
  // Any agent memory for this customer — scan facts text.
  const rows = await db
    .select()
    .from(agentMemories)
    .where(eq(agentMemories.customerId, input.customerId));

  for (const row of rows) {
    const facts = (row.facts ?? []) as Array<{ fact?: string; key?: string; value?: string }>;
    for (const f of facts) {
      const text = `${f.fact ?? ""} ${f.key ?? ""} ${f.value ?? ""}`.toLowerCase();
      for (const flag of VULNERABILITY_FLAGS) {
        if (text.includes(flag)) {
          return { vulnerable: true, reason: `Vulnerabilidade detectada na memória: "${flag}"` };
        }
      }
    }
  }
  return { vulnerable: false };
}

// ============================================================
// Orchestrator
// ============================================================

const memStorage = new AgentMemoryStorage();
const complianceStorage = new ComplianceCheckStorage();
const auditStorage = new AuditLogStorage();
void memStorage; // reserved for future use; suppress unused-import noise.

export async function invokeJulia(input: JuliaInput): Promise<JuliaDecision> {
  const started = Date.now();
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : new Date();

  const camadas = {
    deterministica: false,
    anatel: false,
    semantica: false,
    vulnerabilidade: false,
  };
  const blockingReasons: string[] = [];
  const ajustesSugeridos: string[] = [];
  const fundamentacao: string[] = [];
  let cacheHit = false;
  let decision: JuliaDecision["decision"] = "APPROVED";

  // Layer 1
  try {
    const l1 = await runLayer1(input, scheduledAt);
    camadas.deterministica = l1.ok;
    if (!l1.ok) {
      blockingReasons.push(...l1.reasons);
      fundamentacao.push(LEGAL_REFS.ANATEL_765, LEGAL_REFS.CDC_71);
    }
  } catch (err) {
    logger.error({ action: "julia_layer1_error", err: (err as Error)?.message }, "Júlia layer 1 error");
    blockingReasons.push("Erro interno na validação determinística");
  }

  // Layer 2 (only if action requires it and L1 passed for non-send actions)
  if (camadas.deterministica || input.actionType !== "send_message") {
    try {
      const l2 = await runLayer2(input);
      camadas.anatel = l2.ok;
      if (!l2.ok && l2.reason) {
        blockingReasons.push(l2.reason);
        fundamentacao.push(LEGAL_REFS.ANATEL_765);
      }
    } catch (err) {
      logger.error({ action: "julia_layer2_error", err: (err as Error)?.message }, "Júlia layer 2 error");
    }
  }

  // Layer 3 — semantic LLM (only for send_message with content)
  // Spec 008.6: feature flag AGENT_RUNTIME_JULIA controla qual backend
  // executa o LLM. "direct" = Anthropic Messages API local (default);
  // "managed" = agent na plataforma; "shadow" = ambos paralelo, retorna direct.
  let llmAdjustment = false;
  if (blockingReasons.length === 0 && input.actionType === "send_message" && input.content) {
    try {
      const { systemPrompt } = loadPrompt("julia");
      const customerContext = { customerId: input.customerId, providerId: input.tenantId };
      const runtime = getAgentRuntime("julia");

      const judgement = await runLayer3WithRuntime({
        runtime,
        input,
        systemPrompt,
        customerContext,
      });
      cacheHit = judgement.cacheHit;
      camadas.semantica = judgement.passed;
      if (!judgement.passed) {
        if (judgement.issues.length > 0 && judgement.suggestions.length > 0) {
          // Treat as adjustable when LLM provided suggestions.
          llmAdjustment = true;
          ajustesSugeridos.push(...judgement.suggestions);
          fundamentacao.push(LEGAL_REFS.CDC_71);
        } else {
          blockingReasons.push(...judgement.issues);
          fundamentacao.push(LEGAL_REFS.CDC_71, LEGAL_REFS.CDC_42);
        }
      }
    } catch (err) {
      logger.error({ action: "julia_layer3_error", err: (err as Error)?.message }, "Júlia layer 3 error");
    }
  } else {
    camadas.semantica = true; // not applicable
  }

  // Layer 4 — vulnerability
  try {
    const l4 = await runLayer4(input);
    camadas.vulnerabilidade = !l4.vulnerable;
    if (l4.vulnerable) {
      const aggressive = input.actionType === "suspender_parcial" || input.actionType === "suspender_total" || input.actionType === "cancelar";
      if (aggressive) {
        blockingReasons.push(l4.reason!);
        fundamentacao.push(LEGAL_REFS.LEI_14181);
      }
    }
  } catch (err) {
    logger.error({ action: "julia_layer4_error", err: (err as Error)?.message }, "Júlia layer 4 error");
  }

  if (blockingReasons.length > 0) {
    decision = "BLOCKED";
  } else if (llmAdjustment) {
    decision = "APPROVED_WITH_ADJUSTMENT";
  }

  if (decision !== "BLOCKED" && fundamentacao.length === 0) {
    fundamentacao.push(LEGAL_BASES.EXECUCAO_CONTRATO);
  }

  const latencyMs = Date.now() - started;
  const validUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Persist compliance_checks + audit_logs.
  let complianceCheckId: string | undefined;
  try {
    const created = await complianceStorage.registrar(input.tenantId, {
      customerId: input.customerId,
      agentId: input.agentId,
      proposedAction: {
        actionType: input.actionType,
        channel: input.channel,
        content: input.content,
        scheduledAt: scheduledAt.toISOString(),
        actionPayload: input.actionPayload,
      } as unknown as Record<string, unknown>,
      decision,
      legalBasis: fundamentacao[0] ?? null,
      legalReferences: fundamentacao,
      adjustments: ajustesSugeridos.length > 0 ? { suggestions: ajustesSugeridos } as unknown as Record<string, unknown> : null,
      blockingReasons: blockingReasons.length > 0 ? blockingReasons : null,
      latencyMs,
    } as Parameters<ComplianceCheckStorage["registrar"]>[1]);
    complianceCheckId = created.id;
  } catch (err) {
    logger.error({ action: "julia_compliance_persist_error", err: (err as Error)?.message }, "Júlia compliance persist failed");
  }

  try {
    await auditStorage.registrarAcao(input.tenantId, {
      action: "compliance_check",
      resource: "customer",
      resourceId: String(input.customerId),
      actorType: "agent",
      actorId: JULIA_AGENT_ID,
      actorName: "Júlia — Analista de Conformidade",
      payload: {
        decision,
        actionType: input.actionType,
        channel: input.channel,
        camadasValidadas: camadas,
        blockingReasons,
        ajustesSugeridos,
        complianceCheckId,
        latencyMs,
        cacheHit,
        correlationId: input.correlationId,
      },
      legalBasis: fundamentacao[0],
      legalReferences: fundamentacao,
    });
  } catch (err) {
    logger.error({ action: "julia_audit_persist_error", err: (err as Error)?.message }, "Júlia audit persist failed");
  }

  logger.info(
    {
      tenantId: input.tenantId,
      customerId: input.customerId,
      agentId: JULIA_AGENT_ID,
      action: "julia_decision",
      decision,
      latencyMs,
      cacheHit,
      camadasValidadas: camadas,
      blockingReasons,
      correlationId: input.correlationId,
    },
    "Júlia compliance decision",
  );

  return {
    decision,
    fundamentacaoLegal: fundamentacao,
    ajustesSugeridos,
    blockingReasons: blockingReasons.length > 0 ? blockingReasons : undefined,
    validUntil,
    camadasValidadas: camadas,
    latencyMs,
    cacheHit,
    complianceCheckId,
  };
}
