import { Router } from "express";
import { requireAuth, requireProvider } from "../auth";
import { storage } from "../storage";
import { emitirNfse, consultarNfse, cancelarNfse, isFocusNfeConfigured, getFocusNfeEnv } from "../services/focusnfe";
import { getSafeErrorMessage } from "../utils/safe-error";
import { emModoDemo } from "../demo/modo-demo";
import { configNfseDaDemo, notasFiscaisDaDemo } from "../demo/semeadura-ficha";

/**
 * A instância de demonstração não tem token da Focus NFe, e nunca pode ter:
 * uma nota emitida ali seria uma nota de verdade na prefeitura. Só que a tela
 * trava o botão "Emitir" enquanto `configured` for falso — e o visitante veria
 * apenas o aviso de "não configurado", sem conhecer o fluxo.
 *
 * Em demonstração, então, a integração se diz configurada e as três rotas
 * seguem adiante; quem responde é a simulação dentro de `services/focusnfe.ts`,
 * que desvia ANTES de qualquer rede (a guarda mora no serviço, e não aqui, para
 * cobrir também quem chama o serviço por fora destas rotas). Fora da
 * demonstração o portão continua sendo só o token.
 */
const focusNfeDisponivel = () => isFocusNfeConfigured() || emModoDemo();

export function registerNfseRoutes(): Router {
  const router = Router();

  // Status da integracao
  router.get("/api/nfse/config", requireAuth, requireProvider, async (req, res) => {
    // Na demonstracao o prestador e o PROPRIO sandbox (CNPJ gravado dele, em
    // Londrina): o CNPJ da plataforma em Sao Paulo, fixo abaixo, fazia a nota
    // simulada de um provedor de Londrina sair por uma empresa de SP.
    if (emModoDemo()) {
      try {
        const provider = await storage.getProvider(req.session.providerId!);
        if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
        return res.json(configNfseDaDemo(provider.cnpj));
      } catch (error: any) {
        return res.status(500).json({ message: getSafeErrorMessage(error) });
      }
    }
    // AIDEV-QUESTION: fora da demonstracao o prestador e o CNPJ da plataforma e o
    // municipio e Sao Paulo, fixos — a nota da licenca SaaS que a plataforma emite
    // PARA o provedor, ou deveria ser a nota do provedor para os clientes dele?
    // Decisao de produto pendente; esta resposta segue identica.
    return res.json({
      configured: focusNfeDisponivel(),
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
  router.post("/api/nfse/emit", requireAuth, requireProvider, async (req, res) => {
    try {
      if (!focusNfeDisponivel()) {
        return res.status(400).json({ message: "Focus NFe nao configurado. Adicione FOCUS_NFE_TOKEN no .env" });
      }

      const providerId = req.session.providerId!;
      const provider = await storage.getProvider(providerId);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });

      const { tomador, descricao, valor, codigoServico, aliquotaIss } = req.body;

      if (!tomador || !descricao || !valor) {
        return res.status(400).json({ message: "Campos obrigatorios: tomador, descricao, valor" });
      }

      // Gerar referencia unica. Na demonstracao o prefixo `demo-` deixa a
      // nota simulada reconhecivel em qualquer print ou log.
      const ref = emModoDemo() ? `demo-${providerId}-${Date.now()}` : `nfse-${providerId}-${Date.now()}`;

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

  /**
   * Historico de notas — SO na demonstracao. Fora dela esta rota nao existe (as
   * notas emitidas vivem so na memoria da tela), e o primeiro handler manda o
   * pedido adiante com `next("route")` ANTES da autenticacao, para a resposta
   * continuar exatamente a de quando nao havia rota nenhuma aqui.
   *
   * Registrada antes de `/api/nfse/:ref` de proposito, para a ordem nunca
   * depender de `:ref` exigir um segmento a mais.
   */
  router.get(
    "/api/nfse",
    (_req, _res, next) => (emModoDemo() ? next() : next("route")),
    requireAuth,
    requireProvider,
    async (req, res) => {
      try {
        const provider = await storage.getProvider(req.session.providerId!);
        if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
        return res.json(notasFiscaisDaDemo(req.session.providerId!, provider.createdAt ?? new Date()));
      } catch (error: any) {
        return res.status(500).json({ message: getSafeErrorMessage(error) });
      }
    },
  );

  // Consultar status de NFS-e
  router.get("/api/nfse/:ref", requireAuth, requireProvider, async (req, res) => {
    try {
      if (!focusNfeDisponivel()) {
        return res.status(400).json({ message: "Focus NFe nao configurado" });
      }

      const result = await consultarNfse(req.params.ref);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // Cancelar NFS-e
  router.delete("/api/nfse/:ref", requireAuth, requireProvider, async (req, res) => {
    try {
      if (!focusNfeDisponivel()) {
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
