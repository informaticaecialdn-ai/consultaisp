import { Router } from "express";
import { requireAuth, requireProvider, requireSuperAdmin } from "../auth";
import { storage } from "../storage";
import { getAllConnectors, getConnector, getSupportedSources } from "../erp";
import { getSafeErrorMessage } from "../utils/safe-error";
import { syncProviderToDb, sincronizacaoEmAndamento } from "../services/erp-sync.service";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";

/**
 * O lado do PROVEDOR e somente-leitura.
 *
 * Ate aqui existiam PATCH, /test e /sync sob `requireAuth + requireProvider` —
 * sem `requireAdmin`. Qualquer operador de papel "user" gravava credencial de
 * ERP por curl, e o GET devolvia as credenciais ja decifradas ao navegador.
 * Esconder os campos no JSX nao esconderia nada: a configuracao passou toda
 * para o superadmin (PUT/POST em /api/admin/providers/:id/erp/:source) e as
 * rotas de escrita do provedor foram REMOVIDAS, nao apenas ocultadas.
 *
 * Sairam junto GET /api/erp/available e GET /api/erp/config-fields/:source:
 * nao tinham middleware NENHUM, nenhum consumidor no client, e o segundo
 * publicava a qualquer anonimo o formato exato dos campos de credencial de cada
 * ERP. O catalogo autenticado vive em GET /api/erp-connectors.
 */
export function registerErpRoutes(): Router {
  const router = Router();

  /**
   * Freio na varredura manual do superadmin — irmao dos limitadores de
   * admin.routes.ts (config 60/min, teste 20/min), mais apertado que os dois:
   * um teste de conexao e um handshake, uma varredura completa mediu 682s
   * contra a API do ERP do provedor. Cinco por minuto ja e folga larga para
   * depurar e ainda assim impede que um clique repetido na tela vire enxurrada
   * de saida — o ERP responde a isso bloqueando o IP do servidor, o que derruba
   * o sync de todos os provedores daquele ERP.
   *
   * Nao e redundante com a trava `sincronizacaoEmAndamento` (409): aquela
   * impede duas varreduras SIMULTANEAS do mesmo provedor; esta impede muitas
   * varreduras EM SEQUENCIA, cada uma esperando a anterior terminar. As duas
   * camadas cobrem coisas diferentes.
   */
  const limiteSyncErp = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });

  router.get("/api/provider/erp-integrations", requireAuth, requireProvider, async (req, res) => {
    try {
      const integracoes = await storage.getErpIntegracoesResumo(req.session.providerId!);
      return res.json(integracoes);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/providers/:id/sync/:source", requireSuperAdmin, limiteSyncErp, async (req, res) => {
    try {
      const providerId = parseInt(String(req.params.id));
      if (Number.isNaN(providerId)) {
        return res.status(400).json({ ok: false, message: "Provedor invalido" });
      }
      const source = String(req.params.source);
      if (!getSupportedSources().includes(source)) {
        return res.status(400).json({ ok: false, message: "ERP invalido" });
      }

      // Estar no registry nao significa falar com o ERP: quatro conectores
      // existem so para figurar no catalogo e devolvem recusa em todo metodo.
      // Disparar a varredura gastaria minutos para gravar uma falha que ja se
      // sabe de antemao — e o operador leria "sincronizando" achando que o
      // problema esta na credencial do provedor.
      const conector = getConnector(source);
      if (conector?.naoImplementado) {
        return res.status(400).json({
          ok: false,
          message: `A integracao com o ${conector.label} ainda nao foi construida: `
            + `o conector nao conversa com a API desse ERP. Nao ha o que sincronizar.`,
        });
      }

      const provider = await storage.getProvider(providerId);
      if (!provider) return res.status(404).json({ ok: false, message: "Provedor nao encontrado" });

      const integrations = await storage.getErpIntegrations(providerId);
      const intg = integrations.find(i => i.erpSource === source);
      if (!intg?.apiUrl || !intg?.apiToken) {
        return res.status(400).json({ ok: false, message: "Provedor nao tem URL/token configurados" });
      }
      if (await sincronizacaoEmAndamento(providerId, source)) {
        return res.status(409).json({
          ok: false,
          emAndamento: true,
          message: "Ja existe uma sincronizacao em andamento para este ERP. Acompanhe pelo historico.",
        });
      }

      // DISPARA E RESPONDE. A varredura nao cabe num ciclo de request.
      //
      // A rota fazia `await` na sincronizacao inteira. Ela leva minutos — 682s
      // medidos na NsLink — e o nginx corta em `proxy_read_timeout 60s`,
      // devolvendo 504 em HTML. O `fetch` do painel entao estourava no
      // `res.json()` e a tela dizia "Erro ao sincronizar" para um sync que
      // estava rodando e ia terminar bem. Pior: convidava a clicar de novo.
      //
      // O resultado ja tem onde aparecer: `erp_sync_logs`, que o painel le em
      // GET /api/provider/erp-sync-logs.
      void syncProviderToDb(providerId, provider.name || "Provedor", source, {
        apiUrl: intg.apiUrl,
        apiToken: intg.apiToken,
        apiUser: intg.apiUser,
        mkContraSenha: (intg as any).mkContraSenha ?? null,
        clientId: (intg as any).clientId ?? null,
        clientSecret: (intg as any).clientSecret ?? null,
        extraConfig: (intg as any).extraConfig ?? null,
      }, "manual").catch(err => {
        console.error(`[ERPSync] sync manual de ${source} (provider ${providerId}) falhou:`, err);
      });

      return res.status(202).json({
        ok: true,
        iniciado: true,
        message: "Sincronizacao iniciada. O resultado aparece no historico quando terminar.",
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/provider/erp-sync-logs", requireAuth, requireProvider, async (req, res) => {
    try {
      const { source, limit } = req.query;
      const parsedLimit = Math.min(Math.max(parseInt(limit as string) || 30, 1), 100);
      const logs = await storage.getErpSyncLogs(
        req.session.providerId!,
        source as string | undefined,
        parsedLimit,
      );
      return res.json(logs);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/provider/erp-integration-stats", requireAuth, requireProvider, async (req, res) => {
    try {
      const stats = await storage.getErpIntegrationStats(req.session.providerId!);
      return res.json(stats);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/erp-connectors", requireAuth, (_req, res) => {
    const connectors = getAllConnectors();
    const meta = connectors.map(c => ({
      name: c.name,
      label: c.label,
      configFields: c.configFields,
      supportsEquipment: !!c.supportsEquipment,
      // Quem monta a lista suspensa de ERPs precisa saber que quatro destes sao
      // stub: sem o campo, escolher um deles gera uma integracao que se declara
      // "Ativa" nas duas telas e so falha dias depois, na varredura automatica.
      naoImplementado: !!c.naoImplementado,
    }));
    return res.json(meta);
  });

  return router;
}
