import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
const banco = vi.hoisted(() => ({ consultas: [] as { sql: string; params: unknown[] }[], db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock("../db", () => ({ db: new Proxy({}, { get: (_o, chave) => Reflect.get(banco.db, chave) }) }));
import { segurancaAutonomiaStorage } from "./chat-autonomia-seguranca.storage";
beforeEach(() => { banco.consultas = []; banco.db = drizzle(async (sql, params) => { banco.consultas.push({ sql, params }); return { rows: [] }; }); });
describe("estado de identidade isolado por provedor", () => {
  it("leitura exige provedor e conversa; ausência não concede autorização", async () => {
    expect(await segurancaAutonomiaStorage.ler(42, "c1")).toEqual({ identidade: null, ofertas: null });
    expect(banco.consultas[0].sql).toMatch(/"provider_id" = \$1.*"conversation_id" = \$2/);
    expect(banco.consultas[0].params).toEqual([42, "c1", 1]);
  });
  it("revogar confirmação e oferta só afeta a conversa daquele provedor", async () => {
    await segurancaAutonomiaStorage.revogar(42, "c1");
    expect(banco.consultas[0].sql).toMatch(/^delete from .*"provider_id" = \$1.*"conversation_id" = \$2/);
    expect(banco.consultas[0].params).toEqual([42, "c1"]);
  });
  it("autorização nominal é lida apenas no provedor da execução", async () => {
    expect(await segurancaAutonomiaStorage.autorizacao(42)).toBeNull();
    expect(banco.consultas[0].sql).toMatch(/"provider_id" = \$1/);
    expect(banco.consultas[0].params).toEqual([42, 1]);
  });
});
