/**
 * A autonomia do chat, do lado da sessao: o provedor le e (so o admin) grava
 * a configuracao, ve a fila por status e devolve uma conversa ao assistente.
 *
 * O providerId e SEMPRE o da sessao — nunca do corpo nem da rota. A conversa
 * e identificada pelo id do Chat BullQ, mas so existe para este provedor se
 * houver vinculo em `chat_bullq_conversas` com o provider_id dele (o servico
 * confere; 404 se nao houver).
 *
 * "Assumir" ja existe em `POST /api/chat-bullq/atendimentos/:id/acoes`
 * ({ acao: "assumir" }), sob a mesma trava; nao se duplica aqui.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireProvider } from "../auth";
import { podeAdministrarOProvedor } from "./provider.routes";
import { ConfigAutonomiaSchema } from "@shared/chat-autonomia";
import { configurarAutonomia, devolverAoAssistente, estadoDaAutonomia, filaDaAutonomia } from "../services/chat/chat-autonomia.service";
import { ErroDaPonteDoChat } from "../services/chat/chat-ponte.service";
import { logger } from "../logger";

const providerDaSessao = (req: Request): number => req.session.providerId as number;
const userDaSessao = (req: Request): number | null => (typeof req.session.userId === "number" ? req.session.userId : null);

/** O erro da ponte vira o status certo; o resto e 503 — a tela mostra o traco, nunca um zero. */
function falha(res: Response, e: unknown, contexto: string) {
  if (e instanceof ErroDaPonteDoChat) {
    const status = e.codigo === "CASO_NAO_ENCONTRADO" ? 404 : e.codigo === "CHAT_DESLIGADO" ? 503 : e.codigo === "CHAT_FALHOU" ? 502 : 409;
    return res.status(status).json({ message: e.message, codigo: e.codigo });
  }
  logger.warn({ err: e }, `Autonomia do chat: ${contexto}`);
  res.status(503).json({ message: "Autonomia indisponível. Confira a migração da fila (0028)." });
}

const ConversaSchema = z.string().trim().min(1).max(120);

export function registerChatAutonomiaRoutes() {
  const router = Router();

  router.get("/api/chat-bullq/autonomia", requireAuth, requireProvider, async (req, res) => {
    try { res.json(await estadoDaAutonomia(providerDaSessao(req))); }
    catch (e) { falha(res, e, "estado não lido"); }
  });

  router.put("/api/chat-bullq/autonomia", requireAuth, requireProvider, async (req, res) => {
    if (!podeAdministrarOProvedor(req.session)) return res.status(403).json({ message: "Apenas administradores podem configurar a autonomia" });
    const r = ConfigAutonomiaSchema.safeParse(req.body);
    if (!r.success) return res.status(400).json({ message: "Configuração de autonomia inválida", erros: r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`) });
    try { res.json(await configurarAutonomia(providerDaSessao(req), r.data)); }
    catch (e) {
      if (e instanceof ErroDaPonteDoChat) return res.status(409).json({ message: e.message, codigo: e.codigo });
      logger.warn({ err: e, providerId: providerDaSessao(req) }, "Não foi possível configurar autonomia");
      res.status(503).json({ message: "Autonomia indisponível. A configuração não foi confirmada." });
    }
  });

  router.get("/api/chat-bullq/autonomia/estado", requireAuth, requireProvider, async (req, res) => {
    try { res.json(await filaDaAutonomia(providerDaSessao(req))); }
    catch (e) { falha(res, e, "fila não lida"); }
  });

  router.post("/api/chat-bullq/autonomia/conversas/:conversationId/devolver", requireAuth, requireProvider, async (req, res) => {
    const id = ConversaSchema.safeParse(req.params.conversationId);
    if (!id.success) return res.status(400).json({ message: "Conversa inválida" });
    try { res.json(await devolverAoAssistente(providerDaSessao(req), id.data, userDaSessao(req))); }
    catch (e) { falha(res, e, "conversa não devolvida"); }
  });

  return router;
}
