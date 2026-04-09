import { Router } from "express";
import { requireAuth } from "../auth";
import { getSafeErrorMessage } from "../utils/safe-error";
import { storage } from "../storage";
import { syncAllProviders, isSyncing } from "../services/erp-sync.service";

export function registerHeatmapRoutes(): Router {
  const router = Router();

  router.get("/api/config/maps-key", requireAuth, async (_req, res) => {
    const key = process.env.GOOGLE_MAPS_API_KEY || "";
    return res.json({ key });
  });

  router.get("/api/config/bing-maps-key", requireAuth, async (_req, res) => {
    const key = process.env.BING_MAPS_API_KEY || "";
    return res.json({ key });
  });

  // Dados do provedor logado — query direta no banco local
  router.get("/api/heatmap/provider", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const points = await storage.getHeatmapByProvider(providerId);
      const data = points.map((p, i) => ({
        id: i + 1,
        name: `Ponto ${i + 1}`, // LGPD: sem nome do cliente
        latitude: String(p.lat),
        longitude: String(p.lng),
        city: p.city,
        totalOverdueAmount: String(p.totalOverdueAmount),
        maxDaysOverdue: p.maxDaysOverdue,
        overdueInvoicesCount: p.overdueCount,
        riskTier: p.maxDaysOverdue > 180 ? "critical" : p.maxDaysOverdue > 90 ? "high" : p.maxDaysOverdue > 60 ? "medium" : "low",
        paymentStatus: "overdue" as const,
      }));
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // Dados regionais agregados de todos os provedores (anonimizado)
  router.get("/api/heatmap/regional", requireAuth, async (_req, res) => {
    try {
      const allPoints = await storage.getHeatmapAll();
      const clusterMap = new Map<string, { lat: number; lng: number; city: string; count: number; totalOverdue: number }>();
      for (const item of allPoints) {
        if (isNaN(item.lat) || isNaN(item.lng)) continue;
        const roundedLat = parseFloat(item.lat.toFixed(2));
        const roundedLng = parseFloat(item.lng.toFixed(2));
        const key = `${roundedLat},${roundedLng}`;
        const existing = clusterMap.get(key);
        if (existing) {
          existing.count += 1;
          existing.totalOverdue += item.totalOverdueAmount;
          if (!existing.city && item.city) existing.city = item.city;
        } else {
          clusterMap.set(key, { lat: roundedLat, lng: roundedLng, city: item.city, count: 1, totalOverdue: item.totalOverdueAmount });
        }
      }
      return res.json(Array.from(clusterMap.values()));
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // Ranking de cidades
  router.get("/api/heatmap/city-ranking", requireAuth, async (_req, res) => {
    try {
      const allPoints = await storage.getHeatmapAll();
      const cityMap = new Map<string, { city: string; lat: number; lng: number; count: number; totalOverdue: number; maxDays: number }>();
      for (const item of allPoints) {
        const city = (item.city || "").trim();
        if (!city) continue;
        const existing = cityMap.get(city);
        if (existing) {
          existing.count += 1;
          existing.totalOverdue += item.totalOverdueAmount;
          if (item.maxDaysOverdue > existing.maxDays) existing.maxDays = item.maxDaysOverdue;
        } else {
          cityMap.set(city, { city, lat: item.lat, lng: item.lng, count: 1, totalOverdue: item.totalOverdueAmount, maxDays: item.maxDaysOverdue });
        }
      }
      const results = Array.from(cityMap.values())
        .sort((a, b) => b.count - a.count || b.totalOverdue - a.totalOverdue);
      return res.json(results);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // Sync info
  router.get("/api/heatmap/sync-info", requireAuth, async (_req, res) => {
    try {
      const allPoints = await storage.getHeatmapAll();
      return res.json({
        lastSyncAt: null,
        totalIntegrations: 0,
        lastCacheRefresh: null,
        totalCachePoints: allPoints.length,
        refreshing: isSyncing(),
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // Trigger manual sync ERP → banco local
  router.post("/api/heatmap/refresh", requireAuth, async (_req, res) => {
    try {
      if (isSyncing()) {
        return res.json({ message: "Sincronizacao ja em andamento" });
      }
      syncAllProviders().catch(err => {
        console.warn("[ERPSync] Erro no sync manual:", err.message);
      });
      return res.json({ message: "Sincronizacao iniciada" });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
