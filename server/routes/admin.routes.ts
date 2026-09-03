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
import "../erp/index";
import { getSafeErrorMessage } from "../utils/safe-error";
import { sanitizeFilename } from "../utils/filename-sanitizer";
import { db } from "../db";
import { titularRequests } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";
import { sendCompletionEmail } from "../services/lgpd-email.service";
import { normalizePartnerCode, resolvePartnerCode, resolveOwnCode } from "../utils/provider-anonymizer";
import { isSpcConfigured, listarProdutosSpc, produtoSpcPadrao, SpcError, statusHttpParaErroSpc } from "../services/spc/spc.service";
import { getRegionalProviderIds } from "../services/regional.service";
import { logger } from "../logger";

const adminUpdateProviderSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  tradeName: z.string().max(200).nullable().optional(),
  cnpj: z.string().regex(/^\d{14}$/).optional(),
  plan: z.enum(["free", "basic", "pro", "enterprise"]).optional(),
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

const adminUpdateErpSchema = z.object({
  apiUrl: z.string().url().max(500).nullable().optional(),
  apiToken: z.string().max(1000).nullable().optional(),
  apiUser: z.string().max(200).nullable().optional(),
  isEnabled: z.boolean().optional(),
}).strict();

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

export function registerAdminRoutes(): Router {
  const router = Router();

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
  router.get("/api/admin/cnpj/:cnpj", requireSuperAdmin, async (req, res) => {
    try {
      const cnpj = String(req.params.cnpj).replace(/\D/g, "");
      if (cnpj.length !== 14) return res.status(400).json({ message: "CNPJ invalido" });

      // Try sources in order: ReceitaWS → BrasilAPI → CNPJ.ws
      const sources = [
        {
          name: "ReceitaWS",
          url: `https://receitaws.com.br/v1/cnpj/${cnpj}`,
          parse: (d: any) => ({
            razaoSocial: d.nome || "",
            nomeFantasia: d.fantasia || "",
            cnpj: d.cnpj?.replace(/\D/g, "") || cnpj,
            naturezaJuridica: d.natureza_juridica || "",
            dataAbertura: d.abertura || "",
            atividadePrincipal: d.atividade_principal?.[0]?.text || "",
            telefone: d.telefone || "",
            email: d.email || "",
            cep: d.cep?.replace(/\D/g, "") || "",
            logradouro: d.logradouro || "",
            numero: d.numero || "",
            complemento: d.complemento || "",
            bairro: d.bairro || "",
            cidade: d.municipio || "",
            uf: d.uf || "",
            situacao: d.situacao || "",
            socios: (d.qsa || []).map((s: any) => ({
              nome: s.nome || "",
              qualificacao: s.qual || "",
              cpf: "",
            })),
          }),
        },
        {
          name: "BrasilAPI",
          url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
          parse: (d: any) => ({
            razaoSocial: d.razao_social || "",
            nomeFantasia: d.nome_fantasia || "",
            cnpj: d.cnpj || cnpj,
            naturezaJuridica: d.natureza_juridica || "",
            dataAbertura: d.data_inicio_atividade || "",
            atividadePrincipal: d.cnae_fiscal_descricao || "",
            telefone: d.ddd_telefone_1 ? `(${d.ddd_telefone_1.slice(0, 2)}) ${d.ddd_telefone_1.slice(2)}` : "",
            email: d.email || "",
            cep: d.cep || "",
            logradouro: d.logradouro || "",
            numero: d.numero || "",
            complemento: d.complemento || "",
            bairro: d.bairro || "",
            cidade: d.municipio || "",
            uf: d.uf || "",
            situacao: d.descricao_situacao_cadastral || "",
            socios: (d.qsa || []).map((s: any) => ({
              nome: s.nome_socio || "",
              qualificacao: s.qualificacao_socio || "",
              cpf: s.cnpj_cpf_do_socio || "",
            })),
          }),
        },
        {
          name: "Publica",
          url: `https://publica.cnpj.ws/cnpj/${cnpj}`,
          parse: (d: any) => ({
            razaoSocial: d.razao_social || "",
            nomeFantasia: d.estabelecimento?.nome_fantasia || "",
            cnpj: cnpj,
            naturezaJuridica: d.natureza_juridica?.descricao || "",
            dataAbertura: d.estabelecimento?.data_inicio_atividade || "",
            atividadePrincipal: d.estabelecimento?.atividade_principal?.descricao || "",
            telefone: d.estabelecimento?.ddd1 && d.estabelecimento?.telefone1 ? `(${d.estabelecimento.ddd1}) ${d.estabelecimento.telefone1}` : "",
            email: d.estabelecimento?.email || "",
            cep: d.estabelecimento?.cep || "",
            logradouro: d.estabelecimento?.logradouro || "",
            numero: d.estabelecimento?.numero || "",
            complemento: d.estabelecimento?.complemento || "",
            bairro: d.estabelecimento?.bairro || "",
            cidade: d.estabelecimento?.cidade?.nome || "",
            uf: d.estabelecimento?.estado?.sigla || "",
            situacao: d.estabelecimento?.situacao_cadastral || "",
            socios: (d.socios || []).map((s: any) => ({
              nome: s.nome || "",
              qualificacao: s.qualificacao?.descricao || "",
              cpf: s.cpf_cnpj_socio || "",
            })),
          }),
        },
      ];

      for (const source of sources) {
        try {
          const response = await fetch(source.url, { signal: AbortSignal.timeout(8000) });
          if (!response.ok) continue;
          const data = await response.json();
          if (data.status === "ERROR" || data.error) continue;
          const parsed = source.parse(data);
          if (!parsed.razaoSocial) continue;
          console.log(`[CNPJ] ${cnpj.slice(0, 4)}*** found via ${source.name}`);
          return res.json(parsed);
        } catch {
          continue;
        }
      }

      return res.status(404).json({ message: "CNPJ nao encontrado em nenhuma fonte" });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  const createProviderSchema = z.object({
    name: z.string().min(1).max(200),
    tradeName: z.string().max(200).optional(),
    cnpj: z.string().regex(/^\d{14}$/, "CNPJ deve ter 14 digitos"),
    subdomain: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, "Subdominio: apenas letras minusculas, numeros e hifens"),
    plan: z.enum(["free", "basic", "pro", "enterprise"]).optional(),
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
      const [token, integrations, logs] = await Promise.all([
        storage.getProviderWebhookToken(id),
        storage.getErpIntegrations(id),
        storage.getErpSyncLogs(id, undefined, 20),
      ]);
      return res.json({ token, integrations, logs });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.put("/api/admin/providers/:id/erp/:source", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const source = req.params.source;
      const ALLOWED = getSupportedSources();
      if (!ALLOWED.includes(source)) return res.status(400).json({ message: "ERP invalido" });
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const parsed = adminUpdateErpSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
      }
      const { apiUrl, apiToken, apiUser, isEnabled } = parsed.data;
      const integration = await storage.upsertErpIntegration(id, source, {
        apiUrl: apiUrl ?? null,
        apiToken: apiToken ?? null,
        apiUser: apiUser ?? null,
        isEnabled: isEnabled ?? true,
      });
      return res.json(integration);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
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

  // ── ERP Connection Test ──
  router.post("/api/admin/providers/:id/erp-test", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const integrations = await storage.getErpIntegrations(id);
      const erpIntg = integrations.find(i => i.isEnabled && i.apiUrl && i.apiToken);

      if (!erpIntg) {
        return res.json({ ok: false, message: "ERP nao configurado. Salve a URL e credenciais primeiro." });
      }

      const connector = getConnector(erpIntg.erpSource);
      if (!connector) {
        return res.json({ ok: false, message: `Conector ${erpIntg.erpSource} nao disponivel` });
      }

      const testResult = await connector.testConnection({
        apiUrl: erpIntg.apiUrl!,
        apiToken: erpIntg.apiToken!,
        apiUser: erpIntg.apiUser || undefined,
        extra: {},
      });
      return res.json(testResult);
    } catch (error: any) {
      return res.json({ ok: false, message: getSafeErrorMessage(error) });
    }
  });

  // ── ERP Config Save (per provider) ──
  router.put("/api/admin/providers/:id/erp-config", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const { erpSource, apiUrl, apiToken } = req.body;

      if (!erpSource || !apiUrl || !apiToken) {
        return res.status(400).json({ message: "erpSource, apiUrl e apiToken sao obrigatorios" });
      }

      // Parse credential format based on ERP type
      let apiUser: string | undefined;
      let cleanToken = apiToken;
      if (cleanToken.includes(":")) {
        const parts = cleanToken.split(":", 2);
        if (erpSource === "mk") {
          // MK: "token:contrasenha" → apiToken=token, apiUser=contrasenha
          cleanToken = parts[0];
          apiUser = parts[1];
        } else {
          // IXC/others: "userId:token" → apiUser=userId, apiToken=token
          apiUser = parts[0];
          cleanToken = parts[1];
        }
      }

      const url = apiUrl.startsWith("http") ? apiUrl : `https://${apiUrl}`;

      const { validateErpUrl } = await import("../utils/url-validator");
      const urlCheck = validateErpUrl(url);
      if (!urlCheck.valid) {
        return res.status(400).json({ message: urlCheck.reason });
      }

      await storage.upsertErpIntegration(id, erpSource, {
        apiUrl: url,
        apiToken: cleanToken,
        apiUser: apiUser || null,
        isEnabled: true,
      } as any);

      return res.json({ ok: true });
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
