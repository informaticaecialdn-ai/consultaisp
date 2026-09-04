import { Router } from "express";
import { requireSuperAdmin } from "../auth";
import { storage } from "../storage";
import { hashPassword } from "../password";
import {
  sendVerificationEmail,
  sendCadastroAprovadoEmail,
  sendCadastroReprovadoEmail,
  sendAcessoSuspensoEmail,
  sendAcessoReativadoEmail,
  sendPlanoAlteradoEmail,
  sendUsuarioAdicionadoEmail,
} from "../services/email";
import { avisarProvedor, contextoDeEmail } from "../services/email-destinatario";
import { ROTULO_DO_PLANO } from "../services/precos.service";
import { PLAN_CREDITS } from "@shared/planos";
import { esquecerMarcas, resolverMarcaPorId, urlDeEntrada } from "../services/marca.service";
import { esquecerStatusDeProvedor } from "../auth";
import { getConnector, getSupportedSources } from "../erp/registry";
import { buildConnectorConfig } from "../erp/config";
import "../erp/index";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { getSafeErrorMessage } from "../utils/safe-error";
import { sanitizeFilename } from "../utils/filename-sanitizer";
import { db } from "../db";
import { titularRequests } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";
import { sendCompletionEmail } from "../services/lgpd-email.service";
import { normalizePartnerCode, resolvePartnerCode, resolveOwnCode } from "../utils/provider-anonymizer";
import { normalizarIdentificador, protocoloDaOrigem } from "../services/identificador-consulta";
import type { LinhaDeConsultaEncontrada } from "../storage/admin.storage";
import { CODIGO_PROVEDOR_COM_TRILHA_DE_SUPORTE } from "../storage/providers.storage";
import { consultarCnpjPublico, normalizarCnpj } from "../services/cnpj-publico.service";
import { maskCpfCnpj } from "../services/lgpd-masking";
import { CUSTO_EM_CREDITOS } from "@shared/planos";
import { isSpcConfigured, listarProdutosSpc, produtoSpcPadrao, SpcError, statusHttpParaErroSpc } from "../services/spc/spc.service";
import { getRegionalProviderIds } from "../services/regional.service";
import { logger } from "../logger";

const adminUpdateProviderSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  tradeName: z.string().max(200).nullable().optional(),
  cnpj: z.string().regex(/^\d{14}$/).optional(),
  // O catalogo tem dois planos desde 03/09/2026. Aceitar aqui uma chave que
  // saiu poria um provedor num plano sem preco e sem rotulo — a migracao 0014
  // moveu para `pro` quem estava em `basic` ou `enterprise`.
  plan: z.enum(["free", "pro"]).optional(),
  status: z.enum(["active", "suspended", "cancelled"]).optional(),
  verificationStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  ispCredits: z.number().int().min(0).optional(),
  spcCredits: z.number().int().min(0).optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: z.string().max(20).nullable().optional(),
  website: z.string().url().nullable().optional(),
  subdomain: z.string().max(50).nullable().optional(),
  addressZip: z.string().max(10).nullable().optional(),
  addressStreet: z.string().max(200).nullable().optional(),
  addressNumber: z.string().max(20).nullable().optional(),
  addressComplement: z.string().max(100).nullable().optional(),
  addressNeighborhood: z.string().max(100).nullable().optional(),
  addressCity: z.string().max(100).nullable().optional(),
  addressState: z.string().max(2).nullable().optional(),
  /**
   * NAO E COLUNA. Nao existe `providers.motivo` e nao deve existir: este campo
   * so viaja da tela do superadmin ate o corpo do e-mail que explica a decisao
   * (reprovacao de cadastro, suspensao de acesso). Por isso ele e retirado do
   * payload antes de chegar ao storage — ver o desmembramento no handler.
   */
  motivo: z.string().trim().min(1).max(500).optional(),
}).strict();

/**
 * O contrato completo de uma integracao ERP — o mesmo que o painel do provedor
 * aceitava e este aqui nao.
 *
 * Enquanto o superadmin so pode gravar apiUrl/apiToken/apiUser, quatro dos seis
 * ERPs sao inconfiguraveis por ele: MK precisa de `mkContraSenha`, Hubsoft de
 * `clientId`+`clientSecret`, SGP e Voalle de chaves dentro de `extraConfig`.
 * O `.strict()` rejeitava esses campos, entao a tela salvava "com sucesso" um
 * cadastro que o conector nunca conseguiria usar.
 *
 * `sgpApp` e `voalleClientId` NAO entram aqui: nao sao colunas de
 * `erp_integrations` — viajam dentro de `extraConfig`, e e de la que
 * buildConnectorConfig os le (server/erp/config.ts).
 *
 * apiUrl nao usa `.url()`: quem julga endereco de ERP e `validateErpUrl`, que
 * alem do formato barra HTTP e host privado (SSRF).
 */
const adminUpdateErpSchema = z.object({
  isEnabled: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
  apiUrl: z.string().max(500).nullable().optional(),
  apiToken: z.string().max(1000).nullable().optional(),
  apiUser: z.string().max(200).nullable().optional(),
  syncIntervalHours: z.number().int().min(1).max(720).optional(),
  clientId: z.string().max(200).nullable().optional(),
  clientSecret: z.string().max(500).nullable().optional(),
  mkContraSenha: z.string().max(200).nullable().optional(),
  extraConfig: z.record(z.string()).nullable().optional(),
}).strict();

/**
 * Quatro ERPs figuram no catalogo so para aparecer na lista: o conector deles
 * ainda nao fala com a API do fabricante e todo metodo devolve erro.
 *
 * A marca `naoImplementado` so fechava a porta da frente — a secao de adicionar
 * integracao da tela. Quem chegasse pela rota, ou quem ja tivesse uma linha
 * gravada de quando o painel do provedor aceitava qualquer fonte suportada,
 * seguia configurando: a integracao nascia "ativa", o provedor lia "Integrada",
 * as varreduras automaticas falhavam por construcao e, na terceira, o corte
 * automatico mandava ao PROVEDOR um e-mail dizendo que a integracao dele foi
 * pausada por falhas — de um ERP que nunca chegou a ser implementado. Ele abre
 * chamado, o suporte olha o ERP dele, e nao ha nada errado do lado dele.
 *
 * Devolve o nome do ERP para a mensagem; `null` quando o conector e real.
 */
function erpSemImplementacao(source: string): string | null {
  const connector = getConnector(source);
  return connector?.naoImplementado ? connector.label : null;
}

/**
 * O que o provedor le quando o cadastro e reprovado sem motivo escrito.
 *
 * "Seu cadastro foi reprovado", sozinho, transforma um problema resolvivel —
 * documento ilegivel, CNPJ com pendencia — numa porta sem macaneta. Se o
 * superadmin nao escreveu a razao, o e-mail ainda tem que dizer o que fazer.
 */
const MOTIVO_REPROVACAO_PADRAO =
  "Não foi informado um motivo específico. Revise os dados do cadastro e os documentos enviados no Painel do Provedor e reenvie para uma nova análise; se preferir, fale com o suporte para saber o que falta.";

