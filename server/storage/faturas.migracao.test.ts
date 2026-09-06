/**
 * Faturas do ERP (05/09/2026): as colunas da migracao 0027 sao as do schema,
 * e o upsert do storage aponta para o MESMO indice parcial que a migracao
 * cria. Sem esta paridade a API sobe (a migracao e idempotente) mas o Drizzle
 * seleciona coluna que nao existe — e todo resumo do mes cai com 500; ou o
 * `ON CONFLICT` aponta um predicado que o Postgres nao reconhece como o do
 * indice, e a primeira varredura com fatura repetida derruba o sync.
 */
import fs from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { invoices } from "@shared/schema";

const raiz = process.cwd();
const sql = fs.readFileSync(path.resolve(raiz, "migrations/0027_faturas_do_erp.sql"), "utf8");

describe("migracao 0027 — faturas do ERP", () => {
  it("adiciona as cinco colunas de forma idempotente, e o schema as declara com o mesmo nome", () => {
    for (const coluna of ["erp_source text", "erp_ref text", "descricao text", "baixada_em timestamp", "updated_at timestamp DEFAULT now()"]) {
      expect(sql).toContain(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ${coluna};`);
    }
    const colunas = getTableColumns(invoices) as Record<string, { name: string; notNull: boolean }>;
    expect(colunas.erpSource?.name).toBe("erp_source");
    expect(colunas.erpRef?.name).toBe("erp_ref");
    expect(colunas.descricao?.name).toBe("descricao");
    expect(colunas.baixadaEm?.name).toBe("baixada_em");
    expect(colunas.updatedAt?.name).toBe("updated_at");
    for (const c of ["erpSource", "erpRef", "descricao", "baixadaEm", "updatedAt"]) {
      expect(colunas[c]?.notNull, c).toBe(false);
    }
  });

  it("contract_id passa a aceitar nulo — a fatura do ERP nao tem contrato nosso", () => {
    expect(sql).toContain("ALTER TABLE invoices ALTER COLUMN contract_id DROP NOT NULL;");
    const colunas = getTableColumns(invoices) as Record<string, { notNull: boolean }>;
    expect(colunas.contractId?.notNull).toBe(false);
  });

  it("os dois indices existem na migracao e no schema, com o mesmo nome", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS invoices_provider_erp_ref_uq\s+ON invoices \(provider_id, erp_source, erp_ref\) WHERE erp_ref IS NOT NULL;/);
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_invoices_provider_due ON invoices (provider_id, due_date);");
    const nomes = getTableConfig(invoices).indexes.map(i => i.config.name);
    expect(nomes).toEqual(expect.arrayContaining(["invoices_provider_erp_ref_uq", "idx_invoices_provider_due"]));
  });

  it("o upsert do storage aponta o predicado do indice parcial palavra por palavra", () => {
    // O Postgres so aceita um indice parcial como alvo de ON CONFLICT quando o
    // predicado escrito na clausula implica o do indice. Manter o texto igual
    // e a forma de nao depender da inferencia.
    const fonte = fs.readFileSync(path.resolve(raiz, "server/storage/faturas.storage.ts"), "utf8");
    expect(fonte).toContain("targetWhere: sql`erp_ref IS NOT NULL`");
    expect(fonte).toContain("target: [invoices.providerId, invoices.erpSource, invoices.erpRef]");
  });

  it("a migracao aplica no boot: o nome segue a sequencia e nao colide", () => {
    const arquivos = fs.readdirSync(path.resolve(raiz, "migrations")).filter(f => f.startsWith("0027"));
    expect(arquivos).toEqual(["0027_faturas_do_erp.sql"]);
  });
});
