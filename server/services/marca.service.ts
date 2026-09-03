/**
 * Resolve QUAL marca o visitante esta vendo, a partir do host da requisicao.
 *
 * Este e o ponto de entrada do white label inteiro: tudo — titulo da aba,
 * favicon, cor de botao, logo, remetente de e-mail, texto de LGPD — desce
 * daqui. Se esta funcao erra, o cliente de um revendedor ve a marca de outro.
 *
 * Tres caminhos, nesta ordem:
 *
 *   consultaisp.com.br / www          -> plataforma, contexto "plataforma" (landing)
 *   <sub>.consultaisp.com.br          -> provedor pelo subdominio -> marca dele
 *   qualquer outro host               -> busca em marcas.dominio
 *
 * Host desconhecido cai na plataforma: alguem que aponta um dominio solto pro
 * servidor ve a landing, nao um erro.
 *
 * SOBRE O CACHE: roda em TODA requisicao de HTML. Sem cache seriam duas
 * consultas por pageview so para escrever o <title>. O cache e invalidado na
 * gravacao (`esquecerMarcas`) e tem TTL curto de reserva — a API e um processo
 * pm2 unico, entao nao ha segunda copia para divergir.
 */
import { storage } from "../storage";
import { MAIN_DOMAIN, extractSubdomainFromHost, buildSubdomainUrl } from "../tenant";
import { normalizarHost } from "../storage/marcas.storage";
import { paletaClara, paletaEscura, corValida, type Paleta } from "../utils/marca-cores";
import type { Marca } from "@shared/schema";

export type MarcaResolvida = {
  /** Como chegamos nesta marca. So para diagnostico e log. */
  origem: "plataforma" | "subdominio" | "dominio-proprio";
  /**
   * "tenant" = este host pertence a um provedor ou revendedor, entao sem sessao
   * a tela certa e o LOGIN. "plataforma" = landing.
   *
   * Existe porque o client decidia isso sozinho com `getSubdomain()`, e num
   * dominio proprio (app.crednet.com.br) aquilo da null — o cliente do
   * revendedor cairia na landing do Consulta ISP.
   */
  contexto: "plataforma" | "tenant";
  marcaId: number | null;
  /** Dominio proprio, quando houver. Alimenta os links absolutos do e-mail. */
  dominio: string | null;
  /** So true depois que o certificado foi emitido — ver marcas.dominioStatus. */
  dominioAtivo: boolean;
  nomeProduto: string;
  assinatura: string | null;
  /** null = renderiza o componente SVG embutido da plataforma. */
  logoUrl: string | null;
  faviconUrl: string;
  /** null = usa os tokens de client/src/index.css sem sobrescrever nada. */
  cores: { claro: Paleta; escuro: Paleta } | null;
  suporteEmail: string | null;
  suporteWhatsapp: string | null;
  site: string | null;
  responsavelRazaoSocial: string | null;
  responsavelCnpj: string | null;
  emailRemetente: string | null;
  emailNomeExibicao: string | null;
};

/**
 * A marca da propria plataforma. Nao vive no banco de proposito: e o fallback,
 * e um fallback que depende de linha no banco falha exatamente quando o banco
 * falha. Os valores espelham client/index.html e client/src/index.css.
 *
 * `cores: null` e importante — para a plataforma nada e sobrescrito, e o
 * index.css continua sendo a fonte da verdade. Assim o white label nao tem como
 * causar regressao de cor na marca principal.
 */
export const MARCA_PLATAFORMA: MarcaResolvida = {
  origem: "plataforma",
  contexto: "plataforma",
  marcaId: null,
  dominio: MAIN_DOMAIN,
  dominioAtivo: true,
  nomeProduto: "Consulta ISP",
  assinatura: "Base colaborativa de crédito",
  logoUrl: null,
  faviconUrl: "/marca/favicon.svg",
  cores: null,
  suporteEmail: null,
  suporteWhatsapp: null,
  site: `https://${MAIN_DOMAIN}`,
  responsavelRazaoSocial: null,
  responsavelCnpj: null,
  emailRemetente: null,
  emailNomeExibicao: null,
};

const TTL_MS = 5 * 60_000;

