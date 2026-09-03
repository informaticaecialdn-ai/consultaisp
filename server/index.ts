import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes/index";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase, seedSuperAdmin } from "./seed";
import { validateEnv } from "./env";
import { pool } from "./db";
import { logger } from "./logger";
import { getSafeErrorMessage } from "./utils/safe-error";
import { runMigrations, verifySchema } from "./migrate";
import { sanitizeForLog, corpoEhSensivel } from "./utils/sanitize-log";

const app = express();
// trust proxy: expects exactly 1 reverse proxy (Nginx/Caddy) in front of the app.
// If deployed without a proxy, set to false. If behind multiple proxies, adjust the number.
app.set("trust proxy", 1);
const httpServer = createServer(app);

// Security headers — relax CSP in dev for Vite HMR; tighten in production
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      // Cada host aqui e uma porta aberta: so entra o que o NAVEGADOR de fato
      // acessa. Google Maps, Azure Maps e Bing sairam junto com os tres
      // componentes de heatmap que ninguem renderizava — o mapa em uso e
      // Leaflet sobre tiles do OpenStreetMap, servidos pelo proxy /api/tiles,
      // da propria origem. `fonts.googleapis.com` e `fonts.gstatic.com` ficam:
      // sao o Google Fonts do index.html, outro servico e sem cobranca.
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.openstreetmap.org", "https://viacep.com.br"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      // `brasilapi.com.br` FALTAVA e o navegador chama: o preenchimento
      // automatico por CNPJ (client/src/pages/auth/login.tsx e o painel do
      // provedor) fazia fetch direto e o CSP barrava. O campo simplesmente nao
      // preenchia, e o unico sinal era no console do navegador do usuario.
      connectSrc: [
        "'self'",
        "https://viacep.com.br",
        "https://brasilapi.com.br",
        "https://nominatim.openstreetmap.org",
        "wss:", "ws:",
      ],
      frameSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"],
    },
  },
}));

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "1mb", parameterLimit: 100 }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}



// A regra de censura vive em utils/sanitize-log.ts — importar este arquivo sobe
// o servidor, e o que decide o que e segredo precisa de teste.

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;

      // Suppress response body for sensitive consultation routes
      const isSensitive = corpoEhSensivel(path);
      if (capturedJsonResponse && !isSensitive) {
        logLine += ` :: ${JSON.stringify(sanitizeForLog(capturedJsonResponse))}`;
      } else if (isSensitive && capturedJsonResponse) {
        logLine += ` :: [BODY REDACTED - sensitive route]`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  validateEnv();

  // Health check endpoint — no auth required (used by Docker health checks)
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  // Run migrations — non-fatal if migrations dir is missing
  try {
    await runMigrations();
  } catch (err) {
    logger.error({ err }, "Migration failed — continuing with existing schema");
  }

  // Verify critical schema — fatal only for core tables
  try {
    await verifySchema();
  } catch (err) {
    logger.fatal({ err }, "Critical schema verification failed — cannot serve traffic safely");
    process.exit(1);
  }

  await seedDatabase();
  await seedSuperAdmin();
  await registerRoutes(httpServer, app);

  // Background jobs (ERP sync, LGPD retention/titular) rodam em processo SEPARADO.
  // Ver server/worker.ts + ecosystem.config.cjs. Opt-out via RUN_BG_JOBS_IN_API=true
  // se quiser rodar tudo junto (dev local, single-process deploy).
  if (process.env.RUN_BG_JOBS_IN_API === "true") {
    try {
      const { startRetentionScheduler } = await import("./services/lgpd-retention");
      startRetentionScheduler();
    } catch (err) {
      logger.warn({ err }, "LGPD retention scheduler failed to start");
    }
    try {
      const { startTitularProcessor } = await import("./services/lgpd-titular.service");
      startTitularProcessor();
    } catch (err) {
      logger.warn({ err }, "LGPD titular processor failed to start");
    }
    try {
      const { startErpSyncScheduler } = await import("./services/erp-sync.service");
      startErpSyncScheduler();
    } catch (err) {
      logger.warn({ err }, "ERP sync scheduler failed to start");
    }
    try {
      const { startGeocodeBackfill } = await import("./services/geocode-backfill.service");
      startGeocodeBackfill();
    } catch (err) {
      logger.warn({ err }, "Geocode backfill failed to start");
    }
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message: getSafeErrorMessage(err) });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: process.env.HOST || "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );

  /**
   * Espera a varredura em voo antes de fechar o pool — o mesmo dreno que o
   * worker ja tinha (server/worker.ts).
   *
   * O sync agendado roda no worker, mas o BOTAO "Sincronizar Agora" roda neste
   * processo, e a rota agora responde na hora e deixa a varredura seguindo em
   * background — sao 11 minutos em que um deploy fecharia o pool no meio dela.
   * Sem o dreno o log enche de "Cannot use a pool after calling end on the
   * pool", cada linha um cliente cuja atualizacao se perdeu.
   *
   * Trinta segundos cobre o upsert corrente com folga; passar disso, a varredura
   * e abandonada de proposito — segurar o desligamento faria o pm2 matar o
   * processo do mesmo jeito, so que mais tarde.
   */
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received");
    httpServer.close(() => {
      logger.info("HTTP server closed");
    });
    try {
      const { isSyncing } = await import("./services/erp-sync.service");
      const limite = Date.now() + 30_000;
      if (isSyncing()) logger.info("Sync manual em andamento — aguardando ate 30s");
      while (isSyncing() && Date.now() < limite) {
        await new Promise(r => setTimeout(r, 500));
      }
      if (isSyncing()) logger.warn("Sync ainda rodando apos 30s — encerrando mesmo assim");
    } catch (err) {
      logger.warn({ err }, "Nao consegui verificar o sync em andamento");
    }
    // `pool.end()` espera TODO cliente ser devolvido, e a varredura em voo
    // segura um: a trava do sync e um advisory lock preso a uma conexao, que
    // so e liberada no `finally`. Depois dos 30s de dreno, esperar por ela
    // indefinidamente entrega o desligamento ao SIGKILL do pm2 — que fecha o
    // socket do mesmo jeito, so que sem log e sem ordem.
    await Promise.race([
      pool.end().catch(() => {}),
      new Promise(r => setTimeout(r, 3_000)),
    ]);
    logger.info("Database pool closed");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();
