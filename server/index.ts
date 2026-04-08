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

const app = express();
// trust proxy: expects exactly 1 reverse proxy (Nginx/Caddy) in front of the app.
// If deployed without a proxy, set to false. If behind multiple proxies, adjust the number.
app.set("trust proxy", 1);
const httpServer = createServer(app);

// Security headers — relax CSP in dev for Vite HMR; tighten in production
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://maps.googleapis.com", "https://maps.gstatic.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://maps.googleapis.com", "https://maps.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.googleapis.com", "https://*.gstatic.com", "https://*.google.com", "https://*.openstreetmap.org", "https://viacep.com.br"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      connectSrc: ["'self'", "https://maps.googleapis.com", "https://viacep.com.br", "https://nominatim.openstreetmap.org", "https://*.google.com", "wss:", "ws:"],
      frameSrc: ["'self'", "https://www.google.com", "https://maps.google.com"],
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

// Routes whose response bodies must never be logged (contain personal/financial data)
const SENSITIVE_ROUTES = [
  "/api/isp-consultations",
  "/api/spc-consultations",
  "/api/public/titular-request",
];

/** Redact sensitive fields from a response body before logging */
function sanitizeForLog(body: Record<string, any>): Record<string, any> {
  const sensitiveKeys = new Set([
    "cpfCnpj", "customerName", "nome", "email", "phone", "telefone",
    "address", "cep", "nomeMae", "dataNascimento", "cpf_cnpj",
    "providerDetails", "addressMatches", "cadastralData", "restrictions",
  ]);
  const sanitized: Record<string, any> = {};
  for (const key of Object.keys(body)) {
    if (sensitiveKeys.has(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof body[key] === "object" && body[key] !== null && !Array.isArray(body[key])) {
      sanitized[key] = sanitizeForLog(body[key]);
    } else {
      sanitized[key] = body[key];
    }
  }
  return sanitized;
}

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
      const isSensitive = SENSITIVE_ROUTES.some(r => path.startsWith(r));
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

  // LGPD services — non-fatal if dependencies are missing
  try {
    const { startRetentionScheduler } = await import("./services/lgpd-retention");
    startRetentionScheduler();
  } catch (err) {
    logger.warn({ err }, "LGPD retention scheduler failed to start — feature unavailable");
  }

  try {
    const { startTitularProcessor } = await import("./services/lgpd-titular.service");
    startTitularProcessor();
  } catch (err) {
    logger.warn({ err }, "LGPD titular processor failed to start — feature unavailable");
  }

  try {
    const { startHeatmapCacheScheduler } = await import("./services/heatmap-cache");
    startHeatmapCacheScheduler();
  } catch (err) {
    logger.warn({ err }, "Heatmap cache scheduler failed to start — feature unavailable");
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

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received");
    httpServer.close(() => {
      logger.info("HTTP server closed");
    });
    await pool.end();
    logger.info("Database pool closed");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();