/** O minimo do provedor que os avisos deste arquivo precisam ler. */
type ProvedorAvisavel = {
  id: number;
  name: string;
  contactEmail?: string | null;
  marcaId?: number | null;
  subdomain?: string | null;
  status?: string | null;
  verificationStatus?: string | null;
};

/**
 * Avisa o provedor sobre uma decisao do superadmin — e SO quando ela mudou algo.
 *
 * Analise de cadastro e suspensao de acesso sao decisoes que o provedor so
 * descobria batendo na tela de login. Cada uma tem uma mensagem propria; nenhuma
 * pode sair duas vezes pelo mesmo estado, por isso a comparacao com o valor
 * anterior acontece aqui e nao no e-mail.
 *
 * Nao lanca: o ato ja terminou quando esta funcao e chamada.
 */
async function avisarProvedorSobreDecisao(
  provedor: ProvedorAvisavel,
  anterior: ProvedorAvisavel,
  campos: { verificationStatus?: string; status?: string },
  motivo?: string,
): Promise<void> {
  const nomeDoProvedor = provedor.name;

  if (campos.verificationStatus && campos.verificationStatus !== anterior.verificationStatus) {
    if (campos.verificationStatus === "approved") {
      await avisarProvedor(
        provedor,
        (para, ctx) => sendCadastroAprovadoEmail(para, nomeDoProvedor, ctx.nome, ctx.marca, ctx.urlBase),
        "cadastro-aprovado",
      );
    } else if (campos.verificationStatus === "rejected") {
      await avisarProvedor(
        provedor,
        (para, ctx) => sendCadastroReprovadoEmail(
          para, nomeDoProvedor, ctx.nome, motivo || MOTIVO_REPROVACAO_PADRAO, ctx.marca, ctx.urlBase,
        ),
        "cadastro-reprovado",
      );
    }
  }

  if (campos.status && campos.status !== anterior.status) {
    if (campos.status === "suspended") {
      await avisarProvedor(
        provedor,
        (para, ctx) => sendAcessoSuspensoEmail(para, nomeDoProvedor, ctx.nome, motivo, ctx.marca, ctx.urlBase),
        "acesso-suspenso",
      );
    } else if (campos.status === "active" && anterior.status === "suspended") {
      // So de "suspended" para "active" e restabelecimento. Sair de
      // "cancelled" e outra historia comercial, e "seu acesso voltou" seria a
      // mensagem errada para ela.
      await avisarProvedor(
        provedor,
        (para, ctx) => sendAcessoReativadoEmail(para, nomeDoProvedor, ctx.nome, ctx.marca, ctx.urlBase),
        "acesso-reativado",
      );
    }
  }
}

/** Nome de quem criou o acesso; sem ele o e-mail assina a plataforma. */
async function nomeDeQuemCriou(userId?: number): Promise<string> {
  if (!userId) return "Administrador do Sistema";
  try {
    const autor = await storage.getUser(userId);
    return autor?.name || "Administrador do Sistema";
  } catch {
    return "Administrador do Sistema";
  }
}

/**
 * Avisa a PESSOA que acabou de ganhar acesso — nao o contato do provedor.
 *
 * Por isso `avisarProvedor` nao serve aqui: o destinatario e um endereco
 * especifico, o do usuario criado. O que se aproveita de la e a resolucao de
 * marca e de endereco de entrada (`contextoDeEmail`), que continua sendo a do
 * PROVEDOR: quem entra por uma marca revendedora precisa do link daquela marca,
 * senao cai numa tela que recusa o login dele.
 *
 * Nao lanca: a conta ja foi criada quando este aviso sai.
 */
async function avisarUsuarioCriado(
  provedor: ProvedorAvisavel,
  usuario: { name: string; email: string },
  quemAdicionou: string,
): Promise<void> {
  try {
    const ctx = await contextoDeEmail(provedor);
    await sendUsuarioAdicionadoEmail(
      usuario.email, usuario.name, provedor.name, quemAdicionou, usuario.email, ctx.marca, ctx.urlBase,
    );
  } catch (err: any) {
    logger.error(
      { providerId: provedor.id, rotulo: "usuario-adicionado", err: err?.message },
      "[email] Falha ao avisar o usuario criado",
    );
  }
}

/**
 * Quanto a consulta custou, e de onde veio esse numero.
 *
 * A ISP grava o custo na coluna `cost`; a SPC e a cadastral gravam
 * `creditosCobrados` dentro do `result`. Linha anterior a esses campos nao tem
 * nenhum dos dois, e ai vale a tabela de precos de HOJE — que pode nao ser a
 * de ontem (o SPC ja custou 4 creditos e passou a 3 em 31/08/2026). Por isso o
 * numero nunca sai sozinho: `origem` diz se ele foi lido ou deduzido, e o
 * suporte so estorna com base em "gravado".
 */
function custoDaConsulta(linha: LinhaDeConsultaEncontrada): { creditos: number; origem: "gravado" | "tabela" } {
  if (linha.tipo === "isp" && typeof linha.cost === "number") {
    return { creditos: linha.cost, origem: "gravado" };
  }
  const gravado = (linha.result as any)?.creditosCobrados;
  if (typeof gravado === "number") return { creditos: gravado, origem: "gravado" };
  return { creditos: CUSTO_EM_CREDITOS[linha.tipo], origem: "tabela" };
}

/**
 * A linha do banco virando a ficha que o suporte ve.
 *
 * Esta funcao e o unico ponto por onde a consulta sai para o navegador, e e de
 * proposito que ela CONSTROI um objeto campo a campo em vez de espalhar a
 * linha com `...`. Espalhar levaria o `result` inteiro junto no dia em que
 * alguem acrescentasse uma coluna, sem ninguem perceber. Ver a nota de LGPD na
 * rota.
 */
function fichaDaConsulta(linha: LinhaDeConsultaEncontrada) {
  const custo = custoDaConsulta(linha);
  return {
    consultaId: linha.consultaId,
    tipo: linha.tipo,
    linhaId: linha.id,
    criadaEm: linha.criadaEm,
    provedor: { id: linha.providerId, nome: linha.providerName },
    usuario: { id: linha.userId, nome: linha.userName },
    /** Mascarado sempre: nem o superadmin precisa do documento inteiro aqui. */
    documento: maskCpfCnpj(linha.cpfCnpj, false),
    custoCreditos: custo.creditos,
    custoOrigem: custo.origem,
    desfecho: {
      score: linha.score,
      decisao: linha.decisionReco,
      veredito: linha.veredito,
      tipoDeBusca: linha.searchType,
      datasets: linha.datasets,
    },
    protocoloDaOrigem: protocoloDaOrigem(linha.tipo, linha.result),
  };
}

