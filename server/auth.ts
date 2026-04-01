import { Request, Response, NextFunction } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";

const MemoryStore = createMemoryStore(session);

const isProduction = process.env.NODE_ENV === "production";

export const sessionMiddleware = session({
  store: new MemoryStore({
    checkPeriod: 86400000,
  }),
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: true,
  saveUninitialized: true,
  name: "cid",
  cookie: {
    secure: false,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
  },
  proxy: isProduction,
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
  if (!req.session.userId || req.session.role !== "admin") {
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
