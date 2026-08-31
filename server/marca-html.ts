/**
 * Escreve a marca dentro do index.html, no momento de servir.
 *
 * POR QUE NAO BUSCAR NO CLIENT: o React montaria com a marca da plataforma e
 * trocaria depois. Flash da marca de um concorrente na tela de login de um
 * revendedor e inaceitavel — e nao existe spinner que conserte isso, porque o
 * problema e mostrar a coisa ERRADA, nao demorar.
 *
 * POR QUE MARCADOR E NAO REGEX POR TAG: <title> nao pode ser sobrescrito
 * anexando outro no fim (o navegador usa o PRIMEIRO), e a ordem de <link
 * rel="icon"> e ambigua entre navegadores. Entao o index.html declara uma faixa
 * entre `marca:inicio` e `marca:fim`, e ela e trocada inteira.
 *
 * PARA A PLATAFORMA, NADA E TRANSFORMADO. `injetarMarca` devolve o html
 * original sem tocar. E o que garante que o white label nao pode causar
 * regressao na marca principal: o caminho dela nao passa por aqui.
 *
 * ── SEGURANCA ──────────────────────────────────────────────────────────────
 * Tudo abaixo vem do banco e e digitado por um revendedor. O CSP do projeto
 * usa `script-src 'unsafe-inline'` (server/index.ts), entao um <script>
 * injetado EXECUTA. Cada contexto tem seu escape, e nenhum deles e opcional:
 *
 *   texto em HTML  -> escaparHtml
 *   dentro de <script> -> JSON.stringify + neutralizar "<" (senao "</script>"
 *                         fecha a tag e o resto da string vira codigo)
 *   cor em <style> -> validada por regex; o que nao casar derruba o bloco
 *                     INTEIRO de cor. Cor nao tem forma livre, entao rejeitar
 *                     e sempre melhor que sanitizar.
 *
 * O logo NAO aparece aqui: SVG de terceiro nunca e embutido na pagina. Ele e
 * servido por URL e carregado em <img>, onde o navegador desliga script — ver
 * server/routes/marca.routes.ts.
 */
import type { MarcaResolvida } from "./services/marca.service";

const INICIO = "<!-- marca:inicio -->";
const FIM = "<!-- marca:fim -->";

export function escaparHtml(v: string): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Serializa para dentro de <script>. `JSON.stringify` sozinho NAO basta:
 *
 *  - ele deixa "</script>" intacto, e o parser de HTML fecha a tag ANTES de o
 *    JS rodar — todo o resto da pagina vira conteudo do script;
 *  - U+2028 e U+2029 sao quebra de linha para o parser de JS (nao para o de
 *    JSON) e partem a expressao no meio.
 *
 * Os quatro viram escape unicode. O JSON.parse implicito do navegador desfaz na
 * leitura, entao o valor chega inteiro ao cliente — so que como DADO.
 */
/**
 * Os quatro pontos de codigo listados por numero, e nao por literal, de
 * proposito: U+2028 e U+2029 sao invisiveis num editor e sobrevivem mal a
 * copia e colagem. Escritos assim, ficam conferiveis a olho.
 *
 *   0x3c "<"   0x3e ">"   0x2028   0x2029
 */
const PERIGOSOS_EM_SCRIPT = [0x3c, 0x3e, 0x2028, 0x2029];

