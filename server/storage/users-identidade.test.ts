/**
 * E-mail e telefone de conta comparados na forma canonica.
 *
 * A mesma classe de defeito que deixou o CNPJ do provedor em duas formas
 * (providers-cnpj.test.ts): chave de identidade gravada como veio e comparada
 * por igualdade exata. Em 05/09/2026 as 7 contas estavam canonicas e os 4
 * telefones estavam com mascara — o e-mail era latente, o telefone era um
 * `select * from users` filtrado em memoria a cada cadastro.
 *
 * O SQL e renderizado com o mesmo dialeto de producao: afirmar a intencao nao
 * bastaria, a diferenca entre "compara por digitos" e "carrega a tabela" so
 * aparece no texto emitido.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {} }));

import { PgDialect } from "drizzle-orm/pg-core";
import { emailCanonico, filtroPorTelefone } from "./users.storage";

describe("emailCanonico", () => {
  it("tira espaco das pontas e poe em minusculas", () => {
    expect(emailCanonico("  Joao@Provedor.COM.br ")).toBe("joao@provedor.com.br");
  });

  it("e idempotente — canonizar o canonico nao muda nada", () => {
    const uma = emailCanonico("Joao@X.com");
    expect(emailCanonico(uma)).toBe(uma);
  });

  it("aguenta o que vem de req.body sem tipo", () => {
    expect(emailCanonico(undefined as unknown as string)).toBe("");
    expect(emailCanonico(null as unknown as string)).toBe("");
  });

  it("nao mexe no meio: espaco interno nao e apagado em silencio", () => {
    // Espaco no meio e e-mail invalido; quem julga formato e o schema da rota.
    // Apagar aqui esconderia o erro em vez de mostra-lo.
    expect(emailCanonico("jo ao@x.com")).toBe("jo ao@x.com");
  });
});

describe("filtroPorTelefone", () => {
  const render = (digits: string) => new PgDialect().sqlToQuery(filtroPorTelefone(digits));

  it("tira a pontuacao da COLUNA no banco, e compara com os digitos ligados", () => {
    const q = render("11999998888");
    expect(q.sql).toContain("regexp_replace");
    expect(q.sql).toContain("phone");
    expect(q.params).toContain("11999998888");
    // Os digitos nunca vao interpolados no texto.
    expect(q.sql).not.toContain("11999998888");
  });

  it("mascara e digitos crus produzem a MESMA consulta — e por isso que o duplicado e pego", () => {
    // Quem chama ja tirou a pontuacao; a coluna e tratada pelo regexp_replace.
    const a = render("11999998888");
    const b = render("(11) 99999-8888".replace(/\D/g, ""));
    expect(a.sql).toBe(b.sql);
    expect(a.params).toEqual(b.params);
  });
});
