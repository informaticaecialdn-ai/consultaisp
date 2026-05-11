/**
 * Spec 007 — Time Digital roster endpoint.
 *
 * GET /api/team — retorna os 10 funcionários digitais do tenant atual com
 * status (online/training/offline) e KPI do mês para os 4 implementados
 * (Júlia, Bruno, Helena, Sofia). Multi-tenant via req.session.providerId.
 *
 * Auth: requireAuth (qualquer usuário do tenant pode ver). Não há requireAdmin
 * pq o /time é tela de overview do produto — operadores também precisam ver.
 */

import express, { type Request, type Response, type Router } from "express";
import { logger } from "../logger";
import { requireAuth } from "../auth";
import { buildTeamRoster } from "../services/team.service";

export function registerTeamRoutes(): Router {
  const router: Router = express.Router();

  router.get(
    "/api/team",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const providerId = req.session.providerId;
      if (!providerId) {
        res.status(400).json({ error: "providerId ausente na sessão" });
        return;
      }

      try {
        const roster = await buildTeamRoster(providerId);
        res.json({ agents: roster });
      } catch (err) {
        logger.error({ err, providerId }, "[team.routes] erro ao montar roster");
        res.status(500).json({ error: "Falha ao carregar time digital" });
      }
    },
  );

  return router;
}
