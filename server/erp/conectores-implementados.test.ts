/**
 * Quais conectores REALMENTE falam com o ERP.
 *
 * Quatro dos dez que existem sao stub — gere, radiusnet, receitanet e topsapp
 * devolvem "ainda nao implementado" em todo metodo. Como declaram
 * `configFields` como qualquer outro, a lista suspensa do painel SaaS os
 * oferecia igual aos que funcionam. O operador escolhe, digita credencial e
 * salva; a linha entra como "Configurado / Ativo" e o provedor passa a ler
 * "Integrada", porque o selo depende de configurado + isEnabled, e nao de o
 * conector existir. A falha so aparece dias depois, na primeira varredura.
 *
 * `naoImplementado` e a marca que separa os dois grupos. Este arquivo garante
 * que ela nao minta em nenhuma das duas direcoes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O barrel importa os dez conectores de catalogo e registra todos, mais o
// conector "demo" (registro condicional, ver describe proprio mais abaixo) —
// e o mesmo caminho que a rota do catalogo de conectores usa.
import { getAllConnectors, getConnector } from "./index.js";
import type { ErpConnector } from "./types.js";

import { IxcConnector } from "./connectors/ixc.js";
import { MkConnector } from "./connectors/mk.js";
import { SgpConnector } from "./connectors/sgp.js";
import { HubsoftConnector } from "./connectors/hubsoft.js";
import { VoalleConnector } from "./connectors/voalle.js";
import { RbxConnector } from "./connectors/rbx.js";
import { GereConnector } from "./connectors/gere.js";
import { RadiusnetConnector } from "./connectors/radiusnet.js";
import { ReceitanetConnector } from "./connectors/receitanet.js";
import { TopsappConnector } from "./connectors/topsapp.js";

/**
 * As instancias saem da classe, nao do registry.
 *
 * Assim a marca e conferida no conector em si — um conector que exista mas nao
 * chegue ao registry ainda e cobrado aqui, em vez de passar de graca porque
 * `getConnector()` devolveu `undefined` e `undefined?.naoImplementado` e
 * falsy. A cobertura do registry e um teste separado, mais abaixo.
 */
const IMPLEMENTADOS: [string, ErpConnector][] = [
  ["ixc", new IxcConnector()],
  ["mk", new MkConnector()],
  ["sgp", new SgpConnector()],
  ["hubsoft", new HubsoftConnector()],
  ["voalle", new VoalleConnector()],
  ["rbx", new RbxConnector()],
];

const STUBS: [string, ErpConnector][] = [
  ["gere", new GereConnector()],
  ["radiusnet", new RadiusnetConnector()],
  ["receitanet", new ReceitanetConnector()],
  ["topsapp", new TopsappConnector()],
];

describe("marca de conector nao implementado", () => {
  it.each(STUBS)("%s esta marcado como nao implementado", (_nome, conector) => {
    expect(conector.naoImplementado).toBe(true);
  });

  it.each(IMPLEMENTADOS)("%s nao esta marcado", (_nome, conector) => {
    // Ausente e o valor certo para quem funciona: o contrato diz que so o stub
    // declara. `false` explicito tambem passa, mas nao e o que se pede.
    expect(conector.naoImplementado).toBeFalsy();
  });

  it("o nome da classe bate com o nome da lista", () => {
    // Se as duas listas acima trocarem de instancia por copiar-e-colar, os
    // testes por nome viram teatro. Este as ancora no conector de verdade.
    for (const [nome, conector] of [...IMPLEMENTADOS, ...STUBS]) {
      expect(conector.name).toBe(nome);
    }
  });

  it("o registry contem exatamente os conectores classificados", () => {
    // Igualdade nos dois sentidos, e cada lado pega um erro diferente: sobrar no
    // registry e conector novo que ninguem classificou; faltar e conector que
    // existe no fonte mas nunca chegou ao registry — foi o caso do voalle, que
    // ficava fora da lista suspensa e nao sincronizava para nenhum provedor.
    const classificados = [...IMPLEMENTADOS, ...STUBS].map(([nome]) => nome).sort();
    const registrados = getAllConnectors().map(c => c.name).sort();
    expect(registrados).toEqual(classificados);
  });
});

/**
 * O import e o registro tem de contar a mesma historia.
 *
 * server/erp/index.ts mistura duas convencoes: conector importado como classe e
 * registrado ali mesmo, e conector que se registra sozinho no fim do proprio
 * arquivo (importado so pelo efeito colateral). O voalle estava listado no
 * segundo grupo sem nunca chamar registerConnector() — importado, portanto
 * "presente" para quem lesse o barrel, e ausente do registry para quem o usasse.
 * Ficou meses assim porque nenhum teste comparava o que o index IMPORTA com o
 * que o registry CONTEM: as duas listas acima eram escritas a mao e nasciam do
 * mesmo engano.
 *
 * Este teste fecha a lacuna lendo o fonte do barrel. Um conector acrescentado
 * pelo caminho errado — importado e nao registrado — cai no mesmo dia.
 */
