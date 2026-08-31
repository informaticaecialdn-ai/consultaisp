import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { db } from "../db";
import { titularRequests } from "@shared/schema";
import { getSafeErrorMessage } from "../utils/safe-error";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { sendConfirmationEmail } from "../services/lgpd-email.service";
import { resolverMarcaPorHost } from "../services/marca.service";

export function registerPublicRoutes(): Router {
  const router = Router();

  /**
   * V-04 LGPD — Informações públicas de conformidade LGPD.
   * Alimenta a página /lgpd no frontend.
   */
  router.get("/api/public/lgpd-info", async (req, res) => {
    /**
     * WHITE LABEL — e aqui que ele NAO pode ser invisivel.
     *
     * Se o titular contratou da "CredNet" e esta pagina diz outro nome, ele nao
     * sabe a quem esta consentindo, e o consentimento fica defeituoso. Entao a
     * marca nomeia o CONTROLADOR de verdade, e a plataforma aparece como
     * operadora — esconde-la nao deixa o white label mais bonito, deixa o
     * consentimento invalido.
     */
    const marca = await resolverMarcaPorHost(req.hostname);

    /**
     * O canal de contato faz parte do pacote, nao e opcional.
     *
     * Uma marca com razao social e CNPJ mas SEM e-mail de suporte produzia a
     * pior combinacao possivel: a pagina nomeava o revendedor como controlador
     * e mandava o titular escrever para o DPO da plataforma. Quem recebe nao
     * tem os dados, e quem tem os dados nao recebe.
     *
     * Faltando qualquer uma das tres, o controlador continua sendo a
     * plataforma — o que e a verdade enquanto o revendedor nao declarou por
     * quem responder.
     */
    const temResponsavelProprio = Boolean(
      marca.responsavelRazaoSocial && marca.responsavelCnpj && marca.suporteEmail,
    );

    return res.json({
      empresa: temResponsavelProprio
        ? marca.responsavelRazaoSocial
        : process.env.LGPD_EMPRESA || "Consulta ISP Tecnologia Ltda",
      cnpj: temResponsavelProprio
        ? marca.responsavelCnpj
        : process.env.LGPD_CNPJ || "00.000.000/0000-00",
      /** Quem opera a infraestrutura, sempre nomeado. Ver o comentario acima. */
      operador: temResponsavelProprio
        ? {
            empresa: process.env.LGPD_EMPRESA || "Consulta ISP Tecnologia Ltda",
            cnpj: process.env.LGPD_CNPJ || null,
            papel: "Operadora da plataforma tecnologica que processa os dados em nome do controlador.",
          }
        : null,
      encarregado: (temResponsavelProprio && marca.suporteEmail)
        || process.env.LGPD_DPO_EMAIL || "dpo@consultaisp.com.br",
      finalidade: "Analise de credito e protecao ao credito no ambito de servicos de telecomunicacoes (ISPs). " +
        "A plataforma permite que provedores de internet consultem indicadores de adimplencia anonimizados " +
        "de potenciais clientes, visando reduzir inadimplencia e fraudes por migracao serial.",
      base_legal: "Legitimo Interesse (LGPD Art. 7, inciso IX) — protecao do credito. " +
        "O tratamento de dados e realizado para fins de analise de credito, conforme permitido pela LGPD " +
        "e pelo Codigo de Defesa do Consumidor (Art. 43).",
      direitos: [
        "Acesso aos dados",
        "Correcao de dados incompletos ou desatualizados",
        "Exclusao de dados desnecessarios",
        "Portabilidade dos dados",
        "Revogacao do consentimento",
        "Informacao sobre compartilhamento",
        "Oposicao ao tratamento",
      ],
      canal_solicitacao: (temResponsavelProprio && marca.suporteEmail)
        || process.env.LGPD_DPO_EMAIL || "dpo@consultaisp.com.br",
      prazo_resposta_dias: 15,
      tempo_retencao: "Dados de consultas de credito sao retidos por ate 5 anos, conforme legislacao fiscal e " +
        "normas do setor de protecao ao credito. Apos esse periodo, os dados sao anonimizados automaticamente. " +
        "Dados pessoais de cadastro sao mantidos enquanto a relacao comercial estiver ativa.",
      autoridade: "Autoridade Nacional de Protecao de Dados (ANPD)",
    });
  });

  router.get("/api/public/erp-catalog", async (_req, res) => {
    try {
      const items = await storage.getAllErpCatalog();
      const publicItems = items.filter(i => i.active).map(i => ({ key: i.key, name: i.name, description: i.description, logoBase64: i.logoBase64, gradient: i.gradient }));
      return res.json(publicItems);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/erp-catalog", requireAuth, async (_req, res) => {
    try {
      const items = await storage.getAllErpCatalog();
      return res.json(items);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * LGPD Art. 18 — Titular rights request endpoint.
   * Allows end-users (data subjects) to submit requests for access,
   * correction, deletion, or portability of their personal data.
   */
  const titularLimiter = createRateLimiter({ windowMs: 3_600_000, maxRequests: 5 });

  router.post("/api/public/titular-request", titularLimiter, async (req, res) => {
    try {
      const { cpfCnpj, nome, email, tipoSolicitacao, descricao } = req.body;

      if (!cpfCnpj || !nome || !email || !tipoSolicitacao) {
        return res.status(400).json({
          message: "Campos obrigatorios: cpfCnpj, nome, email, tipoSolicitacao",
        });
      }

      const tiposValidos = ["acesso", "correcao", "exclusao", "portabilidade", "revogacao"];
      if (!tiposValidos.includes(tipoSolicitacao)) {
        return res.status(400).json({
          message: `Tipo de solicitacao invalido. Valores aceitos: ${tiposValidos.join(", ")}`,
        });
      }

      const cleaned = cpfCnpj.replace(/\D/g, "");
      if (cleaned.length !== 11 && cleaned.length !== 14) {
        return res.status(400).json({ message: "CPF ou CNPJ invalido" });
      }

      const protocol = `LGPD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      // Calculate prazo limite: ~15 business days = 21 calendar days
      const prazoLimite = new Date();
      prazoLimite.setDate(prazoLimite.getDate() + 21);

      await db.insert(titularRequests).values({
        cpfCnpj: cleaned,
        nome,
        email,
        tipoSolicitacao,
        descricao: descricao || null,
        protocolo: protocol,
        status: "pendente",
        prazoLimite,
      });

      // Send confirmation email (non-blocking)
      // Mesma marca que a tela mostrou ao titular. Sem isto ele le
      // "Controlador: CredNet" e recebe um e-mail assinado por outra empresa.
      sendConfirmationEmail(email, protocol, tipoSolicitacao, await resolverMarcaPorHost(req.hostname)).catch(() => {});

      return res.json({
        protocolo: protocol,
        message: "Solicitacao registrada com sucesso. Voce recebera atualizacoes no email informado.",
        prazoResposta: "15 dias uteis conforme LGPD Art. 18, §5",
      });
    } catch (error: any) {
      console.error("Titular request error:", error);
      return res.status(500).json({ message: "Erro ao registrar solicitacao" });
    }
  });

  return router;
}
