import { exigirEscopoDoChat } from "./chat-escopo";
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
import { ConfigAutonomiaSchema, FuncionariaDigitalSchema } from "@shared/chat-autonomia";
import { configurarAutonomia, devolverAoAssistente, estadoDaAutonomia, filaDaAutonomia } from "../services/chat/chat-autonomia.service";
import { configurarFuncionariaDigital, funcionariaDigitalDoProvedor } from "../services/chat/chat-agentes.service";
import { ErroDaPonteDoChat } from "../services/chat/chat-ponte.service";
import { logger } from "../logger";

const providerDaSessao = (req: Request): number => req.session.providerId as number;
const userDaSessao = (req: Request): number | null => (typeof req.session.userId === "number" ? req.session.userId : null);

/** O codigo da ponte vira o HTTP: 404 conversa de outro provedor, 503 chat desligado, 502 o Chat BullQ recusou (a razao dele vai no `message`), 409 o resto. */
const statusDaPonte = (e: ErroDaPonteDoChat) => e.codigo === "CASO_NAO_ENCONTRADO" ? 404 : e.codigo === "CHAT_DESLIGADO" ? 503 : e.codigo === "CHAT_FALHOU" ? 502 : 409;

/**
 * O erro da ponte vira a resposta. A recusa do Chat BullQ (CHAT_FALHOU) fica
 * no log com a razao — o cliente da ponte loga so metodo/caminho/status, e
 * senao a recusa em producao so seria vista se o operador copiasse o toast.
 * A razao e o `message` da API ou a frase que o servico montou: sem PII.
 */
function respostaDaPonte(res: Response, e: ErroDaPonteDoChat, contexto: string) {
  if (e.codigo === "CHAT_FALHOU") logger.warn({ codigo: e.codigo, status: e.status, razao: e.message }, `Autonomia do chat: o Chat BullQ recusou — ${contexto}`);
  return res.status(statusDaPonte(e)).json({ message: e.message, codigo: e.codigo });
}
/** `undefined_table` do Postgres — a unica prova, aqui, de que a migracao nao rodou. */
const tabelaAusente = (e: unknown) => (e as { code?: unknown } | null)?.code === "42P01";

/**
 * O erro da ponte vira o status certo; o resto e 503 — a tela mostra o traco, nunca um zero.
 * A frase das migracoes so no caso REAL (tabela ausente, 42P01): banco fora,
 * timeout ou trava recebem uma frase em que o operador consegue agir — ele
 * nao sabe o que e a migracao 0028. O `err` completo continua no log.
 */
function falha(res: Response, e: unknown, contexto: string) {
  if (e instanceof ErroDaPonteDoChat) return respostaDaPonte(res, e, contexto);
  logger.warn({ err: e }, `Autonomia do chat: ${contexto}`);
  res.status(503).json({ message: tabelaAusente(e) ? "Autonomia indisponível. Confira as migrações da fila e da confirmação de identidade (0028/0034)." : "Autonomia indisponível agora. Tente novamente em instantes; se persistir, avise o suporte." });
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
    try { res.json(await configurarAutonomia(providerDaSessao(req), r.data, userDaSessao(req))); }
    catch (e) {
      if (e instanceof ErroDaPonteDoChat) return respostaDaPonte(res, e, "configuração não gravada");
      logger.warn({ err: e, providerId: providerDaSessao(req) }, "Não foi possível configurar autonomia");
      res.status(503).json({ message: "Autonomia indisponível. A configuração não foi confirmada." });
    }
  });

  /**
   * D9 — a chave da funcionária digital. Leitura de qualquer operador; gravação
   * só do admin. Desligar é a primeira linha da volta (spec §11.6), então a rota
   * é própria: não depende de salvar a autonomia inteira nem da validação dela.
   */
  router.get("/api/chat-bullq/autonomia/funcionaria-digital", requireAuth, requireProvider, async (req, res) => {
    try { res.json(await funcionariaDigitalDoProvedor(providerDaSessao(req))); }
    catch (e) {
      if (e instanceof ErroDaPonteDoChat) return falha(res, e, "chave da funcionária digital não lida");
      logger.warn({ err: e, providerId: providerDaSessao(req) }, "Autonomia do chat: chave da funcionária digital não lida");
      // 503, nunca `{ ativa: false }` inventado: a tela mostra que não leu.
      res.status(503).json({ message: "Não foi possível ler a chave da funcionária digital." });
    }
  });

  router.put("/api/chat-bullq/autonomia/funcionaria-digital", requireAuth, requireProvider, async (req, res) => {
    if (!podeAdministrarOProvedor(req.session)) return res.status(403).json({ message: "Apenas administradores podem ligar ou desligar a funcionária digital" });
    const r = FuncionariaDigitalSchema.safeParse(req.body);
    if (!r.success) return res.status(400).json({ message: "Informe apenas se a funcionária digital fica ligada", erros: r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`) });
    try { res.json(await configurarFuncionariaDigital(providerDaSessao(req), r.data, userDaSessao(req))); }
    catch (e) {
      if (e instanceof ErroDaPonteDoChat) return res.status(409).json({ message: e.message, codigo: e.codigo });
      logger.warn({ err: e, providerId: providerDaSessao(req) }, "Não foi possível gravar a chave da funcionária digital");
      res.status(503).json({ message: "A chave da funcionária digital não foi gravada. Tente novamente." });
    }
  });

  router.get("/api/chat-bullq/autonomia/estado", requireAuth, requireProvider, async (req, res) => {
    try { res.json(await filaDaAutonomia(providerDaSessao(req))); }
    catch (e) { falha(res, e, "fila não lida"); }
  });

  router.post("/api/chat-bullq/autonomia/conversas/:conversationId/devolver", requireAuth, requireProvider, exigirEscopoDoChat, async (req, res) => {
    const id = ConversaSchema.safeParse(req.params.conversationId);
    if (!id.success) return res.status(400).json({ message: "Conversa inválida" });
    try { res.json(await devolverAoAssistente(providerDaSessao(req), id.data, userDaSessao(req))); }
    catch (e) { falha(res, e, "conversa não devolvida"); }
  });

  return router;
}
