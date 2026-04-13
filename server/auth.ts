import { Request, Response, NextFunction } from "express";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { pool } from "./db";

const PgSession = ConnectPgSimple(session);

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

export const sessionMiddleware = session({
  store: new PgSession({
    pool: pool,
    tableName: "session",
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: "cid",
  cookie: {
    secure: process.env.NODE_ENV === "production",
    maxAge: 2 * 24 * 60 * 60 * 1000, // 48h
    httpOnly: true,
    sameSite: "lax",
  },
  proxy: process.env.NODE_ENV === "production",
});

declare module "express-session" {
  interface SessionData {
    userId: number;
    providerId: number;
    role: string;
    subdomain?: string;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Autenticacao necessaria" });
  }

  // Validar que a sessao pertence ao subdominio correto (isolamento multi-tenant)
  if (req.session.providerId && req.session.role !== "superadmin") {
    const parts = req.hostname.split(".");
    if (parts.length >= 3 && parts[0] !== "www") {
      const requestSubdomain = parts[0];
      // O providerId da sessao deve corresponder ao subdominio acessado.
      // Verificacao lazy: armazena subdomain na sessao no login e compara aqui.
      if (req.session.subdomain && req.session.subdomain !== requestSubdomain) {
        return res.status(403).json({ message: "Sessao invalida para este subdominio" });
      }
    }
  }

  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId || (req.session.role !== "admin" && req.session.role !== "superadmin")) {
    return res.status(403).json({ message: "Acesso negado" });
  }
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId || req.session.role !== "superadmin") {
    return res.status(403).json({ message: "Acesso restrito ao administrador do sistema" });
  }
  next();
}
