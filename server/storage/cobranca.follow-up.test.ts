/**
 * Follow-up (05/09/2026): a coluna `proxima_acao` da migracao 0026 e a do
 * schema, e o caso a expoe na linha da carteira. Sem esta paridade a API
 * sobe (a migracao e idempotente) mas o Drizzle seleciona uma coluna que
 * nao existe — e todo GET da cobranca cai com 500.
 */
import fs from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cobrancaCasos } from "@shared/schema";

describe("migracao 0026 — proxima_acao", () => {
  const sql = fs.readFileSync(path.resolve(process.cwd(), "migrations/0026_cobranca_proxima_acao.sql"), "utf8");

  it("adiciona a coluna de forma idempotente, e o schema a declara com o mesmo nome", () => {
    expect(sql).toMatch(/ALTER TABLE cobranca_casos ADD COLUMN IF NOT EXISTS proxima_acao text;/);
    const colunas = getTableColumns(cobrancaCasos) as Record<string, { name: string; notNull: boolean }>;
    expect(colunas.proximaAcao?.name).toBe("proxima_acao");
    expect(colunas.proximaAcao?.notNull).toBe(false);
  });

  it("o storage seleciona e devolve a coluna na linha da carteira", () => {
    const fonte = fs.readFileSync(path.resolve(process.cwd(), "server/storage/cobranca.storage.ts"), "utf8");
    expect(fonte).toContain("proximaAcao: cobrancaCasos.proximaAcao,");
    expect(fonte).toContain("proximaAcao: l.proximaAcao ?? null,");
    expect(fonte).toContain("if (patch.proximaAcao !== undefined) set.proximaAcao = patch.proximaAcao;");
  });
});
