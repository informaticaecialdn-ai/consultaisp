/**
 * A injecao da marca e o unico lugar do sistema onde texto digitado por um
 * REVENDEDOR entra no HTML servido a clientes de OUTRO revendedor. O CSP do
 * projeto permite script inline (server/index.ts), entao um <script> que escape
 * do escape roda de verdade.
 *
 * Estes testes existem para provar tres coisas:
 *   1. a marca da plataforma nao passa por transformacao nenhuma;
 *   2. nome de produto hostil nao vira codigo;
 *   3. cor invalida derruba o bloco de cor INTEIRO, em vez de aplicar metade.
 */
import { describe, it, expect } from "vitest";
import { injetarMarca, escaparHtml, paraScript } from "./marca-html";
import { paletaClara, paletaEscura } from "./utils/marca-cores";
import type { MarcaResolvida } from "./services/marca.service";

const TEMPLATE = `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <!-- marca:inicio -->
    <title>Consulta ISP</title>
    <link rel="icon" href="/marca/favicon.svg" />
    <!-- marca:fim -->
  </head>
  <body><div id="root"></div></body>
</html>`;

const PLATAFORMA: MarcaResolvida = {
  origem: "plataforma", contexto: "plataforma", marcaId: null,
  nomeProduto: "Consulta ISP", assinatura: "Base colaborativa de crédito",
  logoUrl: null, faviconUrl: "/marca/favicon.svg", cores: null,
  suporteEmail: null, suporteWhatsapp: null, site: "https://consultaisp.com.br",
  responsavelRazaoSocial: null, responsavelCnpj: null,
  emailRemetente: null, emailNomeExibicao: null,
};

function marcaDe(over: Partial<MarcaResolvida> = {}): MarcaResolvida {
  return {
    ...PLATAFORMA,
    origem: "dominio-proprio", contexto: "tenant", marcaId: 7,
    nomeProduto: "CredNet", assinatura: "Credito para provedores",
    logoUrl: "/api/marca/7/logo", faviconUrl: "/api/marca/7/favicon",
    cores: { claro: paletaClara("#1F6F7A"), escuro: paletaEscura("#1F6F7A") },
    site: "https://crednet.com.br",
    ...over,
  };
}

/** Extrai o objeto de window.__MARCA__ do html gerado. */
function lerMarcaInjetada(html: string): any {
  const m = html.match(/window\.__MARCA__=(.*?);<\/script>/s);
  if (!m) throw new Error("window.__MARCA__ nao encontrado");
  return JSON.parse(m[1]);
}

describe("a plataforma nao passa por transformacao", () => {
  it("devolve o html byte a byte igual", () => {
    expect(injetarMarca(TEMPLATE, PLATAFORMA)).toBe(TEMPLATE);
  });

  it("template sem os marcadores volta intacto em vez de estourar", () => {
    const semMarcadores = "<html><head><title>x</title></head></html>";
    expect(injetarMarca(semMarcadores, marcaDe())).toBe(semMarcadores);
  });

  it("provedor sem marca propria mantem o cabecalho da casa, mas ganha o contexto", () => {
    // subdominio de provedor que ainda nao tem marca: a tela e o login (tenant),
    // e a marca visual continua sendo a da plataforma.
    const html = injetarMarca(TEMPLATE, { ...PLATAFORMA, origem: "subdominio", contexto: "tenant" });
    expect(html).toContain("<title>Consulta ISP</title>");
    expect(lerMarcaInjetada(html).contexto).toBe("tenant");
  });
});

