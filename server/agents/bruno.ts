/**
 * Bruno — Atendente Preventivo (Spec 004).
 *
 * Outbound D-3 / D-1 antes do vencimento. Direct API tool-use loop
 * (máx 2 turnos: 1 para chamar `gerar_pix_dinamico`, 1 para emitir o JSON final).
 *
 * Diferenças em relação à Helena:
 *   - Bruno é STATELESS por execução (sem memória conversacional persistente —
 *     apenas `memoryFacts` injetados pelo worker como leitura).
 *   - 1 única tool (`gerar_pix_dinamico`). Bruno DEVE chamá-la uma vez.
 *   - Resposta final é JSON estruturado (templateName + variables + pix), não texto livre.
 *   - O ENVIO em si NÃO é feito aqui — quem envia é o worker, após Júlia aprovar.
 *
 * System prompt em `server/prompts/bruno.md` (versionado).
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
  gerarPixBrunoTool,
  executeGerarPixBruno,
  type GerarPixBrunoResult,
} from "./tools/gerar-pix-bruno";

export const BRUNO_AGENT_ID = "agt_preventivo_v1";
const BRUNO_MODEL = process.env.BRUNO_MODEL ?? "claude-haiku-4-5-20251001";
const MAX_TURNS = 3; // 1 inicial + 1 tool result + margem

export interface BrunoTemplateSpec {
  name: string;
  variables: string[];
  hasMediaQrCode?: boolean;
}

export interface BrunoMemoryFact {
  key: string;
  value: string;
}

export interface BrunoInput {
  providerName: string;
  providerSupportPhone?: string;
  customerName: string;
  /** Número formatado da fatura (apenas display). */
  invoiceNumber: string;
  /** ID interno da fatura (passa para a tool). */
  invoiceId: number;
  invoiceValue: number;
  /** YYYY-MM-DD */
  invoiceDueDate: string;
  step: "D-3" | "D-1";
  availableTemplates: BrunoTemplateSpec[];
  memoryFacts?: BrunoMemoryFact[];
}

export interface BrunoOutput {
  templateName: string;
  variables: Record<string, string>;
  pix: {
    asaasPaymentId: string;
    qrCodeBase64: string;
    copyPaste: string;
    pixChargeId?: number;
  } | null;
  freeFormText: string | null;
  /** Se preenchido, Bruno reportou erro semântico ou tool falhou. Worker decide. */
  error?: string;
}

export interface BrunoResult {
  success: boolean;
  output?: BrunoOutput;
  error?: string;
  turnsUsed: number;
  toolsCalled: string[];
  latencyMs: number;
  tokensInput: number;
  tokensOutput: number;
  cacheHit: boolean;
  /** Se Bruno reusou um Pix vigente em vez de criar novo. */
  pixReused?: boolean;
}

export interface InvokeBrunoOptions {
  /** ID do outbound_attempts já reservado pelo scheduler. */
  attemptId: number;
  /** ID interno do customer (multi-tenant gate da tool). */
  customerId: number;
  correlationId?: string;
}

/**
 * Extrai o primeiro bloco JSON do texto retornado por Bruno.
 * O modelo pode envolver em ```json ... ``` ou retornar puro.
 */