describe("todo conector importado pelo barrel chega ao registry", () => {
  const barrel = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");

  // Pega as duas formas de citacao: `import { X } from "./connectors/foo.js"` e
  // `import "./connectors/foo.js"`. Basta o caminho; o nome vem do fonte do
  // proprio conector, para o teste nao presumir que arquivo e nome coincidem.
  const arquivosCitados = [...barrel.matchAll(/from\s+"\.\/connectors\/([\w-]+)\.js"|import\s+"\.\/connectors\/([\w-]+)\.js"/g)]
    .map(m => m[1] ?? m[2]);
  const unicos = [...new Set(arquivosCitados)];

  // "demo" e o UNICO conector cujo import no barrel nao implica registro
  // incondicional — `connectors/demo.ts` so chama `registerConnector()` quando
  // `emModoDemo()`, de proposito (ver o comentario em index.ts e em demo.ts).
  // Cobrar `getConnector("demo")` aqui, junto dos demais, faria este teste
  // falhar sempre que rodasse fora do modo demo — que e o caso normal. O
  // comportamento condicional dele tem describe proprio mais abaixo.
  const semCondicional = unicos.filter((arquivo) => arquivo !== "demo");

  it("o barrel cita conectores (guarda contra a expressao parar de casar)", () => {
    // Sem esta linha, uma mudanca de formatacao no index.ts esvaziaria a lista e
    // o `it.each` abaixo passaria sem testar nada.
    expect(unicos.length).toBeGreaterThanOrEqual(10);
  });

  it("o barrel cita o conector demo (guarda contra o import condicional sumir)", () => {
    expect(unicos).toContain("demo");
  });

  it.each(semCondicional)("%s.ts esta registrado depois do import do barrel", (arquivo) => {
    const fonte = readFileSync(join(import.meta.dirname, "connectors", `${arquivo}.ts`), "utf8");
    const nome = fonte.match(/readonly name = "([^"]+)"/)?.[1];
    expect(nome, `connectors/${arquivo}.ts nao declara readonly name`).toBeDefined();
    expect(getConnector(nome!), `connectors/${arquivo}.ts e importado por index.ts mas nao chega ao registry`).toBeDefined();
  });
});

/**
 * O conector demo e o UNICO cujo registro depende do ambiente. Fora do modo
 * demo (o caso de producao, e o caso normal deste arquivo de teste) ele tem
 * que ficar de fora do registry — nenhum provedor real pode configurar um
 * "ERP" que le a propria base do Consulta ISP. `vi.resetModules()` +
 * reimport dinamico e o unico jeito de ver as DUAS respostas no mesmo
 * processo: o barril decide na primeira vez que e avaliado (o `if
 * (emModoDemo())` roda uma vez, na carga do modulo), e o import estatico do
 * topo deste arquivo ja capturou essa decisao para o resto da suite — por
 * isso os dois testes abaixo reimportam o barril, em vez de reusar
 * `getConnector` importado no topo.
 */
describe("conector demo — registro condicional por DEMO_MODE", () => {
  const originalDemoMode = process.env.DEMO_MODE;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = originalDemoMode;
  });

  it("sem DEMO_MODE, o registry nao contem o conector demo", async () => {
    delete process.env.DEMO_MODE;
    const { getConnector: getConnectorFresco } = await import("./index.js");
    expect(getConnectorFresco("demo")).toBeUndefined();
  });

  it("com DEMO_MODE=true, o registry contem o conector demo", async () => {
    process.env.DEMO_MODE = "true";
    const { getConnector: getConnectorFresco } = await import("./index.js");
    const conector = getConnectorFresco("demo");
    expect(conector).toBeDefined();
    expect(conector?.name).toBe("demo");
    expect(conector?.naoImplementado).toBeFalsy();
  });
});

/**
 * A trava de regressao le o FONTE do conector em vez de chamar seus metodos.
 *
 * Chamar `testConnection` e companhia para conferir a mensagem exigiria rede —
 * ou um mock de fetch por ERP, que so provaria o que o mock devolve. Ler o
 * arquivo nao custa nada e pega exatamente o caso que interessa: alguem colar
 * mais um stub em connectors/ e esquecer de marca-lo. Se um conector
 * implementado carregar a frase "ainda nao implementado", ou ele voltou a ser
 * stub ou a marca ficou faltando; nos dois casos a lista suspensa mentiria.
 *
 * O limite e honesto: so o arquivo do proprio conector e lido, entao um stub
 * escondido num helper importado passaria. Vale pela forma como os quatro
 * stubs de hoje sao escritos, e e barato o bastante para rodar sempre.
 */
describe("fonte de conector implementado nao contem resposta de stub", () => {
  const fonte = (nome: string) =>
    readFileSync(join(import.meta.dirname, "connectors", `${nome}.ts`), "utf8");

  it.each(IMPLEMENTADOS)("%s.ts nao devolve 'ainda nao implementado'", (nome) => {
    expect(fonte(nome)).not.toContain("ainda nao implementado");
  });

  it.each(STUBS)("%s.ts devolve 'ainda nao implementado' — e por isso esta marcado", (nome) => {
    // O contraponto: prova que a busca acima procura uma frase que de fato
    // existe no codigo, e nao uma que mudou de texto sem ninguem notar.
    expect(fonte(nome)).toContain("ainda nao implementado");
  });
});
