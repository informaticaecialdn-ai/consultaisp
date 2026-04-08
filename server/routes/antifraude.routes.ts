import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { maskAlertForProvider } from "../utils/mask-alert";
import { getSafeErrorMessage } from "../utils/safe-error";
import { logger } from "../logger";

export function registerAntiFraudeRoutes(): Router {
  const router = Router();

  router.get("/api/anti-fraud/alerts", requireAuth, async (req, res) => {
    try {
      const currentProviderId = req.session.providerId!;

      // 1. Migrator alerts (antiFraudAlerts) — only where THIS provider had the cancelled contract
      const migratorAlerts = await storage.getAlertsByProvider(currentProviderId);
      const maskedMigrator = migratorAlerts.map((alert: any) => maskAlertForProvider(alert, currentProviderId));

      // 2. Proactive alerts — when another provider consulted THIS provider's client
      const proactiveRaw = await storage.getProactiveAlertsByProvider(currentProviderId, 100);

      // Convert proactive alerts to same format as anti-fraud alerts for unified display
      const consultingProviderNames = new Map<number, string>();
      for (const pa of proactiveRaw) {
        if (pa.consultingProviderId && !consultingProviderNames.has(pa.consultingProviderId)) {
          try {
            const p = await storage.getProvider(pa.consultingProviderId);
            if (p) consultingProviderNames.set(pa.consultingProviderId, p.name);
          } catch {}
        }
      }

      const proactiveAsAlerts = proactiveRaw.map(pa => ({
        id: pa.id + 1_000_000, // offset to avoid ID collision with antiFraudAlerts
        providerId: pa.providerId,
        customerId: null,
        consultingProviderId: pa.consultingProviderId,
        consultingProviderName: pa.consultingProviderId ? (consultingProviderNames.get(pa.consultingProviderId) || "Provedor da rede") : null,
        customerName: null,
        customerCpfCnpj: pa.cpfCnpj,
        type: "defaulter_consulted",
        severity: "medium",
        message: `Seu cliente foi consultado por outro provedor da rede ISP`,
        riskScore: 50,
        riskLevel: "medium",
        riskFactors: ["consulta_outro_provedor"],
        daysOverdue: null,
        overdueAmount: null,
        equipmentNotReturned: null,
        equipmentValue: null,
        recentConsultations: 1,
        resolved: pa.acknowledged || false,
        status: pa.acknowledged ? "resolved" : "new",
        createdAt: pa.sentAt,
        _source: "proactive" as const,
      }));

      // Combine both sources, sort by date descending
      const all = [...maskedMigrator.map((a: any) => ({ ...a, _source: "migrator" as const })), ...proactiveAsAlerts]
        .sort((a, b) => {
          const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return db - da;
        });

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
        const customerEquipment = await storage.getEquipmentByCustomer(customer.id);
        const unreturnedEquipment = customerEquipment.filter(eq => eq.status === "not_returned");
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
