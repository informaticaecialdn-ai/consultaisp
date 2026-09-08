/**
 * O console de agentes — as rotas que a tela `/agentes` consome.
 *
 * Tudo aqui é `requireAuth + requireProvider`: a organização do Chat BullQ sai
 * do `providerId` da sessão, nunca do corpo nem do caminho. Leitura é de
 * qualquer operador do provedor; toda ESCRITA é de admin, porque criar agente,
 * skill ou conexão é configurar quem fala com o cliente e com que credencial.
 *
 * O superadmin em janela de suporte conta como admin (`podeAdministrarOProvedor`).
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireProvider } from "../auth";
import { logger } from "../logger";
import { ErroDaPonteDoChat } from "../services/chat/chat-ponte.service";
import { podeAdministrarOProvedor } from "./provider.routes";
import {
  AgenteDoConsoleParcialSchema, AgenteDoConsoleSchema, PERIODOS, SkillDoConsoleSchema, ToolDoConsoleSchema,
} from "@shared/chat-console";
import {
  apagarAgenteDoConsole, apagarSkillDoConsole, apagarToolDoConsole, atualizarAgenteDoConsole,
  atualizarSkillDoConsole, atualizarToolDoConsole, criarAgenteDoConsole, criarSkillDoConsole,
  criarToolDoConsole, definirAprovacaoDaSkillDoConsole, definirSkillsDoAgenteDoConsole,
  desligarAgenteDoCanalDoConsole, listarAgentesDoConsole, listarExecucoesDoConsole, listarSkillsDoConsole,
  listarToolsDoConsole, ligarAgenteAoCanalDoConsole, obterAgenteDoConsole, resumoDoConsole,
  skillsDoAgenteDoConsole, versoesDaSkillDoConsole,
} from "../services/chat/chat-console.service";

const provedor = (req: Request): number => req.session.providerId as number;

function exigirAdmin(acao: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!podeAdministrarOProvedor(req.session)) return res.status(403).json({ message: `Apenas administradores podem ${acao}` });
    next();
  };
}

function falha(res: Response, e: unknown) {
  if (e instanceof ErroDaPonteDoChat) {
    const status = e.codigo === "CASO_NAO_ENCONTRADO" ? 404 : e.codigo === "CHAT_DESLIGADO" ? 503 : e.codigo === "CHAT_FALHOU" ? 502 : 409;
    return res.status(status).json({ message: e.message, codigo: e.codigo });
  }
  logger.error({ err: e }, "Console de agentes: erro inesperado");
  res.status(500).json({ message: "Erro interno no console de agentes" });
}

/** O erro de validação vira a lista de campos, para a tela apontar onde está. */
function invalido(res: Response, erro: z.ZodError) {
  return res.status(400).json({
    message: "Revise os campos do formulário",
    erros: erro.issues.map(i => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)),
  });
}

const identificador = z.string().trim().min(1).max(80);
const CanalDoAgenteSchema = z.object({
  canalId: identificador,
  modo: z.enum(["AUTONOMOUS", "COPILOT", "DISABLED"]),
  gatilho: z.enum(["ALWAYS", "OFF_HOURS", "NO_HUMAN_ASSIGNED"]).optional(),
}).strict();
const SkillsDoAgenteSchema = z.object({ skillIds: z.array(identificador).max(40) }).strict();
const AprovacaoSchema = z.object({ exigeAprovacao: z.boolean() }).strict();
const FiltroDeExecucoesSchema = z.object({
  agenteId: identificador.optional(),
  status: z.enum(["RUNNING", "COMPLETED", "FAILED", "SKIPPED"]).optional(),
  periodo: z.enum(["24h", "7d", "30d", "all"]).optional(),
  soComErro: z.enum(["1", "0", "true", "false"]).optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(),
}).partial();

