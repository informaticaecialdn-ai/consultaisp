/**
 * Confissão de dívida — as rotas do provedor (spec §6.2, §6.4, §6.5, §6.7).
 * Router próprio: as regras moram nos serviços em server/services/confissao;
 * aqui só sessão, validação, permissão e a forma da resposta.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireProvider } from "../auth";
import { storage } from "../storage";
import { logger } from "../logger";
import { getSafeErrorMessage } from "../utils/safe-error";
import { podeAdministrarOProvedor } from "./provider.routes";
import { ErroDeConfissao } from "../assinatura/erro";
import { estadoDaAssinatura, montarBase } from "../services/confissao/confissao-base.service";
import { emitirConfissao } from "../services/confissao/confissao-emissao.service";
import { cancelarConfissao, reenviarNotificacoes } from "../services/confissao/confissao-retorno.service";
import { ORIGENS_DA_CONFISSAO, type AmbienteDeAssinatura, type ConfissaoResumo, type FaturaDoAnexo, type ModeloDaConfissao, type OrigemDaConfissao, type ParcelaConfessada, type SignatarioDaConfissao, type StatusDeConfissao } from "@shared/cobranca/confissao";
import type { CobrancaConfissao } from "@shared/schema";

const providerDaSessao = (req: Request) => req.session.providerId!;
const usuarioDaSessao = (req: Request) => req.session.userId!;

function idDaRota(valor: string | string[] | undefined): number | null {
  if (typeof valor !== "string") return null;
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A mesma recusa das outras rotas de cobrança, com o código que o cadeado do 360 reconhece. */
function exigirAdminDoProvedor(acao: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!podeAdministrarOProvedor(req.session)) {
      return res.status(403).json({ message: `Apenas administradores podem ${acao}`, code: "APROVACAO_OBRIGATORIA" });
    }
    next();
  };
}

export function responderErro(res: Response, e: unknown) {
  if (e instanceof ErroDeConfissao) {
    return res.status(e.http).json({ message: e.message, code: e.codigo, ...(e.detalhes ? { detalhes: e.detalhes } : {}) });
  }
  return res.status(500).json({ message: getSafeErrorMessage(e) });
}

const numero = (s: string | null) => (s === null ? null : Number(s));
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function confissaoParaApi(c: CobrancaConfissao, nomes: Map<number, string>): ConfissaoResumo {
  const signatarios = (c.zapsignSigners as SignatarioDaConfissao[] | null) ?? [];
  return {
    id: c.id,
    customerId: c.customerId,
    casoId: c.casoId,
    negociacaoId: c.negociacaoId,
    status: c.status as StatusDeConfissao,
    origem: c.origem as OrigemDaConfissao,
    ambiente: c.ambiente as AmbienteDeAssinatura,
    zapsignSandbox: c.zapsignSandbox,
    valorTotal: Number(c.valorTotal),
    valorOriginal: numero(c.valorOriginal),
    descontoPct: numero(c.descontoPct),
    parcelas: (c.parcelas as ParcelaConfessada[] | null) ?? [],
    anexo: (c.erpFaturas as FaturaDoAnexo[] | null) ?? [],
    modelo: c.modelo as ModeloDaConfissao,
    modeloVersao: c.modeloVersao,
    modeloRevisado: c.modeloRevisado,
    dataLimiteAssinatura: c.dataLimiteAssinatura,
    enviadaEm: iso(c.enviadaEm),
    assinadaEm: iso(c.assinadaEm),
    encerradaEm: iso(c.encerradaEm),
    recusaInformadaEm: iso(c.recusaInformadaEm),
    expiracaoInformadaEm: iso(c.expiracaoInformadaEm),
    erroUltimo: c.erroUltimo,
    signatarios,
    signUrlCliente: signatarios.find(s => s.papel === "cliente")?.signUrl ?? null,
    contatoAlterado: c.contatoAlteradoPorUserId !== null,
    criadaPor: nomes.get(c.criadaPorUserId) ?? null,
    criadaEm: c.createdAt ? c.createdAt.toISOString() : new Date(0).toISOString(),
    pdf: { original: !!c.pdfOriginalSha256, assinado: !!c.pdfAssinadoSha256 },
  };
}

async function nomesDaEquipe(providerId: number): Promise<Map<number, string>> {
  const usuarios = await storage.getUsersByProvider(providerId).catch(() => []);
  return new Map(usuarios.map(u => [u.id, u.name]));
}

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD");
// A base é relida enquanto o operador digita: e-mail e nome pela metade são
// estado normal do formulário, não requisição inválida. Um 400 aqui deixa o
// diálogo sem base (e sem o campo sendo digitado); quem recusa o contato ou o
// representante incompleto é o bloqueio do `montarBase`. Na emissão o formato
// continua validado — lá o 400 é o certo.
const BaseQuerySchema = z.object({
  vencimento: dia.optional(),
  faturasExcluidas: z.string().max(4000).optional(),
  email: z.string().trim().max(160).optional(),
  telefone: z.string().trim().max(30).optional(),
  representanteNome: z.string().trim().max(160).optional(),
  representanteCpf: z.string().trim().max(20).optional(),
});
const EmissaoSchema = z.object({
  origem: z.enum(ORIGENS_DA_CONFISSAO),
  vencimento: dia.nullable().optional(),
  faturasExcluidas: z.array(z.string().max(120)).max(500).optional(),
  clienteEmail: z.string().trim().email().max(160).nullable().optional(),
  clienteTelefone: z.string().trim().max(30).nullable().optional(),
  representante: z.object({ nome: z.string().trim().min(3).max(160), cpf: z.string().trim().max(20) }).nullable().optional(),
  baseHash: z.string().regex(/^[0-9a-f]{64}$/),
  chaveIdempotencia: z.string().uuid(),
  confirmoTeste: z.boolean().optional(),
  confirmoPrescricao: z.boolean().optional(),
}).strict();