/**
 * Teto do cache.
 *
 * A chave e o host da requisicao — que o CLIENTE controla, via `Host` ou
 * `X-Forwarded-Host`. Sem teto, um Map de modulo cresce enquanto alguem inventar
 * hosts, e o pm2 reinicia a API ao bater `max_memory_restart`. Nao e vazamento
 * de dado (host desconhecido resolve para a plataforma), mas derruba o processo.
 *
 * 500 e folgado: sao os dominios das marcas mais os subdominios dos provedores.
 * O descarte e FIFO — o Map itera na ordem de insercao.
 */
const TETO_CACHE = 500;

/**
 * Um hostname de verdade. Serve para descartar lixo ANTES de consultar o banco
 * e antes de ocupar uma linha do cache: quem manda `Host: <4000 caracteres>` nao
 * chega a custar nada.
 */
const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

const cache = new Map<string, { valor: MarcaResolvida; expira: number }>();

/**
 * Segundo cache, chaveado pelo ID da marca.
 *
 * Nao da para reaproveitar o de host: a mesma marca e alcancada por host (quem
 * navega) e por id (e-mail disparado pelo worker, prova de host do revendedor),
 * e ha marca sem dominio nenhum — ela nao tem chave no primeiro mapa.
 *
 * A chave aqui vem do banco, nao do cliente, entao o teto e so higiene.
 */
const cachePorId = new Map<number, { valor: MarcaResolvida; expira: number }>();

/** Chamar sempre que uma marca for gravada, apagada ou revinculada. */
export function esquecerMarcas(): void {
  cache.clear();
  cachePorId.clear();
}

export async function resolverMarcaPorHost(hostBruto: string | undefined): Promise<MarcaResolvida> {
  const host = normalizarHost(hostBruto);
  if (!host || host.length > 253 || !HOSTNAME.test(host)) return MARCA_PLATAFORMA;

  const emCache = cache.get(host);
  if (emCache && emCache.expira > Date.now()) return emCache.valor;

  // Nunca lanca. Esta funcao roda no caminho que serve o HTML: uma excecao aqui
  // e pagina em branco, e nenhuma personalizacao vale isso. Marca com dado
  // corrompido no banco vira "sem marca", nao vira incidente.
  let resolvida: MarcaResolvida;
  try {
    resolvida = await resolver(host);
  } catch {
    resolvida = MARCA_PLATAFORMA;
  }

  // Descarte FIFO ao encher: o Map itera na ordem de insercao, entao a primeira
  // chave e a mais antiga. Sem isto o cache cresce enquanto houver host novo.
  if (cache.size >= TETO_CACHE) {
    const maisAntiga = cache.keys().next().value;
    if (maisAntiga !== undefined) cache.delete(maisAntiga);
  }
  cache.set(host, { valor: resolvida, expira: Date.now() + TTL_MS });
  return resolvida;
}

async function resolver(host: string): Promise<MarcaResolvida> {
  // 1. dominio da plataforma, com ou sem www
  if (host === MAIN_DOMAIN || host === `www.${MAIN_DOMAIN}`) return MARCA_PLATAFORMA;

  // 2. subdominio da plataforma -> provedor -> marca dele
  if (host.endsWith(`.${MAIN_DOMAIN}`)) {
    const sub = host.slice(0, -(MAIN_DOMAIN.length + 1));
    // Um subdominio de dois niveis (a.b.consultaisp.com.br) nao e um tenant.
    if (!sub || sub.includes(".")) return MARCA_PLATAFORMA;

    const marca = await storage.getMarcaPorSubdominio(sub).catch(() => undefined);
    if (marca && marca.ativo) return montar(marca, "subdominio");

    // Provedor sem marca ainda e tenant: a tela e o login, com a marca da casa.
    return { ...MARCA_PLATAFORMA, origem: "subdominio", contexto: "tenant" };
  }

  // 3. dominio proprio de um revendedor
  const marca = await storage.getMarcaPorDominio(host).catch(() => undefined);
  if (marca && marca.ativo) return montar(marca, "dominio-proprio");

  // Host desconhecido: landing da plataforma.
  return MARCA_PLATAFORMA;
}

