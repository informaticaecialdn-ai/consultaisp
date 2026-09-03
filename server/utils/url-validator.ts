/**
 * ERP URL validation with configurable policy.
 *
 * Strict defaults for production internet targets, but allows controlled
 * exceptions for known/private ERP endpoints via:
 *   - ERP_ALLOW_PRIVATE_NETWORK=true  (env flag — enables HTTP and private IPs)
 *   - ERP_URL_ALLOWLIST=host1,host2   (env flag — specific hosts always accepted)
 *
 * Alem da politica de rede, esta funcao julga o FORMATO do endereco base. O
 * motivo esta na secao "endereco de tela" abaixo: um endereco copiado da barra
 * do navegador entra aqui com aparencia de URL valida e sai como integracao que
 * nunca autentica.
 */

/** Result returned by validateErpUrl with actionable detail. */
export interface ErpUrlValidationResult {
  valid: boolean;
  /** Human-readable reason for rejection (Portuguese). */
  reason?: string;
}

const PRIVATE_IP_RE =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/;

const LOCAL_SUFFIXES = [".local", ".internal"];

function isPrivateHost(host: string): boolean {
  if (
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]"
  ) {
    return true;
  }
  if (LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (PRIVATE_IP_RE.test(host)) return true;
  return false;
}

/**
 * ===== ENDERECO DE TELA versus ENDERECO DE SERVIDOR =====
 *
 * Incidente real (03/09/2026, SGP do provedor 6): o operador colou no campo de
 * URL o endereco para onde o SGP joga quem nao esta logado —
 * `https://amplisinal.sgp.net.br/accounts/login?next=/admin/`. Era o que estava
 * na barra do navegador dele. Esta funcao aceitou, porque so olhava protocolo e
 * host.
 *
 * O estrago: todos os conectores montam a chamada CONCATENANDO um caminho na
 * base. Com aquela URL, `${base}/api/ura/titulos/` virou
 * `.../accounts/login?next=/admin/api/ura/titulos/` — o caminho foi parar
 * DENTRO da query. O SGP respondeu 200 com a pagina de login em HTML, o teste
 * de conexao disse "conexao ok", e a varredura passaria a ler zero
 * inadimplentes de uma pagina de login. Como a lista vazia e usada como prova
 * negativa (quem nao esta nela tem a divida baixada), um "ok" mentiroso aqui
 * pode limpar a inadimplencia de um provedor inteiro.
 *
 * Por que NAO da para simplesmente proibir caminho: ha ERP legitimo com caminho
 * na base. O MK de producao e `http://170.231.148.99:8080/mk`, o Hubsoft pede a
 * base terminando em `/api` e o RBX guarda o endpoint inteiro
 * (`.../routerbox/ws/rbx_server_json.php`). Proibir caminho quebraria os tres
 * hoje. A regra tem de separar caminho de instalacao de endereco de tela.
 *
 * Os tres sinais abaixo foram escolhidos por barrarem de MENOS: cada um deles
 * so aparece em endereco de navegacao, e um falso positivo aqui impede um
 * provedor legitimo de se integrar.
 */

/**
 * Ultimo pedaco do caminho que denuncia tela de acesso, comparado como palavra
 * inteira. Comparar como palavra inteira e o que evita barrar caminho legitimo:
 * `/logistica` e `/authorize` continuam passando, so `/login` e `/auth` caem.
 *
 * Nao entram nesta lista palavras que um ERP poderia usar como area de API
 * ("admin", "acesso", "oauth", "painel"): na duvida, deixa passar — o teste de
 * conexao ainda vai reprovar, e com mensagem do ERP.
 */
const TELAS_DE_ACESSO = new Set([
  "login",
  "logon",
  "signin",
  "sign-in",
  "sign_in",
  "signon",
  "logout",
  "signout",
  "sign-out",
  "entrar",
  "sair",
  "auth",
  "autenticacao",
  "autenticação",
  "autenticar",
]);

/** Extensoes de pagina que so embrulham o nome da tela (`login.php`). */
const EXTENSOES_DE_PAGINA = /\.(php|html?|aspx?|jsp)$/;

/**
 * Ultimo segmento do caminho, minusculo e sem extensao de pagina.
 * Devolve "" para caminho vazio ou so barra.
 */
function ultimoSegmento(pathname: string): string {
  const partes = pathname.split("/").filter(Boolean);
  const cru = partes[partes.length - 1] ?? "";
  // O caminho chega percent-encoded, entao "autenticação" viraria
  // "autentica%C3%A7%C3%A3o" e escaparia da lista sem decodificar.
  let ultimo = cru;
  try {
    ultimo = decodeURIComponent(cru);
  } catch {
    // Percent-encoding quebrado nao e tela de acesso; segue com o texto cru.
  }
  return ultimo.toLowerCase().replace(EXTENSOES_DE_PAGINA, "");
}

/**
 * Endereco sem o trecho de navegacao: protocolo, host, porta e caminho.
 * E o que sobra quando se apaga do "?" (ou do "#") em diante — serve de exemplo
 * na mensagem para o operador nao ter que adivinhar o que cortar.
 */
