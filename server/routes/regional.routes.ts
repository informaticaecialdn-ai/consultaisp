import { Router } from "express";
import { requireAuth } from "../auth";
import { getRegionalProviders, getProvidersByMesoregion } from "../services/regional.service";
import { storage } from "../storage";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load cities data at module initialization (build-time artifact)
const citiesPath = resolve(__dirname, "../../shared/data/cidades-brasil.json");
const citiesData: Array<{
  nome: string;
  uf: string;
  ibge: string;
  mesorregiao: string;
  mesorregiao_id: number;
}> = JSON.parse(readFileSync(citiesPath, "utf-8"));

// Build city-to-mesoregion lookup for fast derivation
const cityMesoregionMap = new Map<string, string>();
for (const c of citiesData) {
  cityMesoregionMap.set(`${c.nome} - ${c.uf}`, c.mesorregiao);
}

// Build list of unique mesoregions per state for the frontend
const mesoregionsByState: Record<string, Array<{ name: string; cities: number }>> = {};
{
  const counts: Record<string, number> = {};
  for (const c of citiesData) {
    if (!mesoregionsByState[c.uf]) mesoregionsByState[c.uf] = [];
    const key = `${c.uf}:${c.mesorregiao}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  for (const key of Object.keys(counts)) {
    const [uf, name] = key.split(":", 2);
    mesoregionsByState[uf].push({ name, cities: counts[key] });
  }
  for (const uf of Object.keys(mesoregionsByState)) {
    mesoregionsByState[uf].sort((a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, "pt-BR")
    );
  }
}

/**
 * Derives unique mesoregion list from selected cities.
 * "Londrina - PR" → "Norte Central Paranaense"
 */
function deriveMesorregioes(cidades: string[]): string[] {
  const mesos = new Set<string>();
  for (const cidade of cidades) {
    const meso = cityMesoregionMap.get(cidade);
    if (meso) mesos.add(meso);
  }
  return Array.from(mesos).sort();
}

export function registerRegionalRoutes(): Router {
  const router = Router();

  // GET /api/regional/cities?q=lon&limit=20
  // Returns filtered cities for autocomplete — now includes mesoregion
  router.get("/api/regional/cities", requireAuth, (req, res) => {
    const q = (req.query.q as string || "").toLowerCase().trim();
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    if (q.length < 2) return res.json([]);
    const filtered = citiesData
      .filter(c => c.nome.toLowerCase().includes(q) || `${c.nome} - ${c.uf}`.toLowerCase().includes(q))
      .slice(0, limit)
      .map(c => ({
        label: `${c.nome} - ${c.uf}`,
        value: `${c.nome} - ${c.uf}`,
        ibge: c.ibge,
        mesorregiao: c.mesorregiao,
      }));
    return res.json(filtered);
  });

  // GET /api/regional/mesorregioes?uf=PR
  // Returns mesoregions for a state (with city count) — for quick-select UI
  router.get("/api/regional/mesorregioes", requireAuth, (req, res) => {
    const uf = (req.query.uf as string || "").toUpperCase().trim();
    if (uf.length !== 2) return res.json([]);
    const mesos = mesoregionsByState[uf] || [];
    return res.json(mesos);
  });

  // GET /api/regional/mesorregioes/:name/cities?uf=PR
  // Returns all cities in a mesoregion — for bulk-adding when selecting a region
  router.get("/api/regional/mesorregioes/:name/cities", requireAuth, (req, res) => {
    const name = req.params.name;
    const uf = (req.query.uf as string || "").toUpperCase().trim();
    const filtered = citiesData
      .filter(c => c.mesorregiao === name && (!uf || c.uf === uf))
      .map(c => `${c.nome} - ${c.uf}`);
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
  // Updates the authenticated provider's cidadesAtendidas + auto-derives mesorregioes
  router.put("/api/regional/cidades", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const { cidades } = req.body as { cidades: string[] };
      if (!Array.isArray(cidades)) {
        return res.status(400).json({ message: "cidades deve ser um array de strings" });
      }
      const valid = cidades.every(c => /^.+ - [A-Z]{2}$/.test(c));
      if (!valid) {
        return res.status(400).json({ message: "Formato invalido. Use 'Cidade - UF'" });
      }

      // Auto-derive mesorregioes from selected cities
      const mesorregioes = deriveMesorregioes(cidades);

      const updated = await storage.updateProviderProfile(providerId, {
        cidadesAtendidas: cidades,
        mesorregioes,
      } as any);
      return res.json({
        cidadesAtendidas: updated.cidadesAtendidas,
        mesorregioes: updated.mesorregioes,
      });
    } catch (err) {
      console.error("Error updating cidades:", err);
      return res.status(500).json({ message: "Erro ao atualizar cidades atendidas" });
    }
  });

  // GET /api/regional/my-cidades
  // Returns the authenticated provider's cidadesAtendidas + mesorregioes
  router.get("/api/regional/my-cidades", requireAuth, async (req, res) => {
    try {
      const provider = await storage.getProvider(req.session.providerId!);
      return res.json({
        cidadesAtendidas: provider?.cidadesAtendidas || [],
        mesorregioes: provider?.mesorregioes || [],
      });
    } catch (err) {
      return res.status(500).json({ message: "Erro ao buscar cidades" });
    }
  });

  return router;
}
