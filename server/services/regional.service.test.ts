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
