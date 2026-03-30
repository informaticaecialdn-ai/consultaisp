import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";

export function registerAntiFraudeRoutes(): Router {
  const router = Router();

  router.get("/api/anti-fraud/alerts", requireAuth, async (req, res) => {
    try {
      const alerts = await storage.getAlertsByProvider(req.session.providerId!);
      return res.json(alerts);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.patch("/api/anti-fraud/alerts/:id/status", requireAuth, async (req, res) => {
    try {
      const alertId = parseInt(req.params.id as string);
      const { status } = req.body;
      if (!["new", "resolved", "dismissed"].includes(status)) {
        return res.status(400).json({ message: "Status invalido" });
      }
      const updated = await storage.updateAlertStatus(alertId, req.session.providerId!, status);
      if (!updated) {
        return res.status(404).json({ message: "Alerta nao encontrado" });
      }
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
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
      return res.status(500).json({ message: error.message });
    }
  });

  return router;
}
