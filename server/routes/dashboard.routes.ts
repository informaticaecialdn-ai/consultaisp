import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";

export function registerDashboardRoutes(): Router {
  const router = Router();

  router.get("/api/dashboard/stats", requireAuth, async (req, res) => {
    try {
      const stats = await storage.getDashboardStats(req.session.providerId!);
      return res.json(stats);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/dashboard/defaulters", requireAuth, async (req, res) => {
    try {
      const list = await storage.getDefaultersList(req.session.providerId!);
      return res.json(list);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/inadimplentes", requireAuth, async (req, res) => {
    try {
      const list = await storage.getInadimplentes(req.session.providerId!);
      return res.json(list);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/customers", requireAuth, async (req, res) => {
    try {
      const custs = await storage.getCustomersByProvider(req.session.providerId!);
      return res.json(custs);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
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
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/defaulters", requireAuth, async (req, res) => {
    try {
      const defaulters = await storage.getDefaultersByProvider(req.session.providerId!);
      return res.json(defaulters);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/invoices", requireAuth, async (req, res) => {
    try {
      const invs = await storage.getInvoicesByProvider(req.session.providerId!);
      return res.json(invs);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/equipment", requireAuth, async (req, res) => {
    try {
      const eqs = await storage.getEquipmentByProvider(req.session.providerId!);
      return res.json(eqs);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/contracts", requireAuth, async (req, res) => {
    try {
      const ctrs = await storage.getContractsByProvider(req.session.providerId!);
      return res.json(ctrs);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  return router;
}
