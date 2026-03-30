import { Router } from "express";
import { requireSuperAdmin } from "../auth";
import { storage } from "../storage";

export function registerFinanceiroRoutes(): Router {
  const router = Router();

  router.get("/api/admin/asaas/status", requireSuperAdmin, async (_req, res) => {
    try {
      const { isAsaasConfigured, getAsaasMode, getBalance } = await import("../asaas");
      const configured = isAsaasConfigured();
      const mode = getAsaasMode();
      let balance = null;
      if (configured) {
        try { balance = await getBalance(); } catch {}
      }
      return res.json({ configured, mode, balance });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/admin/invoices/:id/asaas/charge", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { billingType = "UNDEFINED" } = req.body;
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      if (invoice.asaasChargeId) return res.status(409).json({ message: "Cobranca Asaas ja existe para esta fatura" });

      const { findOrCreateCustomer, createCharge } = await import("../asaas");

      const provider = await storage.getProvider(invoice.providerId);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });

      const providerUsers = await storage.getUsersByProvider(invoice.providerId);
      const adminUser = providerUsers.find(u => u.role === "admin") || providerUsers[0];

      const customer = await findOrCreateCustomer({
        name: provider.name,
        cpfCnpj: provider.cnpj,
        email: provider.contactEmail || adminUser?.email,
        phone: provider.contactPhone || undefined,
      });

      const dueDate = new Date(invoice.dueDate).toISOString().split("T")[0];
      const charge = await createCharge({
        customerId: customer.id,
        value: parseFloat(invoice.amount),
        dueDate,
        description: `${invoice.invoiceNumber} - Plano ${invoice.planAtTime} - Periodo ${invoice.period}`,
        externalReference: `invoice_${invoice.id}`,
        billingType: billingType as any,
      });

      const updated = await storage.updateProviderInvoiceAsaas(id, {
        asaasChargeId: charge.id,
        asaasCustomerId: customer.id,
        asaasStatus: charge.status,
        asaasInvoiceUrl: charge.invoiceUrl,
        asaasBankSlipUrl: charge.bankSlipUrl,
        asaasBillingType: charge.billingType,
      });

      return res.json({ invoice: updated, charge });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/admin/invoices/:id/asaas/sync", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      if (!invoice.asaasChargeId) return res.status(400).json({ message: "Fatura sem cobranca Asaas" });

      const { getCharge, asaasStatusToLocal } = await import("../asaas");
      const charge = await getCharge(invoice.asaasChargeId);
      const newStatus = asaasStatusToLocal(charge.status);

      const updateData: any = {
        asaasStatus: charge.status,
        asaasInvoiceUrl: charge.invoiceUrl || invoice.asaasInvoiceUrl,
        asaasBankSlipUrl: charge.bankSlipUrl || invoice.asaasBankSlipUrl,
        status: newStatus,
      };
      if (newStatus === "paid" && charge.paymentDate) {
        updateData.paidDate = new Date(charge.paymentDate);
        updateData.paidAmount = String(charge.value);
      }

      const updated = await storage.updateProviderInvoiceAsaas(id, updateData);
      return res.json({ invoice: updated, charge });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.delete("/api/admin/invoices/:id/asaas/charge", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      if (!invoice.asaasChargeId) return res.status(400).json({ message: "Fatura sem cobranca Asaas" });

      const { cancelCharge } = await import("../asaas");
      await cancelCharge(invoice.asaasChargeId);
      const updated = await storage.updateProviderInvoiceAsaas(id, {
        asaasChargeId: undefined,
        asaasStatus: "DELETED",
        status: "cancelled",
      });
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/admin/invoices/:id/asaas/pix", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice || !invoice.asaasChargeId) return res.status(404).json({ message: "Cobranca Asaas nao encontrada" });

      const { getPixQrCode } = await import("../asaas");
      const pix = await getPixQrCode(invoice.asaasChargeId);
      return res.json(pix);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/asaas/webhook", async (req, res) => {
    try {
      const { event, payment } = req.body;
      if (!payment?.externalReference) return res.json({ ok: true });

      const { asaasStatusToLocal } = await import("../asaas");

      const creditOrderMatch = payment.externalReference.match(/^credit_order_(\d+)$/);
      if (creditOrderMatch) {
        const orderId = parseInt(creditOrderMatch[1]);
        const newStatus = asaasStatusToLocal(payment.status);
        if (newStatus === "paid") {
          try { await storage.releaseCreditOrder(orderId); } catch {}
        } else {
          await storage.updateCreditOrder(orderId, { asaasStatus: payment.status, status: newStatus });
        }
        return res.json({ ok: true });
      }

      const invoiceMatch = payment.externalReference.match(/^invoice_(\d+)$/);
      if (!invoiceMatch) return res.json({ ok: true });

      const invoiceId = parseInt(invoiceMatch[1]);
      const newStatus = asaasStatusToLocal(payment.status);

      const updateData: any = { asaasStatus: payment.status, status: newStatus };
      if (newStatus === "paid" && payment.paymentDate) {
        updateData.paidDate = new Date(payment.paymentDate);
        updateData.paidAmount = String(payment.value);
      }
      await storage.updateProviderInvoiceAsaas(invoiceId, updateData);
      return res.json({ ok: true });
    } catch (error: any) {
      console.error("Webhook Asaas error:", error.message);
      return res.json({ ok: true });
    }
  });

  // ============ FINANCIAL INVOICE ROUTES ============

  router.get("/api/admin/financial/saas-metrics", requireSuperAdmin, async (_req, res) => {
    try {
      const metrics = await storage.getSaasMetrics();
      return res.json(metrics);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/admin/financial/summary", requireSuperAdmin, async (_req, res) => {
    try {
      const summary = await storage.getFinancialSummary();
      return res.json(summary);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/admin/invoices", requireSuperAdmin, async (req, res) => {
    try {
      const providerId = req.query.providerId ? parseInt(req.query.providerId as string) : undefined;
      const invoiceList = await storage.getAllProviderInvoices(providerId);
      return res.json(invoiceList);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/admin/invoices/:id", requireSuperAdmin, async (req, res) => {
    try {
      const invoice = await storage.getProviderInvoice(parseInt(req.params.id));
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      return res.json(invoice);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/admin/invoices", requireSuperAdmin, async (req, res) => {
    try {
      const { providerId, period, planAtTime, amount, ispCreditsIncluded, spcCreditsIncluded, dueDate, notes } = req.body;
      if (!providerId || !period || !planAtTime || !amount || !dueDate) {
        return res.status(400).json({ message: "Campos obrigatorios: providerId, period, planAtTime, amount, dueDate" });
      }
      const me = await storage.getUser(req.session.userId!);
      const invoiceNumber = await storage.getNextInvoiceNumber();
      const invoice = await storage.createProviderInvoice({
        invoiceNumber,
        providerId: parseInt(providerId),
        period,
        planAtTime,
        amount: amount.toString(),
        ispCreditsIncluded: ispCreditsIncluded || 0,
        spcCreditsIncluded: spcCreditsIncluded || 0,
        dueDate: new Date(dueDate),
        status: "pending",
        notes: notes || null,
        createdById: req.session.userId!,
        createdByName: me?.name || "Admin",
      });
      return res.status(201).json(invoice);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.patch("/api/admin/invoices/:id/status", requireSuperAdmin, async (req, res) => {
    try {
      const { status, paidAmount } = req.body;
      if (!status) return res.status(400).json({ message: "Status e obrigatorio" });
      const paidDate = status === "paid" ? new Date() : undefined;
      const updated = await storage.updateProviderInvoiceStatus(
        parseInt(req.params.id), status, paidDate, paidAmount?.toString()
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.delete("/api/admin/invoices/:id", requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const invoice = await storage.getProviderInvoice(parseInt(id));
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      if (invoice.status === "paid") return res.status(400).json({ message: "Nao e possivel cancelar uma fatura paga" });
      await storage.updateProviderInvoiceStatus(parseInt(id), "cancelled");
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/admin/invoices/generate-monthly", requireSuperAdmin, async (req, res) => {
    try {
      const { period } = req.body;
      if (!period) return res.status(400).json({ message: "Period e obrigatorio (ex: 2026-03)" });
      const PLAN_PRICES: Record<string, number> = { free: 0, basic: 199, pro: 399, enterprise: 799 };
      const PLAN_CREDITS: Record<string, { isp: number; spc: number }> = {
        free: { isp: 50, spc: 0 }, basic: { isp: 200, spc: 50 }, pro: { isp: 500, spc: 150 }, enterprise: { isp: 1500, spc: 500 }
      };
      const allProviders = await storage.getAllProviders();
      const me = await storage.getUser(req.session.userId!);
      const [year, month] = period.split("-").map(Number);
      const dueDate = new Date(year, month - 1, 10);
      let created = 0;
      let skipped = 0;
      for (const provider of allProviders) {
        if (PLAN_PRICES[provider.plan] === 0) { skipped++; continue; }
        const existingInvoices = await storage.getAllProviderInvoices(provider.id);
        if (existingInvoices.some(i => i.period === period && i.status !== "cancelled")) { skipped++; continue; }
        const invoiceNumber = await storage.getNextInvoiceNumber();
        const credits = PLAN_CREDITS[provider.plan] || { isp: 0, spc: 0 };
        await storage.createProviderInvoice({
          invoiceNumber, providerId: provider.id, period,
          planAtTime: provider.plan, amount: PLAN_PRICES[provider.plan].toString(),
          ispCreditsIncluded: credits.isp, spcCreditsIncluded: credits.spc,
          dueDate, status: "pending",
          createdById: req.session.userId!, createdByName: me?.name || "Admin",
        });
        created++;
      }
      return res.json({ created, skipped, message: `${created} faturas geradas para ${period}` });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  return router;
}
