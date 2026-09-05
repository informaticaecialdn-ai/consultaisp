/**
 * As rotas da ponte com o Chat BullQ — o chat com o cliente dentro de
 * Cobranca e Equipamentos.
 *
 * O provedor (requireProvider) ve o estado da integracao e manda casos para o
 * chat; so o admin liga o numero de WhatsApp (o token do canal e credencial).
 * O superadmin em janela de suporte conta como admin (podeAdministrarOProvedor).
 * Nada aqui devolve token nem telefone em log; o telefone so viaja para o
 * Chat BullQ dentro do servico.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireProvider } from "../auth";
import { logger } from "../logger";
import {
  configurarCanalWhatsapp, conversaDoCaso, definirSenhaDoInbox, enviarCasoParaCobranca, enviarRecuperacaoParaChat, estadoDaIntegracao, ErroDaPonteDoChat,
} from "../services/chat/chat-ponte.service";
import { podeAdministrarOProvedor } from "./provider.routes";

const providerDaSessao = (req: Request): number => req.session.providerId as number;
const userDaSessao = (req: Request): number => req.session.userId as number;

function idDaRota(valor: string | string[] | undefined): number | null {
  const n = Number(Array.isArray(valor) ? valor[0] : valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function exigirAdmin(acao: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!podeAdministrarOProvedor(req.session)) return res.status(403).json({ message: `Apenas administradores podem ${acao}` });
    next();
  };
}

/** O erro da ponte vira o status certo; o resto e 500 com a frase generica. */
function falha(res: Response, e: unknown) {
  if (e instanceof ErroDaPonteDoChat) {
    const status = e.codigo === "CASO_NAO_ENCONTRADO" ? 404 : e.codigo === "CHAT_DESLIGADO" ? 503 : e.codigo === "CHAT_FALHOU" ? 502 : 409;
    return res.status(status).json({ message: e.message, codigo: e.codigo });
  }
  logger.error({ err: e }, "Chat BullQ: erro inesperado na rota");
  res.status(500).json({ message: "Erro interno no chat" });
}

const CanalSchema = z.object({
  nome: z.string().trim().min(2).max(80),
  token: z.string().trim().min(8).max(500),
  webhookSecret: z.string().trim().min(8).max(200).optional(),
});

const SenhaSchema = z.object({ senha: z.string().min(6).max(128) });

const EnvioSchema = z.object({
  texto: z.string().trim().min(1).max(2000).optional(),
  acaoDaEtapa: z.string().trim().max(500).optional(),
});

export function registerChatBullqRoutes(): Router {
  const router = Router();

  router.get("/api/chat-bullq/integracao", requireAuth, requireProvider, async (req, res) => {
    try {
      res.json(await estadoDaIntegracao(providerDaSessao(req)));
    } catch (e) {
      falha(res, e);
    }
  });

  router.post("/api/chat-bullq/integracao/canal", requireAuth, requireProvider, exigirAdmin("ligar o WhatsApp ao chat"), async (req, res) => {
    const parsed = CanalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Informe o nome do canal e o token da instancia", erros: parsed.error.issues.map(i => i.message) });
    try {
      const r = await configurarCanalWhatsapp(providerDaSessao(req), parsed.data);
      res.status(r.canalOk ? 200 : 202).json({
        canalOk: r.canalOk,
        integracao: { status: r.integracao.status, canal: r.integracao.canalId ? { id: r.integracao.canalId, nome: r.integracao.canalNome } : null, ultimoErro: r.integracao.ultimoErro },
      });
    } catch (e) {
      falha(res, e);
    }
  });

  router.post("/api/chat-bullq/integracao/senha", requireAuth, requireProvider, exigirAdmin("definir a senha do inbox"), async (req, res) => {
    const parsed = SenhaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "A senha precisa ter entre 6 e 128 caracteres" });
    try {
      res.json(await definirSenhaDoInbox(providerDaSessao(req), parsed.data.senha));
    } catch (e) {
      falha(res, e);
    }
  });

  router.post("/api/chat-bullq/cobranca/casos/:id/enviar", requireAuth, requireProvider, async (req, res) => {
    const casoId = idDaRota(req.params.id);
    if (!casoId) return res.status(400).json({ message: "Caso invalido" });
    const parsed = EnvioSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Mensagem invalida", erros: parsed.error.issues.map(i => i.message) });
    try {
      res.json(await enviarCasoParaCobranca(providerDaSessao(req), casoId, userDaSessao(req), parsed.data.texto ?? null, parsed.data.acaoDaEtapa ?? null));
    } catch (e) {
      falha(res, e);
    }
  });

  router.get("/api/chat-bullq/cobranca/casos/:id/conversa", requireAuth, requireProvider, async (req, res) => {
    const casoId = idDaRota(req.params.id);
    if (!casoId) return res.status(400).json({ message: "Caso invalido" });
    try {
      const c = await conversaDoCaso(providerDaSessao(req), casoId);
      if (!c) return res.status(404).json({ message: "Este caso ainda nao foi enviado para o chat" });
      res.json(c);
    } catch (e) {
      falha(res, e);
    }
  });

  router.post("/api/chat-bullq/recuperacao/:id/enviar", requireAuth, requireProvider, async (req, res) => {
    const id = idDaRota(req.params.id);
    if (!id) return res.status(400).json({ message: "Caso de recuperacao invalido" });
    const parsed = EnvioSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Mensagem invalida", erros: parsed.error.issues.map(i => i.message) });
    try {
      res.json(await enviarRecuperacaoParaChat(providerDaSessao(req), id, userDaSessao(req), parsed.data.texto ?? null));
    } catch (e) {
      falha(res, e);
    }
  });

  return router;
}
