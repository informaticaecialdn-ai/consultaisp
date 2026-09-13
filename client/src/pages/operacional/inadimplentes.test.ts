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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

// `useAuth` controlado: o AuthProvider real so preenche `demoMode` por fetch
// num efeito, que o SSR nao roda.
const auth = vi.hoisted(() => ({ demoMode: false, provider: { name: "Provedor Demo" } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => auth }));

import InadimplentesPage, { acoesDeContato, origensDoFiltro, rotuloErp } from "./inadimplentes";

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

/**
 * Na demonstracao publica nenhum contato sai da tela.
 *
 * O telefone do sandbox e ficticio, mas plausivel: `tel:` discaria para o
 * numero de alguem de verdade e `wa.me/55…` abriria conversa com essa pessoa.
 * Na demo, "Ligar" fica desabilitado com o motivo e "WhatsApp" leva para a
 * ficha do cliente, de onde sai a conversa simulada. Fora da demo, o mesmo
 * `tel:` e o mesmo `wa.me` de sempre.
 *
 * E a origem: o sandbox grava `erp_source = "demo"` (`FONTE_ERP_DEMO`,
 * server/erp/fonte-demo.ts). Sem rotulo, a tela escrevia "Origem nao
 * identificada" para a base inteira do visitante e o filtro nao a oferecia.
 * O rotulo "Demonstração" so existe na demo — fora dela a chave continua
 * desconhecida, como qualquer outra.
 */
describe("contato e origem na demonstracao", () => {
  const LINHA = { id: 1, phone: "(43) 99999-0000" };

  it("fora da demo: tel: e wa.me exatamente como antes", () => {
    expect(acoesDeContato(LINHA, false)).toEqual({
      ligar: { tipo: "externo", url: "tel:(43) 99999-0000" },
      whatsapp: { tipo: "externo", url: "https://wa.me/5543999990000" },
    });
  });

  it("na demo: nada de tel: nem wa.me — ligar indisponivel, WhatsApp leva a ficha do cliente", () => {
    const acoes = acoesDeContato(LINHA, true);
    expect(JSON.stringify(acoes)).not.toMatch(/tel:|wa\.me/);
    expect(acoes.ligar).toMatchObject({ tipo: "indisponivel" });
    expect(acoes.whatsapp).toEqual({ tipo: "interno", rota: "/cobranca/cliente/1" });
  });

  it("rotulo Demonstração para a origem demo so na demo", () => {
    expect(rotuloErp("demo", true)).toBe("Demonstração");
    expect(rotuloErp("demo", false)).toBe("Origem não identificada");
    expect(rotuloErp("demo")).toBe("Origem não identificada");
    expect(rotuloErp("mk", true)).toBe(rotuloErp("mk", false));
  });

  it("o filtro oferece a origem demo so na demo", () => {
    expect(origensDoFiltro(true)).toContain("demo");
    expect(origensDoFiltro(false)).not.toContain("demo");
    expect(origensDoFiltro(true).filter((o) => o !== "demo")).toEqual(origensDoFiltro(false));
  });

  it("nenhum tel: nem wa.me fica fora de acoesDeContato — a tela nao monta link por conta propria", () => {
    const corpo = fonte.slice(fonte.indexOf("export default function InadimplentesPage"));
    expect(corpo).not.toMatch(/tel:|wa\.me/);
  });

  describe("a tela renderizada", () => {
    const LINHAS = [
      { id: 1, name: "Ana Silva", cpfCnpj: "00000000000", phone: "(43) 99999-0000", city: "Londrina", state: "PR", totalOverdueAmount: "120.00", maxDaysOverdue: 40, overdueInvoicesCount: 2, riskTier: "high", status: "active", erpSource: "demo", lastSyncAt: null, unreturnedEquipmentCount: 1 },
      { id: 2, name: "Bruno Lima", cpfCnpj: "11111111111", phone: null, city: "Ibiporã", state: "PR", totalOverdueAmount: "80.00", maxDaysOverdue: 10, overdueInvoicesCount: 1, riskTier: "low", status: "cancelled", erpSource: "mk", lastSyncAt: null, unreturnedEquipmentCount: 0 },
    ];
    const renderizar = () => {
      const qc = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
      qc.setQueryData(["/api/dashboard/stats"], {});
      qc.setQueryData(["/api/inadimplentes"], LINHAS);
      // O `Link` do wouter lê `location` fora de um Router; no SSR o caminho vem de `ssrPath`.
      const html = renderToStaticMarkup(
        createElement(QueryClientProvider, { client: qc },
          createElement(Router, { ssrPath: "/inadimplentes" }, createElement(InadimplentesPage))),
      );
      qc.clear();
      return html;
    };
    /** O elemento inteiro que carrega um data-testid (abre ate o fim da tag). */
    const tag = (html: string, testId: string) => html.match(new RegExp(`<(a|button)[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";

    beforeEach(() => { auth.demoMode = false; });

    it("fora da demo: Ligar habilitado, WhatsApp e botao, origem nao identificada", () => {
      const html = renderizar();
      expect(tag(html, "btn-phone-1")).toMatch(/^<button/);
      // O atributo, nao a classe: o Button do shadcn sempre traz `disabled:pointer-events-none`.
      expect(tag(html, "btn-phone-1")).not.toMatch(/\sdisabled=""/);
      expect(tag(html, "btn-whatsapp-1")).toMatch(/^<button/);
      expect(html).toContain("Origem não identificada");
      expect(html).not.toContain("Demonstração");
    });

    it("na demo: Ligar desabilitado com o motivo, WhatsApp e link interno, origem Demonstração", () => {
      auth.demoMode = true;
      const html = renderizar();
      expect(tag(html, "btn-phone-1")).toContain("disabled");
      expect(html).toMatch(/title="Na demonstração[^"]*"/);
      expect(tag(html, "btn-whatsapp-1")).toMatch(/^<a[^>]*href="\/cobranca\/cliente\/1"/);
      expect(html).not.toMatch(/tel:|wa\.me/);
      expect(html).toContain("Demonstração");
      expect(html).not.toContain("Origem não identificada");
    });
  });
});
