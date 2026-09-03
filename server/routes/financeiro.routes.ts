import { Router } from "express";
import { requireSuperAdmin } from "../auth";
import { storage } from "../storage";
import { PLAN_PRICES, PLAN_CREDITS } from "@shared/schema";
import { logger } from "../logger";
import { getAsaasWebhookToken } from "../env";
import { getSafeErrorMessage } from "../utils/safe-error";

export function registerFinanceiroRoutes(): Router {
  const router = Router();

  router.get("/api/admin/asaas/status", requireSuperAdmin, async (_req, res) => {
    try {
      const { isAsaasConfigured, getAsaasMode, getBalance } = await import("../services/asaas");
      const configured = isAsaasConfigured();
      const mode = getAsaasMode();
      let balance = null;
      if (configured) {
        try { balance = await getBalance(); } catch {}
      }
      return res.json({ configured, mode, balance });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/invoices/:id/asaas/charge", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { billingType = "UNDEFINED" } = req.body;
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      if (invoice.asaasChargeId) return res.status(409).json({ message: "Cobranca Asaas ja existe para esta fatura" });

      const { findOrCreateCustomer, createCharge } = await import("../services/asaas");

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
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/invoices/:id/asaas/sync", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      if (!invoice.asaasChargeId) return res.status(400).json({ message: "Fatura sem cobranca Asaas" });

      const { getCharge, asaasStatusToLocal } = await import("../services/asaas");
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
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/admin/invoices/:id/asaas/charge", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      if (!invoice.asaasChargeId) return res.status(400).json({ message: "Fatura sem cobranca Asaas" });

      const { cancelCharge } = await import("../services/asaas");
      await cancelCharge(invoice.asaasChargeId);
      const updated = await storage.updateProviderInvoiceAsaas(id, {
        asaasChargeId: undefined,
        asaasStatus: "DELETED",
        status: "cancelled",
      });
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/invoices/:id/asaas/pix", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice || !invoice.asaasChargeId) return res.status(404).json({ message: "Cobranca Asaas nao encontrada" });

      const { getPixQrCode } = await import("../services/asaas");
      const pix = await getPixQrCode(invoice.asaasChargeId);
      return res.json(pix);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/asaas/webhook", async (req, res) => {
    try {
      const expectedToken = getAsaasWebhookToken();
      if (expectedToken) {
        const rawToken = req.headers["asaas-access-token"];
        const incomingToken = Array.isArray(rawToken) ? rawToken[0]?.trim() : rawToken?.trim();
        if (!incomingToken || incomingToken !== expectedToken) {
          logger.warn({ ip: req.ip, path: req.path }, "Webhook Asaas rejeitado: token inválido ou ausente");
          return res.status(401).json({ ok: true });
        }
      } else if (process.env.NODE_ENV === "production") {
        // validateEnv já derruba o boot sem o token; esta é a segunda tranca,
        // para o caso de a rota subir por outro caminho. Sem token em produção
        // a porta fica aberta para credito de graça — melhor 503.
        logger.error({ ip: req.ip }, "Webhook Asaas recusado: ASAAS_WEBHOOK_TOKEN ausente em produção");
        return res.status(503).json({ ok: false });
      } else {
        logger.warn("ASAAS_WEBHOOK_TOKEN não configurado — webhook sem proteção");
      }

      const { event, payment } = req.body ?? {};

      logger.info({ event, externalReference: payment?.externalReference }, "Webhook Asaas recebido");

      if (!payment?.externalReference || typeof payment.externalReference !== "string") return res.json({ ok: true });

      const { asaasStatusToLocal } = await import("../services/asaas");
      const { conferirPagamento, anotarRecusa, anotarObservacao } = await import("../services/asaas-conferencia");

      const creditOrderMatch = payment.externalReference.match(/^credit_order_(\d+)$/);
      if (creditOrderMatch) {
        const orderId = parseInt(creditOrderMatch[1]);
        const newStatus = asaasStatusToLocal(payment.status);
        const order = await storage.getCreditOrder(orderId);
        if (!order) {
          logger.warn({ orderId }, "Webhook Asaas para pedido inexistente");
          return res.json({ ok: true });
        }

        if (newStatus !== "paid") {
          // Pedido ja creditado nao volta a "pending". `asaasStatusToLocal`
          // devolve "pending" para tudo que nao esta no mapa dele
          // (CHARGEBACK_REQUESTED, AWAITING_RISK_ANALYSIS, DUNNING_REQUESTED),
          // e o botao "reenviar evento" do painel do Asaas reenvia PENDING e
          // OVERDUE antigos. Rebaixar aqui e o que reabria o pedido para um
          // segundo credito quando o PAYMENT_RECEIVED chegasse de novo.
          // O status do Asaas continua sendo registrado — o que nao muda e o
          // status LOCAL, que ja tem um pagamento consumado por tras.
          if (order.creditedAt) {
            logger.warn({ orderId, pedido: order.orderNumber, asaasStatus: payment.status },
              "Evento nao-pago para pedido ja creditado: status local preservado");
            await storage.updateCreditOrder(orderId, { asaasStatus: payment.status });
            return res.json({ ok: true });
          }
          await storage.updateCreditOrder(orderId, { asaasStatus: payment.status, status: newStatus });
          return res.json({ ok: true });
        }

        const conferencia = await conferirPagamento(payment, {
          referencia: `credit_order_${orderId}`,
          valorEsperado: parseFloat(order.amount),
          chargeIdGravado: order.asaasChargeId,
        });
        if (!conferencia.ok) {
          logger.error({ orderId, pedido: order.orderNumber, motivo: conferencia.motivo }, "Webhook Asaas não liberou crédito");
          const notes = anotarRecusa(order.notes, conferencia.motivo);
          if (notes) await storage.updateCreditOrder(orderId, { notes });
          return res.json({ ok: true });
        }

        const { liberadoAgora } = await storage.releaseCreditOrder(orderId);
        logger.info({ orderId, pedido: order.orderNumber, valorPago: conferencia.valorPago, liberadoAgora },
          liberadoAgora ? "Créditos liberados pelo webhook Asaas" : "Reentrega do webhook Asaas: pedido já estava liberado");
        if (conferencia.avisoIdDivergente && liberadoAgora) {
          logger.warn({ orderId, pedido: order.orderNumber, aviso: conferencia.avisoIdDivergente },
            "Pagamento veio de cobrança diferente da gravada no pedido");
          const notes = anotarObservacao(order.notes, `Asaas: ${conferencia.avisoIdDivergente}`);
          if (notes) await storage.updateCreditOrder(orderId, { notes });
        }
        return res.json({ ok: true });
      }

      const invoiceMatch = payment.externalReference.match(/^invoice_(\d+)$/);
      if (!invoiceMatch) return res.json({ ok: true });

      const invoiceId = parseInt(invoiceMatch[1]);
      const newStatus = asaasStatusToLocal(payment.status);
      const invoice = await storage.getProviderInvoice(invoiceId);
      if (!invoice) {
        logger.warn({ invoiceId }, "Webhook Asaas para fatura inexistente");
        return res.json({ ok: true });
      }

      if (newStatus !== "paid") {
        await storage.updateProviderInvoiceAsaas(invoiceId, { asaasStatus: payment.status, status: newStatus });
        return res.json({ ok: true });
      }

      const conferencia = await conferirPagamento(payment, {
        referencia: `invoice_${invoiceId}`,
        valorEsperado: parseFloat(invoice.amount),
        chargeIdGravado: invoice.asaasChargeId,
      });
      if (!conferencia.ok) {
        logger.error({ invoiceId, fatura: invoice.invoiceNumber, motivo: conferencia.motivo }, "Webhook Asaas não deu a fatura por paga");
        const notes = anotarRecusa(invoice.notes, conferencia.motivo);
        if (notes) await storage.updateProviderInvoiceAsaas(invoiceId, { notes });
        return res.json({ ok: true });
      }

      // Reentrega não é problema aqui: gravar "paid" de novo com os mesmos
      // valores não soma nada, ao contrário do crédito.
      await storage.updateProviderInvoiceAsaas(invoiceId, {
        asaasStatus: payment.status,
        status: "paid",
        paidDate: payment.paymentDate ? new Date(payment.paymentDate) : new Date(),
        paidAmount: conferencia.valorPago.toFixed(2),
      });
      logger.info({ invoiceId, fatura: invoice.invoiceNumber, valorPago: conferencia.valorPago }, "Fatura marcada como paga pelo webhook Asaas");
      if (conferencia.avisoIdDivergente) {
        logger.warn({ invoiceId, fatura: invoice.invoiceNumber, aviso: conferencia.avisoIdDivergente },
          "Fatura paga por cobrança diferente da gravada");
        const notes = anotarObservacao(invoice.notes, `Asaas: ${conferencia.avisoIdDivergente}`);
        if (notes) await storage.updateProviderInvoiceAsaas(invoiceId, { notes });
      }
      return res.json({ ok: true });
    } catch (error: any) {
      // 200 aqui era perda de dinheiro silenciosa: o Asaas da o evento por
      // entregue e NAO reenvia. Uma queda de banco no meio de um
      // PAYMENT_RECEIVED legitimo deixava o provedor pago e sem credito, sem
      // retentativa e sem registro no pedido. Todo caminho ja tratado responde
      // 200 explicitamente acima; o que sobra aqui e falha inesperada, e a
      // resposta certa e 500, para a fila do Asaas reentregar.
      // Reentregar nao custa nada: a liberacao e travada por `credited_at`.
      logger.error({ err: error?.message }, "Webhook Asaas error — devolvendo 500 para o Asaas reentregar");
      return res.status(500).json({ ok: false });
    }
  });

  // ============ FINANCIAL INVOICE ROUTES ============

  router.get("/api/admin/financial/saas-metrics", requireSuperAdmin, async (_req, res) => {
    try {
      const metrics = await storage.getSaasMetrics();
      return res.json(metrics);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/financial/summary", requireSuperAdmin, async (_req, res) => {
    try {
      const summary = await storage.getFinancialSummary();
      return res.json(summary);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/invoices", requireSuperAdmin, async (req, res) => {
    try {
      const providerId = req.query.providerId ? parseInt(req.query.providerId as string) : undefined;
      const invoiceList = await storage.getAllProviderInvoices(providerId);
      return res.json(invoiceList);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/invoices/:id", requireSuperAdmin, async (req, res) => {
    try {
      const invoice = await storage.getProviderInvoice(parseInt(req.params.id));
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      return res.json(invoice);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
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
      return res.status(500).json({ message: getSafeErrorMessage(error) });
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
      return res.status(500).json({ message: getSafeErrorMessage(error) });
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
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/invoices/generate-monthly", requireSuperAdmin, async (req, res) => {
    try {
      const { period } = req.body;
      if (!period) return res.status(400).json({ message: "Period e obrigatorio (ex: 2026-03)" });
      // PLAN_PRICES and PLAN_CREDITS imported from @shared/schema
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
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
