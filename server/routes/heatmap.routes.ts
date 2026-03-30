import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";

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
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/heatmap/regional", requireAuth, async (_req, res) => {
    try {
      const data = await storage.getHeatmapDataAllProviders();
      const clusterMap = new Map<string, { lat: number; lng: number; city: string; count: number; totalOverdue: number }>();
      for (const item of data) {
        const lat = parseFloat(item.latitude);
        const lng = parseFloat(item.longitude);
        if (isNaN(lat) || isNaN(lng)) continue;
        const roundedLat = parseFloat(lat.toFixed(2));
        const roundedLng = parseFloat(lng.toFixed(2));
        const key = `${roundedLat},${roundedLng}`;
        const existing = clusterMap.get(key);
        const overdue = parseFloat(item.totalOverdueAmount || "0");
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
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/heatmap/city-ranking", requireAuth, async (_req, res) => {
    try {
      const data = await storage.getHeatmapDataAllProviders();
      const cityMap = new Map<string, { city: string; lat: number; lng: number; count: number; totalOverdue: number; maxDays: number }>();
      for (const item of data) {
        const city = (item.city || "").trim();
        if (!city) continue;
        const lat = parseFloat(item.latitude);
        const lng = parseFloat(item.longitude);
        const overdue = parseFloat(item.totalOverdueAmount || "0");
        const days = parseInt(item.maxDaysOverdue || "0", 10);
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
      return res.status(500).json({ message: error.message });
    }
  });

  return router;
}