function extractJson(text: string): unknown | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Tenta achar o primeiro objeto `{...}` no texto.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
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
    if (
      typeof p.asaasPaymentId === "string" &&
      typeof p.qrCodeBase64 === "string" &&
      typeof p.copyPaste === "string"
    ) {
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

export async function invokeBruno(
  tenantId: number,
  input: BrunoInput,
  options: InvokeBrunoOptions,
): Promise<BrunoResult> {
  const started = Date.now();
  const toolsCalled: string[] = [];
  let tokensInput = 0;
  let tokensOutput = 0;
  let cacheHit = false;
  let pixReused = false;
  let pixToolResult: GerarPixBrunoResult | null = null;

  const { systemPrompt } = loadPrompt("bruno");

  // Estrutura system com cache_control: prompt + lista de templates cacheáveis,
  // contexto dinâmico em mensagens user.
  const templatesBlock = JSON.stringify({ availableTemplates: input.availableTemplates });
  const systemBlocks: TextBlockParam[] = [
    { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
    { type: "text", text: `Templates disponíveis (cache-key estável):\n${templatesBlock}` },
  ];

  const userContext = JSON.stringify({
    providerName: input.providerName,
    providerSupportPhone: input.providerSupportPhone,
    customerName: input.customerName,
    invoiceNumber: input.invoiceNumber,
    invoiceId: input.invoiceId,
    invoiceValue: input.invoiceValue,
    invoiceDueDate: input.invoiceDueDate,
    step: input.step,
    memoryFacts: input.memoryFacts ?? [],
  });

  const messages: MessageParam[] = [
    {
      role: "user",
      content:
        `Contexto desta execução (NÃO repita literal ao cliente):\n${userContext}\n\n` +
        `Tarefa: escolha o template correto, chame \`gerar_pix_dinamico\` exatamente uma vez, ` +
        `e ao receber o tool_result emita o JSON final estruturado conforme as instruções do system prompt.`,
    },
  ];

  let turn = 0;
  let stop = false;
  let finalText: string | null = null;
  let lastError: string | undefined;

  while (turn < MAX_TURNS && !stop) {
    turn++;
    const res = await createMessage({
      model: BRUNO_MODEL,
      max_tokens: 1024,
      temperature: 0,
      system: systemBlocks,
      messages,
      tools: [gerarPixBrunoTool],
      correlationId: options.correlationId,
    });

    tokensInput += res.tokensInput;
    tokensOutput += res.tokensOutput;
    if (res.cacheHit) cacheHit = true;

    const assistantBlocks: ContentBlock[] = res.message.content;
    messages.push({ role: "assistant", content: assistantBlocks });

    const toolUses = assistantBlocks.filter((b): b is ToolUseBlock => b.type === "tool_use");
    const textBlocks = assistantBlocks.filter((b) => b.type === "text") as Array<{
      type: "text";
      text: string;
    }>;

    if (res.message.stop_reason !== "tool_use" || toolUses.length === 0) {
      // Fim — Bruno emitiu (espera-se) o JSON final.
      finalText = textBlocks.map((b) => b.text).join("\n").trim();
      stop = true;
      break;
    }

    // Executa cada tool_use. Bruno deveria chamar gerar_pix_dinamico exatamente 1x.
    const toolResults: ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      toolsCalled.push(tu.name);
      if (tu.name !== gerarPixBrunoTool.name) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify({ ok: false, error: `Tool desconhecida: ${tu.name}` }),
          is_error: true,
        });
        continue;
      }

      const result = await executeGerarPixBruno(
        {
          providerId: tenantId,
          customerId: options.customerId,
          attemptId: options.attemptId,
          correlationId: options.correlationId,
        },
        tu.input,
      );
      pixToolResult = result;
      if (result.reused) pixReused = true;
      if (!result.ok) lastError = result.error;

      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(
          result.ok
            ? {
                ok: true,
                asaasPaymentId: result.asaasPaymentId,
                qrCodeBase64: result.qrCodeBase64,
                copyPaste: result.copyPaste,
                pixChargeId: result.pixChargeId,
                reused: result.reused ?? false,
              }
            : { ok: false, error: result.error },
        ),
        ...(result.ok ? {} : { is_error: true }),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  const latencyMs = Date.now() - started;

  // Parse do output final.
  let output: BrunoOutput | undefined;
  let validationError: string | undefined;

  if (finalText) {
    const parsed = extractJson(finalText);
    if (parsed) {
      const validated = validateOutput(parsed);
      if (validated) {
        // Sanidade: se a tool deu certo, exigimos que o JSON do Bruno tenha o pix preenchido
        // (ou que ele tenha relatado erro explícito). Isso protege contra alucinação onde
        // o modelo ignora o tool_result.
        if (pixToolResult?.ok && !validated.pix && !validated.error) {
          // Reconstruímos pix a partir do tool_result — Bruno provavelmente esqueceu de copiar.
          validated.pix = {
            asaasPaymentId: pixToolResult.asaasPaymentId!,
            qrCodeBase64: pixToolResult.qrCodeBase64!,
            copyPaste: pixToolResult.copyPaste!,
            pixChargeId: pixToolResult.pixChargeId,
          };
          logger.warn(
            { action: "bruno_pix_field_recovered", correlationId: options.correlationId },
            "Bruno emitiu JSON sem campo pix mas tool tinha sucesso — reconstruído",
          );
        }
        output = validated;
      } else {
        validationError = "JSON output inválido (campos obrigatórios faltando)";
      }
    } else {
      validationError = "Output não contém JSON parseável";
    }
  } else if (turn >= MAX_TURNS) {
    validationError = `Bruno atingiu MAX_TURNS=${MAX_TURNS} sem emitir resposta final`;
  } else {
    validationError = "Bruno terminou sem texto final";
  }

  const success = !!output && !!output.pix && !output.error;

  logger.info(
    {
      tenantId,
      agentId: BRUNO_AGENT_ID,
      action: "bruno_done",
      success,
      latencyMs,
      turnsUsed: turn,
      toolsCalled,
      tokensInput,
      tokensOutput,
      cacheHit,
      pixReused,
      step: input.step,
      invoiceId: input.invoiceId,
      error: lastError ?? validationError,
      correlationId: options.correlationId,
    },
    "Bruno turn complete",
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
    pixReused,
  };
}
