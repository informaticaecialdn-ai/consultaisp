import { Router } from "express";
import { requireSuperAdmin } from "../auth";
import { db } from "../db";
import { getSafeErrorMessage } from "../utils/safe-error";
import { processMessage, requestContent, requestStrategy } from "../services/crm/orchestrator";
import { sendText, isZapiConfigured, validateWebhookToken, parseWebhookPayload, setWebhook, formatPhone } from "../services/crm/zapi";
import {
  crmLeads, crmConversas, crmAtividades, crmHandoffs,
  crmTarefas, crmMetricasDiarias, crmCampanhas,
  insertCrmLeadSchema, insertCrmTarefaSchema, insertCrmCampanhaSchema,
} from "@shared/crm-schema";
import { eq, desc, asc, sql, and, ilike, or, count } from "drizzle-orm";
import { z } from "zod";

const updateLeadSchema = z.object({
  nome: z.string().max(200).optional(),
  provedor: z.string().max(200).optional(),
  cidade: z.string().max(200).optional(),
  estado: z.string().max(2).optional(),
  regiao: z.string().max(200).optional(),
  porte: z.enum(["desconhecido", "micro", "pequeno", "medio", "grande"]).optional(),
  erp: z.string().max(100).optional(),
  numClientes: z.number().int().min(0).optional(),
  decisor: z.string().max(200).optional(),
  email: z.string().email().max(200).optional().nullable(),
  cargo: z.string().max(200).optional(),
  site: z.string().max(500).optional().nullable(),
  scorePerfil: z.number().int().min(0).max(50).optional(),
  scoreComportamento: z.number().int().min(0).max(50).optional(),
  classificacao: z.enum(["frio", "morno", "quente", "ultra_quente"]).optional(),
  etapaFunil: z.enum(["novo", "prospeccao", "qualificacao", "demo", "proposta", "negociacao", "fechamento"]).optional(),
  agenteAtual: z.enum(["sofia", "leo", "carlos", "lucas", "rafael"]).optional(),
  valorEstimado: z.string().optional(),
  motivoPerda: z.string().max(500).optional().nullable(),
  dataProximaAcao: z.string().datetime().optional().nullable(),
  observacoes: z.string().max(2000).optional().nullable(),
}).strict();

const createLeadSchema = z.object({
  telefone: z.string().min(10).max(15),
  nome: z.string().max(200).optional(),
  provedor: z.string().max(200).optional(),
  cidade: z.string().max(200).optional(),
  estado: z.string().max(2).optional(),
  regiao: z.string().max(200).optional(),
  porte: z.enum(["desconhecido", "micro", "pequeno", "medio", "grande"]).optional(),
  erp: z.string().max(100).optional(),
  origem: z.enum(["manual", "whatsapp", "campanha"]).optional(),
  observacoes: z.string().max(2000).optional(),
});

