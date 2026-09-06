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
  consultas: [] as { sql: string; params: unknown[]; method: string; dentroDaTransacao: boolean }[],
  linhas: new Map<string, Record<string, unknown>[]>(),
  vazias: [] as RegExp[],
  /**
   * Resposta sob medida para as consultas que devolvem coluna calculada — o
   * `responder` abaixo so sabe montar linha a partir de coluna crua da tabela,
   * e a leitura do diario de envios junta duas tabelas.
   */
  forcar: null as null | ((sql: string) => unknown[][] | null),
  dentro: false,
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
  const forcado = banco.forcar?.(sqlTexto);
  if (forcado) return forcado;
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
  banco.forcar = null;
  banco.dentro = false;
  const proxy = drizzle(async (sqlTexto, params, method) => {
    banco.consultas.push({ sql: sqlTexto, params, method, dentroDaTransacao: banco.dentro });
    return { rows: responder(sqlTexto) };
  });
  // O pg-proxy nao suporta transacao; o shim marca "dentro" e chama o callback com o mesmo db (molde: cobranca.storage.test.ts).
  banco.db = Object.assign(proxy, {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      banco.dentro = true;
      try { return await fn(proxy); } finally { banco.dentro = false; }
    },
  });
  storage = new ChatBullqStorage();
});

const integracao = { id: 1, providerId: PROVEDOR, organizationId: "org_abc", slug: "isp-6", ownerEmail: "dono@isp.com", canalId: null, canalNome: null, status: "provisionado", ultimoErro: null };
const conversa = { id: 50, providerId: PROVEDOR, customerId: 42, casoId: 10, recuperacaoId: null, origem: "cobranca", conversationId: "conv_1", canalId: "ch_1", abertaPorUserId: 3, status: "BOT", abertaEm: "2026-09-05 10:00:00", ultimoEventoEm: null };

