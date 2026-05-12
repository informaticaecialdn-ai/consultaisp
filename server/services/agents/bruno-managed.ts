/**
 * Spec 008.6 Batch 5 — Bruno (lembrador D-3/D-1) via Managed Agents.
 *
 * Bruno é a invocação MAIS CRÍTICA (envia mensagem outbound real). O agent
 * na plataforma tem 2 tools custom: `gerar_pix` (cria charge Asaas) e
 * `consultar_memoria_cliente` (opcional). System prompt já tem o JSON
 * schema esperado.
 *
 * Adapter:
 *   1. Serializa BrunoInput como user message
 *   2. invokeAgent → plataforma roda loop tool-use sozinha (chama gerar_pix
 *      via /agent-tools/gerar_pix, recebe asaasPaymentId, decide JSON final)
 *   3. Adapter parseia finalText e mapeia para BrunoOutput
 *
 * Cuidado: o `pix.pixChargeId` legacy precisa ser preenchido após criação.
 * Como gerar_pix endpoint não retorna pixChargeId (apenas asaasPaymentId),
 * o adapter resolve buscando pix_charges por asaasPaymentId.
 */

import { eq } from "drizzle-orm";
import { db } from "../../db";
import { pixCharges } from "@shared/schema";
import { logger } from "../../logger";
import { invokeAgent } from "./platform-client";
import { logInvocation, hashInput } from "./invocation-log";
import { buildCustomerContextLite } from "./context-enricher";
import type {
  BrunoInput,
  BrunoOutput,
  BrunoResult,
  InvokeBrunoOptions,
} from "../../agents/bruno";

function extractJson(text: string): unknown | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function validateOutput(raw: unknown): BrunoOutput | null {
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
  let pix: BrunoOutput["pix"] = null;
  if (o.pix && typeof o.pix === "object") {
    const p = o.pix as Record<string, unknown>;
    if (typeof p.asaasPaymentId === "string" && typeof p.qrCodeBase64 === "string" && typeof p.copyPaste === "string") {
      pix = {
        asaasPaymentId: p.asaasPaymentId,
        qrCodeBase64: p.qrCodeBase64,
        copyPaste: p.copyPaste,
        pixChargeId: typeof p.pixChargeId === "number" ? p.pixChargeId : undefined,
      };
    }
  }
  return {
    templateName: o.templateName,
    variables,
    pix,
    freeFormText: typeof o.freeFormText === "string" ? o.freeFormText : null,
    error: typeof o.error === "string" ? o.error : undefined,
  };
}

export async function invokeBrunoManaged(
  tenantId: number,
  input: BrunoInput,
  options: InvokeBrunoOptions,
): Promise<BrunoResult> {
  // Spec 010A — enriquece com customer health (lite, não infla tokens)
  // Falha graciosa: null se erro/cliente não encontrado, Bruno segue sem.
  const customerHealth = await buildCustomerContextLite(tenantId, options.customerId);

  const userMessage = JSON.stringify({
    instruction:
      "Escolha o template de lembrete (D-3 ou D-1), gere Pix dinâmico via tool " +
      "`gerar_pix` (use os IDs fornecidos), preencha variáveis em pt-BR e emita JSON final. " +
      "Calibre tom conforme customerHealth.healthTier: gold/healthy = lembrete cordial, " +
      "warning = cordial extra com facilitação, critical = NÃO enviar lembrete preventivo, " +
      "marca recommendedAgent='human_marcos' no output e abort.",
    context: input,
    customerId: options.customerId,
    attemptId: options.attemptId,
    customerHealth,  // null se erro, Bruno segue sem
  });

  const invocation = await invokeAgent({
    agent: "bruno",
    providerId: tenantId,
    userMessage,
    correlationId: options.correlationId,
    maxTurns: 4, // contexto → tool gerar_pix → tool opcional memory → final
    timeoutMs: 30_000,
  });

  let output: BrunoOutput | undefined;
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

  // Resolve pixChargeId local se o agent não trouxer (gerar_pix retorna só asaasPaymentId)
  if (output?.pix && !output.pix.pixChargeId) {
    try {
      const [row] = await db
        .select({ id: pixCharges.id })
        .from(pixCharges)
        .where(eq(pixCharges.asaasPaymentId, output.pix.asaasPaymentId))
        .limit(1);
      if (row) output.pix.pixChargeId = row.id;
    } catch (err) {
      logger.warn(
        { err, asaasPaymentId: output.pix.asaasPaymentId },
        "[bruno-managed] failed to resolve pixChargeId — non-blocking",
      );
    }
  }

  const result: BrunoResult = {
    success: !!output && !output.error,
    output,
    error: validationError ?? output?.error,
    turnsUsed: invocation.turnsUsed,
    toolsCalled: invocation.toolCalls.map((c) => c.toolName),
    latencyMs: invocation.latencyMs,
    tokensInput: invocation.tokensInput,
    tokensOutput: invocation.tokensOutput,
    cacheHit: false,
  };

  void logInvocation({
    providerId: tenantId,
    agentId: "bruno",
    runtime: "managed",
    anthropicSessionId: invocation.anthropicSessionId,
    anthropicAgentId: invocation.anthropicAgentId,
    inputHash: hashInput({
      customerId: options.customerId,
      invoiceId: input.invoiceId,
      step: input.step,
    }),
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
      action: "bruno_managed_done",
      tenantId,
      customerId: options.customerId,
      invoiceId: input.invoiceId,
      step: input.step,
      sessionId: invocation.anthropicSessionId,
      success: result.success,
      latencyMs: result.latencyMs,
      correlationId: options.correlationId,
    },
    "Bruno managed invocation finished",
  );

  return result;
}

export function compareBrunoOutputs(
  direct: BrunoResult,
  managed: BrunoResult,
): { identical: boolean; significantDiff: boolean; summary: string } {
  const directTpl = direct.output?.templateName;
  const managedTpl = managed.output?.templateName;
  const directHasPix = !!direct.output?.pix?.asaasPaymentId;
  const managedHasPix = !!managed.output?.pix?.asaasPaymentId;
  const identical =
    direct.success === managed.success &&
    directTpl === managedTpl &&
    directHasPix === managedHasPix;
  const significantDiff =
    direct.success !== managed.success ||
    directTpl !== managedTpl ||
    directHasPix !== managedHasPix;
  const summary = significantDiff
    ? `DIFF: direct(${direct.success}/tpl=${directTpl}/pix=${directHasPix}) vs managed(${managed.success}/tpl=${managedTpl}/pix=${managedHasPix})`
    : identical
      ? "identical"
      : "cosmetic_diff";
  return { identical, significantDiff, summary };
}