export function registerAdminRoutes(): Router {
  const router = Router();

  /**
   * Freio nas rotas de ERP do superadmin.
   *
   * Gravar credencial e barato, mas o teste de conexao dispara trafego de SAIDA
   * para a API de um terceiro: sem limite, um loop na tela do admin vira uma
   * enxurrada contra o ERP do provedor — que responde bloqueando o IP do
   * servidor, derrubando o sync de todo mundo naquele ERP.
   */
  const limiteConfigErp = createRateLimiter({ windowMs: 60_000, maxRequests: 60 });
  const limiteTesteErp = createRateLimiter({ windowMs: 60_000, maxRequests: 20 });

  router.get("/api/admin/stats", requireSuperAdmin, async (_req, res) => {
    try {
      const stats = await storage.getSystemStats();
      return res.json(stats);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/providers", requireSuperAdmin, async (_req, res) => {
    try {
      const withStats = await storage.getAllProvidersWithStats();
      return res.json(withStats);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // CNPJ lookup with 3 fallback sources
  /**
   * O cadastro publico de um CNPJ qualquer, para o superadmin preencher a
   * ficha de um provedor que ele esta criando ou corrigindo.
   *
   * As 110 linhas de parser das tres fontes sairam daqui para
   * `services/cnpj-publico.service.ts` em 04/09/2026: o PROVEDOR precisa do
   * mesmo dado para a propria ficha e tinha uma segunda implementacao no
   * navegador, com uma fonte so e sem queda. Duas copias do mesmo parser
   * divergem — a do client nem juntava o tipo do logradouro ao nome da rua.
   */
  router.get("/api/admin/cnpj/:cnpj", requireSuperAdmin, async (req, res) => {
    try {
      const cnpj = normalizarCnpj(String(req.params.cnpj));
      if (!cnpj) return res.status(400).json({ message: "CNPJ invalido" });

      const empresa = await consultarCnpjPublico(cnpj);
      if (!empresa) return res.status(404).json({ message: "CNPJ nao encontrado em nenhuma fonte" });

      return res.json(empresa);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  const createProviderSchema = z.object({
    name: z.string().min(1).max(200),
    tradeName: z.string().max(200).optional(),
    cnpj: z.string().regex(/^\d{14}$/, "CNPJ deve ter 14 digitos"),
    subdomain: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, "Subdominio: apenas letras minusculas, numeros e hifens"),
    // O catalogo tem dois planos desde 03/09/2026. Aceitar aqui uma chave que
  // saiu poria um provedor num plano sem preco e sem rotulo — a migracao 0014
  // moveu para `pro` quem estava em `basic` ou `enterprise`.
  plan: z.enum(["free", "pro"]).optional(),
    adminName: z.string().min(1).max(200),
    adminEmail: z.string().email().max(254),
    adminPassword: z.string().min(6).max(128),
    contactEmail: z.string().email().max(254).optional().nullable(),
    contactPhone: z.string().max(20).optional().nullable(),
    addressZip: z.string().max(10).optional().nullable(),
    addressStreet: z.string().max(200).optional().nullable(),
    addressNumber: z.string().max(20).optional().nullable(),
    addressComplement: z.string().max(100).optional().nullable(),
    addressNeighborhood: z.string().max(100).optional().nullable(),
    addressCity: z.string().max(100).optional().nullable(),
    addressState: z.string().max(2).optional().nullable(),
    legalType: z.string().max(50).optional().nullable(),
    openingDate: z.string().max(20).optional().nullable(),
    businessSegment: z.string().max(100).optional().nullable(),
  });

  router.post("/api/admin/providers", requireSuperAdmin, async (req, res) => {
    try {
      const parsed = createProviderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
      }
      const { name, tradeName, cnpj, subdomain, plan, adminName, adminEmail, adminPassword,
        contactEmail, contactPhone, addressZip, addressStreet, addressNumber,
        addressComplement, addressNeighborhood, addressCity, addressState,
        legalType, openingDate, businessSegment } = parsed.data;
      const existingCnpj = await storage.getProviderByCnpj(cnpj);
      if (existingCnpj) return res.status(409).json({ message: "CNPJ ja cadastrado" });
      const existingSubdomain = await storage.getProviderBySubdomain(subdomain);
      if (existingSubdomain) return res.status(409).json({ message: "Subdominio ja em uso" });
      const existingEmail = await storage.getUserByEmail(adminEmail);
      if (existingEmail) return res.status(409).json({ message: "Email do admin ja cadastrado" });

      const provider = await storage.createProvider({
        name, tradeName, cnpj, subdomain, plan: plan || "free", status: "active",
        contactEmail, contactPhone, addressZip, addressStreet, addressNumber,
        addressComplement, addressNeighborhood, addressCity, addressState,
        legalType, openingDate, businessSegment,
      });
      const user = await storage.createUser({
        name: adminName, email: adminEmail,
        password: await hashPassword(adminPassword),
        role: "admin", providerId: provider.id, emailVerified: true,
      });
      return res.status(201).json({ provider, user: { id: user.id, name: user.name, email: user.email } });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/admin/providers/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = adminUpdateProviderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
      }
      // `motivo` explica a decisao no e-mail; nao e coluna e nao pode ir ao storage.
      const { motivo, ...campos } = parsed.data;

      /**
       * Ler ANTES de gravar e o que torna o aviso honesto.
       *
       * Esta tela reenvia o PATCH inteiro a cada clique, e a lista de cadastros
       * tem botao "Aprovar" visivel para quem ja esta aprovado. Sem o valor
       * anterior, cada clique repetido mandaria de novo "seu cadastro foi
       * aprovado" ou "seu acesso foi suspenso" — e um aviso que chega duas
       * vezes ensina o provedor a ignorar o proximo.
       */
      const anterior = await storage.getProvider(id);
      if (!anterior) return res.status(404).json({ message: "Provedor nao encontrado" });

      const updated = await storage.adminUpdateProvider(id, campos);
      // A resolucao host->marca e cacheada por subdominio. Sem esta linha, uma
      // troca de subdominio ficava ate 5 minutos servindo a marca do dono
      // anterior naquele endereco.
      esquecerMarcas();
      // O status do provedor tambem e cacheado (30s) pelo requireProvider. Sem
      // esta linha, suspender demorava ate meia rodada de cache para valer nas
      // sessoes ja abertas — e reativar demorava o mesmo para devolver acesso.
      esquecerStatusDeProvedor(id);

      // O e-mail sai depois do ato, e nunca o derruba: `avisarProvedor` engole
      // a falha de envio com log. Quem recebe e o provedor DEPOIS da alteracao
      // — nome, contato e marca podem ter mudado neste mesmo PATCH — e o valor
      // anterior fica de base para o caso de o UPDATE devolver menos colunas do
      // que a linha inteira.
      const provedor = { ...anterior, ...(updated || {}) };
      await avisarProvedorSobreDecisao(provedor, anterior, campos, motivo);

      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/admin/providers/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      await storage.deleteProvider(id);
      return res.json({ message: "Provedor excluido com sucesso" });
    } catch (error: any) {
      /**
       * A recusa da trilha de suporte NAO e defeito, e defeito e o que se tenta
       * de novo.
       *
       * `deleteProvider` para antes do primeiro DELETE quando o provedor tem
       * historico de acesso de suporte: aquela tabela e a unica prova de quem
       * abriu o dado pessoal dos titulares deste provedor, e ela nao pode
       * evaporar junto com o que audita. Caindo no 500 generico abaixo, o
       * superadmin lia "Erro interno do servidor" — nada sobre o que aconteceu,
       * nada sobre o que fazer, e um convite a clicar mais uma vez.
       *
       * Compara pelo CODIGO e nao por `instanceof`: o storage e trocado por
       * duble em teste e por camada de acesso em producao, e um erro que
       * atravessa fronteira de modulo perde a identidade da classe antes de
       * perder o campo.
       *
       * 409 e nao 400: o pedido esta bem formado e a permissao existe — o que
       * impede e o ESTADO do provedor, e ele muda quando alguem tratar o
       * historico.
       */
      if (error?.codigo === CODIGO_PROVEDOR_COM_TRILHA_DE_SUPORTE) {
        return res.status(409).json({
          // A frase descreve o que EXISTE. A primeira versão mandava "exporte o
          // histórico antes de remover", e não há exportação nenhuma na tela —
          // instrução impossível de cumprir é pior do que nenhuma, porque o
          // operador procura o botão antes de acreditar que não tem.
          message:
            `Este provedor não pode ser excluído: existem ${error.acessos} registro(s) de acesso de suporte na trilha de auditoria. ` +
            `A trilha prova quem entrou na conta e abriu os dados dos clientes deste provedor, e precisa continuar existindo depois dele. ` +
            `Ela fica na aba Suporte da ficha deste provedor. Para excluir mesmo assim, a remoção precisa ser feita por quem administra o banco.`,
          code: CODIGO_PROVEDOR_COM_TRILHA_DE_SUPORTE,
          acessos: error.acessos,
        });
      }
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/providers/:id/resend-verification", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const users = await storage.getUsersByProvider(id);
      const adminUser = users.find(u => u.role === "admin");
      if (!adminUser) return res.status(404).json({ message: "Usuario administrador do provedor nao encontrado" });
      if (adminUser.emailVerified) return res.json({ message: "Email ja verificado." });
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await storage.setVerificationToken(adminUser.id, token, expiresAt);
      // Sem a marca e a url de entrada, o link cai na raiz da plataforma — que
      // e exatamente onde a prova de host recusa o login deste usuario. Mesmo
      // defeito que o cadastro tinha; esta porta do superadmin ficou de fora.
      const marca = await resolverMarcaPorId(provider.marcaId);
      await sendVerificationEmail(adminUser.email, adminUser.name, token, marca, urlDeEntrada(provider, marca));
      return res.json({ message: "Email de verificacao reenviado com sucesso." });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/providers/:id/plan", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { plan, notes } = req.body;
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const planoAnterior = provider.plan;
      const updated = await storage.updateProviderPlan(id, plan);
      await storage.createPlanChange({
        providerId: id, oldPlan: planoAnterior, newPlan: plan,
        ispCreditsAdded: 0, spcCreditsAdded: 0,
        changedById: req.session.userId, changedByName: "Administrador do Sistema",
        notes: notes || null,
      });

      /**
       * Plano igual ao anterior nao e alteracao: o superadmin reabre a tela,
       * confirma o mesmo plano e o registro em `plan_changes` continua sendo
       * gravado (e o log de quem mexeu), mas "seu plano foi alterado" seria
       * mentira.
       *
       * Os rotulos sao os do servidor (`ROTULO_DO_PLANO`) porque o provedor
       * comprou "Profissional", nao "pro" — a chave e nome de coluna, nao de
       * produto.
       */
      if (plan && plan !== planoAnterior) {
        const creditosDoPlano = PLAN_CREDITS[plan]?.isp ?? 0;
        await avisarProvedor(
          { ...provider, ...(updated || {}) },
          (para, ctx) => sendPlanoAlteradoEmail(para, ctx.nome, {
            de: ROTULO_DO_PLANO[planoAnterior] || planoAnterior,
            para: ROTULO_DO_PLANO[plan] || plan,
            creditosDoPlano,
            observacao: notes || null,
          }, ctx.marca, ctx.urlBase),
          "plano-alterado",
        );
      }

      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/providers/:id/credits", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { ispCredits = 0, spcCredits = 0, bigdataCredits = 0, notes } = req.body;
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const updated = await storage.addCredits(id, ispCredits, spcCredits, bigdataCredits);
      if (ispCredits !== 0 || spcCredits !== 0 || bigdataCredits !== 0) {
        const partes = [
          ispCredits !== 0 ? `ISP +${ispCredits}` : null,
          spcCredits !== 0 ? `SPC +${spcCredits}` : null,
          bigdataCredits !== 0 ? `Cadastral +${bigdataCredits}` : null,
        ].filter(Boolean).join(", ");
        await storage.createPlanChange({
          providerId: id, oldPlan: null, newPlan: null,
          ispCreditsAdded: ispCredits, spcCreditsAdded: spcCredits,
          bigdataCreditsAdded: bigdataCredits,
          changedById: req.session.userId, changedByName: "Administrador do Sistema",
          notes: notes || `Creditos adicionados: ${partes}`,
        });
      }
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/providers/:id/detail", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });

      const [users, customers, equipmentList, ispList, spcList, invoices, planHistory] = await Promise.all([
        storage.getUsersByProvider(id),
        storage.getCustomersByProvider(id),
        storage.getEquipmentByProvider(id),
        storage.getIspConsultationsByProvider(id),
        storage.getSpcConsultationsByProvider(id),
        storage.getAllProviderInvoices(id),
        storage.getPlanChanges(id),
      ]);

      const safeUsers = users.map(u => ({
        id: u.id, name: u.name, email: u.email, role: u.role,
        emailVerified: u.emailVerified, createdAt: u.createdAt,
      }));

      const now = new Date();
      const firstDayMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const ispMonth = ispList.filter(c => new Date(c.createdAt) >= firstDayMonth).length;
      const spcMonth = spcList.filter(c => new Date(c.createdAt) >= firstDayMonth).length;

      const totalPaid = invoices.filter(i => i.status === "paid").reduce((s, i) => s + parseFloat(i.amount), 0);
      const totalPending = invoices.filter(i => i.status === "pending").reduce((s, i) => s + parseFloat(i.amount), 0);
      const totalOverdue = invoices.filter(i => i.status === "overdue").reduce((s, i) => s + parseFloat(i.amount), 0);

      return res.json({
        provider,
        users: safeUsers,
        stats: {
          customers: customers.length,
          equipment: equipmentList.length,
          ispConsultations: ispList.length,
          spcConsultations: spcList.length,
          ispConsultationsMonth: ispMonth,
          spcConsultationsMonth: spcMonth,
        },
        invoices,
        planHistory,
        financial: { totalPaid, totalPending, totalOverdue },
        recentIsp: ispList.slice(0, 20),
        // O XML cru do SPC (PII de terceiros, ate MBs) fica no banco: a tela
        // do admin mostra tres colunas.
        recentSpc: spcList.slice(0, 20).map((c: any) => {
          const { rawXml: _xml, ...result } = (c.result ?? {}) as Record<string, unknown>;
          return { ...c, result };
        }),
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/providers/:id/integration", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      /**
       * A leitura marcada, e nao `getErpIntegrations`.
       *
       * Aquela decifra com a variante que LANCA quando a credencial nao abre
       * (SESSION_SECRET trocado, base restaurada de outro ambiente), e uma
       * unica linha assim derrubava a aba inteira com 500 — nem as linhas
       * sadias, nem o formulario. Esta e a tela que existe para redigitar a
       * credencial quebrada: ela nao pode morrer pelo defeito que conserta.
       * A linha que nao abriu vem com `credencialIlegivel` para a tela pedir
       * que seja redigitada, em vez de mostrar campo vazio.
       */
      const [token, integrations, logs] = await Promise.all([
        storage.getProviderWebhookToken(id),
        storage.getErpIntegracoesParaAdmin(id),
        storage.getErpSyncLogs(id, undefined, 20),
      ]);
      return res.json({ token, integrations, logs });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * A configuracao de ERP mora AQUI, e so aqui.
   *
   * O painel do provedor virou exibicao: quem grava credencial de ERP e o
   * superadmin. Por isso esta rota grava o registro inteiro — inclusive os
   * campos que so alguns conectores usam — e nao mais um recorte de tres
   * colunas.
   *
   * `parsed.data` vai ao storage como veio: chave ausente e chave que nao se
   * quer mexer. A versao anterior mandava `apiUrl ?? null` e companhia, entao
   * salvar so o `isEnabled` apagava a credencial que estava funcionando.
   */
  router.put("/api/admin/providers/:id/erp/:source", requireSuperAdmin, limiteConfigErp, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Provedor invalido" });
      const source = String(req.params.source);
      const ALLOWED = getSupportedSources();
      if (!ALLOWED.includes(source)) return res.status(400).json({ message: "ERP invalido" });
      // Depois do "existe?" e antes de qualquer leitura de credencial: um ERP
      // inexistente tem que continuar sendo invalido, nao "nao implementado".
      const semImplementacao = erpSemImplementacao(source);
      if (semImplementacao) {
        return res.status(400).json({
          message: `Ainda não é possível configurar a integração com o ${semImplementacao}: o conector não conversa com a API do ${semImplementacao}, então salvar estas credenciais criaria uma integração que nunca sincroniza.`,
        });
      }
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const parsed = adminUpdateErpSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
      }
      if (parsed.data.apiUrl) {
        const { validateErpUrl } = await import("../utils/url-validator");
        const urlCheck = validateErpUrl(parsed.data.apiUrl);
        if (!urlCheck.valid) {
          return res.status(400).json({ message: urlCheck.reason });
        }
      }
      /**
       * Religar tem que limpar a marca de pausa — salvar credencial, nao.
       *
       * A pausa por falhas mora em `status = "pausado_por_falhas"`, e desde que
       * `registrarResultadoSync` preserva essa coluna, ninguem mais a apaga
       * sozinho. Sem o que vem abaixo, religar deixava `is_enabled = true` com a
       * marca de pausa junto: o painel do provedor testa o status ANTES do
       * isEnabled e seguia anunciando "pausada por falhas" numa integracao que
       * ja voltava a sincronizar.
       *
       * `status` NAO entra no Zod de entrada de proposito: quem decide o estado
       * da integracao e o servidor, nunca o corpo da requisicao.
       *
       * Integracao que ainda NAO existe nao esta sendo religada — nao ha marca a
       * limpar nem falha a esquecer —, e integracao que ja estava ligada tampouco:
       * gravar reativacao a cada "Salvar" encheria o historico de reativacao
       * falsa e zeraria a contagem de falhas sem motivo.
       */
      /**
       * O RESUMO, e nao `getErpIntegrations`: aqui so se quer saber se a linha
       * existe e se ela esta ligada, e o resumo responde isso sem DECIFRAR nada.
       *
       * `getErpIntegrations` passa por `decryptIntegration`, que LANCA quando a
       * credencial nao abre — SESSION_SECRET trocado, base restaurada de outro
       * ambiente. Ler por ali faria este PUT devolver 500 antes do upsert, e
       * esta e justamente a tela que existe para redigitar a credencial
       * quebrada: o unico caminho de conserto morreria pelo defeito que ele
       * conserta.
       */
      const integracoes = await storage.getErpIntegracoesResumo(id);
      const atual = integracoes.find(i => i.erpSource === source);
      const religando = parsed.data.isEnabled === true && !!atual && !atual.isEnabled;

      const dados: Record<string, unknown> = religando
        ? { ...parsed.data, status: "idle" }
        : { ...parsed.data };
      const integration = await storage.upsertErpIntegration(id, source, dados as any);

      if (religando) {
        /**
         * A linha "reativado" e o batente de `contarFalhasConsecutivas`, que
         * varre os logs do mais recente para tras e para na primeira que nao e
         * erro. Sem ela, as tres falhas que causaram a pausa continuam no
         * historico e a tolerancia de 3 vira 1 para sempre.
         *
         * Falhar aqui nao pode derrubar o PUT: a credencial ja foi gravada.
         */
        try {
          await storage.registrarReativacao(id, source);
        } catch (err: any) {
          logger.error(
            { providerId: id, erpSource: source, err: err?.message },
            "[erp] Falha ao registrar a reativacao da integracao",
          );
        }
      }
      return res.json(integration);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * Testa a conexao de UM ERP nomeado na URL.
   *
   * A rota anterior (`POST /:id/erp-test`, sem `:source`) pegava com `find()` a
   * primeira integracao habilitada do provedor e montava a config a mao com
   * `extra: {}` — descartando clientId, clientSecret, mkContraSenha e
   * extraConfig. Em MK, Hubsoft, SGP e Voalle o teste falhava por construcao e o
   * erro chegava na tela como "credencial invalida", mandando o operador trocar
   * uma credencial que estava certa. Aqui a config sai de `buildConnectorConfig`,
   * a mesma que o sync usa.
   */
  router.post("/api/admin/providers/:id/erp/:source/test", requireSuperAdmin, limiteTesteErp, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: "Provedor invalido" });
      const source = String(req.params.source);
      const connector = getConnector(source);
      if (!connector) {
        return res.status(400).json({ ok: false, message: "ERP nao suportado" });
      }
      // Mesma guarda do PUT, pelo mesmo motivo: testar um conector que nao fala
      // com o ERP so devolveria o erro que ele devolve sempre, e o operador
      // leria isso como credencial errada.
      const semImplementacao = erpSemImplementacao(source);
      if (semImplementacao) {
        return res.status(400).json({
          ok: false,
          message: `Ainda não é possível testar a integração com o ${semImplementacao}: o conector não conversa com a API do ${semImplementacao}, então não há conexão a testar.`,
        });
      }
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ ok: false, message: "Provedor nao encontrado" });
      const integrations = await storage.getErpIntegrations(id);
      const intg = integrations.find(i => i.erpSource === source);
      if (!intg?.apiUrl || !intg?.apiToken) {
        return res.status(400).json({ ok: false, message: "Configure a URL e o token antes de testar" });
      }
      const config = buildConnectorConfig(intg);
      const result = await connector.testConnection(config);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/users", requireSuperAdmin, async (_req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const safe = allUsers.map(u => ({
        id: u.id, name: u.name, email: u.email, role: u.role,
        providerId: u.providerId, emailVerified: u.emailVerified, createdAt: u.createdAt,
      }));
      return res.json(safe);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/admin/users/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ message: "Usuario invalido" });
      }
      // Exclusao aqui e DEFINITIVA (hard delete). Duas travas contra o tiro no
      // pe que nao tem volta pela interface: um superadmin apagando a si mesmo
      // ou o unico outro superadmin deixa a plataforma sem quem administre, e
      // so um acesso direto ao banco recupera.
      if (id === req.session.userId) {
        return res.status(409).json({ message: "Voce nao pode excluir a propria conta" });
      }
      const alvo = await storage.getUser(id);
      if (!alvo) {
        return res.status(404).json({ message: "Usuario nao encontrado" });
      }
      if (alvo.role === "superadmin") {
        return res.status(409).json({ message: "Conta de administrador do sistema nao pode ser excluida por aqui" });
      }
      try {
        await storage.deleteUser(id);
      } catch (erro: any) {
        // Mesmo 23503 que a rota do provedor ja traduz: operador com consulta
        // gravada nao pode ser apagado, porque o historico e do provedor. Sem
        // esta traducao o superadmin recebia "Erro interno do servidor" e
        // tentava de novo — a porta do superadmin ficou de fora da correcao
        // original por estar em outro arquivo.
        const codigo = erro?.code ?? erro?.cause?.code;
        if (codigo === "23503") {
          return res.status(409).json({
            message: "Este usuario ja tem historico no sistema (consultas ou mensagens de suporte) e por isso nao pode ser apagado — o historico e do provedor e nao pode ir junto.",
            code: "USUARIO_COM_HISTORICO",
          });
        }
        throw erro;
      }
      return res.json({ message: "Usuario removido" });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/admin/users/:id/email", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { email } = req.body;
      if (!email || typeof email !== "string" || !email.includes("@")) {
        return res.status(400).json({ message: "Email invalido" });
      }
      const targetUser = await storage.getUser(id);
      if (!targetUser) {
        return res.status(404).json({ message: "Usuario nao encontrado" });
      }
      const existing = await storage.getUserByEmail(email.trim().toLowerCase());
      if (existing && existing.id !== id) {
        return res.status(409).json({ message: "Este email ja esta em uso por outro usuario" });
      }
      await storage.updateUserEmail(id, email.trim().toLowerCase());
      return res.json({ message: "Email atualizado com sucesso" });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // Superadmin creates user for a specific provider (CRUD-02)
  router.post("/api/admin/providers/:id/users", requireSuperAdmin, async (req, res) => {
    try {
      const providerId = parseInt(req.params.id);
      const { name, email, password, role } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({ message: "Nome, email e senha sao obrigatorios" });
      }

      const validRoles = ["admin", "user"];
      const userRole = validRoles.includes(role) ? role : "user";

      const provider = await storage.getProvider(providerId);
      if (!provider) {
        return res.status(404).json({ message: "Provedor nao encontrado" });
      }

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "Email ja cadastrado" });
      }

      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        name,
        email,
        password: hashedPassword,
        role: userRole,
        providerId,
      });

      // Quem foi criado precisa saber que existe um acesso no nome dele, e por
      // qual endereco entrar. A SENHA NAO VAI NO E-MAIL — quem criou a entrega
      // por outro canal, ou o novo usuario usa "Esqueci minha senha".
      await avisarUsuarioCriado(provider, user, await nomeDeQuemCriou(req.session.userId));

      const { password: _, ...userWithoutPassword } = user;
      return res.status(201).json(userWithoutPassword);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/plan-history", requireSuperAdmin, async (req, res) => {
    try {
      const providerId = req.query.providerId ? parseInt(req.query.providerId as string) : undefined;
      const changes = await storage.getPlanChanges(providerId);
      return res.json(changes);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ---- Admin document review ----

  router.patch("/api/admin/providers/:id/documents/:docId/status", requireSuperAdmin, async (req, res) => {
    try {
      const docId = parseInt(req.params.docId);
      const { status, rejectionReason } = req.body;
      if (!["approved", "rejected", "pending"].includes(status)) {
        return res.status(400).json({ message: "Status invalido" });
      }
      const reviewer = await storage.getUser(req.session.userId!);
      const updated = await storage.updateProviderDocumentStatus(
        docId, status,
        req.session.userId!, reviewer?.name || "Admin",
        rejectionReason
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/providers/:id/documents", requireSuperAdmin, async (req, res) => {
    try {
      const providerId = parseInt(req.params.id);
      const docs = await storage.getProviderDocuments(providerId);
      const docsNoData = docs.map(({ fileData, ...rest }) => rest);
      return res.json(docsNoData);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/providers/:id/documents/:docId/download", requireSuperAdmin, async (req, res) => {
    try {
      const docId = parseInt(req.params.docId);
      const doc = await storage.getProviderDocument(docId);
      if (!doc) return res.status(404).json({ message: "Documento nao encontrado" });
      const buffer = Buffer.from(doc.fileData.split(",")[1] || doc.fileData, "base64");
      res.setHeader("Content-Type", doc.documentMimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(doc.documentName)}"`);
      return res.send(buffer);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ---- ERP Catalog admin CRUD ----

  router.post("/api/admin/erp-catalog", requireSuperAdmin, async (req, res) => {
    try {
      const { insertErpCatalogSchema } = await import("@shared/schema");
      const data = insertErpCatalogSchema.parse(req.body);
      const item = await storage.createErpCatalogItem(data);
      return res.status(201).json(item);
    } catch (error: any) {
      return res.status(400).json({ message: getSafeErrorMessage(error) });
    }
  });

  const erpCatalogUpdateSchema = z.object({
    key: z.string().min(1).max(50).optional(),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional().nullable(),
    logoBase64: z.string().optional().nullable(),
    gradient: z.string().max(100).optional(),
    active: z.boolean().optional(),
    authType: z.string().max(50).optional(),
    authHint: z.string().max(500).optional().nullable(),
  });

  router.patch("/api/admin/erp-catalog/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = erpCatalogUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
      }
      const item = await storage.updateErpCatalogItem(id, parsed.data);
      return res.json(item);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/admin/erp-catalog/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteErpCatalogItem(id);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ── V-09 LGPD: Titular request stats ──────────────────────
  router.get("/api/admin/titular-requests/stats", requireSuperAdmin, async (_req, res) => {
    try {
      const all = await db.select().from(titularRequests);
      const now = new Date();

      let pendente = 0, em_andamento = 0, concluido = 0, recusado = 0, slaRisco = 0;

      for (const r of all) {
        if (r.status === "pendente") pendente++;
        else if (r.status === "em_andamento") em_andamento++;
        else if (r.status === "concluido") concluido++;
        else if (r.status === "recusado") recusado++;

        if (r.status === "pendente" || r.status === "em_andamento") {
          const created = r.createdAt ? new Date(r.createdAt) : now;
          const daysSince = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
          const businessDays = Math.floor(daysSince * 5 / 7);
          if (businessDays >= 12) slaRisco++;
        }
      }

      return res.json({ pendente, em_andamento, concluido, recusado, slaRisco, total: all.length });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ── V-09 LGPD: Titular request management ──────────────────────
  router.get("/api/admin/titular-requests", requireSuperAdmin, async (_req, res) => {
    try {
      const requests = await db.select().from(titularRequests).orderBy(desc(titularRequests.createdAt));

      // Highlight requests approaching the 15 business day deadline
      const now = new Date();
      const enriched = requests.map(r => {
        const created = r.createdAt ? new Date(r.createdAt) : now;
        const daysSinceCreation = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
        // Approximate business days (exclude weekends)
        const businessDays = Math.floor(daysSinceCreation * 5 / 7);
        const nearDeadline = businessDays >= 12 && r.status !== "concluido" && r.status !== "recusado";
        const overdue = businessDays >= 15 && r.status !== "concluido" && r.status !== "recusado";
        return { ...r, businessDays, nearDeadline, overdue };
      });

      return res.json(enriched);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/titular-requests/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const [request] = await db.select().from(titularRequests).where(eq(titularRequests.id, id));
      if (!request) {
        return res.status(404).json({ message: "Solicitacao nao encontrada" });
      }
      return res.json(request);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  const titularStatusSchema = z.object({
    status: z.enum(["pendente", "em_andamento", "concluido", "recusado"]),
  });

  router.patch("/api/admin/titular-requests/:id/status", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const parsed = titularStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Status invalido. Valores aceitos: pendente, em_andamento, concluido, recusado" });
      }

      const [existing] = await db.select().from(titularRequests).where(eq(titularRequests.id, id));
      if (!existing) {
        return res.status(404).json({ message: "Solicitacao nao encontrada" });
      }

      let executionResult: Record<string, any> | undefined;

      // LGPD Art. 18: When completing a request, execute the action automatically
      if (parsed.data.status === "concluido") {
        const cpf = existing.cpfCnpj;

        if (existing.tipoSolicitacao === "exclusao" || existing.tipoSolicitacao === "revogacao") {
          // Anonymize all consultation records for this CPF
          const anonymized = await db.execute(sql`
            UPDATE isp_consultations SET cpf_cnpj = 'ANONIMIZADO', cpf_cnpj_hash = NULL,
            result = jsonb_build_object('anonimizado', true, 'motivo', 'LGPD Art. 18 - exclusao', 'protocolo', ${existing.protocolo})
            WHERE cpf_cnpj = ${cpf} AND cpf_cnpj != 'ANONIMIZADO'
          `);
          const spcAnonymized = await db.execute(sql`
            UPDATE spc_consultations SET cpf_cnpj = 'ANONIMIZADO',
            result = jsonb_build_object('anonimizado', true, 'motivo', 'LGPD Art. 18 - exclusao', 'protocolo', ${existing.protocolo})
            WHERE cpf_cnpj = ${cpf} AND cpf_cnpj != 'ANONIMIZADO'
          `);
          executionResult = { action: "exclusao", cpfAnonymized: cpf, ispRecords: anonymized.rowCount || 0, spcRecords: spcAnonymized.rowCount || 0 };
        }

        if (existing.tipoSolicitacao === "acesso" || existing.tipoSolicitacao === "portabilidade") {
          // Export all consultation records for this CPF
          const ispRecords = await db.execute(sql`
            SELECT id, provider_id, search_type, score, decision_reco, cost, created_at
            FROM isp_consultations WHERE cpf_cnpj = ${cpf}
          `);
          const spcRecords = await db.execute(sql`
            SELECT id, provider_id, score, created_at
            FROM spc_consultations WHERE cpf_cnpj = ${cpf}
          `);
          executionResult = {
            action: existing.tipoSolicitacao,
            cpf,
            exportDate: new Date().toISOString(),
            ispConsultations: ispRecords.rows || [],
            spcConsultations: spcRecords.rows || [],
          };
        }
      }

      const [updated] = await db.update(titularRequests)
        .set({
          status: parsed.data.status,
          updatedBy: req.session.userId!,
          updatedAt: new Date(),
          ...(executionResult ? { executionResult } : {}),
        })
        .where(eq(titularRequests.id, id))
        .returning();

      // Send completion email when status changes to concluido
      if (parsed.data.status === "concluido" && existing.email) {
        const summary = executionResult
          ? `Acao: ${executionResult.action || existing.tipoSolicitacao}. Processamento concluido.`
          : "Solicitacao concluida pelo administrador.";
        sendCompletionEmail(existing.email, existing.protocolo, existing.tipoSolicitacao, summary).catch(() => {});
      }

      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * Resolve um codigo de parceiro de volta ao provedor — so o controlador.
   * O codigo e pareado por observador, entao o par (observador, codigo) e o
   * que resolve; nunca se tenta contra outros observadores, o que faria do
   * resolvedor um oraculo. Motivo obrigatorio e log estruturado: e a trilha.
   */
  const resolverCodigoSchema = z.object({
    /** Sem observador, o codigo e tratado como "seu codigo" (o proprio). */
    viewerProviderId: z.number().int().positive().optional(),
    code: z.string().trim().min(6).max(20),
    motivo: z.string().trim().min(5).max(500),
  });

  router.post("/api/admin/partner-code/resolve", requireSuperAdmin, async (req, res) => {
    try {
      const parsed = resolverCodigoSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message || "Pedido inválido" });
      }
      const { viewerProviderId, code, motivo } = parsed.data;
      const normalizado = normalizePartnerCode(code);
      if (!normalizado) {
        return res.status(400).json({ message: "Código inválido — ou do esquema anterior (ISP-#XXXXL), que não se resolve; consulte a linha gravada pelo id." });
      }

      // Sem observador, e "seu codigo" (o proprio) que se resolve, entre todos
      // os provedores. Com observador, e o codigo pareado que ele ve.
      const todos = (await storage.getAllProviders()).map(p => p.id);
      let resolvido: { subjectProviderId: number; keyVersion: string } | null = null;
      let tipo: "proprio" | "parceiro" = "parceiro";
      if (viewerProviderId == null) {
        const proprio = resolveOwnCode(normalizado, todos);
        if (proprio) {
          resolvido = { subjectProviderId: proprio.providerId, keyVersion: proprio.keyVersion };
          tipo = "proprio";
        }
      } else {
        const regionais = await getRegionalProviderIds(viewerProviderId);
        resolvido = resolvePartnerCode(viewerProviderId, normalizado, regionais)
          ?? resolvePartnerCode(viewerProviderId, normalizado, todos);
      }

      logger.info(
        {
          superadminUserId: req.session.userId,
          viewerProviderId: viewerProviderId ?? null,
          tipo,
          code: normalizado,
          motivo,
          resolvedProviderId: resolvido?.subjectProviderId ?? null,
          keyVersion: resolvido?.keyVersion ?? null,
        },
        "partner-code resolvido",
      );

      if (!resolvido) {
        return res.status(404).json({
          message: viewerProviderId == null
            ? "Nenhum provedor tem este código próprio."
            : "Nenhum provedor corresponde a este código para este observador.",
        });
      }
      const provider = await storage.getProvider(resolvido.subjectProviderId);
      return res.json({ tipo, providerId: resolvido.subjectProviderId, name: provider?.name ?? null, keyVersion: resolvido.keyVersion });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ── A busca do suporte pelo codigo da consulta ─────────────────────────────

  /**
   * O que o suporte pode ver de uma consulta de OUTRO provedor.
   *
   * Esta rota entrega, a quem tem um codigo, uma consulta de qualquer tenant.
   * Por isso ela devolve a FICHA e nao a consulta: metadados que permitem agir
   * (quem consultou, quando, quanto custou, qual foi o desfecho, que protocolo
   * apresentar ao bureau) e nada do relatorio.
   *
   * O `result` NAO SAI. Ele e o relatorio de credito de um titular — nome,
   * endereco, telefone, renda, restricoes, processos. Nenhum chamado de
   * suporte precisa disso: "a consulta CI-2609-K7F3M2 deu erro" se resolve
   * sabendo se a linha existe, o que ela decidiu e a quem escalar. Devolver o
   * corpo transformaria o codigo — que circula por e-mail, WhatsApp e ticket —
   * numa chave de leitura do dado pessoal de terceiro.
   *
   * O documento sai MASCARADO (`123.***.***-**`, o mesmo `maskCpfCnpj` que ja
   * governa o que cruza provedor). Ele sai porque o suporte precisa confirmar
   * que esta olhando a consulta certa — o provedor diz "consultei o CPF que
   * comeca com 123" — e os tres primeiros digitos bastam para isso sem
   * identificar ninguem.
   *
   * Os campos que nao sao obvios, um a um:
   * - `usuario` (id e nome): quem operou. E funcionario do provedor, nao
   *   titular do dado consultado, e e a primeira pergunta de todo chamado.
   * - `desfecho.tipoDeBusca` (ISP: "cpf" ou "cep"): consulta por endereco nao
   *   parte de documento; sem isso o suporte estranha o documento vazio.
   * - `desfecho.datasets` (cadastral): quais blocos foram pedidos a
   *   BigDataCorp. E configuracao de produto, nao dado de pessoa, e e o que
   *   explica um relatorio que voltou sem um bloco.
   * - `custoOrigem`: se o custo saiu da linha gravada ou da tabela de precos
   *   de hoje. Linha antiga sem custo gravado ganharia o preco atual, e o SPC
   *   ja custou 4 creditos — devolver "3" para uma consulta de agosto induziria
   *   estorno errado.
   */
  /**
   * O codigo viaja na QUERY STRING, e nao no caminho.
   *
   * O log de acesso registra `req.path` de toda requisicao /api
   * (server/index.ts:107) — e `req.path` NAO inclui a query. Com o codigo no
   * caminho, o texto que a pessoa do suporte colasse na busca ia direto para o
   * log: a caixa aceita texto livre, e o engano mais provavel de quem atende e
   * colar ali o CPF que o provedor acabou de ditar. Seria dado pessoal entrando
   * no log exatamente pela porta que existe para tira-lo de la.
   */
  router.get("/api/admin/consultas", requireSuperAdmin, async (req, res) => {
    // Fora do try: o codigo normalizado entra em toda linha de log deste
    // handler, inclusive na do erro inesperado.
    let normalizado: string | null = null;
    try {
      // `req.query` pode vir como array ou objeto aninhado; o que nao for texto
      // simples nao casa com o formato e cai no 400 de baixo.
      const bruto = req.query.codigo;
      const digitado = typeof bruto === "string" ? bruto : "";
      normalizado = normalizarIdentificador(digitado);

      if (!normalizado) {
        // O que a pessoa digitou NAO vai para o log. A caixa de busca aceita
        // texto livre, e o engano mais provavel de quem atende e colar ali o
        // CPF que o provedor acabou de ditar — gravar isso poria dado pessoal
        // no log justamente pela porta que existe para tira-lo de la.
        logger.warn(
          { superadminUserId: req.session.userId, tamanhoDigitado: digitado.length },
          "busca de consulta recusada: codigo fora do formato",
        );
        return res.status(400).json({
          message: "Código inválido. O formato é CI-AAMM-XXXXXX (exemplo: CI-2609-K7F3M2), "
            + "e o alfabeto não tem 0, 1, I, O nem U.",
        });
      }

      const achadas = await storage.buscarConsultasPorCodigo(normalizado);

      if (achadas.length === 0) {
        logger.info(
          { consultaId: normalizado, superadminUserId: req.session.userId },
          "busca de consulta sem resultado",
        );
        return res.status(404).json({
          consultaId: normalizado,
          message: "Nenhuma consulta gravada com este código. Ele pode ser de uma consulta que "
            + "falhou antes de gravar a linha — saldo insuficiente, bureau fora do ar, erro do "
            + "servidor — e nesse caso existe apenas no log do servidor: procure pelo campo "
            + "consultaId no log do dia da consulta.",
        });
      }

      if (achadas.length > 1) {
        // O indice unico e por tabela, entao duas tabelas podem, em tese,
        // guardar o mesmo codigo. Uma requisicao grava em uma so, entao isso e
        // defeito — colisao do sorteio ou codigo reaproveitado. Fica no log em
        // vez de sumir: quem atende ve a primeira e o dev ve que houve duas.
        logger.error(
          {
            consultaId: normalizado,
            superadminUserId: req.session.userId,
            tipos: achadas.map(a => a.tipo),
            linhas: achadas.map(a => a.id),
          },
          "codigo de consulta repetido em mais de uma tabela",
        );
      }

      const linha = achadas[0];
      logger.info(
        {
          consultaId: normalizado,
          superadminUserId: req.session.userId,
          tipo: linha.tipo,
          linhaId: linha.id,
          // Trilha de acesso: um superadmin abriu a ficha de uma consulta
          // deste provedor. Sem o id nao se sabe de quem era a consulta lida.
          providerId: linha.providerId,
        },
        "consulta localizada pelo codigo",
      );

      return res.json(fichaDaConsulta(linha));
    } catch (error: any) {
      logger.error({ err: error, consultaId: normalizado }, "erro ao buscar consulta pelo codigo");
      return res.status(500).json({ consultaId: normalizado, message: getSafeErrorMessage(error) });
    }
  });

  /**
   * Diagnostico da integracao SPC — operacao listarProdutos, gratuita e so
   * em producao: prova a credencial sem gastar consulta e mostra o que o
   * produto configurado (SPC_PRODUCT_CODE) devolve.
   */
  router.get("/api/admin/spc/produtos", requireSuperAdmin, async (_req, res) => {
    try {
      if (!isSpcConfigured()) {
        return res.status(503).json({ configurado: false, message: "SPC_USERNAME e SPC_PASSWORD não definidos" });
      }
      const produtos = await listarProdutosSpc();
      const padrao = produtoSpcPadrao();
      return res.json({
        configurado: true,
        produtoPadrao: padrao,
        produtoPadraoDisponivel: produtos.some(p => p.codigo === padrao),
        produtos,
      });
    } catch (error: any) {
      if (error instanceof SpcError) {
        return res.status(statusHttpParaErroSpc(error)).json({ configurado: true, message: error.message, categoria: error.categoria });
      }
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
