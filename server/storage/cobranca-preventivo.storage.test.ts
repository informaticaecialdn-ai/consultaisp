import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
const banco = vi.hoisted(() => ({ consultas: [] as { sql: string; params: unknown[] }[], db: null as ReturnType<typeof drizzle> | null, responder: (_sql: string): unknown[][] => [] }));
vi.mock("../db", () => ({ db: new Proxy({}, { get: (_t, p) => banco.db![p as keyof typeof banco.db] }), pool: {} }));
import { CobrancaPreventivoStorage, diaDoPreAviso } from "./cobranca-preventivo.storage";
const storage = new CobrancaPreventivoStorage();
beforeEach(() => {
  banco.consultas = [];
  banco.responder = () => [];
  banco.db = drizzle(async (sql, params) => { banco.consultas.push({ sql, params }); return { rows: banco.responder(sql) }; });
});
describe("fila de pré-avisos", () => {
  it("deduplica atomicamente por provedor, fatura e dia", async () => {
    banco.responder = sql => sql.startsWith("select") ? [[10, 42, "aberta", "2026-09-15 00:00:00", "100.00"]] : [[1]];
    expect(await storage.prepararPreAvisos(6, new Date("2026-09-08T15:00:00Z"))).toBe(1);
    expect(banco.consultas[1].sql).toContain('on conflict ("provider_id","fatura_id","dia_contato") do nothing');
    expect(banco.consultas[1].params).toEqual(expect.arrayContaining([6, 42, 10, "2026-09-08", -7]));
    expect(banco.consultas[0].sql).toContain('"customers"."provider_id"');
  });
  it("reserva com compare-and-set e não retorna ao pendente após timeout", async () => {
    expect(await storage.reservarPreAviso(6, 10, "2026-09-08")).toBe(false);
    expect(banco.consultas[0].params).toEqual(expect.arrayContaining([6, 10, "2026-09-08", "pendente", "enviando"]));
    await storage.concluirPreAviso(6, 10, { status: "incerto" });
    expect(banco.consultas[1].params).toContain("enviando");
    expect(banco.consultas[1].params).not.toContain("pendente");
  });
  it("revalida fatura, cliente atual e tenant antes de enviar", async () => {
    await storage.listarPreAvisosPendentes(6, "2026-09-08");
    const q = banco.consultas[0];
    expect(q.params).toContain("active");
    expect(q.params).toContain("aberta");
    expect(q.sql).toContain('"invoices"."customer_id" = "cobranca_pre_avisos"."customer_id"');
    for (const m of q.sql.matchAll(/"provider_id" = \$(\d+)/g)) expect(q.params[Number(m[1]) - 1]).toBe(6);
  });
  it("dia do toque respeita Brasília na virada UTC", () => {
    expect(diaDoPreAviso(new Date("2026-09-09T01:00:00Z"))).toBe("2026-09-08");
  });
});
