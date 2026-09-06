import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

/**
 * O storage da ponte com o Chat BullQ, provado pelo SQL que emite: toda
 * consulta filtra por provider_id (a conversa e sobre um cliente — nome,
 * telefone, divida — e o id de conversa de um provedor nao pode vazar para
 * outro); o upsert da integracao cria uma vez e depois so atualiza; registrar
 * conversa reaproveita a linha quando o Chat BullQ devolveu a mesma conversa.
 *
 * Mesmo banco de mentira do cobranca.storage.test.ts: o driver pg-proxy do
 * Drizzle compila o SQL de verdade e entrega texto + parametros a um callback.
 */
const banco = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[]; method: string }[],
  linhas: new Map<string, Record<string, unknown>[]>(),
  vazias: [] as RegExp[],
  db: null as any,
}));

vi.mock("../db", () => ({
  db: new Proxy({} as any, { get: (_alvo, chave) => banco.db[chave] }),
  pool: {},
}));

import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { chatBullqConversas, chatBullqIntegracoes } from "@shared/schema";
import { ChatBullqStorage } from "./chat-bullq.storage";

const PROVEDOR = 6;
const TABELAS = [chatBullqIntegracoes, chatBullqConversas];
const chavePorColuna = new Map(
  TABELAS.map(t => [getTableName(t), new Map(Object.entries(getTableColumns(t)).map(([chave, coluna]) => [(coluna as any).name as string, chave]))]),
);

function tabelaAlvo(sqlTexto: string): string {
  const m = sqlTexto.match(/^insert into "(\w+)"/) ?? sqlTexto.match(/^update "(\w+)"/) ?? sqlTexto.match(/ from "(\w+)"/);
  return m?.[1] ?? "";
}

function colunasDevolvidas(sqlTexto: string): string[] | null {
  let lista: string | undefined;
  const ret = sqlTexto.match(/ returning (.+)$/);
  if (ret) lista = ret[1];
  else if (sqlTexto.startsWith("select ")) lista = sqlTexto.slice(7, sqlTexto.indexOf(" from "));
  if (!lista) return null;
  const itens: string[] = [];
  for (const item of lista.split(", ")) {
    const c = item.match(/^(?:"\w+"\.)?"(\w+)"$/);
    if (!c) return null;
    itens.push(c[1]);
  }
  return itens;
}

function responder(sqlTexto: string): unknown[] {
  if (banco.vazias.some(r => r.test(sqlTexto))) return [];
  const alvo = tabelaAlvo(sqlTexto);
  const colunas = colunasDevolvidas(sqlTexto);
  if (!colunas) return [];
  const base = banco.linhas.get(alvo) ?? [];
  const chaves = chavePorColuna.get(alvo);
  return base.map(linha => colunas.map(coluna => { const k = chaves?.get(coluna); return k === undefined ? null : (linha[k] ?? null); }));
}

function provaProviderId(c: { sql: string; params: unknown[] }, providerId: number) {
  if (c.sql.startsWith("insert into")) {
    const m = c.sql.match(/^insert into "\w+" \(([^)]*)\) values (.+?)(?: returning .+)?$/);
    expect(m, c.sql).not.toBeNull();
    const colunas = m![1].split(", ").map(x => x.replace(/"/g, ""));
    const posicao = colunas.indexOf("provider_id");
    expect(posicao, c.sql).toBeGreaterThanOrEqual(0);
    const tupla = m![2].match(/\(([^)]*)\)/)![1].split(", ");
    const ph = tupla[posicao].match(/^\$(\d+)$/);
    expect(ph, c.sql).not.toBeNull();
    expect(c.params[Number(ph![1]) - 1], c.sql).toBe(providerId);
    return;
  }
  const ocorrencias = Array.from(c.sql.matchAll(/"provider_id" = \$(\d+)/g));
  expect(ocorrencias.length, `sem filtro de provider_id: ${c.sql}`).toBeGreaterThan(0);
  for (const o of ocorrencias) expect(c.params[Number(o[1]) - 1], c.sql).toBe(providerId);
}

let storage: ChatBullqStorage;

beforeEach(() => {
  banco.consultas.length = 0;
  banco.vazias.length = 0;
  banco.linhas.clear();
  banco.db = drizzle(async (sqlTexto, params, method) => {
    banco.consultas.push({ sql: sqlTexto, params, method });
    return { rows: responder(sqlTexto) };
  });
  storage = new ChatBullqStorage();
});

const integracao = { id: 1, providerId: PROVEDOR, organizationId: "org_abc", slug: "isp-6", ownerEmail: "dono@isp.com", canalId: null, canalNome: null, status: "provisionado", ultimoErro: null };
const conversa = { id: 50, providerId: PROVEDOR, customerId: 42, casoId: 10, recuperacaoId: null, origem: "cobranca", conversationId: "conv_1", canalId: "ch_1", abertaPorUserId: 3, status: "BOT", abertaEm: "2026-09-05 10:00:00", ultimoEventoEm: null };