function enderecoSemNavegacao(parsed: URL): string {
  const caminho = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${caminho}`;
}

/**
 * Recusa endereco de tela. Devolve `null` quando o formato esta aceitavel.
 *
 * Roda ANTES do ERP_URL_ALLOWLIST de proposito: a allowlist existe para abrir
 * excecao de REDE (host interno, HTTP), nunca para aceitar um endereco digitado
 * errado. Host liberado com URL de tela de login continua sendo integracao que
 * nao autentica.
 */
function recusarEnderecoDeTela(
  raw: string,
  parsed: URL,
): ErpUrlValidationResult | null {
  // Sinal 1 — tela de acesso no fim do caminho. E o caso do incidente: o
  // endereco que o ERP mostra a quem NAO esta logado.
  const segmento = ultimoSegmento(parsed.pathname);
  if (TELAS_DE_ACESSO.has(segmento)) {
    return {
      valid: false,
      reason:
        `O endereco informado termina em "${segmento}", que e a tela de acesso do sistema, e nao o endereco do servidor. ` +
        `Esse e o endereco que aparece no navegador quando voce ainda nao entrou. ` +
        `Informe o endereco do sistema sem a parte da tela — no seu caso, algo como ${parsed.origin}.`,
    };
  }

  // Sinal 2 — query string. Nenhum dos ERPs guarda "?" na base: todos
  // concatenam o caminho da chamada nela, e o "?" empurra esse caminho para
  // dentro da query. O que vem depois do "?" e navegacao do navegador
  // (ex.: para onde voltar depois do login), nunca parte do servidor.
  if (raw.includes("?")) {
    return {
      valid: false,
      reason:
        `O endereco tem um trecho depois do "?", que so serve para a navegacao no navegador e nao faz parte do endereco do servidor. ` +
        `Apague do "?" em diante — deve sobrar ${enderecoSemNavegacao(parsed)}.`,
    };
  }

  // Sinal 3 — fragmento. Mesma historia do "?": "#" e posicao dentro da
  // pagina, o servidor nunca chega a receber.
  if (raw.includes("#")) {
    return {
      valid: false,
      reason:
        `O endereco tem um trecho depois do "#", que so vale dentro da pagina no navegador e nao chega ao servidor. ` +
        `Apague do "#" em diante — deve sobrar ${enderecoSemNavegacao(parsed)}.`,
    };
  }

  return null;
}

function getAllowlist(): Set<string> {
  const raw = process.env.ERP_URL_ALLOWLIST?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isPrivateNetworkAllowed(): boolean {
  return process.env.ERP_ALLOW_PRIVATE_NETWORK === "true";
}

/**
 * Validates an ERP URL and returns an actionable result.
 *
 * Policy:
 *  - Endereco de tela (query, fragmento, caminho de tela de acesso) e recusado
 *    sempre — ver o bloco "ENDERECO DE TELA versus ENDERECO DE SERVIDOR".
 *  - By default only HTTPS to public hosts is accepted.
 *  - If ERP_ALLOW_PRIVATE_NETWORK=true, HTTP and private/local hosts are allowed.
 *  - Hosts listed in ERP_URL_ALLOWLIST are always accepted regardless of NETWORK policy.
 */
export function validateErpUrl(raw: string): ErpUrlValidationResult {
  try {
    // Colar da barra do navegador costuma trazer espaco junto; ele nao muda o
    // endereco e nao deve custar uma mensagem de erro ao operador.
    const texto = raw.trim();
    const url = texto.startsWith("http") ? texto : `https://${texto}`;
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const allowlist = getAllowlist();

    // Formato antes de tudo: nem a allowlist aceita endereco de tela.
    const formato = recusarEnderecoDeTela(texto, parsed);
    if (formato) return formato;

    // Allowlisted hosts bypass the network checks
    if (allowlist.has(host)) {
      return { valid: true };
    }

    const privateAllowed = isPrivateNetworkAllowed();

    // Protocol check
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return {
        valid: false,
        reason:
          "Protocolo invalido. Use uma URL com HTTPS (ex: https://erp.exemplo.com.br).",
      };
    }

    if (parsed.protocol === "http:" && !privateAllowed) {
      return {
        valid: false,
        reason:
          "URLs HTTP nao sao permitidas em modo de producao. " +
          "Use HTTPS ou configure ERP_ALLOW_PRIVATE_NETWORK=true para permitir HTTP em redes privadas.",
      };
    }

    // Private/local host check
    if (isPrivateHost(host) && !privateAllowed) {
      return {
        valid: false,
        reason:
          "Enderecos privados ou locais (localhost, IPs internos, .local) nao sao permitidos em modo de producao. " +
          "Configure ERP_ALLOW_PRIVATE_NETWORK=true ou adicione o host em ERP_URL_ALLOWLIST para permitir.",
      };
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      reason:
        "URL invalida. Informe uma URL valida (ex: https://erp.exemplo.com.br/api).",
    };
  }
}

/**
 * Simple boolean check — kept for backwards compatibility.
 * Delegates to validateErpUrl.
 */
export function isAllowedErpUrl(raw: string): boolean {
  return validateErpUrl(raw).valid;
}