export function registerChatConsoleRoutes(): Router {
  const router = Router();
  const base = "/api/chat-bullq/console";
  const ler = [requireAuth, requireProvider] as const;

  // ------------------------------------------------------------- agentes

  router.get(`${base}/agentes`, ...ler, async (req, res) => {
    try { res.json(await listarAgentesDoConsole(provedor(req))); } catch (e) { falha(res, e); }
  });

  router.post(`${base}/agentes`, ...ler, exigirAdmin("criar agentes"), async (req, res) => {
    const dados = AgenteDoConsoleSchema.safeParse(req.body ?? {});
    if (!dados.success) return invalido(res, dados.error);
    try { res.status(201).json(await criarAgenteDoConsole(provedor(req), dados.data)); } catch (e) { falha(res, e); }
  });

  router.get(`${base}/agentes/:id`, ...ler, async (req, res) => {
    const id = identificador.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Agente inválido" });
    try { res.json(await obterAgenteDoConsole(provedor(req), id.data)); } catch (e) { falha(res, e); }
  });

  router.patch(`${base}/agentes/:id`, ...ler, exigirAdmin("editar agentes"), async (req, res) => {
    const id = identificador.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Agente inválido" });
    const dados = AgenteDoConsoleParcialSchema.safeParse(req.body ?? {});
    if (!dados.success) return invalido(res, dados.error);
    try { res.json(await atualizarAgenteDoConsole(provedor(req), id.data, dados.data)); } catch (e) { falha(res, e); }
  });

  router.delete(`${base}/agentes/:id`, ...ler, exigirAdmin("remover agentes"), async (req, res) => {
    const id = identificador.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Agente inválido" });
    try {
      await apagarAgenteDoConsole(provedor(req), id.data);
      res.json({ ok: true });
    } catch (e) { falha(res, e); }
  });

  // ------------------------------------------------- skills e canais do agente

  router.get(`${base}/agentes/:id/skills`, ...ler, async (req, res) => {
    const id = identificador.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Agente inválido" });
    try { res.json(await skillsDoAgenteDoConsole(provedor(req), id.data)); } catch (e) { falha(res, e); }
  });

  router.put(`${base}/agentes/:id/skills`, ...ler, exigirAdmin("mudar as skills de um agente"), async (req, res) => {
    const id = identificador.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Agente inválido" });
    const dados = SkillsDoAgenteSchema.safeParse(req.body ?? {});
    if (!dados.success) return invalido(res, dados.error);
    try {
      await definirSkillsDoAgenteDoConsole(provedor(req), id.data, dados.data.skillIds);
      res.json({ ok: true });
    } catch (e) { falha(res, e); }
  });

  router.patch(`${base}/agentes/:id/skills/:skillId`, ...ler, exigirAdmin("mudar a aprovação de uma skill"), async (req, res) => {
    const id = identificador.safeParse(req.params.id);
    const skillId = identificador.safeParse(req.params.skillId);
    if (!id.success || !skillId.success) return res.status(400).json({ message: "Agente ou skill inválidos" });
    const dados = AprovacaoSchema.safeParse(req.body ?? {});
    if (!dados.success) return invalido(res, dados.error);
    try {
      await definirAprovacaoDaSkillDoConsole(provedor(req), id.data, skillId.data, dados.data.exigeAprovacao);
      res.json({ ok: true });
    } catch (e) { falha(res, e); }
  });

  router.post(`${base}/agentes/:id/canais`, ...ler, exigirAdmin("ligar um agente a um canal"), async (req, res) => {
    const id = identificador.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Agente inválido" });
    const dados = CanalDoAgenteSchema.safeParse(req.body ?? {});
    if (!dados.success) return invalido(res, dados.error);
    try {
      await ligarAgenteAoCanalDoConsole(provedor(req), id.data, dados.data.canalId, dados.data.modo, dados.data.gatilho);
      res.json({ ok: true });
    } catch (e) { falha(res, e); }
  });

  router.delete(`${base}/agentes/:id/canais/:canalId`, ...ler, exigirAdmin("desligar um agente de um canal"), async (req, res) => {
    const id = identificador.safeParse(req.params.id);
    const canalId = identificador.safeParse(req.params.canalId);
    if (!id.success || !canalId.success) return res.status(400).json({ message: "Agente ou canal inválidos" });
    try {
      await desligarAgenteDoCanalDoConsole(provedor(req), id.data, canalId.data);
      res.json({ ok: true });
    } catch (e) { falha(res, e); }
  });

  // ------------------------------------------------------------- conexões

  router.get(`${base}/tools`, ...ler, async (req, res) => {
    try { res.json(await listarToolsDoConsole(provedor(req))); } catch (e) { falha(res, e); }
  });

  router.post(`${base}/tools`, ...ler, exigirAdmin("criar conexões"), async (req, res) => {
    const dados = ToolDoConsoleSchema.safeParse(req.body ?? {});
    if (!dados.success) return invalido(res, dados.error);
    try { res.status(201).json(await criarToolDoConsole(provedor(req), dados.data)); } catch (e) { falha(res, e); }
  });

  router.patch(`${base}/tools/:id`, ...ler, exigirAdmin("editar conexões"), async (req, res) => {
    const id = identificador.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Conexão inválida" });
    const dados = ToolDoConsoleSchema.safeParse(req.body ?? {});
    if (!dados.success) return invalido(res, dados.error);
    try { res.json(await atualizarToolDoConsole(provedor(req), id.data, dados.data)); } catch (e) { falha(res, e); }
  });

  router.delete(`${base}/tools/:id`, ...ler, exigirAdmin("remover conexões"), async (req, res) => {
    const id = identificador.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Conexão inválida" });
    try {
      await apagarToolDoConsole(provedor(req), id.data);
      res.json({ ok: true });
    } catch (e) { falha(res, e); }
  });

  // -------------------------------------------------------------- skills

  router.get(`${base}/skills`, ...ler, async (req, res) => {
    try { res.json(await listarSkillsDoConsole(provedor(req))); } catch (e) { falha(res, e); }
  });

  router.post(`${base}/skills`, ...ler, exigirAdmin("criar skills"), async (req, res) => {
    const dados = SkillDoConsoleSchema.safeParse(req.body ?? {});
    if (!dados.success) return invalido(res, dados.error);
    try { res.status(201).json(await criarSkillDoConsole(provedor(req), dados.data)); } catch (e) { falha(res, e); }
  });

  router.get(`${base}/skills/:id/versoes`, ...ler, async (req, res) => {
    const id = identificador.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Skill inválida" });
    try { res.json(await versoesDaSkillDoConsole(provedor(req), id.data)); } catch (e) { falha(res, e); }
  });

  router.patch(`${base}/skills/:id`, ...ler, exigirAdmin("editar skills"), async (req, res) => {
    const id = identificador.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Skill inválida" });
    const dados = SkillDoConsoleSchema.safeParse(req.body ?? {});
    if (!dados.success) return invalido(res, dados.error);
    try { res.json(await atualizarSkillDoConsole(provedor(req), id.data, dados.data)); } catch (e) { falha(res, e); }
  });

  router.delete(`${base}/skills/:id`, ...ler, exigirAdmin("remover skills"), async (req, res) => {
    const id = identificador.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Skill inválida" });
    try {
      await apagarSkillDoConsole(provedor(req), id.data);
      res.json({ ok: true });
    } catch (e) { falha(res, e); }
  });

  // ------------------------------------------------------------ execuções

  router.get(`${base}/execucoes`, ...ler, async (req, res) => {
    const f = FiltroDeExecucoesSchema.safeParse(req.query ?? {});
    if (!f.success) return invalido(res, f.error);
    try {
      res.json(await listarExecucoesDoConsole(provedor(req), {
        agenteId: f.data.agenteId, status: f.data.status, periodo: f.data.periodo,
        soComErro: f.data.soComErro === "1" || f.data.soComErro === "true",
        limite: f.data.limite,
      }));
    } catch (e) { falha(res, e); }
  });

  router.get(`${base}/resumo`, ...ler, async (req, res) => {
    const periodo = z.enum(PERIODOS).safeParse(req.query.periodo ?? "7d");
    if (!periodo.success) return res.status(400).json({ message: "Período inválido — use 24h, 7d ou 30d" });
    try { res.json(await resumoDoConsole(provedor(req), periodo.data)); } catch (e) { falha(res, e); }
  });

  return router;
}
