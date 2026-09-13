/**
 * A Base de Inadimplentes nao pode pedir ao servidor uma rota que ele nao tem.
 *
 * O SINTOMA: os botoes "Notificar LGPD/CDC" e "Ver historico na rede" de cada
 * linha chamavam `POST /api/inadimplentes/:id/notificar-lgpd` e
 * `GET /api/inadimplentes/:cpf/historico-rede`. Os dois handlers nasceram no
 * antigo `server/routes.ts` monolitico (commit 7b34cd2) e nao sobreviveram a
 * divisao em `server/routes/*.ts` — o unico handler de inadimplentes hoje e
 * `GET /api/inadimplentes`. Para o provedor, um botao abria o modal, pedia
 * confirmacao e devolvia erro; o outro abria o modal e dizia "Nao foi possivel
 * carregar os dados da rede", como se fosse instabilidade e nao ausencia.
 *
 * O vitest deste projeto nao coleta `.tsx` (sem DOM), entao, como em
 * `chat.test.ts`, a prova e pela fonte: toda URL que a tela EXECUTA e
 * conferida contra as rotas que o servidor REGISTRA. Assim o teste pega esta
 * regressao e a proxima — qualquer chamada nova para rota inexistente fica
 * vermelha aqui, sem ninguem precisar lembrar de acrescentar o nome dela.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const raiz = join(__dirname, "..", "..");
const pastaRotas = join(raiz, "..", "..", "server", "routes");

/** A fonte sem comentario — o que a tela realmente executa. */
const executavel = (fonte: string) =>
  fonte
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const fonteBruta = readFileSync(join(raiz, "pages", "operacional", "inadimplentes.tsx"), "utf8");
const fonte = executavel(fonteBruta);

/** Parametro de caminho vira um marcador so: `:id`, `:cpfCnpj` e `${x}` sao a
 *  mesma posicao para efeito de "existe rota aqui". Query string nao conta. */
const normalizar = (caminho: string) =>
  caminho
    .split("?")[0]
    .replace(/\$\{[^}]+\}/g, ":p")
    .replace(/:[A-Za-z_]\w*/g, ":p");

/** Toda rota registrada nos routers de `server/routes` (testes fora). */
const rotasDoServidor = new Set(
  readdirSync(pastaRotas)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .flatMap((f) => {
      const texto = readFileSync(join(pastaRotas, f), "utf8");
      return [...texto.matchAll(/router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g)].map(
        (m) => `${m[1].toUpperCase()} ${normalizar(m[2])}`,
      );
    }),
);

/** O que a tela pede: mutacoes/buscas por `apiRequest` e leituras por `queryKey`. */
const chamadasDaTela = [
  ...[...fonte.matchAll(/apiRequest\(\s*"(GET|POST|PUT|PATCH|DELETE)",\s*["`]([^"`]+)["`]/g)].map(
    (m) => `${m[1]} ${normalizar(m[2])}`,
  ),
  ...[...fonte.matchAll(/queryKey:\s*\[\s*["`](\/api\/[^"`]+)["`]/g)].map((m) => `GET ${normalizar(m[1])}`),
];

describe("a tela so chama rota que existe", () => {
  it("o extrator enxerga as leituras da tela e as rotas delas — o teste de baixo nao e vazio", () => {
    expect(chamadasDaTela).toContain("GET /api/inadimplentes");
    expect(chamadasDaTela).toContain("GET /api/dashboard/stats");
    expect(rotasDoServidor.has("GET /api/inadimplentes")).toBe(true);
    expect(rotasDoServidor.has("GET /api/dashboard/stats")).toBe(true);
  });

  it("toda requisicao da tela tem rota registrada no servidor", () => {
    const orfas = chamadasDaTela.filter((c) => !rotasDoServidor.has(c));
    expect(orfas).toEqual([]);
  });

  it("nenhum gatilho para notificar-lgpd nem historico-rede — as rotas nao existem", () => {
    expect(fonte).not.toContain("notificar-lgpd");
    expect(fonte).not.toContain("historico-rede");
    expect(fonte).not.toContain("btn-lgpd-");
    expect(fonte).not.toContain("btn-rede-");
    // E o servidor continua sem elas: se um dia forem criadas, este teste
    // avisa que e hora de reabrir a decisao, e nao de religar o botao as cegas.
    expect(rotasDoServidor.has("POST /api/inadimplentes/:p/notificar-lgpd")).toBe(false);
    expect(rotasDoServidor.has("GET /api/inadimplentes/:p/historico-rede")).toBe(false);
  });

  it("as duas decisoes pendentes ficam registradas na tela, nao somem com o botao", () => {
    expect(fonteBruta).toMatch(/AIDEV-QUESTION[\s\S]*notificar-lgpd/);
    expect(fonteBruta).toMatch(/AIDEV-QUESTION[\s\S]*historico-rede/);
  });
});