function montar(m: Marca, origem: MarcaResolvida["origem"]): MarcaResolvida {
  return {
    origem,
    contexto: "tenant",
    marcaId: m.id,
    dominio: m.dominio ?? null,
    dominioAtivo: m.dominioStatus === "ativo",
    nomeProduto: m.nomeProduto,
    assinatura: m.assinatura ?? null,
    // Nunca embutimos o SVG do revendedor na pagina: ele e servido por URL e
    // carregado em <img>, onde o navegador DESLIGA script. Ver marca.routes.ts.
    logoUrl: m.logoSvg || m.logoPng ? `/api/marca/${m.id}/logo` : null,
    faviconUrl: m.faviconSvg ? `/api/marca/${m.id}/favicon` : MARCA_PLATAFORMA.faviconUrl,
    cores: corValida(m.corBrand)
      ? { claro: paletaClara(m.corBrand), escuro: paletaEscura(m.corBrand, m.corBrandDark) }
      : null,
    suporteEmail: m.suporteEmail ?? null,
    suporteWhatsapp: m.suporteWhatsapp ?? null,
    site: m.site ?? null,
    responsavelRazaoSocial: m.responsavelRazaoSocial ?? null,
    responsavelCnpj: m.responsavelCnpj ?? null,
    emailRemetente: m.emailRemetente ?? null,
    emailNomeExibicao: m.emailNomeExibicao ?? null,
  };
}

/**
 * Em desenvolvimento o host e `localhost`, que nao prova nada — sem esta
 * excecao a regra reprovaria TODO login local e ninguem conseguiria trabalhar.
 *
 * E deliberadamente estreita: so estes tres literais, e so fora de producao.
 * Um provedor cadastrado com o dominio "localhost" em producao continua sendo
 * avaliado pela regra normal.
 */
function ehHostDeDesenvolvimento(host: string): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * A marca de um provedor, sem passar pelo host.
 *
 * Para quem roda FORA de uma requisicao — e-mail de alerta disparado pelo
 * worker, tarefa agendada. Sem isto, esses avisos sairiam sempre com a marca da
 * plataforma, contando ao cliente de um revendedor de quem ele comprou de fato.
 */
export async function resolverMarcaPorProviderId(providerId: number | null | undefined): Promise<MarcaResolvida> {
  if (!providerId) return MARCA_PLATAFORMA;
  try {
    const provider = await storage.getProvider(providerId);
    return await resolverMarcaPorId(provider?.marcaId);
  } catch {
    return MARCA_PLATAFORMA;
  }
}

/**
 * A marca pelo ID, sem host e sem provedor.
 *
 * E o caminho de quem JA sabe de qual marca esta falando: o e-mail que precisa
 * sair com a marca do provedor dono da conta (nao com a do host de onde o
 * pedido veio) e, na fase 1, a sessao do revendedor.
 *
 * Marca inativa devolve a plataforma de proposito — desligar a marca tem de
 * derrubar a pele em todo lugar, inclusive fora de requisicao.
 */
export async function resolverMarcaPorId(marcaId: number | null | undefined): Promise<MarcaResolvida> {
  if (!marcaId || !Number.isInteger(marcaId) || marcaId <= 0) return MARCA_PLATAFORMA;

  const emCache = cachePorId.get(marcaId);
  if (emCache && emCache.expira > Date.now()) return emCache.valor;

  let resolvida: MarcaResolvida;
  try {
    const marca = await storage.getMarca(marcaId);
    resolvida = marca?.ativo ? montar(marca, "dominio-proprio") : MARCA_PLATAFORMA;
  } catch {
    // Banco fora do ar nao vira linha de cache: senao um blip de conexao
    // apagaria a marca por cinco minutos.
    return MARCA_PLATAFORMA;
  }

  if (cachePorId.size >= TETO_CACHE) {
    const maisAntiga = cachePorId.keys().next().value;
    if (maisAntiga !== undefined) cachePorId.delete(maisAntiga);
  }
  cachePorId.set(marcaId, { valor: resolvida, expira: Date.now() + TTL_MS });
  return resolvida;
}

/** Base absoluta dos links que a marca manda por e-mail. */
export function urlDaMarca(marca: MarcaResolvida): string {
  if (marca.dominio && marca.dominioAtivo && marca.marcaId) return `https://${marca.dominio}`;
  return process.env.APP_URL || `https://${MAIN_DOMAIN}`;
}

/**
 * O endereco por onde ESTE provedor consegue entrar.
 *
 * Nao e a mesma coisa que `urlDaMarca`. Sem dominio de marca ativo aquela cai
 * na RAIZ da plataforma — e a raiz e justamente onde `hostPertenceAoProvider`
 * recusa o login. O e-mail de verificacao e o de "esqueci minha senha" levavam
 * o usuario para uma tela que responde "Email ou senha incorretos" sem dizer
 * por que.
 *
 * Ordem: dominio da marca quando ativo (o endereco que o cliente do revendedor
 * conhece), senao o subdominio do provedor. Sem nenhum dos dois nao existe
 * endereco valido — devolve a base da marca so para o link nao sair quebrado, e
 * esse provedor precisa de cadastro antes de conseguir logar.
 */
