import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { db } from "../db";
import { titularRequests } from "@shared/schema";
import { getSafeErrorMessage } from "../utils/safe-error";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";

export function registerPublicRoutes(): Router {
  const router = Router();

  /**
   * V-04 LGPD — Informações públicas de conformidade LGPD.
   * Alimenta a página /lgpd no frontend.
   */
  router.get("/api/public/lgpd-info", async (_req, res) => {
    return res.json({
      empresa: process.env.LGPD_EMPRESA || "Consulta ISP Tecnologia Ltda",
      cnpj: process.env.LGPD_CNPJ || "00.000.000/0000-00",
      encarregado: process.env.LGPD_DPO_EMAIL || "dpo@consultaisp.com.br",
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
      canal_solicitacao: process.env.LGPD_DPO_EMAIL || "dpo@consultaisp.com.br",
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

      await db.insert(titularRequests).values({
        cpfCnpj: cleaned,
        nome,
        email,
        tipoSolicitacao,
        descricao: descricao || null,
        protocolo: protocol,
        status: "pendente",
      });

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
