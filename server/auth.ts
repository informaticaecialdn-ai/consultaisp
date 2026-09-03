import { Request, Response, NextFunction } from "express";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { normalizarHost, extractSubdomainFromHost } from "./tenant";
import { storage } from "./storage";

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

  if (req.session.role !== "superadmin") {
    // Fail-CLOSED. A condicao anterior era `req.session.providerId && ...`: a
    // prova de host so valia quando havia provedor, entao uma sessao sem
    // providerId entrava por QUALQUER host e viajava entre eles. Hoje isso e
    // teorico (todo user/admin nasce com provedor); com o white label deixa de
    // ser: papel sem provedor passa a existir, e o host e o seletor de tenant.
    // Ausencia de provedor e falha de autorizacao, nunca dispensa.
    if (!req.session.providerId || req.session.providerId <= 0) {
      return res.status(401).json({ message: "Autenticacao necessaria" });
    }

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

/** O que o login e as rotas de provedor respondem a quem esta suspenso. */
export const MENSAGEM_PROVEDOR_SUSPENSO =
  "Acesso suspenso — fale com o suporte para reativar a conta.";

/**
 * Cache do status do provedor. Guarda SO o veredito positivo, de proposito.
 *
 * A aba Provedores do superadmin promete, no confirm de "Suspender", que "o
 * acesso do provedor e dos usuarios dele fica bloqueado". Ninguem lia
 * `providers.status`: o login carregava o provedor so para a prova de host, e
 * os middlewares nunca olhavam o campo. Suspender por inadimplencia nao impedia
 * um operador de logar dois minutos depois e queimar credito consultando CPF.
 *
 * Ler o status em toda requisicao de provedor custaria uma consulta por request,
 * entao "ativo" fica 30s em memoria. A assimetria e deliberada: veredito
 * NEGATIVO nunca e cacheado, entao REATIVAR volta a valer na requisicao
 * seguinte. O preco e o inverso — suspender leva ate 30s para alcancar sessoes
 * ja abertas — e esse e o lado barato: suspensao e ato comercial, nao contencao
 * de invasor.
 *
 * A chave vem da sessao (gravada no login a partir da linha do usuario), nunca
 * de cabecalho do cliente: o mapa e limitado pelo numero de provedores reais.
 */
const TTL_STATUS_ATIVO_MS = 30_000;
const provedoresAtivos = new Map<number, number>();

/** Zera o cache de status. Serve aos testes e a quem mudar status no processo. */
export function esquecerStatusDeProvedor(providerId?: number): void {
  if (providerId === undefined) provedoresAtivos.clear();
  else provedoresAtivos.delete(providerId);
}

async function provedorSuspenso(providerId: number): Promise<boolean> {
  const ate = provedoresAtivos.get(providerId);
  if (ate !== undefined && ate > Date.now()) return false;

  let provider;
  try {
    provider = await storage.getProvider(providerId);
  } catch {
    // Banco fora do ar nao pode virar bloqueio em massa. Sem leitura, mantem o
    // comportamento anterior: o que se protege aqui e cobranca, nao invasao.
    return false;
  }

  // Provedor ausente nao e suspensao. Quem foi apagado ja quebra no handler, e
  // um bloqueio aqui esconderia a causa real por tras de um texto errado.
  if (!provider) return false;
  if (provider.status === "active") {
    provedoresAtivos.set(providerId, Date.now() + TTL_STATUS_ATIVO_MS);
    return false;
  }
  return true;
}

/**
 * Defesa em profundidade: so passa quem TEM provedor, e provedor no ar.
 *
 * Sem isto, uma sessao com `providerId` 0 chega ao handler e o handler grava
 * `provider_id: 0` — que ou estoura na FK (500) ou, pior, cria uma gaveta
 * orfa que nenhum tenant enxerga. `requireAuth` sozinho nunca prometeu isso;
 * prometia apenas que ha alguem logado.
 *
 * A segunda trava e o status: a recusa no login so alcanca quem entra AGORA, e
 * a sessao dura 48h. Sem esta linha, suspender um provedor as 10h nao tirava do
 * ar ninguem que ja estivesse logado desde as 9h.
 */
export async function requireProvider(req: Request, res: Response, next: NextFunction) {
  const providerId = req.session.providerId;
  if (!req.session.userId || !providerId || providerId <= 0) {
    return res.status(403).json({ message: "Somente provedores" });
  }
  // Superadmin e da plataforma: nao existe status de tenant que o barre. Hoje
  // ele nem chega aqui (nao tem providerId), e a linha garante que continue
  // assim se um dia tiver.
  if (req.session.role !== "superadmin" && await provedorSuspenso(providerId)) {
    return res.status(403).json({ message: MENSAGEM_PROVEDOR_SUSPENSO, code: "PROVIDER_SUSPENDED" });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(403).json({ message: "Acesso negado" });
  }
  if (req.session.role === "superadmin") {
    return next();
  }
  // Admin de provedor sem provedor nao existe: as rotas que usam este
  // middleware gravam com `session.providerId` e escreveriam no vazio.
  if (req.session.role !== "admin" || !req.session.providerId || req.session.providerId <= 0) {
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
