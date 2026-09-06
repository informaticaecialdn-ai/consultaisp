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
import { CanalWhatsappSchema, ConectarWhatsappSchema, TemplatesDeAberturaSchema } from "@shared/chat-whatsapp";
import { catalogoTemplatesWhatsapp, salvarTemplatesWhatsapp, provedorWhatsapp, prepararTemplateWhatsapp } from "../services/chat/chat-templates.service";
import { consultarOuConectarWhatsapp } from "../services/chat/chat-whatsapp.service";
import { z } from "zod";
import { requireAuth, requireProvider } from "../auth";
import { logger } from "../logger";
import {
  configurarCanalWhatsapp, conversaDoCaso, definirSenhaDoInbox, enviarCasoParaCobranca, enviarRecuperacaoParaChat, estadoDaIntegracao, ErroDaPonteDoChat,
  garantirAgenteDeCobranca,
  garantirTransferenciaNaResposta,
} from "../services/chat/chat-ponte.service";
import { AutomacaoChatSchema, lerAutomacaoChat } from "@shared/cobranca/automacao-chat";
import { contextoDoAtendimento, segundaViaDoAtendimento } from "../services/chat/chat-contexto.service";
import { podeAdministrarOProvedor } from "./provider.routes";
import { storage } from "../storage";
import { acaoNaConversa, detalheDoAtendimento, ErroDeDadosDoAtendimento, midiaDoAtendimento, TAMANHO_MAXIMO_DA_ACAO } from "../services/chat/chat-atendimento.service";
import { ConfiguracaoDeAgenteSchema, TipoDeAgenteSchema, type TipoDeAgente } from "@shared/chat-agentes";
import { comTravaDaConfiguracaoDoChat, configurarAgenteDoChat, exigirAgentesProntos, listarAgentesDoChat, modelosDosAgentesDoChat, prepararPrimeiroContatoDoAgente, promptDoAgenteDoChat, provisionarAgenteDoChat } from "../services/chat/chat-agentes.service";

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
  // Corpo incompleto ou impossivel e 400, como toda recusa de dados do sistema
  // — nao 409, que diria conflito com o estado atual do atendimento.
  if (e instanceof ErroDeDadosDoAtendimento) {
    return res.status(400).json({ message: e.message, codigo: e.codigo });
  }
  if (e instanceof ErroDaPonteDoChat) {
    const status = e.codigo === "CASO_NAO_ENCONTRADO" ? 404 : e.codigo === "CHAT_DESLIGADO" ? 503 : e.codigo === "CHAT_FALHOU" ? 502 : 409;
    return res.status(status).json({ message: e.message, codigo: e.codigo });
  }
  logger.error({ err: e }, "Chat BullQ: erro inesperado na rota");
  res.status(500).json({ message: "Erro interno no chat" });
}

const CanalSchema = CanalWhatsappSchema;

const SenhaSchema = z.object({ senha: z.string().min(12).max(128) });

const EnvioSchema = z.object({
  texto: z.string().trim().min(1).max(2000).optional(),
  acaoDaEtapa: z.string().trim().max(500).optional(),
});

/**
 * O follow-up que o atendente escreveu no dialogo — todo contato termina com a
 * proxima acao e a data dela. Vinha sendo descartado aqui: o servico recusava
 * todo "encerrar" com caso vivo e ignorava o que o atendente digitou ao
 * responder. A data chega como ISO do navegador (o fuso e resolvido la, a VPS
 * roda em UTC) e vira Date; quem valida "daqui para a frente" e o servico.
 */
const followUpDaAcao = {
  proximaAcao: z.string().trim().max(TAMANHO_MAXIMO_DA_ACAO).optional(),
  proximoContatoEm: z.coerce.date().optional(),
};

const AcaoDoAtendimentoSchema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("enviar"), texto: z.string().trim().min(1).max(2000), ...followUpDaAcao }),
  z.object({ acao: z.literal("assumir") }),
  z.object({ acao: z.literal("encerrar"), ...followUpDaAcao }),
]);

