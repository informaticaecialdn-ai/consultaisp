import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";

/**
 * Endpoint unico da tela de Localizacao.
 *
 * Devolve pontos, bairros, cidades e a contagem sem coordenada numa chamada —
 * os quatro conjuntos saem da mesma varredura, entao dividir em quatro rotas
 * custaria quatro varreduras.
 */
export function registerLocalizacaoRoutes(): Router {
  const router = Router();

  router.get("/api/localizacao", requireAuth, async (req, res) => {
    try {
      const data = await storage.getLocalizacao(req.session.providerId!);
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
