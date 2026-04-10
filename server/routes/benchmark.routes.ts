import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";

export function registerBenchmarkRoutes(): Router {
  const router = Router();

  router.get("/api/benchmark/cep-ranking", requireAuth, async (_req, res) => {
    try {
      const data = await storage.getCepRanking();
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/benchmark/trend", requireAuth, async (_req, res) => {
    try {
      const data = await storage.getTrend();
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/benchmark/map-points", requireAuth, async (_req, res) => {
    try {
      const data = await storage.getMapPoints();
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
