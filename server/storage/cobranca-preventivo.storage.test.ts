import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
const banco = vi.hoisted(() => ({ consultas: [] as { sql: string; params: unknown[] }[], db: null as ReturnType<typeof drizzle> | null, responder: (_sql: string): unknown[][] => [] }));
vi.mock("../db", () => ({ db: new Proxy({}, { get: (_t, p) => banco.db![p as keyof typeof banco.db] }), pool: {} }));
import { CobrancaPreventivoStorage, diaDoPreAviso } from "./cobranca-preventivo.storage";
import { AvisosFaturasSchema } from "@shared/cobranca/preventivo";
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
    expect(banco.consultas[0].sql).toContain("cobranca_preferencias_contato");
    expect(banco.consultas[0].sql).not.toContain("cobranca_comunicacoes");
    await storage.concluirPreAviso(6, 10, { status: "incerto" });
    expect(banco.consultas[1].params).toContain("enviando");
    expect(banco.consultas[1].params).not.toContain("pendente");
  });
  it("revalida fatura, cliente atual e tenant antes de enviar", async () => {
    await storage.listarPreAvisosPendentes(6, "2026-09-08");
    const q = banco.consultas[0];
    expect(q.params).toContain("active");
    expect(q.sql).toContain("cobranca_preferencias_contato");
    expect(q.sql).toContain("cobranca_comunicacoes");
    expect(q.sql).toContain("interval '24 hours'");
    expect(q.params).toContain("aberta");
    expect(q.sql).toContain('"invoices"."customer_id" = "cobranca_pre_avisos"."customer_id"');
    for (const m of q.sql.matchAll(/"provider_id" = \$(\d+)/g)) expect(q.params[Number(m[1]) - 1]).toBe(6);
  });
  it("dia do toque respeita Brasília na virada UTC", () => {
    expect(diaDoPreAviso(new Date("2026-09-09T01:00:00Z"))).toBe("2026-09-08");
  });
  it("amplia horizonte por provedor e não depende das etapas do kanban", async () => {
    banco.responder = sql => sql.startsWith("select") ? [[10, 42, "aberta", "2026-09-28 00:00:00", "100.00"]] : [[1]];
    expect(await storage.prepararPreAvisos(6, new Date("2026-09-08T15:00:00Z"), [], [20])).toBe(1);
    expect(banco.consultas[1].params).toContain(-20);
  });
  it("simula sem escritas, distingue pago, sem contato, já reservado e elegível", async () => {
    const row = [10, 42, "Maria", "11999999999", "maria@example.com", "active", "0", "2026-09-08 09:00:00", "erp-10", "aberta", "2026-09-15 00:00:00", "100.00", null];
    banco.responder = () => [row, [...row.slice(0, 9), "paid", ...row.slice(10)], [...row.slice(0, 12), "incerto"], [...row.slice(0, 4), null, ...row.slice(5)]];
    const resultado = await storage.simularAvisos(6, "2026-09-08", AvisosFaturasSchema.parse({ ligada: true, canal: "email" }));
    expect(resultado.elegiveis).toBe(1);
    expect(resultado.excluidas).toBe(3);
    expect(resultado.itens[1].motivos).toContain("Fatura paga, cancelada ou fechada");
    expect(resultado.itens[2].motivos).toContain("Aviso já processado ou reservado (incerto)");
    expect(resultado.itens[3].motivos).toContain("E-mail ausente ou inválido");
    expect(banco.consultas).toHaveLength(1);
    expect(banco.consultas[0].sql).toMatch(/^select/);
    for (const m of banco.consultas[0].sql.matchAll(/(?:"provider_id"|p.provider_id) = \$(\d+)/g)) expect(banco.consultas[0].params[Number(m[1]) - 1]).toBe(6);
  });
});