describe("toda consulta carrega o provider_id", () => {
  it("integracao: ler, criar, atualizar, marcar estado", async () => {
    banco.vazias.push(/^select .* from "chat_bullq_integracoes"/);
    await storage.getIntegracaoDoChat(PROVEDOR);
    await storage.upsertIntegracaoDoChat(PROVEDOR, { organizationId: "org_abc", slug: "isp-6", ownerEmail: "dono@isp.com" });
    banco.vazias.length = 0;
    banco.linhas.set("chat_bullq_integracoes", [integracao]);
    await storage.upsertIntegracaoDoChat(PROVEDOR, { organizationId: "org_abc", slug: "isp-6", ownerEmail: "dono@isp.com", canalId: "ch_1", status: "ativo" });
    await storage.marcarEstadoDaIntegracaoDoChat(PROVEDOR, { status: "erro", ultimoErro: "token recusado" });
    expect(banco.consultas.length).toBeGreaterThanOrEqual(5);
    for (const c of banco.consultas) provaProviderId(c, PROVEDOR);
  });

  it("conversas: registrar, buscar por caso, por recuperacao, do cliente, mapa por caso, atualizar", async () => {
    banco.vazias.push(/^select .* from "chat_bullq_conversas"/);
    await storage.registrarConversaDoChat(PROVEDOR, { customerId: 42, origem: "cobranca", casoId: 10, conversationId: "conv_1", canalId: "ch_1", abertaPorUserId: 3 });
    banco.vazias.length = 0;
    banco.linhas.set("chat_bullq_conversas", [conversa]);
    await storage.registrarConversaDoChat(PROVEDOR, { customerId: 42, origem: "cobranca", casoId: 11, conversationId: "conv_1", canalId: "ch_1" });
    await storage.getConversaDoChatPorCaso(PROVEDOR, 10);
    await storage.getConversaDoChatPorRecuperacao(PROVEDOR, 5);
    await storage.listarConversasDoChatDoCliente(PROVEDOR, 42);
    await storage.conversasDoChatPorCaso(PROVEDOR);
    await storage.atualizarConversaDoChat(PROVEDOR, "conv_1", { status: "OPEN" });
    expect(banco.consultas.length).toBeGreaterThanOrEqual(8);
    for (const c of banco.consultas) provaProviderId(c, PROVEDOR);
  });
});

describe("comportamento", () => {
  it("upsert da integracao: sem linha insere; com linha atualiza (nunca duas por provedor)", async () => {
    banco.vazias.push(/^select .* from "chat_bullq_integracoes"/);
    await storage.upsertIntegracaoDoChat(PROVEDOR, { organizationId: "org_abc", slug: "isp-6", ownerEmail: "dono@isp.com" });
    expect(banco.consultas.some(c => c.sql.startsWith('insert into "chat_bullq_integracoes"'))).toBe(true);
    banco.consultas.length = 0;
    banco.vazias.length = 0;
    banco.linhas.set("chat_bullq_integracoes", [integracao]);
    await storage.upsertIntegracaoDoChat(PROVEDOR, { organizationId: "org_abc", slug: "isp-6", ownerEmail: "dono@isp.com", canalId: "ch_1", canalNome: "Principal", status: "ativo" });
    expect(banco.consultas.some(c => c.sql.startsWith('insert into'))).toBe(false);
    const up = banco.consultas.find(c => c.sql.startsWith('update "chat_bullq_integracoes"'))!;
    expect(up.sql).toContain('"canal_id" = $');
    expect(up.params).toContain("ch_1");
    expect(up.params).toContain("ativo");
  });

  it("registrar conversa: a mesma conversa do Chat BullQ e reaproveitada e ganha o caso novo", async () => {
    banco.linhas.set("chat_bullq_conversas", [conversa]);
    const r = await storage.registrarConversaDoChat(PROVEDOR, { customerId: 42, origem: "cobranca", casoId: 11, conversationId: "conv_1", canalId: "ch_1" });
    expect(banco.consultas.some(c => c.sql.startsWith('insert into'))).toBe(false);
    const up = banco.consultas.find(c => c.sql.startsWith('update "chat_bullq_conversas"'))!;
    expect(up.params).toContain(11);
    expect(r.conversationId).toBe("conv_1");
  });

  it("mapa por caso: uma conversa por caso, a mais recente", async () => {
    banco.linhas.set("chat_bullq_conversas", [conversa, { ...conversa, id: 51, conversationId: "conv_2", abertaEm: "2026-09-01 10:00:00" }]);
    const mapa = await storage.conversasDoChatPorCaso(PROVEDOR);
    expect(mapa.get(10)?.conversationId).toBe("conv_1");
    const sel = banco.consultas[0];
    expect(sel.sql).toContain('"caso_id" is not null');
  });
});

describe("paridade com as migracoes 0024 e 0025", () => {
  it("as colunas do schema sao as da migracao (CREATE da 0024 + ADD COLUMN da 0025), tabela a tabela", () => {
    const sql = fs.readFileSync(path.resolve(process.cwd(), "migrations/0024_chat_bullq_ponte.sql"), "utf8");
    const sql25 = fs.readFileSync(path.resolve(process.cwd(), "migrations/0025_chat_bullq_agente.sql"), "utf8");
    for (const t of TABELAS) {
      const nome = getTableName(t);
      const bloco = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${nome} \\(([\\s\\S]*?)\\n\\);`));
      expect(bloco, nome).not.toBeNull();
      const adicionadas = Array.from(sql25.matchAll(new RegExp(`ALTER TABLE ${nome} ADD COLUMN IF NOT EXISTS ([a-z_]+)`, "g"))).map(m => m[1]);
      const colunasSql = [...Array.from(bloco![1].matchAll(/^\s*([a-z_]+)\s+(?:SERIAL|INTEGER|TEXT|TIMESTAMP)/gm)).map(m => m[1]), ...adicionadas].sort();
      const colunasSchema = Object.values(getTableColumns(t)).map(c => (c as any).name as string).sort();
      expect(colunasSql, nome).toEqual(colunasSchema);
    }
  });
});