export function registerConfissaoRoutes(): Router {
  const router = Router();
  router.use("/api/cobranca/confissoes", requireAuth, requireProvider);
  router.use("/api/cobranca/clientes/:customerId/confissoes", requireAuth, requireProvider);

  router.get("/api/cobranca/confissoes/estado", async (req, res) => {
    try {
      res.json(await estadoDaAssinatura(providerDaSessao(req)));
    } catch (e) {
      responderErro(res, e);
    }
  });

  router.put("/api/cobranca/confissoes/modelo/revisado", exigirAdminDoProvedor("marcar o modelo como revisado"), async (req, res) => {
    try {
      await storage.marcarModeloRevisado(providerDaSessao(req), usuarioDaSessao(req));
      res.json(await estadoDaAssinatura(providerDaSessao(req)));
    } catch (e) {
      responderErro(res, e);
    }
  });

  router.get("/api/cobranca/clientes/:customerId/confissoes/base", async (req, res) => {
    const customerId = idDaRota(req.params.customerId);
    if (!customerId) return res.status(400).json({ message: "Cliente invalido" });
    const parsed = BaseQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
    const q = parsed.data;
    try {
      const base = await montarBase(providerDaSessao(req), customerId, {
        vencimento: q.vencimento ?? null,
        faturasExcluidas: q.faturasExcluidas ? q.faturasExcluidas.split(",").map(s => s.trim()).filter(Boolean) : [],
        email: q.email ?? null,
        telefone: q.telefone ?? null,
        representante: q.representanteNome && q.representanteCpf ? { nome: q.representanteNome, cpf: q.representanteCpf.replace(/\D/g, "") } : null,
      });
      res.json(base.dto);
    } catch (e) {
      responderErro(res, e);
    }
  });

  router.post("/api/cobranca/clientes/:customerId/confissoes", exigirAdminDoProvedor("emitir a confissão de dívida"), async (req, res) => {
    const customerId = idDaRota(req.params.customerId);
    if (!customerId) return res.status(400).json({ message: "Cliente invalido" });
    const parsed = EmissaoSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
    const providerId = providerDaSessao(req);
    try {
      const confissao = await emitirConfissao(providerId, customerId, usuarioDaSessao(req), parsed.data);
      res.json(confissaoParaApi(confissao, await nomesDaEquipe(providerId)));
    } catch (e) {
      responderErro(res, e);
    }
  });

  router.get("/api/cobranca/clientes/:customerId/confissoes", async (req, res) => {
    const customerId = idDaRota(req.params.customerId);
    if (!customerId) return res.status(400).json({ message: "Cliente invalido" });
    const providerId = providerDaSessao(req);
    try {
      const [lista, nomes] = await Promise.all([storage.listarConfissoesDoCliente(providerId, customerId), nomesDaEquipe(providerId)]);
      res.json(lista.map(c => confissaoParaApi(c, nomes)));
    } catch (e) {
      responderErro(res, e);
    }
  });

  router.post("/api/cobranca/confissoes/:id/cancelar", exigirAdminDoProvedor("cancelar a confissão de dívida"), async (req, res) => {
    const id = idDaRota(req.params.id);
    if (!id) return res.status(400).json({ message: "Confissao invalida" });
    const providerId = providerDaSessao(req);
    try {
      // A única rota que autoriza cancelar sem o documento no ZapSign (404 —
      // token trocado ou expurgo): é o admin decidindo abrir mão do título.
      const c = await cancelarConfissao(providerId, id, usuarioDaSessao(req), { permitirSemDocumentoNoZapSign: true });
      res.json(confissaoParaApi(c, await nomesDaEquipe(providerId)));
    } catch (e) {
      responderErro(res, e);
    }
  });

  router.post("/api/cobranca/confissoes/:id/reenviar", exigirAdminDoProvedor("reenviar a confissão de dívida"), async (req, res) => {
    const id = idDaRota(req.params.id);
    if (!id) return res.status(400).json({ message: "Confissao invalida" });
    try {
      res.json(await reenviarNotificacoes(providerDaSessao(req), id));
    } catch (e) {
      responderErro(res, e);
    }
  });

  router.get("/api/cobranca/confissoes/:id/pdf", async (req, res) => {
    const id = idDaRota(req.params.id);
    if (!id) return res.status(400).json({ message: "Confissao invalida" });
    const tipo = z.enum(["original", "assinado"]).safeParse(req.query.tipo);
    if (!tipo.success) return res.status(400).json({ message: "tipo deve ser original ou assinado" });
    const providerId = providerDaSessao(req);
    try {
      const confissao = await storage.obterConfissao(providerId, id);
      if (!confissao) return res.status(404).json({ message: "Confissao nao encontrada" });
      const pdf = await storage.obterPdf(providerId, id, tipo.data, { registrarDownload: true });
      if (!pdf) return res.status(404).json({ message: tipo.data === "assinado" ? "O PDF assinado ainda não chegou" : "PDF nao encontrado" });
      logger.info({ providerId, userId: usuarioDaSessao(req), confissaoId: id, tipo: tipo.data, sha256: pdf.sha256 }, "CONFISSAO PDF baixado");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="confissao-${id}-${tipo.data}.pdf"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.send(pdf.bytes);
    } catch (e) {
      responderErro(res, e);
    }
  });

  return router;
}
