import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";

/**
 * Equipment routes extracted from routes.ts.
 * Note: The monolithic routes.ts has equipment endpoints spread across
 * dashboard (GET /api/equipment) and import (POST /api/import/equipment).
 * This module consolidates equipment-specific endpoints.
 * Currently the application does not have dedicated /api/equipamentos/* CRUD routes.
 * The GET /api/equipment endpoint is also registered in dashboard.routes.ts
 * for backward compatibility during the migration period.
 */
export function registerEquipamentosRoutes(): Router {
  const router = Router();

  // Equipment listing (same handler as in routes.ts line 449)
  router.get("/api/equipment", requireAuth, async (req, res) => {
    try {
      const eqs = await storage.getEquipmentByProvider(req.session.providerId!);
      return res.json(eqs);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
