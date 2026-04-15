import { db } from "../../db";
import { crmLeads, crmConversas, crmAtividades, crmHandoffs, crmTarefas } from "@shared/crm-schema";
import { eq, desc } from "drizzle-orm";
import { analyzeAndDecide, sendToAgent, type AgentAnalysis, type ConversationMessage } from "./agents";
import { calculateScore, shouldHandoff, getEtapaForAgente } from "./scoring";

export interface ProcessResult {
  resposta: string;
  analise: AgentAnalysis;
  leadAtualizado: any;
  handoff: { de: string; para: string; motivo: string } | null;
}

/**
 * Process an incoming message for a lead using the assigned agent.
 * This is the main entry point called by the CRM send route.
 */
export async function processMessage(
  leadId: number,
  message: string,
  agentKey?: string
): Promise<ProcessResult> {
  // 1. Get lead
  const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, leadId));
  if (!lead) throw new Error("Lead nao encontrado");

  const activeAgent = agentKey || lead.agenteAtual;

  // 2. Register incoming message
  await db.insert(crmConversas).values({
    leadId,
    agente: activeAgent,
    direcao: "recebida",
    mensagem: message,
  });

  // 3. Load history (last 10 messages)
  const historico = await db.select().from(crmConversas)
    .where(eq(crmConversas.leadId, leadId))
    .orderBy(desc(crmConversas.criadoEm))
    .limit(10);

  const historicoFormatado: ConversationMessage[] = historico.reverse().map((h) => ({
    role: h.direcao === "recebida" ? "user" as const : "assistant" as const,
    content: h.mensagem,
  }));

  // 4. Call agent
  const analise = await analyzeAndDecide(activeAgent, message, lead, historicoFormatado);

  // 5. Update score
  const scoreResult = calculateScore(
    lead.scorePerfil,
    lead.scoreComportamento,
    analise.score_update
  );

  // 6. Update lead data (extracted fields + score)
  const updateData: Record<string, any> = {
    scorePerfil: scoreResult.scorePerfil,
    scoreComportamento: scoreResult.scoreComportamento,
    scoreTotal: scoreResult.scoreTotal,
    classificacao: scoreResult.classificacao,
    atualizadoEm: new Date(),
  };

  // Apply extracted data (only non-null values)
  const extraidos = analise.dados_extraidos;
  if (extraidos.nome) updateData.nome = extraidos.nome;
  if (extraidos.provedor) updateData.provedor = extraidos.provedor;
  if (extraidos.cidade) updateData.cidade = extraidos.cidade;
  if (extraidos.porte) updateData.porte = extraidos.porte;
  if (extraidos.erp) updateData.erp = extraidos.erp;
  if (extraidos.num_clientes) updateData.numClientes = extraidos.num_clientes;

  const [leadAtualizado] = await db.update(crmLeads)
    .set(updateData)
    .where(eq(crmLeads.id, leadId))
    .returning();

  // 7. Register agent response
  await db.insert(crmConversas).values({
    leadId,
    agente: activeAgent,
    direcao: "enviada",
    mensagem: analise.resposta_whatsapp,
  });

  // 8. Log activity
  await db.insert(crmAtividades).values({
    agente: activeAgent,
    tipo: "resposta_enviada",
    descricao: `Respondeu ao lead: ${analise.resposta_whatsapp.substring(0, 100)}`,
    leadId,
    scoreAntes: lead.scoreTotal,
    scoreDepois: scoreResult.scoreTotal,
  });

  // 9. Process action & check for automatic handoff
  let handoff: ProcessResult["handoff"] = null;

  // Check if agent recommended an action
  handoff = await processAction(leadId, activeAgent, analise, scoreResult.scoreTotal);

  // If no explicit handoff from action, check if score triggers automatic handoff
  if (!handoff) {
    const autoHandoffTarget = shouldHandoff(scoreResult.scoreTotal, activeAgent);
    if (autoHandoffTarget) {
      handoff = await executeHandoff(
        leadId,
        activeAgent,
        autoHandoffTarget,
        `Score mudou para ${scoreResult.scoreTotal} (${scoreResult.classificacao})`,
        scoreResult.scoreTotal
      );
    }
  }

  return {
    resposta: analise.resposta_whatsapp,
    analise,
    leadAtualizado,
    handoff,
  };
}

