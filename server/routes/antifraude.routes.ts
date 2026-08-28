import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { maskAlertForProvider } from "../utils/mask-alert";
import { getSafeErrorMessage } from "../utils/safe-error";
import { logger } from "../logger";
import { equipamentoTemRetiradaPendente } from "../services/equipment-recovery-rules";
import { avaliarRiscoDeFuga, rotuloDoAlerta, severidadeDoAlerta } from "../services/antifraude-rules";
import { anonymizeProvider } from "../utils/provider-anonymizer";

export function registerAntiFraudeRoutes(): Router {
  const router = Router();

  /**
   * Alertas de FUGA: clientes deste provedor que outro provedor consultou.
   *
   * Duas origens alimentam a mesma lista — o alerta proativo (alguem consultou
   * seu cliente) e o alerta de migrador (contrato cancelado + divida na rede).
   * As duas passam pela MESMA regra, senao uma volta a mostrar o que a outra
   * filtra. E as duas sao deduplicadas: o mesmo CPF consultado tres vezes pelo
   * mesmo provedor e UM caso a tratar, nao tres cards iguais.
   */
  router.get("/api/anti-fraud/alerts", requireAuth, async (req, res) => {
    try {
      const currentProviderId = req.session.providerId!;

      const [migratorAlerts, proactiveRaw] = await Promise.all([
        storage.getAlertsByProvider(currentProviderId),
        storage.getProactiveAlertsByProvider(currentProviderId, 200),
      ]);

      // ── Snapshot atual dos clientes citados ───────────────────────────
      // Um lookup por CPF distinto, nao um por alerta: antes eram N queries
      // sequenciais dentro do map.
      const documentos = Array.from(new Set([
        ...proactiveRaw.map(p => p.cpfCnpj),
        ...migratorAlerts.map((a: any) => a.customerCpfCnpj),
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

      const nomesConsulentes = new Map<number, string>();
      for (const pa of proactiveRaw) {
        if (pa.consultingProviderId && !nomesConsulentes.has(pa.consultingProviderId)) {
          try {
            const p = await storage.getProvider(pa.consultingProviderId);
            if (p) nomesConsulentes.set(pa.consultingProviderId, p.name);
          } catch { /* nome ausente vira "Provedor da rede" */ }
        }
      }

      type Candidato = {
        alerta: Record<string, any>;
        avaliacao: ReturnType<typeof avaliarRiscoDeFuga>;
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
          { consultanteEhDono: consultanteId === currentProviderId },
        );
      };

      const candidatos: Candidato[] = [];

      for (const pa of proactiveRaw) {
        const snap = snapshot.get((pa.cpfCnpj || "").replace(/\D/g, ""));
        const avaliacao = avaliar(pa.cpfCnpj, pa.consultingProviderId, { daysOverdue: 0, overdueAmount: "0" });
        const dias = snap?.daysOverdue ?? 0;
        const valor = snap?.overdueAmount ?? "0";
        candidatos.push({
          chave: (pa.cpfCnpj || "").replace(/\D/g, "") + "|" + (pa.consultingProviderId ?? 0),
          quando: pa.sentAt ? new Date(pa.sentAt).getTime() : 0,
          avaliacao,
          alerta: {
            id: pa.id + 1_000_000,
            providerId: pa.providerId,
            customerId: null,
            customerProviderId: currentProviderId,
            consultingProviderId: pa.consultingProviderId,
            // Anonimizado como no caminho de migrador: o dono precisa saber QUE
            // consultaram, nao qual concorrente esta prospectando.
            consultingProviderName: pa.consultingProviderId
              ? anonymizeProvider(nomesConsulentes.get(pa.consultingProviderId) || "Provedor da rede", pa.consultingProviderId)
              : null,
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
            _source: "proactive" as const,
          },
        });
      }

      for (const bruto of migratorAlerts as any[]) {
        const mascarado = maskAlertForProvider(bruto, currentProviderId);
        const avaliacao = avaliar(bruto.customerCpfCnpj, bruto.consultingProviderId, {
          daysOverdue: bruto.daysOverdue ?? 0,
          overdueAmount: bruto.overdueAmount ?? "0",
        });
        const snap = snapshot.get((bruto.customerCpfCnpj || "").replace(/\D/g, ""));
        candidatos.push({
          chave: (bruto.customerCpfCnpj || "").replace(/\D/g, "") + "|" + (bruto.consultingProviderId ?? 0),
          quando: bruto.createdAt ? new Date(bruto.createdAt).getTime() : 0,
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
            _source: "migrator" as const,
          },
        });
      }

      /* Um alerta ja tratado continua visivel na aba "Resolvidos" — o provedor
         precisa do proprio historico. O que a regra remove e o alerta ABERTO
         que nunca deveria ter existido, inclusive o passivo criado sob a regra
         antiga, que disparava para qualquer consulta a qualquer cliente. */
      const descartados: Record<string, number> = {};
      const qualificados = candidatos.filter(({ alerta, avaliacao }) => {
        if (avaliacao.alerta || alerta.resolved) return true;
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

  router.patch("/api/anti-fraud/alerts/:id/status", requireAuth, async (req, res) => {
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
          return res.json({ ...updated, id: alertId, status, _source: "proactive" });
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

  router.get("/api/anti-fraud/customer-risk", requireAuth, async (req, res) => {
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