export function registerChatBullqRoutes(): Router {
  const router = Router();
  router.get("/api/chat-bullq/integracao/canal/templates", requireAuth, requireProvider, exigirAdmin("consultar templates do WhatsApp"), async (req, res) => {
    try { res.json(await catalogoTemplatesWhatsapp(providerDaSessao(req))); } catch (e) { falha(res, e); }
  });
  router.put("/api/chat-bullq/integracao/canal/templates", requireAuth, requireProvider, exigirAdmin("configurar templates do WhatsApp"), async (req, res) => {
    const dados = TemplatesDeAberturaSchema.safeParse(req.body);
    if (!dados.success) return res.status(400).json({ message: "Informe um template válido e suas variáveis para cada carteira" });
    try { res.json(await salvarTemplatesWhatsapp(providerDaSessao(req), dados.data.templates)); } catch (e) { falha(res, e); }
  });
  router.get("/api/chat-bullq/integracao/canal/conexao", requireAuth, requireProvider, exigirAdmin("consultar a conexão do WhatsApp"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try { res.json(await consultarOuConectarWhatsapp(providerDaSessao(req), "consultar")); } catch (e) { falha(res, e); }
  });
  router.post("/api/chat-bullq/integracao/canal/conectar", requireAuth, requireProvider, exigirAdmin("parear o WhatsApp"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const dados = ConectarWhatsappSchema.safeParse(req.body);
    if (!dados.success) return res.status(400).json({ message: "Informe apenas o número com DDI 55 e DDD, ou deixe vazio para usar o QR" });
    try { res.json(await consultarOuConectarWhatsapp(providerDaSessao(req), "conectar", dados.data.phone)); } catch (e) { falha(res, e); }
  });
  router.get("/api/chat-bullq/automacao", requireAuth, requireProvider, async (req, res) => {
    try {
      const i = await storage.getIntegracaoDoChat(providerDaSessao(req));
      res.json(lerAutomacaoChat((i?.agenteConfig as Record<string, unknown> | null)?.primeiroContato));
    } catch (e) { falha(res, e); }
  });
  router.put("/api/chat-bullq/automacao", requireAuth, requireProvider, exigirAdmin("ativar primeiros contatos automáticos"), async (req, res) => {
    const config = AutomacaoChatSchema.safeParse(req.body);
    if (!config.success) return res.status(400).json({ message: "Informe os módulos e um limite entre 1 e 100 contatos por dia" });
    try {
      const providerId = providerDaSessao(req);
      if (config.data.ligada) await garantirTransferenciaNaResposta(providerId);
      await comTravaDaConfiguracaoDoChat(providerId, async () => {
        const i = await storage.getIntegracaoDoChat(providerId);
        if (!i || (config.data.ligada && (!i.canalId || i.status !== "ativo"))) throw new ErroDaPonteDoChat("CONFLITO", "Ligue o número de WhatsApp antes de configurar a automação");
        if (config.data.ligada) {
          const tipos: TipoDeAgente[] = [];
          if (config.data.cobranca) for (const carteira of config.data.carteiras) tipos.push(carteira === "ativo" ? "cobranca_ativos" : "cobranca_ex_clientes");
          if (config.data.equipamentos) tipos.push("recuperacao_equipamentos");
          if (provedorWhatsapp(i.agenteConfig) === "DATAFY") {
            for (const tipo of tipos) await prepararTemplateWhatsapp(providerId, tipo, { nomeCliente: "Cliente", nomeProvedor: "Provedor" });
          } else await exigirAgentesProntos(providerId, tipos);
        }
        await storage.guardarAgenteDoChat(providerId, { agenteConfig: { ...(i.agenteConfig as Record<string, unknown> ?? {}), primeiroContato: config.data, primeiroContatoUserId: userDaSessao(req) } });
      });
      res.json(config.data);
    } catch (e) { falha(res, e); }
  });

  router.get("/api/chat-bullq/atendimentos", requireAuth, requireProvider, async (req, res) => {
    const filtro = z.object({ origem: z.enum(["cobranca", "equipamentos"]), carteira: z.enum(["ativo", "ex_cliente"]).optional(), status: z.enum(["PENDING", "OPEN", "WAITING", "BOT", "CLOSED"]).optional(), busca: z.string().trim().max(80).optional(), pagina: z.coerce.number().int().min(1).max(10000).default(1) }).safeParse(req.query);
    if (!filtro.success) return res.status(400).json({ message: "Filtro de atendimento inválido" });
    try { res.json(await storage.listarAtendimentosDoChat(providerDaSessao(req), filtro.data)); } catch (e) { falha(res, e); }
  });

  router.get("/api/chat-bullq/atendimentos/:conversaId", requireAuth, requireProvider, async (req, res) => {
    const id = z.string().trim().min(1).max(120).safeParse(req.params.conversaId);
    const pagina = z.coerce.number().int().min(1).max(10000).default(1).safeParse(req.query.pagina);
    if (!id.success || !pagina.success) return res.status(400).json({ message: "Conversa ou página inválida" });
    try { res.json(await detalheDoAtendimento(providerDaSessao(req), id.data, pagina.data)); } catch (e) { falha(res, e); }
  });

  router.get("/api/chat-bullq/atendimentos/:conversaId/contexto", requireAuth, requireProvider, async (req, res) => {
    const p = z.object({ id: z.string().min(1).max(120), atualizar: z.enum(["true", "false"]).default("false") }).safeParse({ id: req.params.conversaId, atualizar: req.query.atualizar });
    if (!p.success) return res.status(400).json({ message: "Conversa inválida" });
    try { res.json(await contextoDoAtendimento(providerDaSessao(req), p.data.id, p.data.atualizar === "true")); } catch (e) { falha(res, e); }
  });
  router.post("/api/chat-bullq/atendimentos/:conversaId/segunda-via", requireAuth, requireProvider, async (req, res) => {
    const p = z.object({ id: z.string().min(1).max(120), ref: z.string().trim().min(1).max(160) }).safeParse({ id: req.params.conversaId, ref: req.body?.ref });
    if (!p.success) return res.status(400).json({ message: "Informe a fatura" });
    try { res.json(await segundaViaDoAtendimento(providerDaSessao(req), p.data.id, p.data.ref)); } catch (e) { falha(res, e); }
  });

  router.get("/api/chat-bullq/atendimentos/:conversaId/mensagens/:messageId/midia", requireAuth, requireProvider, async (req, res) => {
    const dados = z.object({ conversaId: z.string().min(1).max(120), messageId: z.string().min(1).max(120), pagina: z.coerce.number().int().min(1).max(10000).default(1) }).safeParse({ ...req.params, pagina: req.query.pagina });
    if (!dados.success) return res.status(400).json({ message: "Anexo inválido" });
    try { res.json(await midiaDoAtendimento(providerDaSessao(req), dados.data.conversaId, dados.data.messageId, dados.data.pagina)); } catch (e) { falha(res, e); }
  });

  router.post("/api/chat-bullq/atendimentos/:conversaId/acoes", requireAuth, requireProvider, async (req, res) => {
    const id = z.string().trim().min(1).max(120).safeParse(req.params.conversaId);
    const acao = AcaoDoAtendimentoSchema.safeParse(req.body);
    if (!id.success || !acao.success) return res.status(400).json({ message: "Ação de atendimento inválida" });
    try { res.json(await acaoNaConversa(providerDaSessao(req), id.data, userDaSessao(req), acao.data)); } catch (e) { falha(res, e); }
  });

  router.get("/api/chat-bullq/recuperacao/:id/conversa", requireAuth, requireProvider, async (req, res) => {
    const id = idDaRota(req.params.id);
    if (!id) return res.status(400).json({ message: "Caso inválido" });
    try {
      const conversa = await storage.getConversaDoChatPorRecuperacao(providerDaSessao(req), id);
      res.json(conversa ? { conversationId: conversa.conversationId, status: conversa.status } : null);
    } catch (e) { falha(res, e); }
  });

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

  router.get("/api/chat-bullq/integracao/agentes", requireAuth, requireProvider, async (req, res) => {
    try { res.json(await listarAgentesDoChat(providerDaSessao(req))); } catch (e) { falha(res, e); }
  });
  router.get("/api/chat-bullq/integracao/agentes/modelos", requireAuth, requireProvider, exigirAdmin("configurar os modelos dos agentes"), async (req, res) => {
    try { res.json(await modelosDosAgentesDoChat(providerDaSessao(req))); } catch (e) { falha(res, e); }
  });
  router.put("/api/chat-bullq/integracao/agentes/:tipo", requireAuth, requireProvider, exigirAdmin("configurar agentes"), async (req, res) => {
    const tipo = TipoDeAgenteSchema.safeParse(req.params.tipo);
    const dados = ConfiguracaoDeAgenteSchema.safeParse(req.body);
    if (!tipo.success || !dados.success) return res.status(400).json({ message: "Informe o papel, o modelo, até 500 caracteres de descrição, 6.000 de instruções e 8.000 de contexto operacional; temperatura de 0 a 1 e de 160 a 1.200 tokens", erros: dados.success ? [] : dados.error.issues.map(i => `${i.path.join(".")}: ${i.message}`) });
    try { res.json(await configurarAgenteDoChat(providerDaSessao(req), tipo.data, dados.data)); } catch (e) { falha(res, e); }
  });
  /**
   * O prompt final que o agente recebe — as regras da casa, as preferências do provedor e o contexto do dia.
   *
   * Leitura no mesmo nível de `GET .../agentes`, que já devolve instruções, descrição e contexto operacional a
   * qualquer operador do provedor. Exigir admin só aqui era barreira de fachada: este endpoint não acrescenta
   * nenhum dado — é a composição do que a lista já entrega com texto que está no nosso próprio fonte. E não há
   * vazamento entre tenants: tudo vem do provedor da sessão. A fronteira real continua na ESCRITA (PUT,
   * provisionar, testar), essa sim só de admin.
   */
  router.get("/api/chat-bullq/integracao/agentes/:tipo/prompt", requireAuth, requireProvider, async (req, res) => {
    const tipo = TipoDeAgenteSchema.safeParse(req.params.tipo);
    if (!tipo.success) return res.status(400).json({ message: "Papel de agente inválido" });
    try { res.json(await promptDoAgenteDoChat(providerDaSessao(req), tipo.data)); } catch (e) { falha(res, e); }
  });
  router.post("/api/chat-bullq/integracao/agentes/:tipo/provisionar", requireAuth, requireProvider, exigirAdmin("provisionar agentes"), async (req, res) => {
    const tipo = TipoDeAgenteSchema.safeParse(req.params.tipo);
    if (!tipo.success) return res.status(400).json({ message: "Papel de agente inválido" });
    try {
      const agente = await provisionarAgenteDoChat(providerDaSessao(req), tipo.data);
      await garantirTransferenciaNaResposta(providerDaSessao(req));
      res.json(agente);
    } catch (e) { falha(res, e); }
  });
  router.post("/api/chat-bullq/integracao/agentes/:tipo/testar", requireAuth, requireProvider, exigirAdmin("testar agentes"), async (req, res) => {
    const tipo = TipoDeAgenteSchema.safeParse(req.params.tipo);
    if (!tipo.success) return res.status(400).json({ message: "Papel de agente inválido" });
    try {
      const p = await storage.getProvider(providerDaSessao(req));
      res.json(await prepararPrimeiroContatoDoAgente(providerDaSessao(req), tipo.data, { nomeCliente: "Cliente de teste", nomeProvedor: p?.tradeName || p?.name || "Provedor de teste", tom: "cordial" }));
    } catch (e) { falha(res, e); }
  });

  /** Compatibilidade: usa o agente de clientes ativos do catálogo. */
  router.post("/api/chat-bullq/integracao/agente", requireAuth, requireProvider, exigirAdmin("criar o agente de cobranca"), async (req, res) => {
    try {
      res.json(await garantirAgenteDeCobranca(providerDaSessao(req)));
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
