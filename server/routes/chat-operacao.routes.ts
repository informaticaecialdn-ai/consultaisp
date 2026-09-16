import { Router } from "express";
import { requireAuth, requireProvider } from "../auth";
import { consultarOperacaoChat } from "../services/chat/chat-operacao.service";
import { logger } from "../logger";

export function registerChatOperacaoRoutes() {
  const router = Router();
  router.get("/api/chat-bullq/operacao", requireAuth, requireProvider, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    try { res.json(await consultarOperacaoChat(req.session.providerId!)); }
    catch (err) { logger.error({ err }, "Falha ao consultar operação de cobrança"); res.status(503).json({ message: "Não foi possível verificar a automação agora. Tente atualizar." }); }
  });
  return router;
}
