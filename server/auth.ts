import { Request, Response, NextFunction } from "express";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { normalizarHost, extractSubdomainFromHost } from "./tenant";
import { storage } from "./storage";
import { logger } from "./logger";

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
    /**
     * A MARCA DESTA SESSAO — e o significado depende do papel.
     *
     *   role "revendedor"  -> a marca DO USUARIO (`users.marca_id`). E a ancora
     *                         de tenant dele: nao ha provedor, entao e por este
     *                         numero que toda query de `/api/revenda` filtra e
     *                         e ele que `hostPertenceAMarca` provou no login.
     *   demais papeis      -> a marca que o PROVEDOR veste (`providers.marca_id`),
     *                         ou null. Serve so a UI e ao diagnostico.
     *
     * Ate a fase 1 o campo era gravado do provedor e NUNCA LIDO por ninguem —
     * dava para trocar por qualquer numero sem efeito. Com o revendedor ele vira
     * autorizacao, e e por isso que `requireRevendedor` exige `> 0` em vez de
     * confiar no papel: uma sessao de revendedor sem marca nao tem tenant, e
     * seguir adiante significaria consultar a marca de outro ou nenhuma.
     */
    marcaId?: number | null;
    /**
     * Presente SOMENTE enquanto um superadmin esta conectado como suporte
     * dentro de um provedor. Ausente e o estado normal de todo mundo.
     *
     * A IDENTIDADE NAO MUDA: `userId` e `role` continuam sendo os do
     * superadmin. So `providerId` passa a ser o do provedor personificado.
     *
     * Trocar `role` para "admin" seria mais simples e e exatamente o que nao
     * pode acontecer: o log de acesso, a trilha de auditoria e a faixa vermelha
     * na tela dependem de conseguir separar um suporte conectado de um admin de
     * verdade, e depois da troca as duas sessoes ficariam identicas em tudo que
     * o servidor consegue observar. Com `role` intacto, a distincao e gratuita —
     * `requireAdmin` ja deixa o superadmin passar, e nenhuma rota de provedor
     * precisa saber que esta atendendo um suporte.
     */
    suporte?: PersonificacaoDeSuporte;
  }
}

/** A janela de acesso que esta sendo usada AGORA por esta sessao. */
export interface PersonificacaoDeSuporte {
  /** Linha de `acessos_suporte` que autorizou esta personificacao. */
  acessoId: number;
  /** Provedor cujo dado esta aberto. E o mesmo valor de `session.providerId`. */
  providerId: number;
  /**
   * ISO. Existe para a faixa vermelha mostrar quanto falta — e SO para isso.
   * Quem autoriza cada requisicao e `travaDeAcessoDeSuporte`, que pergunta ao
   * banco; comparar esta string com `Date.now()` no servidor seria voltar a
   * depender do relogio do processo, que e justamente o que o storage evita.
   */
  expiraEm: string;
}

/**
 * O QUE UM REVENDEDOR PODE PEDIR. Fora desta lista, 403.
 *
 * O revendedor e um papel COMERCIAL: ele responde por provedores, nao opera
 * nenhum. Nao ha uma unica rota de dado de titular — consulta, carteira,
 * inadimplente, alerta, equipamento, documento de KYC — que ele deva alcancar,
 * e as rotas de provedor nem sequer perguntam pelo papel: elas isolam por
 * `session.providerId`, que na sessao dele e 0.
 *
 * Por isso a barreira e CENTRAL e por prefixo, e nao uma checagem por rota. Sao
 * ~14 arquivos de rotas e mais de cem endpoints escritos quando "nao-admin =
 * operador de provedor" era verdade; confiar em lembrar do papel novo em cada
 * um deles significa que a PRIMEIRA rota esquecida e escalada de privilegio. Com
 * a lista invertida — nega tudo, libera quatro prefixos — uma rota nova nasce
 * fechada ao revendedor por construcao, e abri-la exige escrever aqui.
 *
 * Os quatro:
 *   /api/revenda  — o painel dele (fase 2 em diante; hoje o namespace nem existe)
 *   /api/auth     — login, /me, logout, troca de senha
 *   /api/marca    — logo e favicon da propria marca, servidos por URL
 *   /api/public   — o que ja e publico para qualquer visitante
 *
 * `/api/admin/*` fica de fora de proposito: la quem manda e `requireSuperAdmin`,
 * que ja recusa o revendedor. Duas barreiras dizendo a mesma coisa nao se
 * contradizem — a de fora e a que continua valendo se a de dentro for esquecida.
 */
