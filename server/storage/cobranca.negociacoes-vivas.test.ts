import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `negociacoesVivasPorCaso`: uma consulta para o quadro inteiro, so acordos
 * vivos (proposta, aceita, ativa), toda consulta com provider_id, e o resumo
 * que o card mostra — parcelas pagas, a proxima pendente ou atrasada, a mais
 * recente por caso. Mesmo banco de mentira (pg-proxy) dos outros storages.
 */
const banco = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  linhas: new Map<string, Record<string, unknown>[]>(),
  db: null as any,
}));
vi.mock("../db", () => ({ db: new Proxy({} as any, { get: (_alvo, chave) => banco.db[chave] }), pool: {} }));

import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { cobrancaNegociacoes, cobrancaParcelas } from "@shared/schema";
import { CobrancaStorage } from "./cobranca.storage";

const PROVEDOR = 6;
const TABELAS = [cobrancaNegociacoes, cobrancaParcelas];
const chavePorColuna = new Map(TABELAS.map(t => [getTableName(t), new Map(Object.entries(getTableColumns(t)).map(([chave, coluna]) => [(coluna as any).name as string, chave]))]));

function tabelaAlvo(sqlTexto: string): string { return sqlTexto.match(/ from "(\w+)"/)?.[1] ?? ""; }
function colunas(sqlTexto: string): string[] | null {
  if (!sqlTexto.startsWith("select ")) return null;
  const lista = sqlTexto.slice(7, sqlTexto.indexOf(" from "));
  const itens: string[] = [];
  for (const item of lista.split(", ")) { const c = item.match(/^(?:"\w+"\.)?"(\w+)"$/); if (!c) return null; itens.push(c[1]); }
  return itens;
}
function responder(sqlTexto: string): unknown[] {
  const alvo = tabelaAlvo(sqlTexto); const cols = colunas(sqlTexto); if (!cols) return [];
  const chaves = chavePorColuna.get(alvo);
  return (banco.linhas.get(alvo) ?? []).map(l => cols.map(c => { const k = chaves?.get(c); return k === undefined ? null : (l[k] ?? null); }));
}

let storage: CobrancaStorage;
beforeEach(() => {
  banco.consultas.length = 0; banco.linhas.clear();
  banco.db = drizzle(async (sqlTexto, params) => { banco.consultas.push({ sql: sqlTexto, params }); return { rows: responder(sqlTexto) }; });
  storage = new CobrancaStorage();
});

const negociacao = (extra: Record<string, unknown>) => ({
  id: 1, providerId: PROVEDOR, casoId: 10, customerId: 42, tipo: "parcelamento", valorOriginal: "400.00", valorNegociado: "300.00", descontoPct: "25.00",
  entrada: "0.00", parcelas: 3, valorParcela: "100.00", primeiroVencimento: "2026-09-10", status: "ativa", criadoPorUserId: 3, aceitaEm: "2026-09-02 10:00:00",
  quebradaEm: null, createdAt: "2026-09-01 10:00:00", updatedAt: "2026-09-01 10:00:00", ...extra,
});

describe("negociacoesVivasPorCaso", () => {
  it("so status vivos, toda consulta com provider_id, e o resumo com pagas e a proxima parcela", async () => {
    banco.linhas.set("cobranca_negociacoes", [negociacao({})]);
    banco.linhas.set("cobranca_parcelas", [
      { id: 501, providerId: PROVEDOR, negociacaoId: 1, numero: 1, valor: "100.00", vencimento: "2026-09-10", status: "paga", pagoEm: "2026-09-10 10:00:00", valorPago: "100.00" },
      { id: 502, providerId: PROVEDOR, negociacaoId: 1, numero: 2, valor: "100.00", vencimento: "2026-10-10", status: "atrasada", pagoEm: null, valorPago: null },
      { id: 503, providerId: PROVEDOR, negociacaoId: 1, numero: 3, valor: "100.00", vencimento: "2026-11-10", status: "pendente", pagoEm: null, valorPago: null },
    ]);
    const mapa = await storage.negociacoesVivasPorCaso(PROVEDOR);
    expect(banco.consultas).toHaveLength(2);
    for (const c of banco.consultas) {
      const oc = Array.from(c.sql.matchAll(/"provider_id" = \$(\d+)/g));
      expect(oc.length, c.sql).toBeGreaterThan(0);
      for (const o of oc) expect(c.params[Number(o[1]) - 1]).toBe(PROVEDOR);
    }
    expect(banco.consultas[0].sql).toContain('"status" in (');
    expect(banco.consultas[0].params).toEqual(expect.arrayContaining(["proposta", "aceita", "ativa"]));
    const r = mapa.get(10)!;
    expect(r).toMatchObject({ id: 1, tipo: "parcelamento", status: "ativa", valorNegociado: 300, entrada: 0, parcelas: 3, valorParcela: 100, parcelasPagas: 1 });
    expect(r.proximaParcela).toEqual({ numero: 2, vencimento: "2026-10-10", valor: 100, atrasada: true });
  });
  it("sem acordo vivo: mapa vazio e uma consulta so", async () => {
    const mapa = await storage.negociacoesVivasPorCaso(PROVEDOR);
    expect(mapa.size).toBe(0);
    expect(banco.consultas).toHaveLength(1);
  });
  it("dois acordos vivos do mesmo caso: o mais recente vence", async () => {
    banco.linhas.set("cobranca_negociacoes", [negociacao({ id: 2, createdAt: "2026-09-05 10:00:00", status: "proposta", parcelas: 2 }), negociacao({ id: 1 })]);
    const mapa = await storage.negociacoesVivasPorCaso(PROVEDOR);
    expect(mapa.get(10)!.id).toBe(2);
    expect(mapa.get(10)!.proximaParcela).toBeNull();
  });
});
