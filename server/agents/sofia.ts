/**
 * Sofia — Atendente de Relacionamento (Spec 004 / US2).
 *
 * Outbound pós-pagamento. Mensagem de agradecimento dentro de template HSM
 * aprovado OU `freeFormText` curto se cliente teve inbound nas últimas 24h.
 *
 * Diferenças em relação a Bruno:
 *   - Sem tool obrigatória. `consultar_memoria_cliente` é opcional.
 *   - Output JSON NÃO inclui `pix` — Sofia não gera cobrança.
 *   - Latência alvo p95 < 3s (geralmente sem tool round-trip).
 *
 * Sempre passa por Júlia depois — quem envia é o worker.
 */

import type {
  ContentBlock,
  MessageParam,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { logger } from "../logger";
import { createMessage } from "./anthropic-client";
import { loadPrompt } from "./prompt-loader";
import {
  consultarMemoriaTool,
  executeConsultarMemoria,
} from "./tools/consultar-memoria-cliente";
// Spec 008.6 — Managed Agents adapter + shadow comparison
import { getAgentRuntime } from "../env";
import {
  invokeSofiaManaged,
  compareSofiaOutputs,
} from "../services/agents/sofia-managed";
import { logInvocation, hashInput } from "../services/agents/invocation-log";

export const SOFIA_AGENT_ID = "agt_relacionamento_v1";
const SOFIA_MODEL = process.env.SOFIA_MODEL ?? "claude-haiku-4-5-20251001";
const MAX_TURNS = 3; // 1 inicial + 1 tool result + margem

export interface SofiaTemplateSpec {
  name: string;
  variables: string[];
}

export interface SofiaMemoryFact {
  key: string;
  value: string;
}

export interface SofiaInput {
  providerName: string;
  customerName: string;
  paidAmount: number;
  /** ISO string */
  paidAt: string;
  isFirstPaymentEver?: boolean;
  isWithin24hWindow?: boolean;
  availableTemplates: SofiaTemplateSpec[];
  memoryFacts?: SofiaMemoryFact[];
}

export interface SofiaOutput {
  templateName: string;
  variables: Record<string, string>;
  freeFormText: string | null;
  error?: string;
}

export interface SofiaResult {
  success: boolean;
  output?: SofiaOutput;
  error?: string;
  turnsUsed: number;
  toolsCalled: string[];
  latencyMs: number;
  tokensInput: number;
  tokensOutput: number;
  cacheHit: boolean;
}

export interface InvokeSofiaOptions {
  customerId: number;
  correlationId?: string;
}

function extractJson(text: string): unknown | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
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

export async function invokeSofia(
  tenantId: number,
  input: SofiaInput,
  options: InvokeSofiaOptions,
): Promise<SofiaResult> {
  // Spec 008.6 — runtime feature flag
  const runtime = getAgentRuntime("sofia");
  if (runtime === "managed") {
    return invokeSofiaManaged(tenantId, input, options);
  }
  if (runtime === "shadow") {
    const [directResult, managedResult] = await Promise.allSettled([
      invokeSofiaDirect(tenantId, input, options),
      invokeSofiaManaged(tenantId, input, options),
    ]);
    if (directResult.status !== "fulfilled") throw directResult.reason;
    if (managedResult.status === "fulfilled") {
      const cmp = compareSofiaOutputs(directResult.value, managedResult.value);
      void logInvocation({
        providerId: tenantId,
        agentId: "sofia",
        runtime: "shadow",
        inputHash: hashInput({ customerId: options.customerId, paidAt: input.paidAt }),
        outputJson: { direct: directResult.value, managed: managedResult.value, comparison: cmp },
        status: cmp.significantDiff ? "diff" : "ok",
        errorMessage: cmp.significantDiff ? cmp.summary : null,
        correlationId: options.correlationId ?? null,
      });
    }
    return directResult.value;
  }
  return invokeSofiaDirect(tenantId, input, options);
}

async function invokeSofiaDirect(
  tenantId: number,
  input: SofiaInput,
  options: InvokeSofiaOptions,
): Promise<SofiaResult> {
  const started = Date.now();
  const toolsCalled: string[] = [];
  let tokensInput = 0;
  let tokensOutput = 0;
  let cacheHit = false;

  const { systemPrompt } = loadPrompt("sofia");

  const templatesBlock = JSON.stringify({ availableTemplates: input.availableTemplates });
  const systemBlocks: TextBlockParam[] = [
    { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
    { type: "text", text: `Templates disponíveis (cache-key estável):\n${templatesBlock}` },
  ];

  const userContext = JSON.stringify({
    providerName: input.providerName,
    customerName: input.customerName,
    paidAmount: input.paidAmount,
    paidAt: input.paidAt,
    isFirstPaymentEver: input.isFirstPaymentEver ?? false,
    isWithin24hWindow: input.isWithin24hWindow ?? false,
    memoryFacts: input.memoryFacts ?? [],
  });

  const messages: MessageParam[] = [
    {
      role: "user",
      content:
        `Contexto desta execução (NÃO repita literal ao cliente):\n${userContext}\n\n` +
        `Tarefa: escolha o template de agradecimento adequado, preencha as variáveis em pt-BR formatado, ` +
        `e emita o JSON final estruturado. Tool \`consultar_memoria_cliente\` é OPCIONAL — use só se memoryFacts veio vazio.`,
    },
  ];

  let turn = 0;
  let stop = false;
  let finalText: string | null = null;
  let lastError: string | undefined;

  while (turn < MAX_TURNS && !stop) {
    turn++;
    const res = await createMessage({
      model: SOFIA_MODEL,
      max_tokens: 768,
      temperature: 0.1, // pequeno toque de criatividade pra freeFormText soar natural
      system: systemBlocks,
      messages,
      tools: [consultarMemoriaTool],
      correlationId: options.correlationId,
    });

    tokensInput += res.tokensInput;
    tokensOutput += res.tokensOutput;
    if (res.cacheHit) cacheHit = true;

    const assistantBlocks: ContentBlock[] = res.message.content;
    messages.push({ role: "assistant", content: assistantBlocks });

    const toolUses = assistantBlocks.filter((b): b is ToolUseBlock => b.type === "tool_use");
    const textBlocks = assistantBlocks.filter((b) => b.type === "text") as Array<{ type: "text"; text: string }>;

    if (res.message.stop_reason !== "tool_use" || toolUses.length === 0) {
      finalText = textBlocks.map((b) => b.text).join("\n").trim();
      stop = true;
      break;
    }

    const toolResults: ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      toolsCalled.push(tu.name);
      if (tu.name !== consultarMemoriaTool.name) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify({ ok: false, error: `Tool desconhecida: ${tu.name}` }),
          is_error: true,
        });
        continue;
      }

      const result = await executeConsultarMemoria(
        { providerId: tenantId, expectedCustomerId: options.customerId, correlationId: options.correlationId },
        tu.input,
      );
      if (!result.ok) lastError = result.error;

      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(result),
        ...(result.ok ? {} : { is_error: true }),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  const latencyMs = Date.now() - started;

  let output: SofiaOutput | undefined;
  let validationError: string | undefined;

  if (finalText) {
    const parsed = extractJson(finalText);
    if (parsed) {
      const validated = validateOutput(parsed);
      if (validated) output = validated;
      else validationError = "JSON output inválido";
    } else {
      validationError = "Output não contém JSON parseável";
    }
  } else if (turn >= MAX_TURNS) {
    validationError = `Sofia atingiu MAX_TURNS=${MAX_TURNS} sem emitir resposta final`;
  } else {
    validationError = "Sofia terminou sem texto final";
  }

  const success = !!output && !output.error;

  logger.info(
    {
      tenantId,
      agentId: SOFIA_AGENT_ID,
      action: "sofia_done",
      success,
      latencyMs,
      turnsUsed: turn,
      toolsCalled,
      tokensInput,
      tokensOutput,
      cacheHit,
      error: lastError ?? validationError,
      correlationId: options.correlationId,
    },
    "Sofia turn complete",
  );

  return {
    success,
    output,
    error: lastError ?? validationError,
    turnsUsed: turn,
    toolsCalled,
    latencyMs,
    tokensInput,
    tokensOutput,
    cacheHit,
  };
}
