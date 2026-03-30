import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";

export function registerPublicRoutes(): Router {
  const router = Router();

  router.get("/api/public/erp-catalog", async (_req, res) => {
    try {
      const items = await storage.getAllErpCatalog();
      const publicItems = items.filter(i => i.active).map(i => ({ key: i.key, name: i.name, description: i.description, logoBase64: i.logoBase64, gradient: i.gradient }));
      return res.json(publicItems);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/erp-catalog", requireAuth, async (_req, res) => {
    try {
      const items = await storage.getAllErpCatalog();
      return res.json(items);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  return router;
}
