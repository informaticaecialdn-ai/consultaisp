/**
 * Os dois predicados que tiram o sandbox de OUTRO visitante das leituras que
 * cruzam provedores. Presos no SQL que sai, com o mesmo dialeto de produção:
 * com e sem a exclusão, as versões quase não se distinguem na leitura.
 */
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { customers } from "@shared/schema";
import {
  PADRAO_DE_SANDBOX_NO_SQL,
  doProvedorForaDeSandboxAlheio,
  provedorForaDeSandboxAlheio,
} from "./fora-de-sandbox";

const render = (q: unknown) => new PgDialect().sqlToQuery(q as any);

describe("provedorForaDeSandboxAlheio — para consulta que já lê providers", () => {
  it("sem observador: aceita subdominio nulo e recusa o padrao, ligado como parametro", () => {
    const q = render(provedorForaDeSandboxAlheio());
    const texto = q.sql.toLowerCase();
    // Sem o IS NULL, provedor sem subdominio sumiria: NULL NOT LIKE da NULL.
    expect(texto).toContain("subdomain");
    expect(texto).toContain("is null or");
    expect(texto).toContain("not like");
    expect(q.params).toEqual([PADRAO_DE_SANDBOX_NO_SQL]);
    expect(q.sql).not.toContain("sandbox-");
  });

  it("com observador: o sandbox do proprio observador continua na leitura", () => {
    const q = render(provedorForaDeSandboxAlheio(42));
    const texto = q.sql.toLowerCase();
    expect(texto).toContain("not like");
    expect(texto).toMatch(/"id" = \$2\)$/);
    expect(q.params).toEqual([PADRAO_DE_SANDBOX_NO_SQL, 42]);
  });
});

describe("doProvedorForaDeSandboxAlheio — para tabela que so tem provider_id", () => {
  it("sem observador: subconsulta sobre providers, sem JOIN e sem mexer no formato da linha", () => {
    const q = render(doProvedorForaDeSandboxAlheio(customers.providerId));
    const texto = q.sql.toLowerCase();
    expect(texto).toContain('"provider_id" not in (select');
    expect(texto).toContain('from "providers"');
    expect(texto).toContain("like $1");
    expect(texto).not.toContain(" join ");
    expect(q.params).toEqual([PADRAO_DE_SANDBOX_NO_SQL]);
  });

  it("com observador: tira todo sandbox menos o do observador", () => {
    const q = render(doProvedorForaDeSandboxAlheio(customers.providerId, 7));
    const texto = q.sql.toLowerCase();
    expect(texto).toContain("like $1");
    expect(texto).toContain("<> $2");
    expect(q.params).toEqual([PADRAO_DE_SANDBOX_NO_SQL, 7]);
  });

  it("o padrao comeca pelo prefixo do sandbox e so entao abre o curinga", () => {
    // A igualdade exata com PREFIXO_SANDBOX esta em server/demo/sandbox.service.test.ts;
    // aqui fica so a forma, para um erro de digitacao nao passar calado.
    expect(PADRAO_DE_SANDBOX_NO_SQL.startsWith("sandbox-")).toBe(true);
    expect(PADRAO_DE_SANDBOX_NO_SQL.endsWith("%")).toBe(true);
    expect(PADRAO_DE_SANDBOX_NO_SQL.indexOf("%")).toBe(PADRAO_DE_SANDBOX_NO_SQL.length - 1);
    expect(PADRAO_DE_SANDBOX_NO_SQL).not.toContain("_");
  });
});

describe("ehSubdominioDeSandbox — para lista ja carregada em memoria", () => {
  it("reconhece o sandbox e deixa passar rede, provedor real e subdominio vazio", async () => {
    const { ehSubdominioDeSandbox } = await import("./fora-de-sandbox");
    expect(ehSubdominioDeSandbox("sandbox-25e05fcf17325015")).toBe(true);
    expect(ehSubdominioDeSandbox("SANDBOX-abc")).toBe(true);
    expect(ehSubdominioDeSandbox("rede-1")).toBe(false);
    expect(ehSubdominioDeSandbox("nslink")).toBe(false);
    // Nao e por CONTER a palavra: "meusandbox-x" e um provedor como outro qualquer.
    expect(ehSubdominioDeSandbox("meusandbox-x")).toBe(false);
    expect(ehSubdominioDeSandbox(null)).toBe(false);
    expect(ehSubdominioDeSandbox(undefined)).toBe(false);
  });
});
