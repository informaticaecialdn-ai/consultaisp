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
    maxAge: 30 * 24 * 60 * 60 * 1000,
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
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Autenticacao necessaria" });
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
