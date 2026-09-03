import { Router } from "express";
import { requireAuth, requireAdmin, requireProvider } from "../auth";
import { storage } from "../storage";
import { maskAlertForProvider } from "../utils/mask-alert";
import { getSafeErrorMessage } from "../utils/safe-error";
import { logger } from "../logger";
import { equipamentoTemRetiradaPendente } from "../services/equipment-recovery-rules";
import { avaliarRiscoDeFuga, rotuloDoAlerta, severidadeDoAlerta, motivosGravados } from "../services/antifraude-rules";
import { montarRegras, desmontarRegras, regrasAntiFraudeSchema } from "@shared/antifraude-regras";
import { isZapiConfigured } from "../services/crm/zapi";
import { z } from "zod";
import { anonymizeProvider } from "../utils/provider-anonymizer";

export function registerAntiFraudeRoutes(): Router {
  const router = Router();

  /**
   * Regras e canais do anti-fraude deste provedor — o que ele quer que a
   * rede vigie na base dele e por onde quer ser avisado. O catalogo e o
   * padrao vivem em shared/antifraude-regras.ts; sem linha gravada vale o
   * padrao (so cliente ativo inadimplente).
   */
  router.get("/api/anti-fraud/rules", requireAuth, requireProvider, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const [linhas, provider, usuarios] = await Promise.all([
        storage.getAntiFraudRules(providerId),
        storage.getProvider(providerId),
        storage.getUsersByProvider(providerId),
      ]);
      if (!provider) return res.status(404).json({ message: "Provedor não encontrado" });

      // Para onde o e-mail vai hoje — a mesma escolha do envio.
      const contato = (provider.contactEmail || "").trim();
      const emails = contato
        ? [contato]
        : Array.from(new Set(usuarios.filter(u => u.role === "admin" && u.email).map(u => u.email.trim().toLowerCase())));

      return res.json({
        regras: montarRegras(linhas),
        canais: {
          proactiveAlertsEnabled: provider.proactiveAlertsEnabled ?? true,
          webhookUrl: provider.proactiveAlertWebhookUrl || "",
          emails,
          whatsapp: provider.contactPhone || null,
          whatsappDisponivel: isZapiConfigured(),
        },
      });
    } catch (error: any) {
      logger.error({ err: error }, "Erro ao ler regras do anti-fraude");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  const salvarRegrasSchema = z.object({
    regras: regrasAntiFraudeSchema,
    canais: z.object({
      proactiveAlertsEnabled: z.boolean(),
      webhookUrl: z.string().trim().max(500)
        .refine(v => v === "" || /^https?:\/\//i.test(v), "O webhook precisa começar com http:// ou https://"),
    }).optional(),
  });

  router.put("/api/anti-fraud/rules", requireProvider, requireAdmin, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const parsed = salvarRegrasSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message || "Regras inválidas" });
      }
      await storage.saveAntiFraudRules(providerId, desmontarRegras(parsed.data.regras));
      if (parsed.data.canais) {
        await storage.updateProviderProfile(providerId, {
          proactiveAlertsEnabled: parsed.data.canais.proactiveAlertsEnabled,
          proactiveAlertWebhookUrl: parsed.data.canais.webhookUrl || null,
        });
      }
      logger.info({ providerId, regras: parsed.data.regras }, "Regras do anti-fraude salvas");
      return res.json({ success: true, regras: parsed.data.regras });
    } catch (error: any) {
      logger.error({ err: error }, "Erro ao salvar regras do anti-fraude");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * Alertas do anti-fraude deste provedor.
   *
   * Um unico conceito: `defaulter_consulted` — FUGA. Um cliente ATIVO (ou
   * suspenso por atraso) e INADIMPLENTE deste provedor foi consultado por
   * outro. Nasce com a foto do momento (divida, dias, contrato) e e mostrado
   * como nasceu; a situacao de HOJE vai junto (`atual`) para o provedor ver
   * se o cliente pagou ou saiu desde entao e resolver o alerta.
   *
   * Ex-cliente NAO e anti-fraude. Linhas `migrador_serial` (ex-cliente que
   * saiu devendo e foi consultado de novo) existem no banco de antes de
   * 02/09/2026 e sao ignoradas aqui: nao ha contrato a proteger, o caso e de
   * bureau, e ele ja aparece no resultado da consulta de quem consultou.
   *
   * `proactive_alerts` e o log de envio. Linhas antigas, de antes de o alerta
   * ser gravado com a foto, continuam entrando — reavaliadas pela regra com a
   * situacao atual, porque nao guardam a de entao.
   *
   * Tudo deduplicado por tipo + CPF + consulente: o mesmo CPF consultado tres
   * vezes pelo mesmo provedor e UM caso a tratar, nao tres cards iguais.
   */
  router.get("/api/anti-fraud/alerts", requireAuth, requireProvider, async (req, res) => {
    try {
      const currentProviderId = req.session.providerId!;

      const [gravados, proactiveRaw, regrasGravadas] = await Promise.all([
        storage.getAlertsByProvider(currentProviderId),
        storage.getProactiveAlertsByProvider(currentProviderId, 200),
        storage.getAntiFraudRules(currentProviderId),
      ]);
      // As regras DESTE provedor: e com elas que "em risco hoje" e decidido.
      const regras = montarRegras(regrasGravadas);

      // ── Snapshot atual dos clientes citados ───────────────────────────
      // Um lookup por CPF distinto, nao um por alerta: antes eram N queries
      // sequenciais dentro do map.
      const documentos = Array.from(new Set([
        ...proactiveRaw.map(p => p.cpfCnpj),
        ...gravados.map((a: any) => a.customerCpfCnpj),
      ].filter(Boolean) as string[]));

      const snapshot = new Map<string, {
        name: string | null;
        daysOverdue: number;
        overdueAmount: string;
        equipCount: number;
        equipValue: string;
        contractStatus?: "active" | "cancelled" | "suspended";
      }>();

      await Promise.all(documentos.map(async (doc) => {
        try {
          const encontrados = await storage.getCustomerByCpfCnpj(doc);
          const meu = encontrados.find(c => c.providerId === currentProviderId);
          if (!meu) return;
          snapshot.set(doc.replace(/\D/g, ""), {
            name: meu.name,
            daysOverdue: meu.maxDaysOverdue || 0,
            overdueAmount: meu.totalOverdueAmount || "0",
            equipCount: (meu as any).equipmentCount ?? 0,
            equipValue: (meu as any).equipmentEstimatedValue ?? "0",
            // customers.status espelha o contrato no ERP na ultima sincronia.
            //
            // O mapeamento e EXAUSTIVO e o default e `undefined`, nao "active".
            // Qualquer valor que a lista nao reconheca — inclusive o default da
            // coluna, para quem nunca foi sincronizado — virava "ativo" e abria
            // o portao da regra de fuga para ex-cliente. Undefined faz a regra
            // descartar por "status_desconhecido", que e a resposta certa: nao
            // saber se e cliente nao e o mesmo que saber que e.
            contractStatus: meu.status === "active"
              ? "active"
              : meu.status === "suspended"
              ? "suspended"
              : meu.status === "cancelled" || meu.status === "inactive"
              ? "cancelled"
              : undefined,
          });
        } catch { /* sem snapshot, a regra decide com o que o alerta trouxe */ }
      }));

      type Candidato = {
        alerta: Record<string, any>;
        /** Legado sem foto: a regra decide com a situacao de hoje. Gravado com foto: null. */
        avaliacao: ReturnType<typeof avaliarRiscoDeFuga> | null;
        chave: string;
        quando: number;
      };

      const avaliar = (
        doc: string | null,
        consultanteId: number | null,
        brutos: { daysOverdue: number; overdueAmount: string },
      ) => {
        const snap = doc ? snapshot.get(doc.replace(/\D/g, "")) : undefined;
        return avaliarRiscoDeFuga(
          {
            contractStatus: snap?.contractStatus,
            totalOverdueAmount: parseFloat(snap?.overdueAmount ?? brutos.overdueAmount) || 0,
            maxDaysOverdue: snap?.daysOverdue ?? brutos.daysOverdue,
          },
          { consultanteEhDono: consultanteId === currentProviderId, regras },
        );
      };

      /** A situacao de HOJE do cliente, ao lado da foto que o alerta guardou. */
      const situacaoHoje = (doc: string | null) => {
        const snap = doc ? snapshot.get(doc.replace(/\D/g, "")) : undefined;
        if (!snap) return null;
        return {
          contractStatus: snap.contractStatus ?? null,
          daysOverdue: snap.daysOverdue,
          overdueAmount: snap.overdueAmount,
          emRisco: avaliar(doc, null, { daysOverdue: 0, overdueAmount: "0" }).alerta,
        };
      };

      const candidatos: Candidato[] = [];

      // Alertas de fuga ja gravados com foto: uma linha de log de envio do
      // mesmo CPF+consulente, nos minutos em volta, e o MESMO alerta.
      const fugasGravadas = gravados.filter((a: any) => a.type === "defaulter_consulted");
      const temFugaGravada = (cpf: string, consultante: number | null, quando: number) =>
        fugasGravadas.some((a: any) =>
          (a.customerCpfCnpj || "").replace(/\D/g, "") === cpf
          && (a.consultingProviderId ?? 0) === (consultante ?? 0)
          && Math.abs((a.createdAt ? new Date(a.createdAt).getTime() : 0) - quando) < 5 * 60_000);

      for (const pa of proactiveRaw) {
        const cpf = (pa.cpfCnpj || "").replace(/\D/g, "");
        const quando = pa.sentAt ? new Date(pa.sentAt).getTime() : 0;
        if (temFugaGravada(cpf, pa.consultingProviderId, quando)) continue;
        const snap = snapshot.get(cpf);
        const avaliacao = avaliar(pa.cpfCnpj, pa.consultingProviderId, { daysOverdue: 0, overdueAmount: "0" });
        const dias = snap?.daysOverdue ?? 0;
        const valor = snap?.overdueAmount ?? "0";
        candidatos.push({
          chave: "fuga|" + cpf + "|" + (pa.consultingProviderId ?? 0),
          quando,
          avaliacao,
          alerta: {
            id: pa.id + 1_000_000,
            providerId: pa.providerId,
            customerId: null,
            customerProviderId: currentProviderId,
            // O id cru do consulente nao sai para o dono: ao lado do codigo ele
            // desfazia a anonimizacao. O dono precisa saber QUE consultaram, nao
            // qual concorrente esta prospectando.
            consultingProviderId: pa.consultingProviderId === currentProviderId ? pa.consultingProviderId : null,
            consultingProviderName: anonymizeProvider(currentProviderId, pa.consultingProviderId),
            customerName: snap?.name ?? null,
            customerCpfCnpj: pa.cpfCnpj,
            type: "defaulter_consulted",
            severity: severidadeDoAlerta(avaliacao.motivos, {
              totalOverdueAmount: parseFloat(valor) || 0,
              maxDaysOverdue: dias,
            }),
            message: "Seu cliente foi consultado por outro provedor da rede ISP",
            motivos: avaliacao.motivos,
            motivoLabel: rotuloDoAlerta(avaliacao.motivos),
            diasDeContrato: avaliacao.diasDeContrato ?? null,
            riskScore: dias > 90 ? 80 : 50,
            riskLevel: dias > 90 ? "high" : "medium",
            riskFactors: ["consulta_outro_provedor", ...avaliacao.motivos],
            daysOverdue: dias,
            overdueAmount: valor,
            equipmentNotReturned: snap?.equipCount ?? 0,
            equipmentValue: snap?.equipValue ?? "0",
            recentConsultations: 1,
            resolved: pa.acknowledged || false,
            status: pa.acknowledged ? "resolved" : "new",
            createdAt: pa.sentAt,
            atual: situacaoHoje(pa.cpfCnpj),
            _source: "proactive" as const,
          },
        });
      }

      for (const bruto of gravados as any[]) {
        const mascarado = maskAlertForProvider(bruto, currentProviderId);
        const cpf = (bruto.customerCpfCnpj || "").replace(/\D/g, "");
        const snap = snapshot.get(cpf);
        const quando = bruto.createdAt ? new Date(bruto.createdAt).getTime() : 0;

        if (bruto.type === "defaulter_consulted") {
          // Gravado com a foto: e mostrado como nasceu. A regra nao e
          // reaplicada — o alerta ja passou por ela ao nascer, e o que mudou
          // desde entao vai em `atual` para o provedor decidir. Os motivos
          // que bateram vieram em riskFactors; registro de antes deles e fuga
          // por divida, a unica regra que existia.
          const motivosDoRegistro = motivosGravados(bruto.riskFactors);
          if (motivosDoRegistro.length === 0) motivosDoRegistro.push("divida_ativa");
          candidatos.push({
            chave: "fuga|" + cpf + "|" + (bruto.consultingProviderId ?? 0),
            quando,
            avaliacao: null,
            alerta: {
              ...mascarado,
              customerName: mascarado.customerName ?? snap?.name ?? null,
              motivos: motivosDoRegistro,
              motivoLabel: rotuloDoAlerta(motivosDoRegistro),
              diasDeContrato: null,
              equipmentNotReturned: bruto.equipmentNotReturned || snap?.equipCount || 0,
              equipmentValue: bruto.equipmentValue && bruto.equipmentValue !== "0" ? bruto.equipmentValue : (snap?.equipValue ?? "0"),
              atual: situacaoHoje(bruto.customerCpfCnpj),
              _source: "fuga" as const,
            },
          });
          continue;
        }

        // Ex-cliente nao e anti-fraude: o contrato ja acabou, nao ha o que
        // proteger. Linhas antigas desse tipo ficam no banco, fora da tela.
        if (bruto.type === "migrador_serial") continue;

        // Tipos legados sem foto confiavel: passam pela regra com a situacao de hoje.
        const avaliacao = avaliar(bruto.customerCpfCnpj, bruto.consultingProviderId, {
          daysOverdue: bruto.daysOverdue ?? 0,
          overdueAmount: bruto.overdueAmount ?? "0",
        });
        candidatos.push({
          chave: "fuga|" + cpf + "|" + (bruto.consultingProviderId ?? 0),
          quando,
          avaliacao,
          alerta: {
            ...mascarado,
            customerName: mascarado.customerName ?? snap?.name ?? null,
            motivos: avaliacao.motivos,
            motivoLabel: rotuloDoAlerta(avaliacao.motivos),
            diasDeContrato: avaliacao.diasDeContrato ?? null,
            severity: severidadeDoAlerta(avaliacao.motivos, {
              totalOverdueAmount: parseFloat(snap?.overdueAmount ?? bruto.overdueAmount ?? "0") || 0,
              maxDaysOverdue: snap?.daysOverdue ?? bruto.daysOverdue ?? 0,
            }),
            atual: situacaoHoje(bruto.customerCpfCnpj),
            _source: "legado" as const,
          },
        });
      }

      /* Um alerta ja tratado continua visivel na aba "Resolvidos" — o provedor
         precisa do proprio historico. O que a regra remove e o alerta ABERTO
         legado que nunca deveria ter existido, criado sob a regra antiga, que
         disparava para qualquer consulta a qualquer cliente. Alerta gravado
         com foto (avaliacao null) fica como nasceu. */
      const descartados: Record<string, number> = {};
      const qualificados = candidatos.filter(({ alerta, avaliacao }) => {
        if (!avaliacao || avaliacao.alerta || alerta.resolved) return true;
        const k = avaliacao.descartadoPor ?? "desconhecido";
        descartados[k] = (descartados[k] ?? 0) + 1;
        return false;
      });

      // Dedup: mesmo CPF + mesmo consulente = um caso. Fica o mais recente.
      const porChave = new Map<string, Candidato>();
      for (const c of qualificados) {
        const atual = porChave.get(c.chave);
        if (!atual || c.quando > atual.quando) porChave.set(c.chave, c);
      }

      if (Object.keys(descartados).length > 0 || porChave.size < qualificados.length) {
        logger.info(
          {
            providerId: currentProviderId,
            descartados,
            duplicatasRemovidas: qualificados.length - porChave.size,
          },
          "Alertas de fuga filtrados pela regra",
        );
      }

      const all = Array.from(porChave.values())
        .sort((a, b) => b.quando - a.quando)
        .map(c => c.alerta);

      return res.json(all);
    } catch (error: any) {
      logger.error({ err: error }, "Anti-fraud alerts fetch error");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/anti-fraud/alerts/:id/status", requireAuth, requireProvider, async (req, res) => {
    try {
      const alertId = parseInt(req.params.id as string);
      const { status } = req.body;
      if (!["new", "resolved", "dismissed"].includes(status)) {
        return res.status(400).json({ message: "Status invalido" });
      }

      // Proactive alerts have IDs offset by 1_000_000
      if (alertId >= 1_000_000) {
        const realId = alertId - 1_000_000;
        const isAck = status === "resolved" || status === "dismissed";
        if (isAck) {
          const updated = await storage.acknowledgeProactiveAlert(realId, req.session.providerId!);
          if (!updated) return res.status(404).json({ message: "Alerta nao encontrado" });
          // So o que a tela usa: a linha crua traz o id do consulente.
          return res.json({ id: alertId, status, acknowledgedAt: updated.acknowledgedAt, _source: "proactive" });
        }
        return res.json({ id: alertId, status: "new" });
      }

      const updated = await storage.updateAlertStatus(alertId, req.session.providerId!, status);
      if (!updated) {
        return res.status(404).json({ message: "Alerta nao encontrado" });
      }
      return res.json(maskAlertForProvider(updated, req.session.providerId!));
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/anti-fraud/customer-risk", requireAuth, requireProvider, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const allCustomers = await storage.getCustomersByProvider(providerId);
      const customerRisk = [];
      for (const customer of allCustomers) {
        const customerEquipment = await storage.getEquipmentByCustomer(customer.id, providerId);
        const unreturnedEquipment = customerEquipment.filter(eq => equipamentoTemRetiradaPendente(eq.status));
        const equipmentValue = unreturnedEquipment.reduce((sum, eq) => sum + parseFloat(eq.value || "0"), 0);
        const overdueAmount = parseFloat(customer.totalOverdueAmount || "0");
        const daysOverdue = customer.maxDaysOverdue || 0;
        const existingAlerts = await storage.getAlertsByCustomer(customer.id);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentAlertCount = existingAlerts.filter(a => a.createdAt && new Date(a.createdAt) >= thirtyDaysAgo).length;

        const customerContracts = await storage.getContractsByCustomer(customer.id);
        const oldestContract = customerContracts.reduce((oldest, ct) => {
          const start = ct.startDate ? new Date(ct.startDate) : new Date();
          return start < oldest ? start : oldest;
        }, new Date());
        const contractAgeDays = Math.floor((Date.now() - oldestContract.getTime()) / (1000 * 60 * 60 * 24));

        let riskScore = 0;
        const riskFactors: string[] = [];
        if (daysOverdue >= 90) { riskScore += 35; riskFactors.push("Atraso superior a 90 dias"); }
        else if (daysOverdue >= 60) { riskScore += 25; riskFactors.push("Atraso entre 60-90 dias"); }
        else if (daysOverdue >= 30) { riskScore += 15; riskFactors.push("Atraso entre 30-60 dias"); }
        else if (daysOverdue >= 1) { riskScore += 8; riskFactors.push("Atraso de 1-30 dias"); }

        if (overdueAmount >= 1000) { riskScore += 25; riskFactors.push(`Valor alto em aberto: R$ ${overdueAmount.toFixed(2)}`); }
        else if (overdueAmount >= 500) { riskScore += 18; riskFactors.push(`Valor medio em aberto: R$ ${overdueAmount.toFixed(2)}`); }
        else if (overdueAmount >= 200) { riskScore += 10; riskFactors.push(`Valor em aberto: R$ ${overdueAmount.toFixed(2)}`); }
        else if (overdueAmount > 0) { riskScore += 5; riskFactors.push(`Pequeno valor em aberto: R$ ${overdueAmount.toFixed(2)}`); }

        if (equipmentValue >= 500) { riskScore += 25; riskFactors.push(`Equipamento de alto valor: R$ ${equipmentValue.toFixed(2)}`); }
        else if (equipmentValue >= 200) { riskScore += 18; riskFactors.push(`Equipamento nao devolvido: R$ ${equipmentValue.toFixed(2)}`); }
        else if (unreturnedEquipment.length > 0) { riskScore += 10; riskFactors.push(`${unreturnedEquipment.length} equipamento(s) pendente(s)`); }

        if (recentAlertCount >= 5) { riskScore += 15; riskFactors.push(`Consultado por ${recentAlertCount} provedores`); }
        else if (recentAlertCount >= 3) { riskScore += 10; riskFactors.push(`Multiplas consultas: ${recentAlertCount}`); }
        else if (recentAlertCount >= 2) { riskScore += 5; riskFactors.push("Consultado por 2+ provedores"); }

        if (contractAgeDays < 30) { riskScore += 10; riskFactors.push("Contrato muito recente"); }
        else if (contractAgeDays < 90) { riskScore += 5; riskFactors.push("Contrato recente"); }

        riskScore = Math.min(riskScore, 100);
        const riskLevel = riskScore >= 75 ? "critical" : riskScore >= 50 ? "high" : riskScore >= 25 ? "medium" : "low";

        customerRisk.push({
          id: customer.id,
          name: customer.name,
          cpfCnpj: customer.cpfCnpj,
          riskScore,
          riskLevel,
          riskFactors,
          daysOverdue,
          overdueAmount,
          equipmentNotReturned: unreturnedEquipment.length,
          equipmentValue,
          recentConsultations: recentAlertCount,
          alertCount: existingAlerts.length,
        });
      }
      customerRisk.sort((a, b) => b.riskScore - a.riskScore);
      return res.json(customerRisk);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