/**
 * Process the action recommended by the agent
 */
async function processAction(
  leadId: number,
  agente: string,
  analise: AgentAnalysis,
  scoreAtual: number
): Promise<ProcessResult["handoff"]> {
  switch (analise.acao) {
    case "transferir_vendas":
      return executeHandoff(leadId, agente, "lucas", "Agente recomendou transferencia para vendas", scoreAtual);
    case "transferir_closer":
      return executeHandoff(leadId, agente, "rafael", "Agente recomendou transferencia para closer", scoreAtual);
    case "devolver_marketing":
      return executeHandoff(leadId, agente, "sofia", "Agente devolveu para nurturing", scoreAtual);
    case "agendar_demo":
      await db.insert(crmTarefas).values({
        leadId,
        agente,
        tipo: "demo",
        descricao: `Agendar demo para lead #${leadId}`,
        status: "pendente",
        prioridade: "alta",
      });
      await db.update(crmLeads).set({ etapaFunil: "demo", atualizadoEm: new Date() }).where(eq(crmLeads.id, leadId));
      return null;
    case "enviar_proposta":
      await db.insert(crmTarefas).values({
        leadId,
        agente,
        tipo: "proposta",
        descricao: `Enviar proposta para lead #${leadId}`,
        status: "pendente",
        prioridade: "alta",
      });
      await db.update(crmLeads).set({ etapaFunil: "proposta", atualizadoEm: new Date() }).where(eq(crmLeads.id, leadId));
      return null;
    case "encerrar":
      await db.update(crmLeads).set({
        etapaFunil: "perdido",
        motivoPerda: analise.notas_internas || "Lead encerrado pelo agente",
        atualizadoEm: new Date(),
      }).where(eq(crmLeads.id, leadId));
      await db.insert(crmAtividades).values({
        agente,
        tipo: "lead_perdido",
        descricao: `Lead encerrado: ${analise.notas_internas || "sem motivo"}`,
        leadId,
      });
      return null;
    default:
      return null;
  }
}

async function executeHandoff(
  leadId: number,
  deAgente: string,
  paraAgente: string,
  motivo: string,
  scoreAtual: number
): Promise<{ de: string; para: string; motivo: string }> {
  await db.insert(crmHandoffs).values({
    leadId,
    deAgente,
    paraAgente,
    motivo,
    scoreNoMomento: scoreAtual,
  });

  await db.update(crmLeads).set({
    agenteAtual: paraAgente,
    etapaFunil: getEtapaForAgente(paraAgente),
    atualizadoEm: new Date(),
  }).where(eq(crmLeads.id, leadId));

  await db.insert(crmAtividades).values({
    agente: deAgente,
    tipo: "handoff",
    descricao: `Transferido para ${paraAgente}: ${motivo}`,
    leadId,
    scoreAntes: scoreAtual,
    scoreDepois: scoreAtual,
  });

  return { de: deAgente, para: paraAgente, motivo };
}

/**
 * Generate content using Leo (copywriter) or strategy using Sofia (marketing).
 */
export async function requestContent(tipo: string, briefing: string) {
  const prompt = `BRIEFING DE CONTEUDO:\nTipo: ${tipo}\n${briefing}\n\nProduza o conteudo solicitado.`;
  return sendToAgent("leo", prompt);
}

export async function requestStrategy(tipo: string, dados: Record<string, any>) {
  const prompt = `SOLICITACAO DE ESTRATEGIA:\nTipo: ${tipo}\nDados: ${JSON.stringify(dados)}\n\nElabore a estrategia com acoes praticas.`;
  return sendToAgent("sofia", prompt);
}
