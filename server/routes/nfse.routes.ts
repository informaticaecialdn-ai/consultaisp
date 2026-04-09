import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { emitirNfse, consultarNfse, cancelarNfse, isFocusNfeConfigured, getFocusNfeEnv } from "../services/focusnfe";
import { getSafeErrorMessage } from "../utils/safe-error";

export function registerNfseRoutes(): Router {
  const router = Router();

  // Status da integracao
  router.get("/api/nfse/config", requireAuth, async (_req, res) => {
    return res.json({
      configured: isFocusNfeConfigured(),
      environment: getFocusNfeEnv(),
      cnpjPrestador: "64199963000149",
      inscricaoMunicipal: "", // Precisa ser preenchido
      codigoMunicipio: "3550308", // Sao Paulo
      aliquotaIss: 2.90,
      codigoServico: "01.07", // Analise e desenvolvimento de sistemas
      descricaoPadrao: "Licenciamento de uso de software SaaS - Consulta ISP - Analise de credito para provedores de internet",
    });
  });

  // Emitir NFS-e
  router.post("/api/nfse/emit", requireAuth, async (req, res) => {
    try {
      if (!isFocusNfeConfigured()) {
        return res.status(400).json({ message: "Focus NFe nao configurado. Adicione FOCUS_NFE_TOKEN no .env" });
      }

      const providerId = req.session.providerId!;
      const provider = await storage.getProvider(providerId);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });

      const { tomador, descricao, valor, codigoServico, aliquotaIss } = req.body;

      if (!tomador || !descricao || !valor) {
        return res.status(400).json({ message: "Campos obrigatorios: tomador, descricao, valor" });
      }

      // Gerar referencia unica
      const ref = `nfse-${providerId}-${Date.now()}`;

      const result = await emitirNfse({
        ref,
        cnpjPrestador: "64199963000149",
        inscricaoMunicipal: provider.cnpj || "", // TODO: campo inscricao_municipal
        tomador: {
          cnpjCpf: tomador.cnpjCpf,
          razaoSocial: tomador.razaoSocial,
          email: tomador.email,
          telefone: tomador.telefone,
          logradouro: tomador.logradouro,
          numero: tomador.numero,
          complemento: tomador.complemento,
          bairro: tomador.bairro,
          codigoMunicipio: tomador.codigoMunicipio || "3550308",
          uf: tomador.uf || "SP",
          cep: tomador.cep,
        },
        descricao: descricao || "Licenciamento de uso de software SaaS - Consulta ISP",
        valor: parseFloat(valor),
        codigoServico: codigoServico || "01.07",
        aliquotaIss: parseFloat(aliquotaIss) || 2.90,
      });

      return res.status(result.status === "error" ? 400 : 202).json(result);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // Consultar status de NFS-e
  router.get("/api/nfse/:ref", requireAuth, async (req, res) => {
    try {
      if (!isFocusNfeConfigured()) {
        return res.status(400).json({ message: "Focus NFe nao configurado" });
      }

      const result = await consultarNfse(req.params.ref);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // Cancelar NFS-e
  router.delete("/api/nfse/:ref", requireAuth, async (req, res) => {
    try {
      if (!isFocusNfeConfigured()) {
        return res.status(400).json({ message: "Focus NFe nao configurado" });
      }

      const justificativa = req.body?.justificativa || "Cancelamento solicitado pelo provedor";
      const result = await cancelarNfse(req.params.ref, justificativa);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
