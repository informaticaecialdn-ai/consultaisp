import type { Express } from "express";
import type { Server } from "http";
import { sessionMiddleware } from "../auth";

// Import all 15 route modules
import { registerAuthRoutes } from "./auth.routes";
import { registerDashboardRoutes } from "./dashboard.routes";
import { registerImportRoutes } from "./import.routes";
import { registerConsultasRoutes } from "./consultas.routes";
import { registerAntiFraudeRoutes } from "./antifraude.routes";
import { registerEquipamentosRoutes } from "./equipamentos.routes";
import { registerBigdataRoutes } from "./bigdata.routes";
import { registerHeatmapRoutes } from "./heatmap.routes";
import { registerLocalizacaoRoutes } from "./localizacao.routes";
import { registerProviderRoutes } from "./provider.routes";
import { registerErpRoutes } from "./erp.routes";
import { registerAdminRoutes } from "./admin.routes";
import { registerFinanceiroRoutes } from "./financeiro.routes";
import { registerCreditsRoutes } from "./credits.routes";
import { registerChatRoutes } from "./chat.routes";
import { registerAiRoutes } from "./ai.routes";
import { registerPublicRoutes } from "./public.routes";
import { registerRegionalRoutes } from "./regional.routes";
import { registerNfseRoutes } from "./nfse.routes";
import { registerCrmRoutes } from "./crm.routes";
import { registerMarcaRoutes } from "./marca.routes";
import { registerRevendaRoutes } from "./revenda.routes";
import { registerCadastroRoutes } from "./cadastro.routes";
import { registerPrecosRoutes } from "./precos.routes";
import { registerSuporteAcessoRoutes } from "./suporte-acesso.routes";
import { registerCobrancaRoutes } from "./cobranca.routes";
import { registerChatBullqRoutes } from "./chat-bullq.routes";
import { registerChatBullqAgenteRoutes } from "./chat-bullq-agente.routes";
import { registerChatAutonomiaRoutes } from "./chat-autonomia.routes";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Session middleware (was in old routes.ts)
  app.use(sessionMiddleware);

  // PRIMEIRO da cadeia, e a posicao importa: este router comeca com
  // `travaDeAcessoDeSuporte`, que reconfere a cada requisicao se a
  // personificacao em curso continua autorizada. Montado depois de qualquer
  // outro, as rotas montadas antes dele serviriam dado do provedor a um suporte
  // cuja liberacao ja tinha sido revogada. Ele chama `next()` para quem nao
  // esta personificando, entao nao muda nada para o resto do sistema.
  app.use(registerSuporteAcessoRoutes());

  // Mount all domain routers
  app.use(registerAuthRoutes());
  app.use(registerDashboardRoutes());
  app.use(registerImportRoutes());
  app.use(registerConsultasRoutes());
  app.use(registerAntiFraudeRoutes());
  app.use(registerEquipamentosRoutes());
  app.use(registerBigdataRoutes());
  app.use(registerHeatmapRoutes());
  app.use(registerLocalizacaoRoutes());
  app.use(registerProviderRoutes());
  app.use(registerErpRoutes());
  app.use(registerAdminRoutes());
  app.use(registerFinanceiroRoutes());
  app.use(registerCreditsRoutes());
  app.use(registerChatRoutes());
  app.use(registerAiRoutes());
  app.use(registerPublicRoutes());
  app.use(registerRegionalRoutes());
  app.use(registerNfseRoutes());
  app.use(registerCrmRoutes());
  app.use(registerMarcaRoutes());
  // Depois do de marcas, e a ordem tem razao: aquele serve o logo e o favicon
  // por URL PUBLICA (`/api/marca/:id/logo`, sem sessao — a tela de login ja
  // mostra a marca). Este exige revendedor autenticado. Nao ha caminho em comum
  // entre os dois hoje, mas `/api/marca*` e `/api/revenda*` sao vizinhos de
  // nome, e a ordem declarada deixa claro qual e o publico e qual e o fechado.
  app.use(registerRevendaRoutes());
  app.use(registerCadastroRoutes());
  app.use(registerPrecosRoutes());
  app.use(registerCobrancaRoutes());
  // A ponte com o Chat BullQ (chat com o cliente em cobranca e equipamentos).
  app.use(registerChatBullqRoutes());
  // As skills do agente de IA e o webhook de volta do Chat BullQ (sem sessao: chave e HMAC).
  app.use(registerChatBullqAgenteRoutes());
  // A autonomia do chat: configuracao por provedor, fila por status e a volta da conversa ao assistente (sessao).
  app.use(registerChatAutonomiaRoutes());

  return httpServer;
}
