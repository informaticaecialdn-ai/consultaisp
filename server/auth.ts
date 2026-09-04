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
    /** Marca vigente no login. Guardada para a UI e para diagnostico. */
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
