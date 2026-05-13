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
import { registerHeatmapRoutes } from "./heatmap.routes";
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
import { registerBenchmarkRoutes } from "./benchmark.routes";
import { registerCrmRoutes } from "./crm.routes";
import { registerWhatsappRoutes } from "./whatsapp.routes";
import { registerWhatsAppWebhookRoutes } from "../communications/whatsapp/webhook";
import { registerWhatsAppOAuthRoutes } from "../communications/whatsapp/embedded-signup";
import { registerAsaasWebhookRoutes } from "./webhook.routes";
// Spec 004 US3 — Painel
import { registerAsaasConfigRoutes } from "./asaas-config.routes";
import { registerReguaRoutes } from "./regua.routes";
import { registerDossieRoutes } from "./dossie.routes";
// Spec 007 — Time Digital
import { registerTeamRoutes } from "./team.routes";
// Spec 008.5 — MCP ERP wrapper
import { registerMcpErpRoutes } from "./mcp.routes";
import { isMcpEnabled } from "../env";
// Spec 008.6 — Custom HTTP Tools for Managed Agents
import { registerAgentToolsRoutes } from "./agent-tools.routes";
// Spec 010A — Customer Health Score preview endpoints
import { registerCustomerHealthRoutes } from "./customer-health.routes";
// Spec 009 — Pix Dinâmico preview
import { registerPixDynamicRoutes } from "./pix-dynamic.routes";
// Spec 013 — Silent Exit risk preview
import { registerSilentExitRoutes } from "./silent-exit.routes";
// Spec 014 — Competitor Monitor preview
import { registerCompetitorMonitorRoutes } from "./competitor-monitor.routes";
// Spec 012.5 — Cliente 360 (cobrança ativa + recuperação pós-cancelamento)
import { registerCliente360Routes } from "./cliente-360.routes";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Session middleware (was in old routes.ts)
  app.use(sessionMiddleware);

  // Mount all domain routers
  app.use(registerAuthRoutes());
  app.use(registerDashboardRoutes());
  app.use(registerImportRoutes());
  app.use(registerConsultasRoutes());
  app.use(registerAntiFraudeRoutes());
  app.use(registerEquipamentosRoutes());
  app.use(registerHeatmapRoutes());
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
  app.use(registerBenchmarkRoutes());
  app.use(registerCrmRoutes());
  app.use(registerWhatsappRoutes());
  app.use(registerWhatsAppWebhookRoutes());
  app.use(registerWhatsAppOAuthRoutes());
  // Spec 004 — webhook Asaas + Painel US3
  app.use(registerAsaasWebhookRoutes());
  app.use(registerAsaasConfigRoutes());
  app.use(registerReguaRoutes());
  app.use(registerDossieRoutes());
  // Spec 007 — Time Digital
  app.use(registerTeamRoutes());

  // Spec 010A — Customer Health Score preview (sem schema, só calculator puro)
  app.use(registerCustomerHealthRoutes());
  // Spec 009 — Pix Dinâmico preview (sem Asaas real, só tier calculator)
  app.use(registerPixDynamicRoutes());
  // Spec 013 — Silent Exit risk preview
  app.use(registerSilentExitRoutes());
  // Spec 014 — Competitor Monitor preview (sem Serper, só heurística)
  app.use(registerCompetitorMonitorRoutes());
  // Spec 012.5 — Cliente 360 (Cobrança Ativa + Recuperação Pós-Cancelamento)
  app.use(registerCliente360Routes());

  // Spec 008.5 — MCP ERP wrapper (controlado por env var MCP_DISABLED)
  if (isMcpEnabled()) {
    app.use(registerMcpErpRoutes());
    // Spec 008.6 — Custom HTTP Tools (mesma feature flag — usa mesmo bearer auth)
    app.use(registerAgentToolsRoutes());
  }

  return httpServer;
}