export function urlDeEntrada(
  provider: { subdomain?: string | null } | null | undefined,
  marca: MarcaResolvida,
): string {
  if (marca.marcaId && marca.dominio && marca.dominioAtivo) return `https://${marca.dominio}`;
  const sub = provider?.subdomain?.trim();
  if (sub) return buildSubdomainUrl(sub);
  return urlDaMarca(marca);
}

/**
 * O host da requisicao prova que este provedor pertence aqui?
 *
 * E a UNICA prova de pertencimento host<->tenant do sistema, e a tentacao ao
 * adicionar dominio proprio e afrouxar a regra antiga ate "app.crednet.com.br"
 * passar. Isso escancararia o buraco: a regra antiga ja era fail-OPEN — em host
 * de dois rotulos ela era pulada inteira, e qualquer usuario de qualquer
 * provedor entrava.
 *
 * Entao a regra troca de EIXO em vez de afrouxar. Duas provas, ambas estritas:
 *
 *   host e o dominio da marca do provedor   -> provider.marcaId === marca.id
 *   host e o subdominio do provedor         -> provider.subdomain === rotulo
 *
 * Qualquer outra coisa RECUSA — inclusive o dominio raiz da plataforma e host
 * desconhecido. Ausencia de marca ou de subdominio no cadastro e falha de
 * autorizacao, nunca dispensa: provedor sem marca so entra pelo subdominio, e
 * provedor sem subdominio so entra pelo dominio da marca.
 */
export async function hostPertenceAoProvider(
  hostBruto: string | undefined,
  provider: { subdomain: string | null; marcaId: number | null },
): Promise<boolean> {
  const host = normalizarHost(hostBruto);
  if (!host) return false;
  if (ehHostDeDesenvolvimento(host)) return true;

  const marca = await resolverMarcaPorHost(host);

  if (marca.origem === "dominio-proprio") {
    return marca.marcaId != null && provider.marcaId === marca.marcaId;
  }

  if (marca.origem === "subdominio") {
    const rotulo = extractSubdomainFromHost(host);
    return !!rotulo && !!provider.subdomain && provider.subdomain === rotulo;
  }

  return false;
}

/**
 * O host da requisicao prova que quem loga responde por ESTA marca?
 *
 * Irma de `hostPertenceAoProvider`, para o outro papel: o revendedor. A regra e
 * mais estreita de proposito, e cada recusa tem motivo proprio.
 *
 *   dominio proprio da marca pedida  -> ACEITA (e o unico caminho)
 *   dominio de outra marca           -> recusa: cross-tenant, o caso grave
 *   marca inativa                    -> recusa: desligar a marca desliga o acesso
 *   dominio ainda pendente de HTTPS  -> recusa: sem certificado a sessao viaja
 *                                       em claro, e o superadmin so cria o
 *                                       usuario revendedor depois do HTTPS
 *   subdominio de provedor da marca  -> recusa: a sessao do revendedor nao nasce
 *                                       presa ao endereco de um CLIENTE dele
 *   raiz e www da plataforma         -> recusa: la quem manda e a plataforma
 *   host desconhecido                -> recusa
 *
 * Fail-closed em toda ausencia: sem marcaId nao ha o que provar. Nao ha ramo
 * que devolva true por nao ter conseguido decidir.
 */
export async function hostPertenceAMarca(
  hostBruto: string | undefined,
  marcaId: number | null | undefined,
): Promise<boolean> {
  if (!marcaId || !Number.isInteger(marcaId) || marcaId <= 0) return false;

  const host = normalizarHost(hostBruto);
  if (!host) return false;
  if (ehHostDeDesenvolvimento(host)) return true;

  const marca = await resolverMarcaPorHost(host);
  // `resolverMarcaPorHost` so devolve "dominio-proprio" para marca ATIVA; as
  // demais origens ja cobrem raiz, www, subdominio e host desconhecido.
  if (marca.origem !== "dominio-proprio") return false;
  if (marca.marcaId !== marcaId) return false;
  return marca.dominioAtivo;
}
