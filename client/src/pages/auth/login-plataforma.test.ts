/**
 * A porta de entrada da plataforma no desenho "/consulta.isp" (10/09/2026).
 *
 * Teste de FONTE, como os vizinhos `.tsx`. O que ele prende é o que o
 * standalone do dono trazia e não pode voltar por uma "atualização do
 * desenho": número que o sistema não mede, link que não leva a lugar nenhum,
 * checkbox que não faz nada e CSS solto no :root.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const RAIZ = resolve(__dirname, "../../../..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

const tela = ler("client/src/pages/auth/login-plataforma.tsx");
const fluxo = ler("client/src/pages/auth/login-fluxo.ts");
const porta = ler("client/src/pages/auth/login.tsx");
const css = ler("client/src/pages/auth/login-plataforma.css");

/** Só o código: comentário conta a história do que saiu e citaria os números. */
const semComentarios = (fonte: string) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("dado real, e só dado real", () => {
  const codigo = semComentarios(tela);

  it("o selo não traz o \"47 provedores\" do desenho — o número vem do servidor", () => {
    expect(codigo).not.toMatch(/\b47\b/);
    expect(codigo).toContain('queryKey: ["/api/public/rede"]');
    // sem resposta, "Rede online" e nada mais
    expect(codigo).toMatch(/if \(typeof provedoresAtivos !== "number"\) return "Rede online";/);
  });

  it("sem o \"R$690 prejuízo médio evitado\", que nada mede", () => {
    expect(codigo).not.toMatch(/690/);
    expect(codigo).toContain("{CUSTO_EM_CREDITOS.isp}");
  });

  it("os créditos do convite vêm do preço público, não do texto", () => {
    expect(codigo).not.toMatch(/·\s*50 créditos/);
    expect(codigo).toContain('planoPorChave(precos, "free")?.creditosInclusos.isp');
  });

  it("nenhum link morto: sem href=\"#\" e sem \"Termos\" (não há página de termos)", () => {
    expect(codigo).not.toContain('href="#"');
    expect(codigo).not.toMatch(/>Termos</);
    expect(codigo).toContain('href="/lgpd"');
  });
});

describe("\"Manter conectado por 30 dias\" faz o que diz", () => {
  it("a caixa alimenta o estado que vai no login", () => {
    expect(tela).toContain("checked={lembrar}");
    expect(tela).toContain("setLembrar(e.target.checked)");
    expect(fluxo).toContain("await login(form.email, form.password, lembrar);");
  });

  it("desmarcada por padrão — o de hoje, 48 horas, para quem não mexe", () => {
    expect(fluxo).toContain("const [lembrar, setLembrar] = useState(false);");
  });
});

describe("a porta certa para cada host", () => {
  it("marca da plataforma veste o desenho; revendedor fica na tela neutra com a marca dele", () => {
    expect(porta).toContain("return marca.marcaId === null ? <LoginDaPlataforma /> : <LoginDoRevendedor />;");
  });

  it("no modo tenant não há convite de cadastro", () => {
    expect(tela).toMatch(/\{!isSubdomainMode && \(\s*<div className="signup-row">/);
  });

  /** Os mesmos identificadores da tela antiga: teste e suporte continuam achando os controles. */
  it("os data-testid da porta antiga continuam lá", () => {
    for (const id of [
      "login-page", "input-email", "input-password", "button-toggle-password", "button-submit-login",
      "button-nao-recebi-confirmacao", "button-toggle-register", "text-login-title", "text-provider-name",
      "check-email-card", "text-pending-email", "input-reenvio-email", "button-resend-email",
      "text-resultado-reenvio", "button-back-to-login", "button-back-to-site",
    ]) {
      expect(tela, id).toContain(`data-testid="${id}"`);
    }
  });
});

describe("a folha do desenho não vaza para o app", () => {
  it("todo seletor vive sob .lg e nada é declarado no :root", () => {
    const limpo = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const fora: string[] = [];
    const varrer = (texto: string) => {
      let i = 0;
      while (i < texto.length) {
        const abre = texto.indexOf("{", i);
        if (abre < 0) break;
        const prelude = texto.slice(i, abre).trim();
        let nivel = 1, j = abre + 1;
        while (j < texto.length && nivel > 0) { if (texto[j] === "{") nivel++; else if (texto[j] === "}") nivel--; j++; }
        const corpo = texto.slice(abre + 1, j - 1);
        if (/^@(media|supports)/.test(prelude)) varrer(corpo);
        else if (!prelude.startsWith("@")) {
          for (const s of prelude.split(",")) { const t = s.trim(); if (t && !t.startsWith(".lg")) fora.push(t); }
        }
        i = j;
      }
    };
    varrer(limpo);
    expect(fora).toEqual([]);
    expect(limpo).not.toMatch(/:root/);
  });

  it("o assistente de cadastro veste o traje só dentro do cartão", () => {
    expect(css).toMatch(/\.lg \.login-card \{[\s\S]*--primary: 40 13% 5%;/);
  });
});
