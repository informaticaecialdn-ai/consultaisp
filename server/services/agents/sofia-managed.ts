/**
 * Spec 008.6 Batch 4 — Sofia (agradecimento pós-pagamento) via Managed Agents.
 *
 * Pattern: o agent na plataforma já tem o system prompt da Sofia + tool custom
 * `consultar_memoria_cliente` registrada. Nosso adapter:
 *   1. Serializa SofiaInput como user message JSON
 *   2. Invoca o agent via platform-client
 *   3. Parseia finalText como SofiaOutput (templateName, variables, freeFormText)
 *   4. Retorna SofiaResult com mesmo shape do legacy invokeSofia()
 *
 * Multi-tenant: providerId já está implícito via vault bearer; o agent valida
 * via tool calls que customerId pertence ao tenant.
 *
 * Loop tool-use: gerenciado pela plataforma. Aqui só recebe o output final.
 */

import { logger } from "../../logger";
import { invokeAgent } from "./platform-client";
import { logInvocation, hashInput } from "./invocation-log";
import type {
  SofiaInput,
  SofiaOutput,
  SofiaResult,
  InvokeSofiaOptions,
} from "../../agents/sofia";

function extractJson(text: string): unknown | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function validateOutput(raw: unknown): SofiaOutput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.templateName !== "string" || !o.templateName) return null;
  if (!o.variables || typeof o.variables !== "object") return null;
  const variables: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.variables as Record<string, unknown>)) {
    if (typeof v === "string") variables[k] = v;
    else if (typeof v === "number") variables[k] = String(v);
    else return null;
  }
  return {
    templateName: o.templateName,
    variables,
    freeFormText: typeof o.freeFormText === "string" ? o.freeFormText : null,
    error: typeof o.error === "string" ? o.error : undefined,
  };
}

export async function invokeSofiaManaged(
  tenantId: number,
  input: SofiaInput,
  options: InvokeSofiaOptions,
): Promise<SofiaResult> {
  const started = Date.now();

  const userMessage = JSON.stringify({
    instruction:
      "Escolha o template de agradecimento adequado, preencha as variáveis em pt-BR formatado, " +
      "e emita o JSON final estruturado conforme o schema do system prompt.",
    context: input,
    customerId: options.customerId,
  });

  const invocation = await invokeAgent({
    agent: "sofia",
    providerId: tenantId,
    userMessage,
    correlationId: options.correlationId,
    maxTurns: 3, // 1 inicial + tool round-trip + final
    timeoutMs: 15_000,
  });

  let output: SofiaOutput | undefined;
  let validationError: string | undefined;

  if (invocation.status === "idled" && invocation.finalText) {
    const parsed = extractJson(invocation.finalText);
    if (parsed) {
      const validated = validateOutput(parsed);
      if (validated) output = validated;
      else validationError = "JSON output inválido (managed)";
    } else {
      validationError = "Output não contém JSON parseável (managed)";
    }
  } else {
    validationError = invocation.errorMessage ?? `managed status=${invocation.status}`;
  }

  const result: SofiaResult = {
    success: !!output && !output.error,
    output,
    error: validationError ?? output?.error,
    turnsUsed: invocation.turnsUsed,
    toolsCalled: invocation.toolCalls.map((c) => c.toolName),
    latencyMs: invocation.latencyMs,
    tokensInput: invocation.tokensInput,
    tokensOutput: invocation.tokensOutput,
    cacheHit: false, // platform handles caching internally
  };

  void logInvocation({
    providerId: tenantId,
    agentId: "sofia",
    runtime: "managed",
    anthropicSessionId: invocation.anthropicSessionId,
    anthropicAgentId: invocation.anthropicAgentId,
    inputHash: hashInput({ customerId: options.customerId, paidAt: input.paidAt }),
    outputJson: result,
    tokensInput: invocation.tokensInput,
    tokensOutput: invocation.tokensOutput,
    latencyMs: invocation.latencyMs,
    status: invocation.status === "idled" ? "ok" : "error",
    errorMessage: invocation.errorMessage ?? validationError ?? null,
    correlationId: options.correlationId ?? null,
  });

  logger.info(
    {
      action: "sofia_managed_done",
      tenantId,
      customerId: options.customerId,
      sessionId: invocation.anthropicSessionId,
      success: result.success,
      latencyMs: result.latencyMs,
      correlationId: options.correlationId,
    },
    "Sofia managed invocation finished",
  );

  return result;
}

/**
 * Compares direct vs managed Sofia outputs for shadow telemetry.
 * Significant divergence: templateName differs OR success differs.
 */
export function compareSofiaOutputs(
  direct: SofiaResult,
  managed: SofiaResult,
): { identical: boolean; significantDiff: boolean; summary: string } {
  const directTpl = direct.output?.templateName;
  const managedTpl = managed.output?.templateName;
  const identical = direct.success === managed.success && directTpl === managedTpl;
  const significantDiff = direct.success !== managed.success || directTpl !== managedTpl;
  const summary = significantDiff
    ? `DIFF: direct.success=${direct.success} tpl="${directTpl}" vs managed.success=${managed.success} tpl="${managedTpl}"`
    : identical
      ? "identical"
      : "cosmetic_diff (variables/freeFormText only)";
  return { identical, significantDiff, summary };
}
