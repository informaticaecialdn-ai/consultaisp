/**
 * Spec 008.6 Batch 3 — Júlia Layer 3 (semantic LLM) via Managed Agents.
 *
 * Júlia tem 4 camadas. As 3 determinísticas (1: horário/frequência/opt-in,
 * 2: Anatel timeline, 4: vulnerabilidade memory) ficam no backend porque
 * dependem de queries multi-tabela. APENAS a Layer 3 (LLM Haiku 4.5 que
 * julga semanticamente o conteúdo) é candidata a rodar no agent gerenciado.
 *
 * Esta função é o substituto do `runLayer3` original (em julia.ts) quando
 * o runtime é `managed` ou `shadow`. Mantém a mesma interface de retorno
 * (LlmJudgement = { passed, issues, suggestions }) pra que `invokeJulia`
 * trate identicamente o resultado.
 *
 * Cutover plan:
 *   - Imediato: shadow mode 24h, compara direct vs managed Layer 3 (passed/issues/suggestions)
 *   - 99% paridade → managed mode liga só Layer 3 via plataforma
 *   - Futuro (fora 008.6): mover Layers 1, 2, 4 pra tools custom HTTP +
 *     usar agent Júlia full-managed com loop tool-use.
 */

import { logger } from "../../logger";
import { invokeAgent } from "./platform-client";
import { logInvocation, hashInput } from "./invocation-log";

export interface JuliaLayer3Input {
  providerId: number;
  customerId: number;
  actionType: "send_message";
  content: string;
  channel?: "whatsapp" | "sms" | "email";
  customerContext: Record<string, unknown>;
  correlationId?: string;
}

export interface JuliaLayer3Result {
  passed: boolean;
  issues: string[];
  suggestions: string[];
  /** True if managed runtime served an output. False = fallback to direct or error. */
  managedServed: boolean;
  /** Anthropic session id for trace correlation (managed only). */
  anthropicSessionId?: string;
  latencyMs: number;
}

/**
 * Invoke Júlia Layer 3 (semantic LLM check) via Anthropic Managed Agents.
 * The agent on the platform was created with the same system prompt from
 * `server/prompts/julia.md`. We only send the user message (action + content
 * + customerContext) and parse the JSON response.
 *
 * Returns `managedServed: false` if the platform call fails — caller MUST
 * fallback to direct or treat as APPROVED (least restrictive on infra issue).
 */
export async function juliaLayer3Managed(input: JuliaLayer3Input): Promise<JuliaLayer3Result> {
  const started = Date.now();

  const userMessage = JSON.stringify({
    actionType: input.actionType,
    content: input.content,
    channel: input.channel ?? "whatsapp",
    customerContext: input.customerContext,
  });

  let result: JuliaLayer3Result = {
    passed: true,
    issues: [],
    suggestions: [],
    managedServed: false,
    latencyMs: 0,
  };

  try {
    const invocation = await invokeAgent({
      agent: "julia",
      providerId: input.providerId,
      userMessage,
      correlationId: input.correlationId,
      maxTurns: 1, // Júlia é one-shot, sem tools
      timeoutMs: 10_000, // gate síncrono — não pode bloquear envio > 10s
    });

    // Júlia retorna JSON puro no finalText. May be wrapped in ```json fences.
    const cleaned = invocation.finalText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed: Partial<{ passed: boolean; issues: string[]; suggestions: string[] }> = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      logger.warn(
        {
          action: "julia_managed_layer3_parse_failed",
          sessionId: invocation.anthropicSessionId,
          text: invocation.finalText.slice(0, 200),
          err: (err as Error)?.message,
        },
        "Júlia managed Layer 3 returned non-JSON — fallback to passed",
      );
    }

    result = {
      passed: parsed.passed ?? true,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      managedServed: invocation.status === "idled",
      anthropicSessionId: invocation.anthropicSessionId,
      latencyMs: invocation.latencyMs,
    };

    // Telemetria: cada invocação managed loga em agent_invocations.
    // status:"ok" pra idled, "error" para outros. shadowMode é setado pelo caller.
    await logInvocation({
      providerId: input.providerId,
      agentId: "julia",
      runtime: "managed",
      anthropicSessionId: invocation.anthropicSessionId,
      anthropicAgentId: invocation.anthropicAgentId,
      inputHash: hashInput(input),
      outputJson: result,
      tokensInput: invocation.tokensInput,
      tokensOutput: invocation.tokensOutput,
      latencyMs: invocation.latencyMs,
      status: invocation.status === "idled" ? "ok" : "error",
      errorMessage: invocation.errorMessage ?? null,
      correlationId: input.correlationId ?? null,
    });
  } catch (err) {
    const errorMessage = (err as Error)?.message ?? "managed_invoke_failed";
    logger.error(
      { action: "julia_managed_layer3_error", err: errorMessage, correlationId: input.correlationId },
      "Júlia managed Layer 3 invocation failed",
    );
    result = {
      passed: true,
      issues: [],
      suggestions: [],
      managedServed: false,
      latencyMs: Date.now() - started,
    };

    await logInvocation({
      providerId: input.providerId,
      agentId: "julia",
      runtime: "managed",
      inputHash: hashInput(input),
      latencyMs: result.latencyMs,
      status: "error",
      errorMessage,
      correlationId: input.correlationId ?? null,
    });
  }

  return result;
}

/**
 * Compares two Layer 3 results for shadow-mode telemetry. The decision-relevant
 * fields are `passed` and `issues.length > 0`. Suggestions text-diff isn't a
 * "significant" divergence (LLM variability is expected on phrasing).
 */
export function compareLayer3Outputs(
  direct: { passed: boolean; issues: string[]; suggestions: string[] },
  managed: { passed: boolean; issues: string[]; suggestions: string[] },
): { identical: boolean; significantDiff: boolean; summary: string } {
  const identical =
    direct.passed === managed.passed &&
    direct.issues.length === managed.issues.length &&
    direct.suggestions.length === managed.suggestions.length;

  // Significant: decision flipped OR issues count differs (BLOCKED outcomes change)
  const significantDiff = direct.passed !== managed.passed || direct.issues.length !== managed.issues.length;

  let summary = "identical";
  if (significantDiff) {
    summary = `DECISION_DIFF: direct.passed=${direct.passed}(${direct.issues.length} issues) vs managed.passed=${managed.passed}(${managed.issues.length} issues)`;
  } else if (!identical) {
    summary = `cosmetic_diff: suggestions count direct=${direct.suggestions.length} managed=${managed.suggestions.length}`;
  }

  return { identical, significantDiff, summary };
}
