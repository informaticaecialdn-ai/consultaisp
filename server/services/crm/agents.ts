/**
 * CRM Agents — Integracao com Claude via OpenAI-compatible API.
 * Usa OpenAI SDK com AI_INTEGRATIONS_OPENAI_API_KEY e AI_INTEGRATIONS_OPENAI_BASE_URL
 * (mesmo padrao de ai-analysis.ts e chat-agent.ts).
 */

import OpenAI from "openai";
import { getAgent } from "./agent-config";

function getClient() {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

export interface AgentAnalysis {
  resposta_whatsapp: string;
  score_update: { perfil: number; comportamento: number };
  acao: string;
  notas_internas: string;
  dados_extraidos: {
    nome?: string | null;
    provedor?: string | null;
    cidade?: string | null;
    porte?: string | null;
    erp?: string | null;
    num_clientes?: number | null;
  };
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Envia uma mensagem para um agente e obtém uma análise estruturada em JSON.
 * Usa o modelo e system prompt configurados por agente.
 */
export async function analyzeAndDecide(
  agentKey: string,
  message: string,
  leadData: Record<string, unknown>,
  historico: ConversationMessage[] = []
): Promise<AgentAnalysis> {
  const agent = getAgent(agentKey);
  if (!agent) throw new Error(`Agente '${agentKey}' nao encontrado`);

  const contextStr = buildLeadContext(leadData);

  const analysisPrompt = `
ANALISE esta mensagem do lead e responda em JSON:

DADOS DO LEAD:
${contextStr}

MENSAGEM RECEBIDA:
"${message}"

Responda APENAS com JSON valido (sem markdown, sem backticks):
{
  "resposta_whatsapp": "sua resposta para enviar ao lead via WhatsApp (SEM markdown, SEM asteriscos, max 3-4 frases, tom conversacional)",
  "score_update": {
    "perfil": 0,
    "comportamento": 0
  },
  "acao": "responder|agendar_demo|enviar_proposta|transferir_vendas|transferir_closer|devolver_marketing|encerrar",
  "notas_internas": "observacoes para o time",
  "dados_extraidos": {
    "nome": null,
    "provedor": null,
    "cidade": null,
    "porte": null,
    "erp": null,
    "num_clientes": null
  }
}`;

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...historico.map((h) => ({ role: h.role, content: h.content })),
    { role: "user" as const, content: analysisPrompt },
  ];

  const client = getClient();
  const response = await client.chat.completions.create({
    model: agent.model,
    max_tokens: 2048,
    messages: [
      { role: "system", content: agent.systemPrompt },
      ...messages,
    ],
  });

  const text = response.choices?.[0]?.message?.content?.trim() || "";
  return parseAgentResponse(text);
}

/**
 * Envia uma mensagem livre para um agente (geração de conteúdo, estratégia, etc.)
 * Retorna a resposta em texto bruto.
 */
export async function sendToAgent(
  agentKey: string,
  message: string,
  context: Record<string, unknown> = {}
): Promise<{ resposta: string; tokensUsados: number }> {
  const agent = getAgent(agentKey);
  if (!agent) throw new Error(`Agente '${agentKey}' nao encontrado`);

  const contextStr =
    context.leadData ? buildLeadContext(context.leadData as Record<string, unknown>) : "";
  const fullMessage = contextStr
    ? `${contextStr}\n\nMENSAGEM:\n${message}`
    : message;

  const client = getClient();
  const response = await client.chat.completions.create({
    model: agent.model,
    max_tokens: 2048,
    messages: [
      { role: "system", content: agent.systemPrompt },
      { role: "user", content: fullMessage },
    ],
  });

  const text = response.choices?.[0]?.message?.content?.trim() || "";
  const usage = response.usage;
  const tokensUsados = (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0);

  return { resposta: text, tokensUsados };
}

function buildLeadContext(leadData: Record<string, unknown>): string {
  const parts: string[] = ["FICHA DO LEAD:"];
  if (leadData.nome) parts.push(`Nome: ${leadData.nome}`);
  if (leadData.telefone) parts.push(`Telefone: ${leadData.telefone}`);
  if (leadData.provedor) parts.push(`Provedor: ${leadData.provedor}`);
  if (leadData.cidade)
    parts.push(`Cidade: ${leadData.cidade} - ${leadData.estado || ""}`);
  if (leadData.porte) parts.push(`Porte: ${leadData.porte}`);
  if (leadData.erp) parts.push(`ERP: ${leadData.erp}`);
  if (leadData.numClientes) parts.push(`Clientes: ${leadData.numClientes}`);
  if (leadData.scoreTotal !== undefined)
    parts.push(
      `Score: ${leadData.scoreTotal}/100 (${leadData.classificacao})`
    );
  if (leadData.etapaFunil) parts.push(`Etapa: ${leadData.etapaFunil}`);
  if (leadData.agenteAtual) parts.push(`Agente atual: ${leadData.agenteAtual}`);
  return parts.join("\n");
}

function parseAgentResponse(text: string): AgentAnalysis {
  // Tenta extrair JSON da resposta
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        resposta_whatsapp:
          parsed.resposta_whatsapp || text.substring(0, 500),
        score_update: {
          perfil: Number(parsed.score_update?.perfil) || 0,
          comportamento: Number(parsed.score_update?.comportamento) || 0,
        },
        acao: parsed.acao || "responder",
        notas_internas: parsed.notas_internas || "",
        dados_extraidos: {
          nome: parsed.dados_extraidos?.nome ?? null,
          provedor: parsed.dados_extraidos?.provedor ?? null,
          cidade: parsed.dados_extraidos?.cidade ?? null,
          porte: parsed.dados_extraidos?.porte ?? null,
          erp: parsed.dados_extraidos?.erp ?? null,
          num_clientes: parsed.dados_extraidos?.num_clientes
            ? Number(parsed.dados_extraidos.num_clientes)
            : null,
        },
      };
    } catch {
      // JSON parse falhou, usa fallback abaixo
    }
  }

  // Fallback: retorna texto bruto como resposta
  return {
    resposta_whatsapp: text.substring(0, 500),
    score_update: { perfil: 0, comportamento: 0 },
    acao: "responder",
    notas_internas: "Resposta nao estruturada - parse falhou",
    dados_extraidos: {},
  };
}
