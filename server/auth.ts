import { Request, Response, NextFunction } from "express";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { normalizarHost, extractSubdomainFromHost } from "./tenant";

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
    /**
     * Host normalizado onde a sessao nasceu. Ver `requireAuth`.
     * Opcional so por causa das sessoes criadas antes do white label.
     */
    hostLogin?: string;
    /** Marca vigente no login. Guardada para a UI e para diagnostico. */
    marcaId?: number | null;
  }
}

/**
 * NOTA DE SEGURANCA — por que a comparacao e por HOST INTEIRO.
 *
 * O cookie de sessao nao define `domain` (ver acima), entao ele e host-only: o
 * navegador so o envia de volta ao host exato que o criou. Isso ja impede a
 * sessao de uma marca viajar para outra, e e a peca do desenho atual que ja
 * estava certa para white label — NAO adicionar `domain` ao cookie.
 *
 * Mas `req.hostname` nao e o host da conexao: com `trust proxy` ligado
 * (server/index.ts), o Express prefere o cabecalho `X-Forwarded-Host`, que o
 * cliente pode mandar. Medido: com trust proxy 1, um X-Forwarded-Host forjado
 * vira `req.hostname`. O nginx passa a sobrescrever esse cabecalho
 * (script/dominio-whitelabel.sh), e esta comparacao e a segunda barreira: para
 * uma requisicao legitima o host e sempre o mesmo do login; para uma forjada,
 * diverge — e o white label transforma esse cabecalho no seletor de tenant.
 *
 * A regra anterior comparava so o primeiro rotulo do host, e por isso aceitava
 * `nslink.evil.com` para uma sessao de `nslink`.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Autenticacao necessaria" });
  }

  if (req.session.providerId && req.session.role !== "superadmin") {
    const atual = normalizarHost(req.hostname);

    if (req.session.hostLogin) {
      if (req.session.hostLogin !== atual) {
        return res.status(403).json({ message: "Sessao invalida para este endereco" });
      }
    } else if (req.session.subdomain) {
      // Sessao aberta ANTES deste deploy: nao tem `hostLogin`. Cai na regra
      // antiga (agora com extracao correta de subdominio) ate expirar — o
      // cookie dura 48h. Este ramo pode ser removido depois disso.
      const rotulo = extractSubdomainFromHost(atual);
      if (rotulo && req.session.subdomain !== rotulo) {
        return res.status(403).json({ message: "Sessao invalida para este endereco" });
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
