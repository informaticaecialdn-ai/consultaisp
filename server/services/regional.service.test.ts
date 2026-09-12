/**
 * O 500 do mapa regional, preso por uma asercao sobre o SQL que sai.
 *
 * `GET /api/regional/providers` respondia 500 em producao com
 * `operator does not exist: text[] && record` (log de 04/09/2026, 13:51 e
 * 14:03). A causa era um array de JavaScript interpolado num template `sql` do
 * Drizzle: ele nao vira parametro de array, vira `($1, $2)` — um construtor de
 * linha, que o Postgres le como `record`.
 *
 * O teste renderiza o SQL com o MESMO dialeto de producao. Afirmar a intencao
 * nao adiantaria: a linha quebrada e a consertada sao quase identicas na
 * leitura, e a diferenca so aparece no texto emitido.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {} }));

import { PgDialect } from "drizzle-orm/pg-core";
import { sobreposicaoDeCidades } from "./regional.service";

const render = (cidades: string[]) =>
  new PgDialect().sqlToQuery(sobreposicaoDeCidades(cidades) as any);

const DUAS = ["Embu-Guacu - SP", "Itapecerica da Serra - SP"];

describe("sobreposicaoDeCidades", () => {
  it("compara a coluna certa pelo operador de sobreposicao", () => {
    const q = render(DUAS);
    expect(q.sql).toContain("cidades_atendidas");
    expect(q.sql).toContain("&&");
  });

  /**
   * ESTA e a asercao que prende o defeito. Com a lista virando `($1, $2)` o
   * Postgres recebe um record e a rota da 500 — e nenhuma asercao sobre
   * "contem &&" ou "contem ::text[]" pegaria isso, porque as duas continuariam
   * verdadeiras na versao quebrada.
   */
  it("a lista inteira vai como UM parametro, nunca como lista entre parenteses", () => {
    const q = render(DUAS);
    expect(q.sql.match(/\$\d+/g)).toHaveLength(1);
    expect(q.sql).not.toMatch(/\(\s*\$\d+\s*,/);
  });

  it("as cidades viajam ligadas, e nao interpoladas no texto do SQL", () => {
    const q = render(DUAS);
    expect(JSON.stringify(q.params)).toContain("Embu-Guacu - SP");
    expect(q.sql).not.toContain("Embu-Guacu");
  });

  it("uma cidade so tambem e um parametro, e nao um escalar solto", () => {
    const q = render(["Embu-Guacu - SP"]);
    expect(q.sql.match(/\$\d+/g)).toHaveLength(1);
    expect(JSON.stringify(q.params)).toContain("Embu-Guacu - SP");
  });
});

/**
 * A busca regional nao devolve o sandbox de OUTRO visitante — senao, na
 * demonstracao, cada visitante veria os outros como "provedores parceiros"
 * (achado no ar, 12/09/2026). Preso no SQL que sai, pelo mesmo motivo dos
 * testes acima: com e sem a exclusao, as duas versoes quase nao se distinguem
 * na leitura.
 */
describe("busca regional exclui sandboxes", () => {
  it("o predicado aceita subdominio nulo, recusa o padrao e o liga como parametro", async () => {
    const { foraDeSandboxAlheio, PADRAO_DE_SANDBOX_NO_SQL } = await import("./regional.service");
    const q = new PgDialect().sqlToQuery(foraDeSandboxAlheio() as any);
    expect(q.sql).toContain("subdomain");
    // Sem o IS NULL, provedor sem subdominio sumiria da regiao: NULL NOT LIKE da NULL.
    expect(q.sql.toLowerCase()).toContain("is null or");
    expect(q.sql.toLowerCase()).toContain("not like");
    expect(q.params).toEqual([PADRAO_DE_SANDBOX_NO_SQL]);
    expect(q.sql).not.toContain("sandbox-");
  });

  it("getRegionalProviders poe a exclusao no WHERE da busca", async () => {
    const { db } = (await import("../db")) as any;
    const { getRegionalProviders, PADRAO_DE_SANDBOX_NO_SQL } = await import("./regional.service");
    const condicoes: unknown[] = [];
    let chamada = 0;
    db.select = () => ({
      from: () => ({
        where: async (condicao: unknown) => {
          chamada++;
          // 1a: o proprio provedor (as cidades dele); 2a: a busca regional.
          if (chamada === 1) return [{ id: 6, cidadesAtendidas: ["Londrina"] }];
          condicoes.push(condicao);
          return [];
        },
      }),
    });

    await getRegionalProviders(6);

    expect(condicoes).toHaveLength(1);
    const q = new PgDialect().sqlToQuery(condicoes[0] as any);
    expect(q.sql.toLowerCase()).toContain("not like");
    expect(q.params).toContain(PADRAO_DE_SANDBOX_NO_SQL);
  });

  it("getProvidersByMesoregion manda a exclusao no SQL cru, com o padrao ligado", async () => {
    const { db, pool } = (await import("../db")) as any;
    const { getProvidersByMesoregion, PADRAO_DE_SANDBOX_NO_SQL } = await import("./regional.service");
    db.select = () => ({
      from: () => ({ where: async () => [{ id: 6, mesorregioes: ["Norte Central Paranaense"] }] }),
    });
    const chamadas: Array<{ texto: string; valores: unknown[] }> = [];
    pool.query = async (texto: string, valores: unknown[]) => {
      chamadas.push({ texto, valores });
      return { rows: [] };
    };

    await getProvidersByMesoregion(6);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].texto).toMatch(/subdomain IS NULL OR subdomain NOT LIKE \$3/);
    expect(chamadas[0].valores).toEqual([6, ["Norte Central Paranaense"], PADRAO_DE_SANDBOX_NO_SQL]);
  });
});
