import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";

export function registerDashboardRoutes(): Router {
  const router = Router();

  router.get("/api/dashboard/stats", requireAuth, async (req, res) => {
    try {
      const stats = await storage.getDashboardStats(req.session.providerId!);
      return res.json(stats);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/dashboard/defaulters", requireAuth, async (req, res) => {
    try {
      const list = await storage.getDefaultersList(req.session.providerId!);
      return res.json(list);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/inadimplentes", requireAuth, async (req, res) => {
    try {
      const list = await storage.getInadimplentes(req.session.providerId!);
      return res.json(list);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/customers", requireAuth, async (req, res) => {
    try {
      const custs = await storage.getCustomersByProvider(req.session.providerId!);
      return res.json(custs);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * GET /api/customers/:id/profile
   *
   * Quick win Cliente 360 (parcial). Retorna o customer + equipment + contracts
   * em uma chamada. Usado pela tela /cliente/:id/dossie pra renderizar cards
   * de identidade, contrato e equipamentos acima do Health Score.
   *
   * Multi-tenant: requer providerId em sessao + ownership check.
   *
   * Spec completa (Cliente 360 com timeline, OS, predicoes ML, regua DNA)
   * fica pra Spec 012.5 — esse endpoint cobre o quick win.
   */
  router.get("/api/customers/:id/profile", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const customerId = Number(req.params.id);
      if (!Number.isFinite(customerId) || customerId <= 0) {
        return res.status(400).json({ message: "invalid_customer_id" });
      }

      // Customer + ownership check
      const customer = await storage.getCustomerByIdAndProvider(customerId, providerId);
      if (!customer) {
        return res.status(404).json({ message: "Cliente nao encontrado" });
      }

      // Equipment (tolerante a tabela vazia)
      let equipment: any[] = [];
      try {
        equipment = await storage.getEquipmentByCustomer(customerId, providerId);
      } catch {}

      // Contracts (tolerante a tabela vazia)
      let contracts: any[] = [];
      try {
        contracts = await storage.getContractsByCustomer(customerId, providerId);
      } catch {}

      return res.json({ customer, equipment, contracts });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/customers", requireAuth, async (req, res) => {
    try {
      const customer = await storage.createCustomer({
        ...req.body,
        providerId: req.session.providerId!,
      });
      return res.json(customer);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/defaulters", requireAuth, async (req, res) => {
    try {
      const defaulters = await storage.getDefaultersByProvider(req.session.providerId!);
      return res.json(defaulters);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/invoices", requireAuth, async (req, res) => {
    try {
      const invs = await storage.getInvoicesByProvider(req.session.providerId!);
      return res.json(invs);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/equipment", requireAuth, async (req, res) => {
    try {
      const eqs = await storage.getEquipmentByProvider(req.session.providerId!);
      return res.json(eqs);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/contracts", requireAuth, async (req, res) => {
    try {
      const ctrs = await storage.getContractsByProvider(req.session.providerId!);
      return res.json(ctrs);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
