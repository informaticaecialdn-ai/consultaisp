import Anthropic from "@anthropic-ai/sdk";
import { db } from "../../db";
import { crmAvaliacoes, crmConhecimento, crmRegrasAprendidas, crmConversas } from "@shared/crm-schema";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { SUPERVISOR_CONFIG } from "./agent-config";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface SupervisorEvaluation {
  nota: number;
  lead_sentimento: string;
  problemas: string[];
  sugestao: string;
  exemplo_tipo: string;
  tags: string[];
}

/**
 * Evaluate an agent's response using the Opus 4.6 supervisor.
 * Fire-and-forget — should not block the main flow.
 */
export async function evaluateResponse(
  conversaId: number,
  leadId: number,
  agente: string,
  mensagemLead: string,
  respostaAgente: string,
  leadData: Record<string, any>
): Promise<void> {
  try {
    const evalPrompt = `CONVERSA PARA AVALIAR:

AGENTE: ${agente}
DADOS DO LEAD: ${JSON.stringify({
      nome: leadData.nome,
      provedor: leadData.provedor,
      cidade: leadData.cidade,
      porte: leadData.porte,
      erp: leadData.erp,
      scoreTotal: leadData.scoreTotal,
      classificacao: leadData.classificacao,
      etapaFunil: leadData.etapaFunil,
    })}

MENSAGEM DO LEAD:
"${mensagemLead}"

RESPOSTA DO AGENTE:
"${respostaAgente}"

Avalie esta resposta.`;

    const response = await client.messages.create({
      model: SUPERVISOR_CONFIG.model,
      max_tokens: 1024,
      system: SUPERVISOR_CONFIG.systemPrompt,
      messages: [{ role: "user", content: evalPrompt }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const evaluation = parseSupervisorResponse(text);

    // Register evaluation
    await db.insert(crmAvaliacoes).values({
      conversaId,
      leadId,
      agente,
      nota: evaluation.nota,
      leadSentimento: evaluation.lead_sentimento,
      problemas: evaluation.problemas,
      sugestao: evaluation.sugestao,
      scoreImpacto: (leadData.scoreTotal as number) || 0,
    });

    // Extract example if nota is high or low
    if (evaluation.exemplo_tipo === "sucesso" || evaluation.nota >= 4) {
      await extractExample(agente, "sucesso", mensagemLead, respostaAgente, leadData, evaluation);
    } else if (evaluation.exemplo_tipo === "evitar" || evaluation.nota <= 2) {
      await extractExample(agente, "evitar", mensagemLead, respostaAgente, leadData, evaluation);
    }

    // Check if we should suggest rules (every 10 evaluations)
    const [evalCount] = await db.select({ count: count() }).from(crmAvaliacoes)
      .where(eq(crmAvaliacoes.agente, agente));
    if (Number(evalCount.count) % 10 === 0 && Number(evalCount.count) > 0) {
      suggestRules(agente).catch((err) =>
        console.error("[Training] Erro ao sugerir regras:", err.message)
      );
    }
  } catch (error: any) {
    console.error("[Training] Erro na avaliacao:", error.message);
  }
}

async function extractExample(
  agente: string,
  tipo: "sucesso" | "evitar",
  mensagemLead: string,
  respostaAgente: string,
  leadData: Record<string, any>,
  evaluation: SupervisorEvaluation
): Promise<void> {
  const contexto = [
    leadData.porte && `Porte: ${leadData.porte}`,
    leadData.erp && `ERP: ${leadData.erp}`,
    leadData.classificacao && `Classificacao: ${leadData.classificacao}`,
    leadData.etapaFunil && `Etapa: ${leadData.etapaFunil}`,
  ].filter(Boolean).join(", ");

  const resultado = tipo === "sucesso"
    ? `Nota ${evaluation.nota}/5. ${evaluation.sugestao}`
    : `Nota ${evaluation.nota}/5. Problemas: ${evaluation.problemas.join(", ")}`;

  const tags = [
    ...(evaluation.tags || []),
    leadData.porte,
    leadData.erp,
    leadData.classificacao,
    leadData.etapaFunil,
    leadData.regiao,
  ].filter(Boolean) as string[];

  await db.insert(crmConhecimento).values({
    agente,
    tipo,
    contexto,
    mensagemLead: mensagemLead.substring(0, 500),
    respostaAgente: respostaAgente.substring(0, 500),
    resultado,
    tags,
  });
}

async function suggestRules(agente: string): Promise<void> {
  try {
    const recentEvals = await db.select().from(crmAvaliacoes)
      .where(eq(crmAvaliacoes.agente, agente))
      .orderBy(desc(crmAvaliacoes.criadoEm))
      .limit(20);

    if (recentEvals.length < 10) return;

    const summary = recentEvals.map((e) => ({
      nota: e.nota,
      sentimento: e.leadSentimento,
      problemas: e.problemas,
      sugestao: e.sugestao,
    }));

    const response = await client.messages.create({
      model: SUPERVISOR_CONFIG.model,
      max_tokens: 1024,
      system: `Voce analisa padroes em avaliacoes de agentes de vendas. Identifique regras de comportamento baseadas nos padroes encontrados. Responda APENAS JSON (sem markdown):
[
  {
    "regra": "descricao da regra",
    "evidencia": "baseado em quais padroes",
    "categoria": "tom|timing|conteudo|objecao|regional"
  }
]
Retorne array vazio [] se nao encontrar padroes claros. Maximo 3 regras.`,
      messages: [{
        role: "user",
        content: `Avaliacoes recentes do agente "${agente}":\n${JSON.stringify(summary, null, 2)}`,
      }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const rules = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(rules) || rules.length === 0) return;

    for (const rule of rules) {
      if (!rule.regra) continue;
      await db.insert(crmRegrasAprendidas).values({
        agente,
        regra: rule.regra,
        evidencia: rule.evidencia || "",
        categoria: rule.categoria || "conteudo",
      });
    }
  } catch (error: any) {
    console.error("[Training] Erro ao sugerir regras:", error.message);
  }
}

/**
 * Build the learning context block to inject into an agent's system prompt.
 * Max ~500 tokens (~2000 chars).
 */
export async function buildLearningContext(
  agente: string,
  leadTags: string[]
): Promise<string> {
  try {
    const regras = await db.select().from(crmRegrasAprendidas)
      .where(and(
        sql`(${crmRegrasAprendidas.agente} = ${agente} OR ${crmRegrasAprendidas.agente} = 'todos')`,
        eq(crmRegrasAprendidas.status, "aprovada")
      ))
      .orderBy(desc(crmRegrasAprendidas.prioridade))
      .limit(10);

    const cleanTags = leadTags.filter(Boolean);
    let exemplosSucesso: any[] = [];
    let exemplosEvitar: any[] = [];

    if (cleanTags.length > 0) {
      exemplosSucesso = await db.select().from(crmConhecimento)
        .where(and(
          sql`(${crmConhecimento.agente} = ${agente} OR ${crmConhecimento.agente} = 'todos')`,
          eq(crmConhecimento.tipo, "sucesso"),
          eq(crmConhecimento.ativo, true),
          sql`${crmConhecimento.tags} && ${cleanTags}`
        ))
        .orderBy(desc(crmConhecimento.criadoEm))
        .limit(3);

      exemplosEvitar = await db.select().from(crmConhecimento)
        .where(and(
          sql`(${crmConhecimento.agente} = ${agente} OR ${crmConhecimento.agente} = 'todos')`,
          eq(crmConhecimento.tipo, "evitar"),
          eq(crmConhecimento.ativo, true),
          sql`${crmConhecimento.tags} && ${cleanTags}`
        ))
        .orderBy(desc(crmConhecimento.criadoEm))
        .limit(2);
    }

    if (regras.length === 0 && exemplosSucesso.length === 0 && exemplosEvitar.length === 0) {
      return "";
    }

    const parts: string[] = ["--- CONTEXTO DE APRENDIZADO ---"];

    if (regras.length > 0) {
      parts.push("\nREGRAS APRENDIDAS:");
      for (const r of regras) {
        parts.push(`- ${r.regra}`);
      }
    }

    if (exemplosSucesso.length > 0) {
      parts.push("\nEXEMPLOS DE SUCESSO:");
      for (const e of exemplosSucesso) {
        parts.push(`- Lead disse: "${e.mensagemLead?.substring(0, 80)}" -> Agente: "${e.respostaAgente?.substring(0, 80)}" -> ${e.resultado?.substring(0, 60)}`);
      }
    }

    if (exemplosEvitar.length > 0) {
      parts.push("\nEXEMPLOS A EVITAR:");
      for (const e of exemplosEvitar) {
        parts.push(`- Agente: "${e.respostaAgente?.substring(0, 80)}" -> ${e.resultado?.substring(0, 60)}`);
      }
    }

    const context = parts.join("\n");
    return context.length > 2000 ? context.substring(0, 2000) + "\n..." : context;
  } catch (error: any) {
    console.error("[Training] Erro ao construir contexto:", error.message);
    return "";
  }
}

export async function approveRule(ruleId: number) {
  return db.update(crmRegrasAprendidas)
    .set({ status: "aprovada", aprovadoEm: new Date() })
    .where(eq(crmRegrasAprendidas.id, ruleId))
    .returning();
}

export async function rejectRule(ruleId: number) {
  return db.update(crmRegrasAprendidas)
    .set({ status: "rejeitada" })
    .where(eq(crmRegrasAprendidas.id, ruleId))
    .returning();
}

function parseSupervisorResponse(text: string): SupervisorEvaluation {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        nota: Math.max(1, Math.min(5, Number(parsed.nota) || 3)),
        lead_sentimento: parsed.lead_sentimento || "neutro",
        problemas: Array.isArray(parsed.problemas) ? parsed.problemas : [],
        sugestao: parsed.sugestao || "",
        exemplo_tipo: parsed.exemplo_tipo || "nenhum",
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      };
    } catch { /* fallback */ }
  }
  return {
    nota: 3,
    lead_sentimento: "neutro",
    problemas: [],
    sugestao: "",
    exemplo_tipo: "nenhum",
    tags: [],
  };
}