describe("escape — nome de produto hostil", () => {
  it("fechar a tag script nao vaza para fora da string", () => {
    const html = injetarMarca(TEMPLATE, marcaDe({ nomeProduto: '</script><script>alert(1)</script>' }));
    // O unico <script> permitido e o nosso.
    expect(html.match(/<script>/g) ?? []).toHaveLength(1);
    expect(html).not.toContain("alert(1)</script>");
    // ...e o nome chega inteiro no cliente, so que como DADO.
    expect(lerMarcaInjetada(html).nomeProduto).toBe('</script><script>alert(1)</script>');
  });

  it("aspas e sinais nao escapam do atributo nem do titulo", () => {
    const html = injetarMarca(TEMPLATE, marcaDe({
      nomeProduto: 'A" onload="alert(1)',
      assinatura: "<img src=x onerror=alert(2)>",
    }));
    expect(html).not.toContain('onload="alert(1)"');
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&quot;");
  });

  it("window.__MARCA__ continua sendo JSON valido com entrada hostil", () => {
    const veneno = ['</script>', '\u2028\u2029', '"; alert(1); var x="', "\\", "</SCRIPT >"];
    for (const v of veneno) {
      const html = injetarMarca(TEMPLATE, marcaDe({ nomeProduto: v }));
      expect(() => lerMarcaInjetada(html)).not.toThrow();
      expect(lerMarcaInjetada(html).nomeProduto).toBe(v);
    }
  });

  it("paraScript neutraliza os separadores de linha do JS", () => {
    expect(paraScript("a\u2028b")).not.toContain("\u2028");
    expect(paraScript("</script>")).not.toContain("</script>");
  });

  it("escaparHtml cobre os cinco caracteres", () => {
    expect(escaparHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("cores", () => {
  it("emite os DOIS formatos — hex da pele e tripla HSL do shadcn", () => {
    const html = injetarMarca(TEMPLATE, marcaDe());
    expect(html).toMatch(/--brand:#[0-9a-f]{6}/i);
    expect(html).toMatch(/--primary:\d+ \d+% \d+%/);
    expect(html).toMatch(/--sidebar-accent:\d+ \d+% \d+%/);
  });

  it("cobre o tema escuro pelas duas formas de ativa-lo", () => {
    const html = injetarMarca(TEMPLATE, marcaDe());
    expect(html).toContain(".dark");
    expect(html).toContain(':root[data-theme="dark"]');
  });

  it("uma cor invalida derruba o bloco INTEIRO — meia paleta e pior que nenhuma", () => {
    const cores = marcaDe().cores!;
    const html = injetarMarca(TEMPLATE, marcaDe({
      cores: { claro: { ...cores.claro, hover: "red; } body { display:none } .x{" }, escuro: cores.escuro },
    }));
    expect(html).not.toContain("marca-cores");
    expect(html).not.toContain("display:none");
  });

  it("marca sem cor nao emite bloco de cor", () => {
    expect(injetarMarca(TEMPLATE, marcaDe({ cores: null }))).not.toContain("marca-cores");
  });
});

describe("urls", () => {
  it("logo so aceita caminho interno; url externa e descartada", () => {
    for (const ruim of ["https://malicioso.com/l.svg", "javascript:alert(1)", "//evil.com/x", "/api/../../etc"]) {
      expect(lerMarcaInjetada(injetarMarca(TEMPLATE, marcaDe({ logoUrl: ruim }))).logoUrl).toBeNull();
    }
    expect(lerMarcaInjetada(injetarMarca(TEMPLATE, marcaDe())).logoUrl).toBe("/api/marca/7/logo");
  });

  it("site so vira link se for http(s)", () => {
    expect(lerMarcaInjetada(injetarMarca(TEMPLATE, marcaDe({ site: "javascript:alert(1)" }))).site).toBeNull();
    expect(lerMarcaInjetada(injetarMarca(TEMPLATE, marcaDe({ site: "https://crednet.com.br/" }))).site)
      .toBe("https://crednet.com.br/");
  });

  it("favicon fora do padrao cai no da plataforma em vez de virar href arbitrario", () => {
    const html = injetarMarca(TEMPLATE, marcaDe({ faviconUrl: "https://evil.com/f.svg" }));
    expect(html).toContain('href="/marca/favicon.svg"');
    expect(html).not.toContain("evil.com");
  });
});

describe("substituicao", () => {
  it("troca a faixa entre os marcadores e preserva o resto do documento", () => {
    const html = injetarMarca(TEMPLATE, marcaDe());
    expect(html).toContain("<title>CredNet</title>");
    expect(html).not.toContain("<title>Consulta ISP</title>");
    expect(html).toContain('<meta charset="UTF-8" />');
    expect(html).toContain('<div id="root"></div>');
    expect(html.match(/<!-- marca:inicio -->/g)).toHaveLength(1);
    expect(html.match(/<!-- marca:fim -->/g)).toHaveLength(1);
  });
});

/**
 * Estes dois nasceram de uma revisao adversarial. Os dois passavam despercebidos
 * em desenvolvimento e quebravam so em producao — que e a pior combinacao.
 */
describe("cascata: a paleta precisa GANHAR do CSS do build", () => {
  /** Como o index.html de producao fica: o stylesheet entra depois da faixa. */
  const COM_STYLESHEET = `<html><head>
    <!-- marca:inicio -->
    <title>Consulta ISP</title>
    <!-- marca:fim -->
    <link rel="stylesheet" href="/assets/index-abc.css">
  </head><body></body></html>`;

  it("o bloco de cor vem DEPOIS do stylesheet", () => {
    const html = injetarMarca(COM_STYLESHEET, marcaDe());
    expect(html.indexOf("marca-cores")).toBeGreaterThan(html.indexOf("assets/index-abc.css"));
  });

  it("o titulo continua vindo ANTES — o navegador usa o primeiro", () => {
    const html = injetarMarca(COM_STYLESHEET, marcaDe());
    expect(html.indexOf("<title>CredNet</title>")).toBeLessThan(html.indexOf("assets/index-abc.css"));
  });

  it("os seletores batem o :root e o .dark do arquivo de estilo", () => {
    // O CSS do build declara `:root{}` (0,0,1) e `.dark{}` (0,1,0). Empatar e
    // perder: o arquivo vem depois. Foi o bug que deixou o tema CLARO inteiro
    // na cor da plataforma enquanto o escuro trocava.
    const html = injetarMarca(COM_STYLESHEET, marcaDe());
    expect(html).toContain(":root:root{");
    expect(html).toContain(":root:root.dark");
    expect(html).toContain(':root:root[data-theme="dark"]');
  });

  it("template sem </head> nao perde o bloco nem estoura", () => {
    const solto = "<!-- marca:inicio --><title>x</title><!-- marca:fim -->";
    const html = injetarMarca(solto, marcaDe());
    expect(html).toContain("marca-cores");
    expect(html).toContain("__MARCA__");
  });
});
