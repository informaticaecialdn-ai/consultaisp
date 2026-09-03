import { Router } from "express";
import { requireAuth, requireProvider } from "../auth";
import { getSafeErrorMessage } from "../utils/safe-error";
import { storage } from "../storage";

export function registerHeatmapRoutes(): Router {
  const router = Router();

  // Tile proxy — evita bloqueio de Referer pelo OpenStreetMap
  router.get("/api/tiles/:z/:x/:y.png", async (req, res) => {
    try {
      const { z, x, y } = req.params;
      const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "ConsultaISP/1.0 (https://consultaisp.com.br)",
          "Referer": "https://consultaisp.com.br",
        },
      });
      if (!response.ok) {
        return res.status(response.status).send("Tile not found");
      }
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "public, max-age=86400"); // cache 24h
      const buffer = Buffer.from(await response.arrayBuffer());
      return res.send(buffer);
    } catch {
      return res.status(500).send("Tile proxy error");
    }
  });

  // As rotas /api/config/maps-key e /api/config/azure-maps-key sairam junto com
  // os componentes que as consumiam (GoogleHeatMap, AzureHeatMap, BingHeatMap —
  // nenhum era renderizado). Entregar chave de API ao navegador e superficie
  // exposta; sem consumidor, e superficie exposta a toa.
  //
  // O mapa em uso e Leaflet sobre tiles do OpenStreetMap, servidos pelo proxy
  // /api/tiles acima — nao depende de chave nenhuma.

  // Dados regionais agregados de todos os provedores (anonimizado)
  router.get("/api/heatmap/regional", requireAuth, requireProvider, async (_req, res) => {
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

  return router;
}
