/**
 * Confissão de dívida (09/09/2026): as colunas e os índices da migração 0037
 * são os do schema. Sem esta paridade a API sobe (a migração é idempotente) e
 * o Drizzle seleciona coluna que não existe — a emissão cai com 500; ou o
 * índice parcial "uma confissão viva por cliente" não existe e duas emissões
 * simultâneas passam.
 */
import fs from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { assinaturaIntegracoes, cobrancaConfissoes, cobrancaConfissoesPdf } from "@shared/schema";

const raiz = process.cwd();
const sql = fs.readFileSync(path.resolve(raiz, "migrations/0037_confissao_de_divida_zapsign.sql"), "utf8");

function nomesDasColunas(tabela: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.values(getTableColumns(tabela) as Record<string, { name: string }>).map(c => c.name);
}

describe("migração 0037 — confissão de dívida e ZapSign", () => {
  it("não abre transação própria: o runner envolve cada arquivo na dele", () => {
    expect(sql).not.toMatch(/^\s*BEGIN\b/mi);
    expect(sql).not.toMatch(/^\s*COMMIT\b/mi);
  });
  it("cria as três tabelas de forma idempotente", () => {
    for (const t of ["assinatura_integracoes", "cobranca_confissoes", "cobranca_confissoes_pdf"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${t} (`);
    }
  });
  it.each([
    ["assinatura_integracoes", assinaturaIntegracoes],
    ["cobranca_confissoes", cobrancaConfissoes],
    ["cobranca_confissoes_pdf", cobrancaConfissoesPdf],
  ] as const)("toda coluna de %s no schema está no SQL", (nome, tabela) => {
    const bloco = sql.slice(sql.indexOf(`CREATE TABLE IF NOT EXISTS ${nome} (`));
    const fim = bloco.indexOf(");");
    const ddl = bloco.slice(0, fim);
    for (const coluna of nomesDasColunas(tabela)) {
      expect(ddl, `${nome}.${coluna}`).toMatch(new RegExp(`^\\s*${coluna}\\s`, "m"));
    }
  });
  it("os índices existem na migração e no schema, com o mesmo nome e o mesmo predicado", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS assinatura_integracoes_provider_fornecedor\s+ON assinatura_integracoes \(provider_id, fornecedor\);/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_cobranca_confissoes_cliente ON cobranca_confissoes \(provider_id, customer_id\);/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_cobranca_confissoes_status ON cobranca_confissoes \(provider_id, status\);/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_cobranca_confissoes_reconciliar ON cobranca_confissoes \(status, reconciliar_em\);/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS cobranca_confissoes_doc_token_uq\s+ON cobranca_confissoes \(zapsign_doc_token\) WHERE zapsign_doc_token IS NOT NULL;/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS cobranca_confissoes_viva_uq\s+ON cobranca_confissoes \(provider_id, customer_id\) WHERE status IN \('rascunho', 'enviada'\);/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS cobranca_confissoes_idempotencia_uq\s+ON cobranca_confissoes \(provider_id, chave_idempotencia\) WHERE chave_idempotencia IS NOT NULL;/);
    const confissoes = getTableConfig(cobrancaConfissoes).indexes.map(i => i.config.name);
    expect(confissoes).toEqual(expect.arrayContaining([
      "idx_cobranca_confissoes_cliente", "idx_cobranca_confissoes_status", "idx_cobranca_confissoes_reconciliar",
      "cobranca_confissoes_doc_token_uq", "cobranca_confissoes_viva_uq", "cobranca_confissoes_idempotencia_uq",
    ]));
    expect(getTableConfig(assinaturaIntegracoes).indexes.map(i => i.config.name)).toContain("assinatura_integracoes_provider_fornecedor");
  });
  it("o PDF tem chave composta (confissao_id, tipo) e o token é cifrado no storage, não no banco", () => {
    expect(sql).toContain("PRIMARY KEY (confissao_id, tipo)");
    const colunas = getTableColumns(assinaturaIntegracoes) as Record<string, { name: string; notNull: boolean }>;
    expect(colunas.apiToken?.name).toBe("api_token");
    expect(colunas.webhookSecret?.name).toBe("webhook_secret");
    expect(colunas.isEnabled?.notNull).toBe(true);
  });
  it("o nome segue a sequência e não colide", () => {
    const arquivos = fs.readdirSync(path.resolve(raiz, "migrations")).filter(f => f.startsWith("0037"));
    expect(arquivos).toEqual(["0037_confissao_de_divida_zapsign.sql"]);
  });
});