export function registerCrmRoutes(): Router {
  const router = Router();

  // ==================== STATS ====================
  router.get("/api/crm/stats", requireSuperAdmin, async (_req, res) => {
    try {
      const [totalLeads] = await db.select({ count: count() }).from(crmLeads);
      const [leadsQuentes] = await db.select({ count: count() }).from(crmLeads)
        .where(or(eq(crmLeads.classificacao, "quente"), eq(crmLeads.classificacao, "ultra_quente")));
      const [tarefasPendentes] = await db.select({ count: count() }).from(crmTarefas)
        .where(eq(crmTarefas.status, "pendente"));
      const [pipeline] = await db.select({ total: sql<string>`COALESCE(SUM(${crmLeads.valorEstimado}), 0)` }).from(crmLeads)
        .where(sql`${crmLeads.etapaFunil} NOT IN ('novo', 'perdido')`);

      const porClassificacao = await db.select({
        classificacao: crmLeads.classificacao,
        count: count(),
      }).from(crmLeads).groupBy(crmLeads.classificacao);

      const porAgente = await db.select({
        agente: crmLeads.agenteAtual,
        count: count(),
      }).from(crmLeads).groupBy(crmLeads.agenteAtual);

      const porEtapa = await db.select({
        etapa: crmLeads.etapaFunil,
        count: count(),
      }).from(crmLeads).groupBy(crmLeads.etapaFunil);

      const atividades = await db.select().from(crmAtividades)
        .orderBy(desc(crmAtividades.criadoEm)).limit(10);

      const handoffs = await db.select().from(crmHandoffs)
        .orderBy(desc(crmHandoffs.criadoEm)).limit(10);

      return res.json({
        totalLeads: totalLeads.count,
        leadsQuentes: leadsQuentes.count,
        tarefasPendentes: tarefasPendentes.count,
        valorPipeline: pipeline.total,
        porClassificacao,
        porAgente,
        porEtapa,
        atividades,
        handoffs,
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ==================== METRICAS ====================
  router.get("/api/crm/metricas/historico", requireSuperAdmin, async (req, res) => {
    try {
      const dias = parseInt(req.query.dias as string) || 30;
      const agente = req.query.agente as string;
      const dataMin = new Date();
      dataMin.setDate(dataMin.getDate() - dias);
      const dataMinStr = dataMin.toISOString().split("T")[0];

      let query = db.select().from(crmMetricasDiarias)
        .where(sql`${crmMetricasDiarias.data} >= ${dataMinStr}`)
        .orderBy(asc(crmMetricasDiarias.data));

      if (agente) {
        query = db.select().from(crmMetricasDiarias)
          .where(and(
            sql`${crmMetricasDiarias.data} >= ${dataMinStr}`,
            eq(crmMetricasDiarias.agente, agente)
          ))
          .orderBy(asc(crmMetricasDiarias.data));
      }

      const metricas = await query;
      return res.json(metricas);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/crm/metricas/agentes", requireSuperAdmin, async (_req, res) => {
    try {
      const agentes = ["sofia", "leo", "carlos", "lucas", "rafael"];
      const result = await Promise.all(agentes.map(async (agente) => {
        const [leads] = await db.select({ count: count() }).from(crmLeads)
          .where(eq(crmLeads.agenteAtual, agente));
        const [msgs] = await db.select({ count: count() }).from(crmConversas)
          .where(eq(crmConversas.agente, agente));
        const [ativs] = await db.select({ count: count() }).from(crmAtividades)
          .where(and(
            eq(crmAtividades.agente, agente),
            sql`DATE(${crmAtividades.criadoEm}) = CURRENT_DATE`
          ));
        const [handoffsEnviados] = await db.select({ count: count() }).from(crmHandoffs)
          .where(eq(crmHandoffs.deAgente, agente));
        const ultimaAtividade = await db.select({ criadoEm: crmAtividades.criadoEm })
          .from(crmAtividades).where(eq(crmAtividades.agente, agente))
          .orderBy(desc(crmAtividades.criadoEm)).limit(1);

        return {
          agente,
          leadsAtivos: leads.count,
          totalMensagens: msgs.count,
          atividadesHoje: ativs.count,
          handoffsEnviados: handoffsEnviados.count,
          ultimaAtividade: ultimaAtividade[0]?.criadoEm || null,
        };
      }));
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/crm/funil", requireSuperAdmin, async (_req, res) => {
    try {
      const etapas = ["novo", "prospeccao", "qualificacao", "demo", "proposta", "negociacao", "fechamento"];
      const result = await Promise.all(etapas.map(async (etapa) => {
        const [r] = await db.select({ count: count() }).from(crmLeads)
          .where(eq(crmLeads.etapaFunil, etapa));
        return { etapa, count: r.count };
      }));
      const total = result.reduce((s, r) => s + Number(r.count), 0);
      return res.json(result.map(r => ({
        ...r,
        percentual: total > 0 ? Math.round((Number(r.count) / total) * 100) : 0,
      })));
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ==================== LEADS ====================
  router.get("/api/crm/leads", requireSuperAdmin, async (req, res) => {
    try {
      const { agente, classificacao, etapa, busca, regiao, porte, ordenar, dir, limit: lim, offset: off } = req.query;
      const conditions = [];

      if (agente) conditions.push(eq(crmLeads.agenteAtual, agente as string));
      if (classificacao) conditions.push(eq(crmLeads.classificacao, classificacao as string));
      if (etapa) conditions.push(eq(crmLeads.etapaFunil, etapa as string));
      if (regiao) conditions.push(eq(crmLeads.regiao, regiao as string));
      if (porte) conditions.push(eq(crmLeads.porte, porte as string));
      if (busca) {
        conditions.push(or(
          ilike(crmLeads.nome, `%${busca}%`),
          ilike(crmLeads.telefone, `%${busca}%`),
          ilike(crmLeads.provedor, `%${busca}%`),
          ilike(crmLeads.cidade, `%${busca}%`),
        ));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const orderField = ordenar === "score" ? crmLeads.scoreTotal
        : ordenar === "valor" ? crmLeads.valorEstimado
        : crmLeads.criadoEm;
      const orderDir = dir === "asc" ? asc(orderField) : desc(orderField);

      const leads = await db.select().from(crmLeads)
        .where(where)
        .orderBy(orderDir)
        .limit(parseInt(lim as string) || 50)
        .offset(parseInt(off as string) || 0);

      const [total] = await db.select({ count: count() }).from(crmLeads).where(where);

      return res.json({ leads, total: total.count });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/crm/leads/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, id));
      if (!lead) return res.status(404).json({ message: "Lead nao encontrado" });

      const conversas = await db.select().from(crmConversas)
        .where(eq(crmConversas.leadId, id)).orderBy(asc(crmConversas.criadoEm));
      const tarefas = await db.select().from(crmTarefas)
        .where(eq(crmTarefas.leadId, id)).orderBy(desc(crmTarefas.criadoEm));
      const handoffs = await db.select().from(crmHandoffs)
        .where(eq(crmHandoffs.leadId, id)).orderBy(desc(crmHandoffs.criadoEm));
      const atividades = await db.select().from(crmAtividades)
        .where(eq(crmAtividades.leadId, id)).orderBy(desc(crmAtividades.criadoEm)).limit(20);

      return res.json({ ...lead, conversas, tarefas, handoffs, atividades });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/crm/leads", requireSuperAdmin, async (req, res) => {
    try {
      const parsed = createLeadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
      }
      const existing = await db.select().from(crmLeads).where(eq(crmLeads.telefone, parsed.data.telefone));
      if (existing.length > 0) {
        return res.status(409).json({ message: "Lead com este telefone ja existe" });
      }
      const [lead] = await db.insert(crmLeads).values(parsed.data).returning();
      return res.status(201).json(lead);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/crm/leads/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = updateLeadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
      }
      const data: any = { ...parsed.data, atualizadoEm: new Date() };
      if (parsed.data.scorePerfil !== undefined || parsed.data.scoreComportamento !== undefined) {
        const [current] = await db.select().from(crmLeads).where(eq(crmLeads.id, id));
        if (current) {
          const perfil = parsed.data.scorePerfil ?? current.scorePerfil;
          const comportamento = parsed.data.scoreComportamento ?? current.scoreComportamento;
          data.scoreTotal = perfil + comportamento;
        }
      }
      const [updated] = await db.update(crmLeads).set(data).where(eq(crmLeads.id, id)).returning();
      if (!updated) return res.status(404).json({ message: "Lead nao encontrado" });
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ==================== CONVERSAS ====================
  router.get("/api/crm/conversas/recentes", requireSuperAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const conversas = await db.select({
        conversa: crmConversas,
        leadNome: crmLeads.nome,
        leadTelefone: crmLeads.telefone,
        leadProvedor: crmLeads.provedor,
      }).from(crmConversas)
        .leftJoin(crmLeads, eq(crmConversas.leadId, crmLeads.id))
        .orderBy(desc(crmConversas.criadoEm))
        .limit(limit);
      return res.json(conversas);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ==================== TAREFAS ====================
  router.get("/api/crm/tarefas", requireSuperAdmin, async (req, res) => {
    try {
      const { status, agente } = req.query;
      const conditions = [];
      if (status) conditions.push(eq(crmTarefas.status, status as string));
      if (agente) conditions.push(eq(crmTarefas.agente, agente as string));
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const tarefas = await db.select({
        tarefa: crmTarefas,
        leadNome: crmLeads.nome,
        leadTelefone: crmLeads.telefone,
      }).from(crmTarefas)
        .leftJoin(crmLeads, eq(crmTarefas.leadId, crmLeads.id))
        .where(where)
        .orderBy(desc(crmTarefas.criadoEm));
      return res.json(tarefas);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/crm/tarefas/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      const data: any = { status };
      if (status === "concluida") data.concluidoEm = new Date();
      const [updated] = await db.update(crmTarefas).set(data).where(eq(crmTarefas.id, id)).returning();
      if (!updated) return res.status(404).json({ message: "Tarefa nao encontrada" });
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/crm/tarefas", requireSuperAdmin, async (req, res) => {
    try {
      const parsed = insertCrmTarefaSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
      }
      const [tarefa] = await db.insert(crmTarefas).values(parsed.data).returning();
      return res.status(201).json(tarefa);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ==================== CAMPANHAS ====================
  router.get("/api/crm/campanhas", requireSuperAdmin, async (_req, res) => {
    try {
      const campanhas = await db.select().from(crmCampanhas).orderBy(desc(crmCampanhas.criadoEm));
      return res.json(campanhas);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/crm/campanhas", requireSuperAdmin, async (req, res) => {
    try {
      const parsed = insertCrmCampanhaSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
      }
      const [campanha] = await db.insert(crmCampanhas).values(parsed.data).returning();
      return res.status(201).json(campanha);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ==================== ATIVIDADES ====================
  router.get("/api/crm/atividades", requireSuperAdmin, async (req, res) => {
    try {
      const { agente, tipo, limit: lim } = req.query;
      const conditions = [];
      if (agente) conditions.push(eq(crmAtividades.agente, agente as string));
      if (tipo) conditions.push(eq(crmAtividades.tipo, tipo as string));
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const atividades = await db.select().from(crmAtividades)
        .where(where)
        .orderBy(desc(crmAtividades.criadoEm))
        .limit(parseInt(lim as string) || 50);
      return res.json(atividades);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ==================== HANDOFFS ====================
  router.post("/api/crm/transferir", requireSuperAdmin, async (req, res) => {
    try {
      const { leadId, paraAgente, motivo } = req.body;
      if (!leadId || !paraAgente) {
        return res.status(400).json({ message: "leadId e paraAgente sao obrigatorios" });
      }
      const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, leadId));
      if (!lead) return res.status(404).json({ message: "Lead nao encontrado" });

      const etapaMap: Record<string, string> = {
        sofia: "nurturing", carlos: "qualificacao",
        lucas: "negociacao", rafael: "fechamento",
      };

      await db.insert(crmHandoffs).values({
        leadId, deAgente: lead.agenteAtual, paraAgente, motivo,
        scoreNoMomento: lead.scoreTotal,
      });

      const [updated] = await db.update(crmLeads).set({
        agenteAtual: paraAgente,
        etapaFunil: etapaMap[paraAgente] || lead.etapaFunil,
        atualizadoEm: new Date(),
      }).where(eq(crmLeads.id, leadId)).returning();

      await db.insert(crmAtividades).values({
        agente: lead.agenteAtual,
        tipo: "handoff",
        descricao: `Transferido para ${paraAgente}: ${motivo || "sem motivo"}`,
        leadId,
        scoreAntes: lead.scoreTotal,
        scoreDepois: lead.scoreTotal,
      });

      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ==================== MONITOR ====================
  router.get("/api/crm/monitor", requireSuperAdmin, async (_req, res) => {
    try {
      const agentes = ["sofia", "leo", "carlos", "lucas", "rafael"];
      const result = await Promise.all(agentes.map(async (agente) => {
        const [leads] = await db.select({ count: count() }).from(crmLeads)
          .where(eq(crmLeads.agenteAtual, agente));
        const recentAtividades = await db.select().from(crmAtividades)
          .where(eq(crmAtividades.agente, agente))
          .orderBy(desc(crmAtividades.criadoEm)).limit(5);
        return { agente, leadsAtivos: leads.count, atividades: recentAtividades };
      }));
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ==================== SEND (via Agent) ====================
  router.post("/api/crm/send", requireSuperAdmin, async (req, res) => {
    try {
      const { leadId, message, agentKey } = req.body;
      if (!leadId || !message) {
        return res.status(400).json({ message: "leadId e message sao obrigatorios" });
      }
      const result = await processMessage(leadId, message, agentKey);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ==================== CONTEUDO (Leo) ====================
  router.post("/api/crm/conteudo", requireSuperAdmin, async (req, res) => {
    try {
      const { tipo, briefing } = req.body;
      if (!tipo || !briefing) {
        return res.status(400).json({ message: "tipo e briefing sao obrigatorios" });
      }
      const result = await requestContent(tipo, briefing);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ==================== ESTRATEGIA (Sofia) ====================
  router.post("/api/crm/estrategia", requireSuperAdmin, async (req, res) => {
    try {
      const { tipo, dados } = req.body;
      if (!tipo) {
        return res.status(400).json({ message: "tipo e obrigatorio" });
      }
      const result = await requestStrategy(tipo, dados || {});
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ==================== WEBHOOK Z-API (PUBLICO) ====================
  router.post("/api/crm/webhook/zapi", async (req, res) => {
    try {
      // Validate token
      const headerToken = req.headers["client-token"] as string | undefined;
      if (!validateWebhookToken(headerToken)) {
        return res.status(401).json({ message: "Token invalido" });
      }

      const parsed = parseWebhookPayload(req.body);
      if (!parsed) {
        return res.status(200).json({ message: "Ignorado" });
      }

      const { phone, message } = parsed;

      // Find or create lead by phone
      let [lead] = await db.select().from(crmLeads).where(eq(crmLeads.telefone, phone));

      if (!lead) {
        // Create new lead from incoming WhatsApp message
        [lead] = await db.insert(crmLeads).values({
          telefone: phone,
          origem: "whatsapp",
          agenteAtual: "carlos", // New leads go to Carlos (SDR)
        }).returning();
      }

      // Process through orchestrator
      const result = await processMessage(lead.id, message);

      // Send agent response via Z-API
      if (result.resposta) {
        await sendText(phone, result.resposta);
      }

      return res.status(200).json({ ok: true, leadId: lead.id });
    } catch (error: any) {
      console.error("[CRM Webhook] Erro:", error.message);
      return res.status(200).json({ ok: false, error: error.message });
    }
  });

  router.post("/api/crm/webhook/zapi/status", async (_req, res) => {
    // Status updates (delivered, read) — acknowledge silently
    return res.status(200).json({ ok: true });
  });

  // ==================== PROSPECCAO EM MASSA ====================
  router.post("/api/crm/prospectar", requireSuperAdmin, async (req, res) => {
    try {
      const { telefones, regiao, mensagemBase } = req.body;
      if (!telefones || !Array.isArray(telefones) || telefones.length === 0) {
        return res.status(400).json({ message: "Lista de telefones obrigatoria" });
      }

      if (!isZapiConfigured()) {
        return res.status(400).json({ message: "Z-API nao configurado. Configure ZAPI_INSTANCE_ID e ZAPI_TOKEN no .env" });
      }

      const resultados: Array<{ telefone: string; status: string; erro?: string; leadId?: number }> = [];

      for (const telefone of telefones) {
        try {
          const phone = formatPhone(telefone);

          // Find or create lead
          let [lead] = await db.select().from(crmLeads).where(eq(crmLeads.telefone, phone));
          if (!lead) {
            [lead] = await db.insert(crmLeads).values({
              telefone: phone,
              regiao: regiao || undefined,
              origem: "campanha",
              agenteAtual: "carlos",
            }).returning();
          }

          // Generate prospection message via Carlos
          const result = await processMessage(lead.id, mensagemBase || `Prospeccao outbound para ${regiao || "regiao"}`);

          // Send via Z-API
          const sendResult = await sendText(phone, result.resposta);

          if (sendResult.success) {
            resultados.push({ telefone: phone, status: "enviado", leadId: lead.id });
          } else {
            resultados.push({ telefone: phone, status: "erro", erro: sendResult.error });
          }

          // Small delay between messages (2-5 seconds to avoid Z-API rate limits)
          await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
        } catch (err: any) {
          resultados.push({ telefone, status: "erro", erro: err.message });
        }
      }

      return res.json({
        total: telefones.length,
        enviados: resultados.filter(r => r.status === "enviado").length,
        erros: resultados.filter(r => r.status === "erro").length,
        resultados,
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ==================== SETUP WEBHOOK ====================
  router.post("/api/crm/setup-webhook", requireSuperAdmin, async (req, res) => {
    try {
      const { webhookUrl } = req.body;
      if (!webhookUrl) {
        return res.status(400).json({ message: "webhookUrl obrigatoria" });
      }
      const result = await setWebhook(webhookUrl);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ==================== ZAPI STATUS ====================
  router.get("/api/crm/zapi-status", requireSuperAdmin, async (_req, res) => {
    try {
      return res.json({ configured: isZapiConfigured() });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