export const PREFIXOS_LIBERADOS_AO_REVENDEDOR = [
  "/api/revenda",
  "/api/auth",
  "/api/marca",
  "/api/public",
] as const;

/**
 * Este caminho esta na lista acima?
 *
 * A normalizacao espelha o que o ROTEADOR do Express ignora, e existe por causa
 * de um furo real deste repositorio (ver `caminhoComparavel` em
 * server/utils/sanitize-log.ts e o teste `server/rotas-sensiveis.test.ts`): sem
 * `app.set("case sensitive routing", true)` — que este projeto nao tem — o
 * Express casa a rota SEM olhar caixa, e sem `strict routing` ele aceita barra
 * final. Medido no express 5.2.1 deste `node_modules`: `/API/isp-consultations`
 * chega ao mesmo handler que a forma em caixa baixa. Uma lista sensivel a caixa
 * decidindo sobre um roteador que nao e produz exatamente o buraco que ja
 * aconteceu aqui uma vez.
 *
 * A comparacao e por SEGMENTO (`igual ao prefixo` ou `prefixo + "/"`), nunca
 * `startsWith` cru: `startsWith("/api/marca")` liberaria tambem um futuro
 * `/api/marcas-do-revendedor`, e a lista deixaria de dizer o que parece dizer.
 *
 * Percent-encoding e `..` NAO sao normalizados, pela mesma razao documentada em
 * sanitize-log: o Express tambem nao os normaliza (`/api/%69sp-consultations` e
 * `/api/x/../isp-consultations` dao 404, medidos), entao nao ha caminho que
 * chegue a um handler de provedor e case com esta lista. E aqui o erro por falta
 * custa barato: uma lista que nao casa NEGA, que e o lado seguro.
 */
