/**
 * O saldo de creditos do Painel do Provedor (cabecalho e aba de creditos).
 *
 * Os dois lugares mostram `useAuth().provider.ispCredits`, e a sessao so era
 * lida na montagem da aplicacao: quem consultava (a consulta debita no
 * servidor) e abria /painel-provedor via o saldo do login. O conserto de
 * /creditos (`recarregar()` ao abrir) nao chegava aqui, e o
 * `invalidateQueries(["/api/auth/me"])` depois de salvar o perfil nao atingia
 * nada — a sessao nao mora no React Query.
 *
 * Trava de fonte: a pagina e grande demais para montar em jsdom, e o SSR do
 * `renderToStaticMarkup` nao roda efeito. O comportamento de `recarregar()` em
 * si esta provado renderizado em `creditos.render.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const fonte = readFileSync(join(__dirname, "painel-provedor.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("Painel do Provedor — saldo de creditos", () => {
  it("a pagina ainda mostra o saldo da sessao (senao a trava nao tem objeto)", () => {
    expect(fonte).toContain('data-testid="text-isp-credits"');
    expect(fonte).toContain('data-testid="text-isp-credits-tab"');
    expect(fonte).toContain("provider?.ispCredits");
  });

  it("rele a sessao ao abrir o painel", () => {
    expect(fonte).toMatch(/const \{[^}]*\brecarregar\b[^}]*\} = useAuth\(\)/);
    expect(fonte).toMatch(/useEffect\(\(\) => \{ recarregar\(\); \}, \[recarregar\]\)/);
  });

  it("nao invalida uma query /api/auth/me que nao existe — rele a sessao de verdade", () => {
    expect(fonte).not.toContain('queryKey: ["/api/auth/me"]');
  });
});
