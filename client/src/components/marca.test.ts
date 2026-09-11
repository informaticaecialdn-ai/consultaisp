/**
 * A marca /consulta.isp (brand kit de 10/09/2026) — o que não pode derivar.
 *
 * Teste de FONTE, como os vizinhos `.tsx`: lê os arquivos como texto. Ele não
 * vê render; vê as três coisas que quebram em silêncio numa troca de marca —
 * o favicon e o componente desenhando glifos diferentes, um ícone citado no
 * HTML que não existe em disco (o navegador cai no ícone genérico sem avisar
 * ninguém) e um número inventado voltando para a tela de login.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const RAIZ = resolve(__dirname, "../../..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

const marca = ler("client/src/components/marca.tsx");
const favicon = ler("client/public/marca/favicon-v2.svg");
const indexHtml = ler("client/index.html");
const manifest = JSON.parse(ler("client/public/site.webmanifest"));

describe("o símbolo \"/c\"", () => {
  it("o componente e o favicon desenham os MESMOS contornos", () => {
    const caminhos = Array.from(marca.matchAll(/const CONTORNO_(?:BARRA|C)\s*=\s*\n?\s*"([^"]+)"/g)).map(m => m[1]);
    expect(caminhos).toHaveLength(2);
    for (const d of caminhos) expect(favicon).toContain(`d="${d}"`);
  });

  /**
   * Os SVGs do kit desenham <text> com a fonte puxada por @import. Como favicon
   * (e em <img>) o navegador não carrega recurso externo, e o "/c" cairia na
   * monoespaçada do sistema — por isso o favicon é contorno puro.
   */
  /** O nome antigo segue servindo a arte nova — para atalho e cache que ainda apontem para ele. */
  it("o favicon.svg de nome antigo é o mesmo arquivo do versionado", () => {
    expect(ler("client/public/marca/favicon.svg")).toBe(favicon);
  });

  it("o favicon não depende de fonte: sem <text> e sem @import", () => {
    expect(favicon).not.toMatch(/<text/i);
    expect(favicon).not.toMatch(/@import/i);
    expect(favicon).toContain('fill="#0E0D0B"');
    expect(favicon).toContain('fill="#77726A"');
    expect(favicon).toContain('fill="#F5F3EE"');
  });
});

describe("o wordmark", () => {
  it("usa os tokens da marca, e a tinta troca no tema escuro — o cinza não", () => {
    expect(marca).toContain('fontFamily: "var(--marca-fonte)"');
    expect(marca).toContain('"var(--marca-tinta)"');
    // Sobre fundo escuro FIXO (painel do login da plataforma) a tinta e o creme
    // do ladrilho, nos dois temas.
    expect(marca).toContain('sobreEscuro ? "var(--marca-ladrilho-tinta)" : "var(--marca-tinta)"');
    expect(marca).toContain('color: "var(--marca-destaque)"');
    const css = ler("client/src/index.css");
    expect(css).toMatch(/--marca-fonte:\s*"JetBrains Mono"/);
    const escuro = css.slice(css.indexOf(".dark {"));
    expect(escuro).toMatch(/--marca-tinta:\s*#F5F3EE/);
    expect(escuro).not.toMatch(/--marca-destaque:/);
  });

  it("o leitor de tela ouve o nome do produto, não a pontuação do desenho", () => {
    expect(marca).toContain('<span className="sr-only">Consulta ISP</span>');
    expect(marca).toMatch(/aria-hidden="true"[\s\S]{0,400}<span style=\{\{ color: "var\(--marca-destaque\)" \}\}>\/<\/span>consulta/);
  });
});

describe("white label não herda a marca da plataforma", () => {
  it("revendedor sem logo ganha monograma, nunca o \"/c\"", () => {
    const simboloDaMarca = marca.slice(marca.indexOf("export function SimboloDaMarca"), marca.indexOf("export default function Marca"));
    const monograma = simboloDaMarca.indexOf("marca.marcaId !== null");
    const plataforma = simboloDaMarca.indexOf("<SimboloConsultaISP");
    expect(monograma).toBeGreaterThan(-1);
    expect(plataforma).toBeGreaterThan(monograma);
  });

  it("o nome do revendedor não sai na fonte da marca-mãe", () => {
    const ramoDoRevendedor = marca.slice(marca.lastIndexOf("return (\n    <span className={`inline-flex items-center gap-2.5"));
    expect(ramoDoRevendedor).not.toContain("var(--marca-fonte)");
    expect(ramoDoRevendedor).toContain('fontFamily: "var(--font-sans)"');
  });
});

describe("ícones e prévia de compartilhamento", () => {
  /** Todo caminho de ícone citado tem de existir: faltando, o navegador cai no genérico em silêncio. */
  const existeNoPublic = (url: string) => existsSync(join(RAIZ, "client/public", url.replace(/^https:\/\/consultaisp\.com\.br/, "")));

  it("todo ícone e imagem do <head> existe em client/public", () => {
    const citados = Array.from(indexHtml.matchAll(/(?:href|content)="((?:https:\/\/consultaisp\.com\.br)?\/(?:marca\/)?[^"]+\.(?:svg|png))"/g)).map(m => m[1]);
    expect(citados.length).toBeGreaterThanOrEqual(5);
    for (const url of citados) expect(existeNoPublic(url), url).toBe(true);
  });

  it("todo ícone do manifest existe, e as cores são as do kit", () => {
    for (const icone of manifest.icons) expect(existeNoPublic(icone.src), icone.src).toBe(true);
    expect(manifest.theme_color).toBe("#0E0D0B");
    expect(manifest.background_color).toBe("#F5F3EE");
    expect(indexHtml).toContain('<meta name="theme-color" content="#0E0D0B" />');
  });

  it("a Montserrat saiu junto com a marca antiga — nem baixada, nem declarada", () => {
    expect(indexHtml).not.toContain("family=Montserrat");
    expect(ler("client/src/index.css")).not.toMatch(/"Montserrat"/);
  });

  it("nada no código aponta para os arquivos da marca antiga", () => {
    const antigos = ["lockup-claro", "lockup-escuro", "logo-completa", "simbolo.png", "icone-512"];
    const fontes: string[] = [];
    const varrer = (dir: string) => {
      for (const nome of readdirSync(join(RAIZ, dir))) {
        const rel = `${dir}/${nome}`;
        if (statSync(join(RAIZ, rel)).isDirectory()) varrer(rel);
        else if (/\.(tsx?|html|css|json|webmanifest)$/.test(nome) && !nome.endsWith(".test.ts")) fontes.push(rel);
      }
    };
    varrer("client/src"); varrer("server"); fontes.push("client/index.html", "client/public/site.webmanifest");
    for (const rel of fontes) {
      const texto = ler(rel);
      for (const nome of antigos) expect(texto.includes(nome), `${rel} cita ${nome}`).toBe(false);
    }
  });
});

describe("tela de login", () => {
  /** Regra do dono: só dado real e verificável. Nenhum dos dois era medido pelo sistema. */
  it("sem os números inventados da plataforma", () => {
    const login = ler("client/src/pages/auth/login.tsx");
    expect(login).not.toMatch(/>100\+</);
    expect(login).not.toMatch(/>99\.9%</);
    expect(login).not.toMatch(/Uptime</);
  });
});