export function caminhoLiberadoAoRevendedor(caminho: string): boolean {
  const semQuery = (caminho || "").replace(/[?#].*$/, "");
  const alvo = (semQuery.replace(/\/+$/, "") || "/").toLowerCase();
  return PREFIXOS_LIBERADOS_AO_REVENDEDOR.some(p => alvo === p || alvo.startsWith(`${p}/`));
}

/**
 * O caminho pedido, do jeito que o roteador o viu.
 *
 * `req.originalUrl` e nao `req.path` de proposito: hoje os routers sao montados
 * na raiz (`app.use(registerXRoutes())` em server/routes/index.ts) e cada rota
 * declara o caminho inteiro, entao os dois coincidem. Se um dia alguem montar um
 * router sob prefixo, `req.path` passa a vir SEM o prefixo e nenhuma entrada
 * desta lista casaria — o revendedor levaria 403 em tudo, inclusive no proprio
 * painel. `originalUrl` nao e reescrito pelo roteamento e mantem a lista falando
 * dos mesmos caminhos absolutos que estao escritos nos arquivos de rota.
 */
function caminhoDaRequisicao(req: Request): string {
  return req.originalUrl || req.url || "";
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

  // Superadmin e da plataforma: entra por qualquer host, por desenho, e nao tem
  // tenant a provar. Sai cedo para as duas regras abaixo poderem ser escritas
  // sem repetir a excecao.
  if (req.session.role === "superadmin") return next();

  const atual = normalizarHost(req.hostname);

  /**
   * REVENDEDOR — a ancora de tenant e a MARCA, nao o provedor.
   *
   * A regra de baixo (`providerId > 0`) e fail-closed e esta certa para user e
   * admin, mas aplicada ao revendedor ela recusaria TODA requisicao dele:
   * `providerId` 0 e o estado normal deste papel, nao a anomalia que aquela
   * linha existe para pegar. Trocar o teto por `marcaId > 0` mantem a mesma
   * afirmacao — "sessao sem tenant nao passa" — no eixo que vale aqui.
   *
   * `hostLogin` e OBRIGATORIO neste ramo, sem a janela de compatibilidade que o
   * ramo do provedor ainda tem: o papel nasceu depois do campo, entao nao existe
   * sessao legada de revendedor: uma sessao sem `hostLogin` aqui ou e forjada ou
   * e lixo, e nos dois casos nao ha prova nenhuma a aceitar. A prova importa
   * mais para ele do que para o provedor — o dominio da marca E a credencial de
   * qual marca a sessao responde.
   */
  if (req.session.role === "revendedor") {
    if (!req.session.marcaId || req.session.marcaId <= 0) {
      return res.status(401).json({ message: "Autenticacao necessaria" });
    }
    if (!req.session.hostLogin || req.session.hostLogin !== atual) {
      return res.status(403).json({ message: "Sessao invalida para este endereco" });
    }
    const caminho = caminhoDaRequisicao(req);
    if (!caminhoLiberadoAoRevendedor(caminho)) {
      // Vale log, e nao so o 403: nao e engano de tela — e uma sessao comercial
      // pedindo dado operacional de provedor, que a tela dela nem sabe pedir.
      // Ver PREFIXOS_LIBERADOS_AO_REVENDEDOR.
      logger.warn(
        { userId: req.session.userId, marcaId: req.session.marcaId, caminho },
        "[revenda] rota fora do escopo do revendedor recusada",
      );
      return res.status(403).json({ message: "Somente provedores" });
    }
    return next();
  }

  // Fail-CLOSED. A condicao anterior era `req.session.providerId && ...`: a
  // prova de host so valia quando havia provedor, entao uma sessao sem
  // providerId entrava por QUALQUER host e viajava entre eles. Hoje isso e
  // teorico (todo user/admin nasce com provedor); com o white label deixa de
  // ser: papel sem provedor passa a existir, e o host e o seletor de tenant.
  // Ausencia de provedor e falha de autorizacao, nunca dispensa.
  if (!req.session.providerId || req.session.providerId <= 0) {
    return res.status(401).json({ message: "Autenticacao necessaria" });
  }

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

  next();
}

/**
 * As rotas do PAINEL DO REVENDEDOR (`/api/revenda/*`).
 *
 * Tres afirmacoes, e nenhuma delas e redundante:
 *
 *   `userId`            — ha alguem logado;
 *   `role`              — e um revendedor. SUPERADMIN NAO PASSA de proposito:
 *                         ele tem `/api/admin/marcas/:id` com o mesmo conteudo,
 *                         e deixa-lo entrar aqui daria a uma sessao sem marca um
 *                         escopo (`session.marcaId`) que ninguem gravou —
 *                         `undefined` filtrando query e o comeco de um vazamento;
 *   `marcaId > 0`       — a sessao tem tenant. Toda query de revenda filtra por
 *                         este numero; sem ele o filtro sumiria em silencio.
 *
 * A prova de host e repetida aqui de PROPOSITO, e nao herdada de `requireAuth`.
 * As duas sempre andam juntas hoje, mas quem escrever `router.get(rota,
 * requireRevendedor, ...)` sem a primeira nao veria erro nenhum — e a sessao do
 * revendedor de uma marca passaria a valer no dominio de outra. Uma comparacao
 * de string e barata; descobrir a ausencia dela em producao nao e.
 */
export async function requireRevendedor(req: Request, res: Response, next: NextFunction) {
  const sessao = req.session;
  if (!sessao.userId || sessao.role !== "revendedor" || !sessao.marcaId || sessao.marcaId <= 0) {
    return res.status(403).json({ message: "Somente revendedores" });
  }
  if (!sessao.hostLogin || sessao.hostLogin !== normalizarHost(req.hostname)) {
    return res.status(403).json({ message: "Sessao invalida para este endereco" });
  }
  if (await marcaDesligada(sessao.marcaId)) {
    return res.status(403).json({ message: MENSAGEM_MARCA_DESLIGADA, code: "MARCA_DESLIGADA" });
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

/** O que as rotas de revenda respondem quando a marca foi desligada. */
export const MENSAGEM_MARCA_DESLIGADA =
  "Esta marca esta desligada — fale com a plataforma para reativa-la.";

/**
 * Cache do estado da marca, gemeo de `provedoresAtivos` e pelo mesmo motivo.
 *
 * A prova de que a marca esta ligada morava SO no login: `hostPertenceAMarca`
 * exige que `resolverMarcaPorHost` devolva origem "dominio-proprio", e essa
 * resolucao filtra por `ativo`. Depois disso nada revalidava — entao desligar
 * uma marca as 10h deixava o revendedor ja logado editando a marca e criando e
 * removendo acessos de equipe pelo resto da vida do cookie (48h).
 *
 * A assimetria e a mesma da versao de provedor, e pelo mesmo argumento:
 * veredito POSITIVO fica 30s em memoria, NEGATIVO nunca — assim RELIGAR volta a
 * valer na requisicao seguinte, e o preco (desligar leva ate 30s para alcancar
 * sessao aberta) e o lado barato, porque isto e ato comercial e nao contencao
 * de invasor.
 *
 * `revendaAtiva` NAO e conferida aqui de proposito. A decisao 14 do dono diz
 * que marca sem revenda continua existindo como pele; tirar dela o painel seria
 * a plataforma inventando uma punicao que o desenho nao pediu. Quem barra a
 * CRIACAO de acesso naquele estado e o 422 de `POST /marcas/:id/usuarios`.
 */
const marcasLigadas = new Map<number, number>();

/** Zera o cache do estado da marca. Serve aos testes e a quem desligar no processo. */
export function esquecerEstadoDaMarca(marcaId?: number): void {
  if (marcaId === undefined) marcasLigadas.clear();
  else marcasLigadas.delete(marcaId);
}

async function marcaDesligada(marcaId: number): Promise<boolean> {
  const ate = marcasLigadas.get(marcaId);
  if (ate !== undefined && ate > Date.now()) return false;

  let marca;
  try {
    marca = await storage.getMarca(marcaId);
  } catch {
    // Banco fora do ar nao pode virar bloqueio em massa — mesma escolha de
    // `provedorSuspenso`. O que se protege aqui e regra comercial.
    return false;
  }

  // Marca ausente nao e marca desligada: a sessao aponta para uma linha que
  // sumiu, e isso e defeito, nao estado comercial. Bloquear aqui esconderia a
  // causa real atras de um texto errado — as rotas ja respondem 404 sozinhas.
  if (!marca) return false;
  if (marca.ativo) {
    marcasLigadas.set(marcaId, Date.now() + TTL_STATUS_ATIVO_MS);
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
 * `providerId` 0 deixou de ser hipotese com a fase 1: e o valor gravado na
 * sessao de todo revendedor. Ele ja e barrado antes, pelo 403 central de
 * `requireAuth`, e esta linha e a segunda barreira — a que continua de pe se
 * alguem escrever uma rota de provedor sem a primeira.
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

/**
 * Admin DO PROVEDOR (ou superadmin). O revendedor NAO entra aqui.
 *
 * Vale dizer porque a intuicao puxa para o outro lado: o revendedor "administra"
 * provedores, e chamar isto de administracao seria natural. Mas as rotas que
 * usam este middleware sao as do painel de UM provedor e gravam com
 * `session.providerId` — na sessao do revendedor esse valor e 0, e um "admin"
 * sem provedor escreveria no vazio ou na FK. Aceitar aqui daria ao papel
 * comercial exatamente o acesso operacional que ele nao tem.
 *
 * Ele e recusado duas vezes, em eixos diferentes: por papel nesta funcao, e pelo
 * 403 central de `requireAuth`, que nem deixa a requisicao chegar.
 */
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

function ehSuperadmin(req: Request): boolean {
  return !!req.session.userId && req.session.role === "superadmin";
}

/**
 * As rotas da PLATAFORMA — as que enxergam todos os provedores.
 *
 * A personificacao preserva `session.role` de proposito: o suporte continua
 * sendo superadmin, e e por isso que ele consegue operar a conta do provedor.
 * O efeito colateral e que a comparacao por papel, sozinha, deixava toda rota
 * de plataforma responder de dentro da janela — `GET /api/admin/providers`
 * devolvia a lista INTEIRA de provedores, com CNPJ, contato, plano e credito,
 * para uma sessao que so o provedor A autorizou.
 *
 * A liberacao que A assinou autoriza olhar o dado de A. Usar essa mesma janela
 * para ler o dado de B e furar exatamente o isolamento entre tenants que o
 * produto vende — e nao adianta tirar o link da barra lateral, porque a
 * resposta vem de chamar a API direto.
 *
 * Entao a recusa mora AQUI, no unico ponto por onde as ~30 rotas de plataforma
 * passam, e nao em cada tela. Quem escrever uma rota nova de superadmin herda a
 * regra sem precisar lembrar dela.
 *
 * As excecoes sao as duas rotas do PROPRIO fluxo de suporte — entrar e sair —,
 * que usam `requireSuperAdminMesmoNoSuporte`. Barrar a saida prenderia o
 * atendente dentro do provedor ate a janela expirar sozinha, e barrar a entrada
 * trocaria o 409 dela ("voce ja esta no provedor X") por um 403 que nao diz de
 * onde sair. Nenhuma das duas devolve dado de provedor nenhum.
 */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!ehSuperadmin(req)) {
    return res.status(403).json({ message: "Acesso restrito ao administrador do sistema" });
  }
  if (req.session.suporte) {
    return res.status(403).json({
      message: "Encerre o acesso de suporte para voltar as telas da plataforma.",
      code: CODIGO_SUPORTE_SEM_PLATAFORMA,
    });
  }
  next();
}

/**
 * Superadmin, valendo TAMBEM dentro da personificacao.
 *
 * Existe para as duas rotas que ABREM e FECHAM a janela, e para mais nenhuma:
 * `.../:providerId/entrar` e `.../sair`. As duas tem regra propria e nenhuma
 * devolve dado de provedor. Qualquer outra rota de plataforma tem de usar
 * `requireSuperAdmin`, que recusa na janela — ha um teste que conta as
 * ocorrencias desta funcao e falha se ela aparecer em mais algum lugar.
 */
export function requireSuperAdminMesmoNoSuporte(req: Request, res: Response, next: NextFunction) {
  if (!ehSuperadmin(req)) {
    return res.status(403).json({ message: "Acesso restrito ao administrador do sistema" });
  }
  next();
}

/**
 * Codigos que o client reconhece para saber o que fazer com a tela.
 *
 * O status sozinho nao serve: 403 e a resposta de dezenas de rotas, e a faixa
 * vermelha precisa distinguir "a liberacao acabou, saia do provedor e avise por
 * que" de "voce nao tem permissao para isto". Sao constantes exportadas para
 * que o client e os testes leiam a mesma string que o servidor escreve.
 */
export const CODIGO_SUPORTE_ENCERRADO = "SUPPORT_ACCESS_ENDED";
export const CODIGO_SUPORTE_NAO_VERIFICADO = "SUPPORT_ACCESS_UNVERIFIED";

/**
 * Tela da plataforma pedida de dentro de uma janela de suporte.
 *
 * Nao e "sem permissao": o atendente TEM o papel, e a tela volta sozinha assim
 * que ele sair do provedor. O client usa este codigo para dizer isso, em vez de
 * um "acesso negado" que mandaria abrir chamado.
 */
export const CODIGO_SUPORTE_SEM_PLATAFORMA = "SUPPORT_PLATFORM_BLOCKED";

/** Desfaz a personificacao. Idempotente: chamar duas vezes nao muda nada. */
export function encerrarPersonificacao(session: Request["session"]): void {
  session.providerId = 0;
  delete session.suporte;
}

/**
 * Intervalo minimo entre duas gravacoes de uso da MESMA janela.
 *
 * `registrarUsoDoAcesso` e um UPDATE, e a trava roda em toda requisicao: sem
 * limite, uma tela que dispara oito chamadas ao abrir gravaria oito linhas de
 * uso, e `usos` — que a trilha exibe — viraria "numero de requisicoes HTTP",
 * um numero de quatro digitos que nao responde nenhuma pergunta de auditoria.
 * Com a amostragem, `usos` conta janelas de um minuto em que houve atividade,
 * `ultimo_uso_em` fica com precisao de um minuto (suficiente para "ate quando
 * ficou") e o primeiro acesso continua sendo gravado na hora, porque o mapa
 * comeca vazio.
 */
const INTERVALO_REGISTRO_DE_USO_MS = 60_000;
const proximoRegistroDeUso = new Map<number, number>();

/** Zera a amostragem de uso. Serve aos testes. */
export function esquecerRegistrosDeUso(): void {
  proximoRegistroDeUso.clear();
}

/**
 * Grava que a janela foi usada, no maximo uma vez por minuto.
 *
 * Nao lanca: a autorizacao desta requisicao foi decidida pela LEITURA que veio
 * antes, e o nucleo da trilha (quem liberou, quem entrou, quando) ja esta
 * gravado desde o POST de entrar. Derrubar a requisicao porque a amostra de
 * atividade nao foi escrita trocaria um dado acessorio por uma tela quebrada.
 * Em caso de falha a marca e removida, para a proxima requisicao tentar de novo
 * em vez de esperar o minuto inteiro.
 */
export async function marcarUsoDoAcesso(acessoId: number, usadoPor: number): Promise<void> {
  const agora = Date.now();
  const proximo = proximoRegistroDeUso.get(acessoId);
  if (proximo !== undefined && proximo > agora) return;
  proximoRegistroDeUso.set(acessoId, agora + INTERVALO_REGISTRO_DE_USO_MS);

  // O mapa e limitado pelo numero de janelas de suporte, mas nada o esvazia
  // sozinho: uma limpeza barata das entradas vencidas evita que um processo de
  // meses acumule uma chave por janela ja encerrada.
  if (proximoRegistroDeUso.size > 200) {
    proximoRegistroDeUso.forEach((ate, id) => {
      if (ate <= agora) proximoRegistroDeUso.delete(id);
    });
  }

  try {
    await storage.registrarUsoDoAcesso(acessoId, usadoPor);
  } catch (err: any) {
    proximoRegistroDeUso.delete(acessoId);
    logger.warn({ acessoId, usadoPor, err: err?.message }, "[suporte] falha ao registrar uso do acesso");
  }
}

/**
 * A TRAVA. Roda em toda requisicao de API e confere no BANCO se a
 * personificacao em curso continua autorizada.
 *
 * POR QUE POR REQUISICAO, E NAO SO NA ENTRADA.
 *
 * A sessao dura 48h; a liberacao dura 2h. Conferir apenas no POST de entrar
 * deixaria uma sessao aberta as 14h valendo as 20h, com a autorizacao vencida
 * havia quatro horas — e "revogar" so fecharia a porta na cara de quem ainda
 * nao entrou, que e exatamente quem nao importa. O provedor clica em encerrar
 * porque quer o suporte FORA agora.
 *
 * CUSTO. E uma consulta por requisicao, e por isso a primeira linha e a saida
 * antecipada: sessao sem `suporte` — todo operador, todo admin, todo superadmin
 * fora de personificacao, ou seja, a esmagadora maioria — nao toca o banco. Só
 * paga quem esta dentro do dado de outro provedor.
 *
 * POR QUE A TRAVA NAO OLHA MAIS O CAMINHO.
 *
 * Ate 04/09/2026 havia uma segunda saida antecipada, por caminho:
 * `if (!req.path.startsWith("/api")) return next()`, com o argumento de que os
 * assets da SPA nao servem dado nenhum. O argumento era bom e a linha era um
 * furo: o roteamento do Express NAO e sensivel a caixa (nao ha
 * `app.set("case sensitive routing", true)`, e o default e false), mas
 * `startsWith` e. Medido no express 5.2.1 deste `node_modules`:
 * `GET /api/isp-consultations` chega ao handler COM a trava aplicada, e
 * `GET /API/isp-consultations` chega ao MESMO handler com a trava pulada. Bastava
 * trocar uma letra de caixa para continuar lendo CPF, nome e telefone dos
 * titulares do provedor DEPOIS de ele ter clicado em encerrar — e, como o uso so
 * era carimbado dentro da trava, a trilha ainda registrava que o suporte tinha
 * parado.
 *
 * Comparar em caixa baixa fecharia este caso. Nao foi o escolhido: a saida
 * antecipada por caminho e uma decisao de autorizacao que erra PARA O LADO DE
 * DEIXAR PASSAR, e qualquer divergencia futura entre o texto que o Express casa
 * e o texto que esta funcao compara reabre o mesmo buraco em silencio (barra
 * final, barra dupla, percent-encoding, uma rota nova fora de `/api`). Para uma
 * sessao que ESTA personificando nao existe requisicao que mereca passar sem
 * revalidar — nem um asset —, entao a saida simplesmente deixou de existir e a
 * classe inteira de desvio por caminho deixa de ser possivel por construcao.
 * O custo real e limitado: quem paga a consulta extra por asset e apenas a
 * sessao de suporte, que e rara, curta e monitorada.
 *
 * E DE PROPOSITO QUE NAO HA CACHE aqui, ao contrario de `provedorSuspenso`:
 * cachear o veredito positivo por 30s daria ao suporte ate 30s de sobrevida
 * depois do clique em encerrar. La o que se protege e cobranca; aqui e dado
 * pessoal de titular que nunca autorizou este leitor.
 */
export async function travaDeAcessoDeSuporte(req: Request, res: Response, next: NextFunction) {
  const suporte = req.session?.suporte;
  const superadminId = req.session?.userId;
  // Sem `suporte` — todo operador, todo admin, todo superadmin fora de
  // personificacao — nao ha o que verificar e o banco nao e tocado. Sem
  // `userId` a sessao nem esta autenticada: `requireAuth` a recusa logo
  // adiante, e aqui nao haveria a quem atribuir o uso na trilha.
  if (!suporte || !superadminId) return next();

  /**
   * PERSONIFICACAO ORFA — a sessao trocou de dono e o `suporte` ficou.
   *
   * `POST /api/auth/login` (server/routes/auth.routes.ts) sobrescreve `userId`,
   * `providerId` e `role` e NAO apaga `session.suporte`; a sessao tambem nao e
   * regenerada. Uma sessao que personificava o provedor Y e faz login de novo
   * fica com uma janela de Y pendurada na identidade de quem acabou de entrar —
   * e, sem estas duas linhas, a trava continuaria validando a janela de Y e
   * carimbando uso dela com o userId novo, sujando a trilha de auditoria com
   * atividade de quem nunca personificou ninguem.
   *
   * O conserto certo e o login limpar o que ele mesmo invalida; esta e a
   * blindagem do lado de ca, para o buraco nao depender de um arquivo so.
   *
   * Papel diferente de superadmin com `suporte` na sessao E orfao por
   * definicao: a personificacao nao mexe em `role` (ver
   * `PersonificacaoDeSuporte`), entao "admin" ou "user" aqui so pode ter vindo
   * de outro login. Apaga a sobra e SEGUE — o `providerId` desta sessao veio do
   * login proprio dela, e derrubar seria expulsar um usuario legitimo por causa
   * de lixo que ele nao criou. Nao se usa `encerrarPersonificacao`, que zeraria
   * esse `providerId` legitimo.
   */
  if (req.session.role !== "superadmin") {
    delete req.session.suporte;
    logger.warn(
      { userId: superadminId, role: req.session.role, providerId: suporte.providerId, acessoId: suporte.acessoId },
      "[suporte] personificacao orfa descartada: a sessao trocou de dono (login sem limpar `suporte`)",
    );
    return next();
  }

  /**
   * A janela e o provedor aberto TEM de ser o mesmo. Se divergirem, ninguem
   * sabe qual dos dois vale, e continuar seria autorizar leitura de um provedor
   * com a autorizacao de outro. Acontece quando um superadmin que estava dentro
   * de Y faz login de novo: `providerId` volta a 0 e a janela de Y sobra.
   * Derruba a personificacao e recusa esta requisicao; a seguinte ja e uma
   * sessao de superadmin comum. Nao toca o banco: a incoerencia esta na sessao.
   */
  if (
    !Number.isInteger(suporte.providerId) ||
    suporte.providerId <= 0 ||
    suporte.providerId !== req.session.providerId
  ) {
    logger.warn(
      { superadminId, providerIdDaJanela: suporte.providerId, providerIdDaSessao: req.session.providerId, acessoId: suporte.acessoId },
      "[suporte] personificacao incoerente com a sessao: encerrada",
    );
    encerrarPersonificacao(req.session);
    return res.status(403).json({
      message: "A liberacao de acesso de suporte terminou.",
      code: CODIGO_SUPORTE_ENCERRADO,
    });
  }

  let valido;
  try {
    valido = await storage.acessoDeSuporteValido(suporte.providerId);
  } catch (err: any) {
    // Fail-CLOSED, e sem apagar a personificacao. Banco indisponivel nao e
    // "a liberacao acabou": nao da para afirmar isso, entao a requisicao nao
    // passa. Limpar a sessao aqui obrigaria o provedor a autorizar de novo por
    // causa de um soluco de rede, e nada vazou — a requisicao foi recusada.
    logger.error(
      { superadminId, providerId: suporte.providerId, acessoId: suporte.acessoId, err: err?.message },
      "[suporte] nao foi possivel verificar a liberacao",
    );
    return res.status(503).json({
      message: "Nao foi possivel confirmar a liberacao de suporte. Tente novamente.",
      code: CODIGO_SUPORTE_NAO_VERIFICADO,
    });
  }

  // Id diferente tambem derruba: se o provedor revogou e liberou de novo, a
  // janela nova e outra autorizacao, e quem estava dentro tem de entrar por
  // ela. Sem essa comparacao, um "revogar" seguido de "liberar" para atender
  // outra pessoa emendaria silenciosamente a sessao antiga na janela nova.
  if (!valido || valido.id !== suporte.acessoId) {
    logger.info(
      { superadminId, providerId: suporte.providerId, acessoId: suporte.acessoId },
      "[suporte] personificacao encerrada: liberacao revogada ou expirada",
    );
    encerrarPersonificacao(req.session);
    return res.status(403).json({
      message: "A liberacao de acesso de suporte terminou.",
      code: CODIGO_SUPORTE_ENCERRADO,
    });
  }

  await marcarUsoDoAcesso(valido.id, superadminId);
  next();
}
