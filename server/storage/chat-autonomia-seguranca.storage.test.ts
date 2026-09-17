import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
const banco = vi.hoisted(() => ({ consultas: [] as { sql: string; params: unknown[] }[], db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock("../db", () => ({ db: new Proxy({}, { get: (_o, chave) => Reflect.get(banco.db, chave) }) }));
import { segurancaAutonomiaStorage } from "./chat-autonomia-seguranca.storage";
const resposta = vi.hoisted(() => ({ linhas: [] as unknown[][] }));
beforeEach(() => { banco.consultas = []; resposta.linhas = []; banco.db = drizzle(async (sql, params) => { banco.consultas.push({ sql, params }); return { rows: resposta.linhas }; }); });
describe("estado de identidade isolado por provedor", () => {
  it("leitura exige provedor e conversa; ausência não concede autorização", async () => {
    expect(await segurancaAutonomiaStorage.ler(42, "c1")).toEqual({ identidade: null, ofertas: null });
    expect(banco.consultas[0].sql).toMatch(/"provider_id" = \$1.*"conversation_id" = \$2/);
    expect(banco.consultas[0].params).toEqual([42, "c1", 1]);
  });
  it("revogar derruba confirmação e oferta só da conversa daquele provedor, sem apagar o histórico de tentativas (s7)", async () => {
    await segurancaAutonomiaStorage.revogar(42, "c1");
    const { sql, params } = banco.consultas[0];
    expect(sql).not.toMatch(/^delete/);
    expect(sql).toMatch(/^update .*jsonb_set\(jsonb_set\(.*'\{confirmadaEm\}'.*'\{validaAte\}'.*"ofertas" = \$1.*"provider_id" = \$2.*"conversation_id" = \$3/);
    expect(params).toEqual([null, 42, "c1"]);
    expect(sql).not.toMatch(/tentativas/);
  });
  it("tentativas contam por cliente dentro do provedor e ignoram linha de outro cliente que o filtro deixar passar", async () => {
    const agora = new Date("2026-09-17T15:00:00Z");
    const estado = (customerId: number, conversationId: string, tentativasEm: string[]) => ({ providerId: 42, conversationId, customerId, telefone: "5543999990000", cadastroHash: "h", tentativas: tentativasEm.length, desafiadaEm: agora.toISOString(), ultimaMensagemId: "m", confirmadaEm: null, validaAte: null, tentativasEm });
    resposta.linhas = [
      [JSON.stringify(estado(7, "c1", ["2026-09-17T14:00:00Z", "2026-09-10T14:00:00Z"]))],
      [JSON.stringify(estado(7, "c2", ["2026-09-17T10:00:00Z"]))],
      [JSON.stringify(estado(8, "c3", ["2026-09-17T14:30:00Z"]))],
      // conversa revinculada ao cliente 9 que guardou 1 tentativa do 7 (correção 2)
      [JSON.stringify({ ...estado(9, "c4", ["2026-09-17T14:40:00Z"]), tentativasDeOutrosClientes: { "7": ["2026-09-17T09:00:00Z"] } })],
      [null],
    ];
    expect(await segurancaAutonomiaStorage.tentativasDoCliente(42, 7, agora)).toEqual({ em24h: 3, em30Dias: 4 });
    const { sql, params } = banco.consultas[0];
    expect(sql).toMatch(/"provider_id" = \$1.*->>'customerId' = \$2 or .*->'tentativasDeOutrosClientes'\) \? \$3/);
    expect(params).toEqual([42, "7", "7"]);
  });
  it("autorização nominal é lida apenas no provedor da execução", async () => {
    expect(await segurancaAutonomiaStorage.autorizacao(42)).toBeNull();
    expect(banco.consultas[0].sql).toMatch(/"provider_id" = \$1/);
    expect(banco.consultas[0].params).toEqual([42, 1]);
  });
});