export function paraScript(valor: unknown): string {
  let s = JSON.stringify(valor ?? null);
  for (const ponto of PERIGOSOS_EM_SCRIPT) {
    const escapado = "\\u" + ponto.toString(16).padStart(4, "0");
    s = s.split(String.fromCharCode(ponto)).join(escapado);
  }
  return s;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** URL absoluta so vira href se for http(s). Bloqueia `javascript:` e `data:`. */
function urlSegura(u: string | null): string | null {
  if (!u) return null;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Caminho interno gerado por nos (/api/marca/12/logo).
 *
 * A recusa de "//" nao e detalhe de estilo: "//evil.com/x" e URL RELATIVA A
 * PROTOCOLO. Comeca com barra, passa em qualquer teste ingenuo de "e caminho
 * local", e o navegador vai buscar em evil.com com o esquema da pagina. A
 * primeira versao desta funcao aceitava; quem pegou foi o teste.
 */
function caminhoInterno(p: string | null): string | null {
  if (!p || p.startsWith("//") || p.includes("..")) return null;
  return /^\/[A-Za-z0-9/_.-]*$/.test(p) ? p : null;
}

function blocoDeCores(marca: MarcaResolvida): string {
  if (!marca.cores) return "";
  const { claro, escuro } = marca.cores;
  const todas = [
    claro.brand, claro.hover, claro.soft, claro.ink, claro.textOnBrand,
    escuro.brand, escuro.hover, escuro.soft, escuro.ink, escuro.textOnBrand,
  ];
  // Uma cor torta derruba o bloco inteiro: meia paleta aplicada e pior que
  // nenhuma, porque mistura a marca do revendedor com a da plataforma.
  if (!todas.every(c => HEX.test(c))) return "";

  const hsl = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    if (d === 0) return `0 0% ${Math.round(l * 100)}%`;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = Math.round(h * 60); if (h < 0) h += 360;
    return `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
  };

  /** "74, 70, 112" — o --focus-ring guarda a marca em rgba, nao em hex. */
  const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  };

  /**
   * Os DOIS formatos, sempre.
   *
   * A pele usa hex (--brand, --color-brand); o shadcn usa tripla HSL sem a
   * funcao hsl() (--primary). E nao e simetrico: `ui/button.tsx` le
   * --color-brand e --color-steel, enquanto checkbox, switch, slider e progress
   * leem --primary. Sobrescrever so os hex deixa todo controle de formulario na
   * cor velha; so os HSL deixa todo botao.
   *
   * Tres que escapam de busca ingenua e por isso estao nomeados aqui:
   *   --color-steel  nao tem "brand" no nome, mas e o hover de TODO botao
   *   --focus-ring   guarda a cor em rgba literal, nao deriva de --brand
   *   --cat-indigo   tem o MESMO valor da marca, mas significa "ERP iXC Soft".
   *                  Fica de fora de proposito: trocar mudaria o sentido de um
   *                  dado, nao a aparencia.
   */
  const regras = (p: typeof claro) => `
    --brand:${p.brand};--action:${p.brand};--brand-hover:${p.hover};
    --action-hover:${p.hover};--brand-bg:${p.soft};--brand-soft:${p.soft};
    --brand-ink:${p.ink};--text-on-brand:${p.textOnBrand};
    --color-brand:${p.brand};--color-steel:${p.hover};--color-brand-bg:${p.soft};
    --focus-ring:0 0 0 3px rgba(${rgb(p.brand)}, .30);
    --primary:${hsl(p.brand)};--primary-foreground:${hsl(p.textOnBrand)};
    --sidebar-accent:${hsl(p.soft)};--sidebar-primary:${hsl(p.brand)};
    --accent:${hsl(p.soft)};--accent-foreground:${hsl(p.ink)};
    --ring:${hsl(p.brand)};
    --marca-nome:${p.brand};--marca-no:${p.brand};`;

  /**
   * Seletores repetidos (`:root:root`) de proposito: e especificidade, nao
   * descuido.
   *
   * O CSS do build declara `:root{--brand:...}` e `.dark{--brand:...}`. Um
   * `:root` simples aqui EMPATA com o do arquivo e perde para ele, porque o
   * <link> do stylesheet vem depois no <head>. Foi exatamente o que aconteceu:
   * no tema escuro a paleta do revendedor aplicava (porque `.dark` tem
   * especificidade maior que `:root`) e no tema claro nao aplicava NADA.
   *
   * `:root:root` vale (0,0,2) e ganha de `:root`; `:root:root.dark` vale
   * (0,1,2) e ganha de `.dark`. Somado a posicao (o bloco e escrito no fim do
   * <head>, depois do stylesheet), a paleta vence dos dois jeitos.
   */
  return `<style id="marca-cores">:root:root{${regras(claro)}}
:root:root.dark,:root:root[data-theme="dark"]{${regras(escuro)}}</style>`;
}

/** O que o React le em window.__MARCA__. So dado de apresentacao. */
function blocoDeScript(marca: MarcaResolvida): string {
  const paraOCliente = {
    contexto: marca.contexto,
    marcaId: marca.marcaId,
    nomeProduto: marca.nomeProduto,
    assinatura: marca.assinatura,
    logoUrl: caminhoInterno(marca.logoUrl),
    suporteEmail: marca.suporteEmail,
    suporteWhatsapp: marca.suporteWhatsapp,
    site: urlSegura(marca.site),
    responsavelRazaoSocial: marca.responsavelRazaoSocial,
    responsavelCnpj: marca.responsavelCnpj,
    /**
     * A paleta CLARA, explicitamente.
     *
     * Existe para o relatorio impresso: a janela de impressao e um documento
     * novo, nao herda o index.css nem o <style> injetado, e e sempre fundo
     * branco. Ler a cor do documento vivo daria a paleta do tema ATIVO — no
     * escuro, um lilas claro sobre papel branco.
     *
     * Sao os mesmos valores ja validados como hex em blocoDeCores.
     */
    paletaClara: marca.cores && [marca.cores.claro.brand, marca.cores.claro.ink, marca.cores.claro.soft].every(c => HEX.test(c))
      ? { brand: marca.cores.claro.brand, ink: marca.cores.claro.ink, soft: marca.cores.claro.soft }
      : null,
  };
  return `<script>window.__MARCA__=${paraScript(paraOCliente)};</script>`;
}

function blocoDeCabecalho(marca: MarcaResolvida): string {
  const nome = escaparHtml(marca.nomeProduto);
  const descricao = escaparHtml(
    marca.assinatura || "Analise de credito para provedores de internet"
  );
  const favicon = caminhoInterno(marca.faviconUrl) ?? "/marca/favicon.svg";
  const logo = caminhoInterno(marca.logoUrl);
  const site = urlSegura(marca.site);

  return [
    `<title>${nome}</title>`,
    `<meta name="description" content="${descricao}" />`,
    `<link rel="icon" type="image/svg+xml" href="${escaparHtml(favicon)}" />`,
    logo ? `<link rel="apple-touch-icon" href="${escaparHtml(logo)}" />` : "",
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${nome}" />`,
    `<meta property="og:title" content="${nome}" />`,
    `<meta property="og:description" content="${descricao}" />`,
    site ? `<meta property="og:url" content="${escaparHtml(site)}" />` : "",
    // Sem og:image proprio: melhor previa sem imagem que previa com a marca
    // errada. O revendedor sobe a dele quando tiver.
  ].filter(Boolean).join("\n    ");
}

/**
 * Devolve o html com a marca aplicada.
 *
 * Marca da plataforma, ou template sem os marcadores: devolve o original
 * intacto. Nunca lanca — HTML nao servido e a pagina inteira em branco, e
 * nenhuma personalizacao vale isso.
 */
export function injetarMarca(html: string, marca: MarcaResolvida): string {
  if (marca.origem === "plataforma" && marca.contexto === "plataforma") return html;

  const i = html.indexOf(INICIO);
  const f = html.indexOf(FIM);
  if (i === -1 || f === -1 || f < i) return html;

  try {
    // 1. A faixa leva o que precisa vir CEDO: o <title> (o navegador usa o
    //    primeiro que encontrar) e os icones.
    //    Provedor sem marca propria mantem o cabecalho da casa — ele so ganha o
    //    window.__MARCA__ que diz "aqui a tela e o login, nao a landing".
    const cabecalho = marca.marcaId ? blocoDeCabecalho(marca) : html.slice(i + INICIO.length, f);
    let saida = html.slice(0, i)
      + `${INICIO}\n    ${cabecalho}\n    ${FIM}`
      + html.slice(f + FIM.length);

    // 2. Cor e dados vao para o FIM do <head>, depois do <link> do stylesheet.
    //    Dentro da faixa eles vinham ANTES dele, e o CSS do build sobrescrevia a
    //    paleta inteira no tema claro — ver a nota de especificidade em
    //    blocoDeCores. Posicao e especificidade resolvem o mesmo problema; as
    //    duas juntas porque nenhuma sozinha e obvia para quem editar depois.
    const rodape = `\n    ${blocoDeCores(marca)}\n    ${blocoDeScript(marca)}\n  `;
    const fimHead = saida.lastIndexOf("</head>");
    return fimHead === -1
      ? saida + rodape                        // template sem </head>: anexa e segue
      : saida.slice(0, fimHead) + rodape + saida.slice(fimHead);
  } catch {
    return html;
  }
}
