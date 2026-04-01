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

  return httpServer;
}
