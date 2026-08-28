import { Router } from "express";
import { requireAuth, requireSuperAdmin } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";

export function registerCreditsRoutes(): Router {
  const router = Router();

  // ============ CREDIT ORDER ROUTES (PROVIDER) ============

  router.get("/api/credits/orders", requireAuth, async (req, res) => {
    try {
      if (!req.session.providerId) return res.status(403).json({ message: "Somente provedores" });
      const orders = await storage.getAllCreditOrders(req.session.providerId);
      return res.json(orders);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/credits/purchase", requireAuth, async (req, res) => {
    try {
      if (!req.session.providerId) return res.status(403).json({ message: "Somente provedores" });
      const { packageId, billingType } = req.body;
      const { CREDIT_PACKAGES } = await import("@shared/schema");

      const pkg = CREDIT_PACKAGES.find(p => p.id === packageId);
      if (!pkg) return res.status(400).json({ message: "Pacote inválido" });

      // Credito e UNICO: tudo entra em ispCredits, que virou o saldo universal.
      // As outras duas colunas seguem no schema por causa dos pedidos antigos
      // gravados, mas nenhuma compra nova as alimenta.
      const creditType = "universal";
      const ispCredits = pkg.credits;
      const spcCredits = 0;
      const bigdataCredits = 0;

      const provider = await storage.getProvider(req.session.providerId);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const me = await storage.getUser(req.session.userId!);

      const orderNumber = await storage.getNextOrderNumber();
      const order = await storage.createCreditOrder({
        orderNumber, providerId: provider.id, providerName: provider.name,
        packageName: pkg.name, ispCredits, spcCredits, bigdataCredits,
        amount: (pkg.price / 100).toFixed(2), status: "pending",
        creditType,
        createdById: req.session.userId!, createdByName: me?.name || "Provedor",
      });

      let chargeData: any = null;
      try {
        const { isAsaasConfigured, findOrCreateCustomer, createCharge } = await import("../services/asaas");
        if (isAsaasConfigured() && billingType) {
          const customer = await findOrCreateCustomer({ name: provider.name, cnpj: provider.cnpj, email: provider.contactEmail || me?.email || "" });
          const charge = await createCharge({
            customer: customer.id,
            billingType: billingType || "UNDEFINED",
            value: pkg.price / 100,
            dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
            description: `${pkg.name} — ${pkg.credits} creditos ${creditType.toUpperCase()}`,
            externalReference: `credit_order_${order.id}`,
          });
          await storage.updateCreditOrder(order.id, {
            asaasChargeId: charge.id, asaasCustomerId: customer.id,
            asaasStatus: charge.status, asaasInvoiceUrl: charge.invoiceUrl,
            asaasBankSlipUrl: charge.bankSlipUrl, asaasBillingType: charge.billingType,
            paymentMethod: charge.billingType,
          });
          chargeData = charge;
        }
      } catch (asaasErr: any) {
        console.warn("Asaas charge creation failed:", asaasErr.message);
      }

      return res.json({ order, charge: chargeData });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/credits/orders/:id/asaas/pix", requireAuth, async (req, res) => {
    try {
      if (!req.session.providerId) return res.status(403).json({ message: "Somente provedores" });
      const order = await storage.getCreditOrder(parseInt(req.params.id));
      if (!order || order.providerId !== req.session.providerId) return res.status(404).json({ message: "Pedido nao encontrado" });
      if (!order.asaasChargeId) return res.status(400).json({ message: "Sem cobranca Asaas vinculada" });
      const { getPixQrCode } = await import("../services/asaas");
      const pixData = await getPixQrCode(order.asaasChargeId);
      return res.json(pixData);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ============ CREDIT ORDER ROUTES (ADMIN) ============

  router.get("/api/admin/credit-orders", requireSuperAdmin, async (req, res) => {
    try {
      const providerId = req.query.providerId ? parseInt(req.query.providerId as string) : undefined;
      const orders = await storage.getAllCreditOrders(providerId);
      return res.json(orders);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/credit-orders", requireSuperAdmin, async (req, res) => {
    try {
      const { providerId, packageId, customCredits, customAmount, notes, billingType } = req.body;
      const { CREDIT_PACKAGES } = await import("@shared/schema");
      const provider = await storage.getProvider(parseInt(providerId));
      if (!provider) return res.status(404).json({ message: "Provedor não encontrado" });
      const me = await storage.getUser(req.session.userId!);

      // Credito unico: o admin nao escolhe mais o tipo, so a quantidade.
      const creditType = "universal";
      const spcCredits = 0;
      let ispCredits: number, amount: string, packageName: string;
      if (packageId && packageId !== "custom") {
        const pkg = CREDIT_PACKAGES.find(p => p.id === packageId);
        if (!pkg) return res.status(400).json({ message: "Pacote inválido" });
        ispCredits = pkg.credits;
        amount = (pkg.price / 100).toFixed(2);
        packageName = pkg.name;
      } else {
        ispCredits = parseInt(customCredits) || 0;
        amount = parseFloat(customAmount || "0").toFixed(2);
        packageName = `Personalizado · ${ispCredits} créditos`;
      }

      const orderNumber = await storage.getNextOrderNumber();
      const order = await storage.createCreditOrder({
        orderNumber, providerId: provider.id, providerName: provider.name,
        packageName, ispCredits, spcCredits, amount, status: "pending",
        creditType, notes, createdById: req.session.userId!, createdByName: me?.name || "Admin",
      });

      let chargeData: any = null;
      if (billingType) {
        try {
          const { isAsaasConfigured, findOrCreateCustomer, createCharge } = await import("../services/asaas");
          if (isAsaasConfigured()) {
            const credits = ispCredits || spcCredits;
            const customer = await findOrCreateCustomer({ name: provider.name, cnpj: provider.cnpj, email: provider.contactEmail || "" });
            const charge = await createCharge({
              customer: customer.id, billingType,
              value: parseFloat(amount),
              dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
              description: `${packageName} — ${credits} creditos ${creditType.toUpperCase()}`,
              externalReference: `credit_order_${order.id}`,
            });
            await storage.updateCreditOrder(order.id, {
              asaasChargeId: charge.id, asaasCustomerId: customer.id,
              asaasStatus: charge.status, asaasInvoiceUrl: charge.invoiceUrl,
              asaasBankSlipUrl: charge.bankSlipUrl, asaasBillingType: charge.billingType,
              paymentMethod: charge.billingType,
            });
            chargeData = charge;
          }
        } catch (asaasErr: any) {
          console.warn("Asaas charge creation failed:", asaasErr.message);
        }
      }

      return res.json({ order, charge: chargeData });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/credit-orders/:id/release", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.releaseCreditOrder(id);
      return res.json({ order, message: `${order.ispCredits} ISP + ${order.spcCredits} SPC creditos liberados` });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/admin/credit-orders/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, notes } = req.body;
      const order = await storage.updateCreditOrder(id, { status, notes });
      return res.json(order);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/credit-orders/:id/asaas/charge", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { billingType } = req.body;
      const order = await storage.getCreditOrder(id);
      if (!order) return res.status(404).json({ message: "Pedido nao encontrado" });
      const provider = await storage.getProvider(order.providerId);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });

      const { findOrCreateCustomer, createCharge } = await import("../services/asaas");
      const customer = await findOrCreateCustomer({ name: provider.name, cnpj: provider.cnpj, email: provider.contactEmail || "" });
      const charge = await createCharge({
        customer: customer.id, billingType: billingType || "UNDEFINED",
        value: parseFloat(order.amount),
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        description: `Creditos ${order.packageName}: ${order.ispCredits} ISP + ${order.spcCredits} SPC`,
        externalReference: `credit_order_${order.id}`,
      });
      const updated = await storage.updateCreditOrder(id, {
        asaasChargeId: charge.id, asaasCustomerId: customer.id,
        asaasStatus: charge.status, asaasInvoiceUrl: charge.invoiceUrl,
        asaasBankSlipUrl: charge.bankSlipUrl, asaasBillingType: charge.billingType,
        paymentMethod: charge.billingType,
      });
      return res.json({ order: updated, charge });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/credit-orders/:id/asaas/sync", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getCreditOrder(id);
      if (!order || !order.asaasChargeId) return res.status(400).json({ message: "Sem cobranca Asaas" });
      const { getCharge, asaasStatusToLocal } = await import("../services/asaas");
      const charge = await getCharge(order.asaasChargeId);
      const newStatus = asaasStatusToLocal(charge.status);
      const updates: any = { asaasStatus: charge.status, asaasInvoiceUrl: charge.invoiceUrl, asaasBankSlipUrl: charge.bankSlipUrl };
      if (charge.pixTransaction?.payload) updates.asaasPixKey = charge.pixTransaction.payload;
      if (newStatus === "paid" && order.status !== "paid") {
        const released = await storage.releaseCreditOrder(id);
        return res.json({ order: released, message: "Pagamento confirmado e creditos liberados automaticamente" });
      }
      const updated = await storage.updateCreditOrder(id, { ...updates, status: newStatus !== "paid" ? newStatus : order.status });
      return res.json({ order: updated });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/credit-orders/:id/asaas/pix", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getCreditOrder(id);
      if (!order || !order.asaasChargeId) return res.status(400).json({ message: "Sem cobranca Asaas" });
      const { getPixQrCode } = await import("../services/asaas");
      const pixData = await getPixQrCode(order.asaasChargeId);
      return res.json(pixData);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
