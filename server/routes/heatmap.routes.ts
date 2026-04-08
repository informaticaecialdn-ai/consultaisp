import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";
import {
  getAllPoints,
  getCacheStatus,
  isRefreshing,
  refreshAllProviders,
} from "../services/heatmap-cache";

export function registerHeatmapRoutes(): Router {
  const router = Router();

  router.get("/api/config/maps-key", requireAuth, async (_req, res) => {
    const key = process.env.GOOGLE_MAPS_API_KEY || "";
    return res.json({ key });
  });

  router.get("/api/heatmap/provider", requireAuth, async (req, res) => {
    try {
      const data = await storage.getHeatmapDataByProvider(req.session.providerId!);
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // Aggregated regional data from all providers (anonymized via cache)
  router.get("/api/heatmap/regional", requireAuth, async (_req, res) => {
    try {
      const allPoints = getAllPoints();
      const clusterMap = new Map<string, { lat: number; lng: number; city: string; count: number; totalOverdue: number }>();
      for (const item of allPoints) {
        const lat = item.lat;
        const lng = item.lng;
        if (isNaN(lat) || isNaN(lng)) continue;
        const roundedLat = parseFloat(lat.toFixed(2));
        const roundedLng = parseFloat(lng.toFixed(2));
        const key = `${roundedLat},${roundedLng}`;
        const existing = clusterMap.get(key);
        const overdue = item.totalOverdueAmount || 0;
        if (existing) {
          existing.count += 1;
          existing.totalOverdue += overdue;
          if (!existing.city && item.city) existing.city = item.city;
        } else {
          clusterMap.set(key, { lat: roundedLat, lng: roundedLng, city: item.city || "", count: 1, totalOverdue: overdue });
        }
      }
      const results = Array.from(clusterMap.values());
      return res.json(results);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // Aggregated city ranking from all providers (anonymized)
  router.get("/api/heatmap/city-ranking", requireAuth, async (_req, res) => {
    try {
      const allPoints = getAllPoints();
      const cityMap = new Map<string, { city: string; lat: number; lng: number; count: number; totalOverdue: number; maxDays: number }>();
      for (const item of allPoints) {
        const city = (item.city || "").trim();
        if (!city) continue;
        const lat = item.lat;
        const lng = item.lng;
        const overdue = item.totalOverdueAmount || 0;
        const days = item.maxDaysOverdue || 0;
        const existing = cityMap.get(city);
        if (existing) {
          existing.count += 1;
          existing.totalOverdue += overdue;
          if (days > existing.maxDays) existing.maxDays = days;
        } else {
          cityMap.set(city, { city, lat: isNaN(lat) ? 0 : lat, lng: isNaN(lng) ? 0 : lng, count: 1, totalOverdue: overdue, maxDays: days });
        }
      }
      const results = Array.from(cityMap.values())
        .sort((a, b) => b.count - a.count || b.totalOverdue - a.totalOverdue);
      return res.json(results);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // Sync info for the regional cache status banner
  router.get("/api/heatmap/sync-info", requireAuth, async (_req, res) => {
    try {
      const status = getCacheStatus();
      const allPoints = getAllPoints();
      const lastRefresh = status.length > 0
        ? status.reduce((latest, s) => {
            if (!s.fetchedAt) return latest;
            return !latest || s.fetchedAt > latest ? s.fetchedAt : latest;
          }, null as Date | null)
        : null;

      return res.json({
        lastSyncAt: lastRefresh ? lastRefresh.toISOString() : null,
        totalIntegrations: status.length,
        lastCacheRefresh: lastRefresh ? lastRefresh.toISOString() : null,
        totalCachePoints: allPoints.length,
        refreshing: isRefreshing(),
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // Trigger manual refresh of all provider caches
  router.post("/api/heatmap/refresh", requireAuth, async (_req, res) => {
    try {
      if (isRefreshing()) {
        return res.json({ message: "Atualizacao ja em andamento" });
      }
      // Start refresh in background, don't await
      refreshAllProviders().catch(err => {
        console.warn("[HeatmapCache] Erro no refresh manual:", err.message);
      });
      return res.json({ message: "Atualizacao iniciada" });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
