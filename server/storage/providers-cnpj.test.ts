import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Duas formas do mesmo CNPJ nao podem virar dois provedores.
 *
 * MEDIDO em producao em 05/09/2026: das seis linhas de `providers`, quatro
 * estavam mascaradas ("23.864.873/0001-48") e duas cruas ("22759562000156").
 * `getProviderByCnpj` comparava por igualdade exata de string, entao quem se
 * cadastrasse digitando "23864873000148" NAO casava com a linha mascarada da
 * propria empresa: a conferencia de duplicidade passava, o indice UNIQUE
 * tambem nao barrava (para o Postgres sao duas strings diferentes) e nascia um
 * segundo tenant para a mesma empresa — carteira, credito e alerta de
 * anti-fraude partidos em dois, cada metade cega para a outra.
 *
 * A migracao 0020 canonizou a coluna. Estes testes cobrem o outro lado: o
 * argumento chega canonico, e o SQL continua sendo uma igualdade sobre a
 * COLUNA — se alguem "consertar" isto com `regexp_replace` no SQL, o indice
 * para de ser usado e dado sujo que volte a entrar deixa de ser percebido.
 *
 * O Postgres nao entra aqui: o que precisa de prova e o texto e os parametros
 * da consulta, e isso o dialeto do Drizzle compila sozinho.
 */
const estado = vi.hoisted(() => ({
  selects: [] as { tabela: unknown; where: unknown }[],
  /** tabela do Drizzle -> linhas que o SELECT nela devolve. */
  retorno: new Map<unknown, unknown[]>(),
}));

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: (tabela: unknown) => ({
        where: async (cond: unknown) => {
          estado.selects.push({ tabela, where: cond });
          return estado.retorno.get(tabela) ?? [];
        },
      }),
    }),
  },
  pool: {},
}));

import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { providers } from "@shared/schema";
import { cnpjCanonico, ProvidersStorage } from "./providers.storage";

const dialeto = new PgDialect();
const paraSql = (q: unknown) => dialeto.sqlToQuery(q as SQL);

/** O CNPJ do provedor 6 (Amplinet), a linha mascarada medida em producao. */
const MASCARADO = "23.864.873/0001-48";
const DIGITOS = "23864873000148";

let storage: ProvidersStorage;

beforeEach(() => {
  estado.selects.length = 0;
  estado.retorno.clear();
  storage = new ProvidersStorage();
});

describe("cnpjCanonico", () => {
  it("reduz as duas formas medidas em producao a mesma string", () => {
    expect(cnpjCanonico(MASCARADO)).toBe(DIGITOS);
    expect(cnpjCanonico(DIGITOS)).toBe(DIGITOS);
  });

  it("e idempotente — aplicar de novo no proprio resultado nao muda nada", () => {
    expect(cnpjCanonico(cnpjCanonico(MASCARADO))).toBe(DIGITOS);
  });

  it("aceita as mascaras que a tela e o teclado produzem", () => {
    for (const forma of [
      "23.864.873/0001-48",
      "23864873/0001-48",
      " 23 864 873 0001 48 ",
      "23.864.873/0001-48\n",
    ]) {
      expect(cnpjCanonico(forma)).toBe(DIGITOS);
    }
  });

  // O TypeScript promete `string`; `req.body` nao promete nada. Sem a coercao,
  // um `undefined` que escape de uma rota vira TypeError dentro do storage e a
  // rota o converte em 500 — quando a resposta certa e "nao achei".
  it("nao explode com o que vem de req.body", () => {
    expect(cnpjCanonico(undefined as any)).toBe("");
    expect(cnpjCanonico(null as any)).toBe("");
    expect(cnpjCanonico(23864873000148 as any)).toBe(DIGITOS);
  });
});

describe("getProviderByCnpj", () => {
  it("procura pelos digitos mesmo quando recebe a mascara", async () => {
    await storage.getProviderByCnpj(MASCARADO);

    const q = paraSql(estado.selects[0].where);
    expect(getTableName(estado.selects[0].tabela as any)).toBe("providers");
    expect(q.params).toEqual([DIGITOS]);
    expect(q.params).not.toContain(MASCARADO);
  });

  /**
   * O teste que prova o defeito. Antes, estas duas chamadas emitiam consultas
   * DIFERENTES: uma achava a empresa, a outra nao — e a que nao achava
   * autorizava o cadastro de um segundo tenant.
   */
  it("as duas formas do mesmo CNPJ emitem a MESMA consulta", async () => {
    await storage.getProviderByCnpj(MASCARADO);
    await storage.getProviderByCnpj(DIGITOS);

    const [comMascara, semMascara] = estado.selects.map(s => paraSql(s.where));
    expect(comMascara).toEqual(semMascara);
  });

  /**
   * A normalizacao fica no ARGUMENTO. `regexp_replace` sobre a coluna casaria
   * os dois formatos sem depender da migracao 0020, mas ao preco de duas
   * coisas: o indice de `cnpj` deixa de ser usado (a comparacao vira uma
   * expressao, e o scan e sequencial), e dado sujo que voltasse a entrar
   * continuaria sendo encontrado — entao ninguem descobriria que voltou.
   */
  it("compara com a COLUNA crua, para o indice continuar valendo", async () => {
    await storage.getProviderByCnpj(MASCARADO);

    const q = paraSql(estado.selects[0].where);
    expect(q.sql).toMatch(/"providers"\."cnpj" = \$1/);
    expect(q.sql).not.toContain("regexp_replace");
    expect(q.sql).not.toContain("replace");
  });

  it("devolve a linha encontrada", async () => {
    estado.retorno.set(providers, [{ id: 6, name: "Amplinet", cnpj: DIGITOS }]);

    await expect(storage.getProviderByCnpj(MASCARADO)).resolves.toMatchObject({ id: 6 });
  });

  it("devolve undefined quando nao ha linha — nao explode", async () => {
    await expect(storage.getProviderByCnpj("")).resolves.toBeUndefined();
  });
});

