import { Router } from "express";
import { requireAuth, requireProvider, requireSuperAdmin } from "../auth";
import { storage } from "../storage";
import { logger } from "../logger";
import { getSafeErrorMessage } from "../utils/safe-error";

/** Formas de cobranca que o Asaas aceita; qualquer outra coisa vira UNDEFINED. */
const FORMAS_DE_COBRANCA = ["PIX", "BOLETO", "UNDEFINED"] as const;
type FormaDeCobranca = (typeof FORMAS_DE_COBRANCA)[number];

/**
 * O body vem do cliente. Mandar a string crua para o Asaas devolve 400 com uma
 * mensagem em ingles que o provedor ve como "erro ao gerar cobranca".
 */
function formaDeCobranca(valor: unknown): FormaDeCobranca {
  return FORMAS_DE_COBRANCA.includes(valor as FormaDeCobranca) ? (valor as FormaDeCobranca) : "UNDEFINED";
}

/**
 * Os unicos status que o pedido pode ter. Sao os que a tela do superadmin
 * filtra e pinta (`pending`, `paid`, `cancelled`) mais o `overdue` que
 * `asaasStatusToLocal` produz. Qualquer outra string deixa o pedido fora de
 * todos os filtros e de todas as somas.
 */
const STATUS_DE_PEDIDO = ["pending", "paid", "cancelled", "overdue"] as const;

/** Vencimento padrao da cobranca: tres dias, no formato AAAA-MM-DD do Asaas. */
function vencimentoPadrao(): string {
  return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function registerCreditsRoutes(): Router {
  const router = Router();

  // ============ CREDIT ORDER ROUTES (PROVIDER) ============

  router.get("/api/credits/orders", requireAuth, requireProvider, async (req, res) => {
    try {
      const orders = await storage.getAllCreditOrders(req.session.providerId);
      return res.json(orders);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/credits/purchase", requireAuth, requireProvider, async (req, res) => {
    try {
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

      // `requireProvider` ja garantiu providerId > 0 antes de chegar aqui.
      const provider = await storage.getProvider(req.session.providerId!);
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
          // `cpfCnpj` e `customerId` sao os nomes que services/asaas.ts espera.
          // Enquanto isto dizia `cnpj` e `customer`, o Asaas criava cliente sem
          // documento e cobranca sem pagador: a compra self-service inteira caia
          // no catch abaixo e o provedor recebia um pedido sem como pagar.
          const customer = await findOrCreateCustomer({
            name: provider.name,
            cpfCnpj: provider.cnpj,
            email: provider.contactEmail || me?.email || undefined,
            phone: provider.contactPhone || undefined,
          });
          const charge = await createCharge({
            customerId: customer.id,
            billingType: formaDeCobranca(billingType),
            value: pkg.price / 100,
            dueDate: vencimentoPadrao(),
            description: `${pkg.name} — ${pkg.credits} creditos`,
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
        // O pedido ja existe e a tela oferece "fale com o suporte"; derrubar a
        // rota apagaria o pedido da vista do provedor sem apagar do banco.
        logger.error({ pedido: order.orderNumber, err: asaasErr?.message }, "Cobranca Asaas nao criada para o pedido");
      }

      return res.json({ order, charge: chargeData });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/credits/orders/:id/asaas/pix", requireAuth, requireProvider, async (req, res) => {
    try {
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
            const customer = await findOrCreateCustomer({
              name: provider.name,
              cpfCnpj: provider.cnpj,
              email: provider.contactEmail || undefined,
              phone: provider.contactPhone || undefined,
            });
            const charge = await createCharge({
              customerId: customer.id,
              billingType: formaDeCobranca(billingType),
              value: parseFloat(amount),
              dueDate: vencimentoPadrao(),
              description: `${packageName} — ${credits} creditos`,
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
          logger.error({ pedido: order.orderNumber, err: asaasErr?.message }, "Cobranca Asaas nao criada para o pedido");
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
      const { pedido, liberadoAgora } = await storage.releaseCreditOrder(id);
      return res.json({
        order: pedido,
        liberadoAgora,
        message: liberadoAgora
          ? `${pedido.ispCredits} creditos liberados`
          : "Este pedido ja estava liberado; nada foi creditado de novo",
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/admin/credit-orders/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, notes } = req.body;

      const alvo = await storage.getCreditOrder(id);
      if (!alvo) return res.status(404).json({ message: "Pedido nao encontrado" });

      const mudancas: { status?: string; notes?: string } = {};
      if (typeof notes === "string") mudancas.notes = notes;

      if (status !== undefined) {
        // O status vinha cru do corpo. Rebaixar um pedido ja creditado para
        // "pending" pela mao reabria o caminho do credito em dobro na proxima
        // entrega do webhook; e um status inventado ("PAGO", "ok") deixava o
        // pedido invisivel para toda tela que filtra por status.
        if (!STATUS_DE_PEDIDO.includes(status)) {
          return res.status(400).json({ message: `Status invalido. Use um de: ${STATUS_DE_PEDIDO.join(", ")}` });
        }
        if (alvo.creditedAt && status !== "paid") {
          return res.status(409).json({
            message: "Pedido ja creditado: o status nao volta atras. Para estornar, lance um pedido de ajuste.",
          });
        }
        mudancas.status = status;
      }

      if (Object.keys(mudancas).length === 0) return res.json(alvo);

      const order = await storage.updateCreditOrder(id, mudancas);
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

      // A cobranca anterior NAO e cancelada e continua pagavel no Asaas com o
      // mesmo externalReference. E por isso que a conferencia do webhook decide
      // pela referencia, e nao pelo id gravado: o provedor pode pagar o boleto
      // velho, e esse pagamento tem que virar credito.
      if (order.asaasChargeId) {
        logger.warn({ pedido: order.orderNumber, cobrancaAnterior: order.asaasChargeId },
          "Segunda cobrança para o mesmo pedido: a anterior continua pagável no Asaas");
      }

      const { findOrCreateCustomer, createCharge } = await import("../services/asaas");
      const customer = await findOrCreateCustomer({
        name: provider.name,
        cpfCnpj: provider.cnpj,
        email: provider.contactEmail || undefined,
        phone: provider.contactPhone || undefined,
      });
      const charge = await createCharge({
        customerId: customer.id,
        billingType: formaDeCobranca(billingType),
        value: parseFloat(order.amount),
        dueDate: vencimentoPadrao(),
        description: `Creditos ${order.packageName}: ${order.ispCredits} creditos`,
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

      // Quem decide se ha o que creditar e `credited_at`, nao o status: um
      // pedido pago cujo status tenha sido rebaixado (evento de chargeback,
      // ajuste manual) nao pode ser creditado de novo por um clique em
      // "sincronizar". `releaseCreditOrder` tambem trava sozinho — este teste
      // so evita a chamada inutil.
      if (newStatus === "paid" && !order.creditedAt) {
        const { pedido, liberadoAgora } = await storage.releaseCreditOrder(id);
        return res.json({
          order: pedido,
          message: liberadoAgora
            ? "Pagamento confirmado e creditos liberados automaticamente"
            : "Pedido ja estava liberado; nada foi creditado de novo",
        });
      }
      // Pedido ja creditado le "paid", ponto: `credited_at` so e escrito junto
      // com status "paid", entao credito sem "paid" e um estado que so existe
      // por rebaixamento indevido — e o sync conserta.
      const statusLocal = order.creditedAt ? "paid" : (newStatus !== "paid" ? newStatus : order.status);
      const updated = await storage.updateCreditOrder(id, { ...updates, status: statusLocal });
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
