import { Router } from "express";
import { requireAuth } from "../auth";
import { getRegionalProviders } from "../services/regional.service";
import { storage } from "../storage";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load cities data at module initialization (build-time artifact)
const citiesPath = resolve(__dirname, "../../shared/data/cidades-brasil.json");
const citiesData: Array<{ nome: string; uf: string; ibge: string }> = JSON.parse(
  readFileSync(citiesPath, "utf-8")
);

export function registerRegionalRoutes(): Router {
  const router = Router();

  // GET /api/regional/cities?q=lon&limit=20
  // Returns filtered cities for autocomplete
  router.get("/api/regional/cities", requireAuth, (req, res) => {
    const q = (req.query.q as string || "").toLowerCase().trim();
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    if (q.length < 2) return res.json([]);
    const filtered = citiesData
      .filter(c => c.nome.toLowerCase().includes(q) || `${c.nome} - ${c.uf}`.toLowerCase().includes(q))
      .slice(0, limit)
      .map(c => ({ label: `${c.nome} - ${c.uf}`, value: `${c.nome} - ${c.uf}`, ibge: c.ibge }));
    return res.json(filtered);
  });

  // GET /api/regional/providers
  // Returns providers in the same region as the authenticated provider
  router.get("/api/regional/providers", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const regional = await getRegionalProviders(providerId);
      return res.json(regional);
    } catch (err) {
      console.error("Error fetching regional providers:", err);
      return res.status(500).json({ message: "Erro ao buscar provedores regionais" });
    }
  });

  // PUT /api/regional/cidades
  // Updates the authenticated provider's cidadesAtendidas
  router.put("/api/regional/cidades", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const { cidades } = req.body as { cidades: string[] };
      if (!Array.isArray(cidades)) {
        return res.status(400).json({ message: "cidades deve ser um array de strings" });
      }
      // Validate each city is in the format "CityName - UF"
      const valid = cidades.every(c => /^.+ - [A-Z]{2}$/.test(c));
      if (!valid) {
        return res.status(400).json({ message: "Formato invalido. Use 'Cidade - UF'" });
      }
      const updated = await storage.updateProviderProfile(providerId, { cidadesAtendidas: cidades } as any);
      return res.json({ cidadesAtendidas: updated.cidadesAtendidas });
    } catch (err) {
      console.error("Error updating cidades:", err);
      return res.status(500).json({ message: "Erro ao atualizar cidades atendidas" });
    }
  });

  // GET /api/regional/my-cidades
  // Returns the authenticated provider's cidadesAtendidas
  router.get("/api/regional/my-cidades", requireAuth, async (req, res) => {
    try {
      const provider = await storage.getProvider(req.session.providerId!);
      return res.json({ cidadesAtendidas: provider?.cidadesAtendidas || [] });
    } catch (err) {
      return res.status(500).json({ message: "Erro ao buscar cidades" });
    }
  });

  return router;
}