describe("toda consulta carrega o provider_id", () => {
  it("cadastro, faturas, pagamentos, contrato e ordens do chat pertencem ao mesmo provedor", async () => {
    await storage.clienteDoAtendimento(PROVEDOR, 42);
    await storage.contextoFinanceiroDoChat(PROVEDOR, 42);
    expect(banco.consultas).toHaveLength(5);
    for (const q of banco.consultas) provaProviderId(q, PROVEDOR);
    expect(banco.consultas.every(q => q.params.includes(42))).toBe(true);
  });
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
  it("fila filtra os vínculos, inclusive quando a conversa pertence aos dois módulos", async () => {
    await storage.listarAtendimentosDoChat(PROVEDOR, { origem: "cobranca", carteira: "ex_cliente", pagina: 1 });
    const cobranca = banco.consultas.at(-1)!;
    provaProviderId(cobranca, PROVEDOR);
    expect(cobranca.sql).toContain('"caso_id" is not null');
    expect(cobranca.params).toContain("ex_cliente");
    await storage.listarAtendimentosDoChat(PROVEDOR, { origem: "equipamentos", pagina: 1 });
    const equipamentos = banco.consultas.at(-1)!;
    provaProviderId(equipamentos, PROVEDOR);
    expect(equipamentos.sql).toContain('"recuperacao_id" is not null');
  });
  it("não transfere conversa entre cadastros que compartilham telefone", async () => {
    banco.linhas.set("chat_bullq_conversas", [conversa]);
    await expect(storage.registrarConversaDoChat(PROVEDOR, { customerId: 99, origem: "cobranca", casoId: 11, conversationId: "conv_1", canalId: "ch_1" })).rejects.toThrow("outro cliente");
    expect(banco.consultas.some(c => c.sql.startsWith("update "))).toBe(false);
  });
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

/* ── O evento do chat na linha do tempo do caso, com o follow-up ─────── */

/** O metadata jsonb vai ao driver como texto; e o unico parametro que fala em chat_integrado. */
function metadataDo(c: { params: unknown[] }): Record<string, unknown> {
  const bruto = c.params.find(p => typeof p === "string" && p.includes("chat_integrado"));
  expect(bruto, "metadata do evento").toBeTypeOf("string");
  return JSON.parse(bruto as string);
}

/* ── A fila do primeiro contato automático: contato que SAIU ─────────── */

describe("primeiro contato automático", () => {
  it("a cota do dia conta contato enviado (evento), nunca conversa aberta", async () => {
    await storage.contatosIniciadosNoDia(PROVEDOR, new Date("2026-09-08T03:00:00.000Z"));
    expect(banco.consultas).toHaveLength(2);
    for (const c of banco.consultas) provaProviderId(c, PROVEDOR);
    // Uma linha em chat_bullq_conversas nasce também quando a ponte só vinculou
    // a conversa que já existia — e nada foi enviado. Ela não conta.
    expect(banco.consultas.some(c => c.sql.includes('"chat_bullq_conversas"'))).toBe(false);
    const cobranca = banco.consultas.find(c => c.sql.includes('"cobranca_eventos"'))!;
    expect(cobranca.params).toContain("contato");
    expect(cobranca.params).toContain("whatsapp");
    const equipamentos = banco.consultas.find(c => c.sql.includes('"equipment_recovery_events"'))!;
    expect(equipamentos.sql).toContain(`->>'enviado' = 'true'`);
  });

  it("candidatos: exclui só a conversa ABERTA e quem já recebeu contato de verdade", async () => {
    await storage.candidatosAoPrimeiroContato(PROVEDOR);
    expect(banco.consultas).toHaveLength(2);
    for (const c of banco.consultas) provaProviderId(c, PROVEDOR);
    const [cobranca, equipamentos] = banco.consultas;
    // Conversa encerrada não pode aposentar o caso para sempre: a exclusão olha
    // status <> 'CLOSED'.
    for (const c of [cobranca, equipamentos]) {
      expect(c.sql).toContain('"chat_bullq_conversas"');
      expect(c.sql).toContain('"status" <> $');
      expect(c.params).toContain("CLOSED");
    }
    // Na cobrança o rastro do envio é ultimo_contato_em (só o evento `contato` a
    // grava); na recuperação, o evento marcado `enviado`.
    expect(cobranca.sql).toContain('"ultimo_contato_em" is null');
    expect(equipamentos.sql).toContain('"equipment_recovery_events"');
    expect(equipamentos.sql).toContain(`->>'enviado' = 'true'`);
  });

  /**
   * O DIARIO que a tela de automacao mostra. Ele existe para responder "o robo
   * esta trabalhando?" sem que ninguem precise abrir o banco — e por isso a
   * definicao de envio TEM de ser a mesma da cota do dia: se o diario listasse
   * conversa reaproveitada, o provedor veria cinco linhas e o contador diria
   * dois, e nao teria como saber qual dos dois esta mentindo.
   */
  it("o diario lista os mesmos envios que a cota conta, dos dois lados, com o cliente do provedor", async () => {
    banco.forcar = () => [];
    await storage.ultimosPrimeirosContatos(PROVEDOR);
    expect(banco.consultas).toHaveLength(2);
    for (const c of banco.consultas) provaProviderId(c, PROVEDOR);

    const cobranca = banco.consultas.find(c => c.sql.includes('"cobranca_eventos"'))!;
    expect(cobranca.params).toContain("contato");
    expect(cobranca.params).toContain("whatsapp");
    // O nome sai do cliente DESTE provedor — a juncao carrega o provider_id.
    expect(cobranca.sql).toContain('"customers"."provider_id" = $');
    expect(cobranca.sql).toContain('order by "cobranca_eventos"."ocorrido_em" desc');

    const equipamentos = banco.consultas.find(c => c.sql.includes('"equipment_recovery_events"'))!;
    expect(equipamentos.sql).toContain(`->>'enviado' = 'true'`);
    // O caso da recuperacao tambem e do provedor: sem isso, o nome viria de
    // outra carteira por um id de caso adivinhado.
    expect(equipamentos.sql).toContain('"equipment_recovery_cases"."provider_id" = $');
    expect(banco.consultas.some(c => c.sql.includes('"chat_bullq_conversas"'))).toBe(false);
  });

  it("junta as duas frentes em ordem de tempo e respeita o teto pedido", async () => {
    const linha = (dia: string, nome: string) => [new Date(`2026-09-${dia}T12:00:00Z`), "whatsapp", 42, nome, null];
    banco.forcar = (sql: string) =>
      sql.includes('"cobranca_eventos"')
        ? [linha("01", "Ana Souza"), linha("05", "Bruno Lima")]
        : [linha("03", "Carla Dias")];
    const envios = await storage.ultimosPrimeirosContatos(PROVEDOR, 2);
    expect(envios.map(e => e.clienteNome)).toEqual(["Bruno Lima", "Carla Dias"]);
    expect(envios.map(e => e.origem)).toEqual(["cobranca", "equipamentos"]);
    // O teto vai para o BANCO tambem, e nao so para o corte em memoria.
    for (const c of banco.consultas) expect(c.params).toContain(2);
  });

  it("teto fora da faixa vira o padrao seguro, e envio sem data nao entra", async () => {
    banco.forcar = (sql: string) =>
      sql.includes('"cobranca_eventos"')
        ? [[null, "whatsapp", 42, "Sem data", null], [new Date("2026-09-02T12:00:00Z"), "whatsapp", 43, "Com data", "falou"]]
        : [];
    const envios = await storage.ultimosPrimeirosContatos(PROVEDOR, 0);
    expect(envios.map(e => e.clienteNome)).toEqual(["Com data"]);
    expect(envios[0].resultado).toBe("falou");
    expect(banco.consultas[0].params).toContain(20);
  });
});

describe("registrarEventoDoChat", () => {
  const vinculo = { ...conversa, recuperacaoId: 7 } as any;
  const quando = new Date("2026-09-08T12:00:00.000Z");

  it("um evento por modulo, os dois com provider_id, na mesma transacao; o follow-up so no evento de cobranca", async () => {
    await storage.registrarEventoDoChat(PROVEDOR, vinculo, 3, "Conversa encerrada; situação do caso preservada", { proximaAcao: "Cobrar a promessa", proximoContatoEm: quando });
    expect(banco.consultas).toHaveLength(2);
    for (const c of banco.consultas) {
      expect(c.sql.startsWith("insert into")).toBe(true);
      expect(c.dentroDaTransacao, c.sql).toBe(true);
      provaProviderId(c, PROVEDOR);
    }
    const cobranca = banco.consultas.find(c => c.sql.startsWith('insert into "cobranca_eventos"'))!;
    const recuperacao = banco.consultas.find(c => c.sql.startsWith('insert into "equipment_recovery_events"'))!;
    expect(cobranca.params).toEqual(expect.arrayContaining([10, 42, 3, "nota", "whatsapp"]));
    expect(metadataDo(cobranca)).toEqual({ origem: "chat_integrado", conversationId: "conv_1", proximaAcao: "Cobrar a promessa", proximoContatoEm: "2026-09-08T12:00:00.000Z" });
    expect(recuperacao.params).toEqual(expect.arrayContaining([7, 3, "nota", "whatsapp"]));
    expect(metadataDo(recuperacao)).toEqual({ origem: "chat_integrado", conversationId: "conv_1" });
  });
  it("sem follow-up o metadata continua so com a origem — nada inventado na linha do tempo", async () => {
    await storage.registrarEventoDoChat(PROVEDOR, conversa as any, null, "Atendente assumiu a conversa; resposta automática pausada");
    expect(banco.consultas).toHaveLength(1);
    provaProviderId(banco.consultas[0], PROVEDOR);
    expect(metadataDo(banco.consultas[0])).toEqual({ origem: "chat_integrado", conversationId: "conv_1" });
    // O caso nao e tocado por aqui: as colunas proxima_acao/proximo_contato_em sao de atualizarCasoDeCobranca.
    expect(banco.consultas.some(c => c.sql.startsWith('update "cobranca_casos"'))).toBe(false);
  });
  it("o primeiro contato que saiu de verdade fica marcado `enviado` no metadata", async () => {
    await storage.registrarEventoDoChat(PROVEDOR, { ...conversa, casoId: null, recuperacaoId: 7 } as any, 3, "Primeiro contato sobre devolução enviado pelo chat", undefined, true);
    expect(metadataDo(banco.consultas[0])).toEqual({ origem: "chat_integrado", conversationId: "conv_1", enviado: true });
  });
  it("conversa sem caso e sem recuperacao nao grava nada", async () => {
    await storage.registrarEventoDoChat(PROVEDOR, { ...conversa, casoId: null, recuperacaoId: null } as any, 3, "x");
    expect(banco.consultas).toHaveLength(0);
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
