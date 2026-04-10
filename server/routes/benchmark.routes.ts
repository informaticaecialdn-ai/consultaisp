import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";

export function registerBenchmarkRoutes(): Router {
  const router = Router();

  router.get("/api/benchmark/cep-ranking", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId;
      if (!providerId) return res.status(401).json({ message: "Nao autenticado" });
      const data = await storage.getCepRanking(providerId);
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/benchmark/trend", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId;
      if (!providerId) return res.status(401).json({ message: "Nao autenticado" });
      const data = await storage.getTrend(providerId);
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/benchmark/map-points", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId;
      if (!providerId) return res.status(401).json({ message: "Nao autenticado" });
      const data = await storage.getMapPoints(providerId);
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/benchmark/defaulters-map", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId;
      if (!providerId) return res.status(401).json({ message: "Nao autenticado" });
      const data = await storage.getDefaultersMapPoints(providerId);
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
