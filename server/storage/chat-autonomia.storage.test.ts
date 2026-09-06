import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A fila e o estado da autonomia no banco de mentira (pg-proxy): toda
 * consulta que recebe um provedor filtra por provider_id (a unica sem ele e
 * a varredura do worker, `proximos`), as transicoes de estado sao CAS (o
 * `assumir` so vence se a linha ainda estava `pendente`), o resumo traz TODO
 * status (zero contado, nao zero por ausencia) e o agendamento local nao
 * grava evento quando o caso nao estava livre.
 */
const banco = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[]; method: string }[],
  responder: ((_sql: string, _params: unknown[], _method: string) => [] as unknown[]) as (sql: string, params: unknown[], method: string) => unknown[],
  db: null as any,
}));
vi.mock("../db", () => ({ db: new Proxy({} as any, { get: (_alvo, chave) => banco.db[chave] }), pool: {} }));

import { drizzle } from "drizzle-orm/pg-proxy";
import { autonomiaStorage, type TrabalhoAutonomia } from "./chat-autonomia.storage";

const PROVEDOR = 6;
const JOB: TrabalhoAutonomia = { id: 15, provider_id: PROVEDOR, conversation_id: "conv_1", message_id: "m1", status: "pendente" };

beforeEach(() => {
  banco.consultas.length = 0;
  banco.responder = () => [];
  banco.db = drizzle(async (sqlTexto, params, method) => { banco.consultas.push({ sql: sqlTexto, params, method }); return { rows: banco.responder(sqlTexto, params, method) }; });
  // O driver pg-proxy nao abre transacao; aqui ela e a sequencia de comandos no mesmo banco.
  banco.db.transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(banco.db);
});

/** Toda ocorrencia de "provider_id" = $n na consulta aponta para o provedor esperado. */
function exigeProvedor(c: { sql: string; params: unknown[] }, provedor = PROVEDOR) {
  const oc = Array.from(c.sql.matchAll(/"provider_id" = \$(\d+)/g));
  expect(oc.length, c.sql).toBeGreaterThan(0);
  for (const o of oc) expect(c.params[Number(o[1]) - 1]).toBe(provedor);
}

describe("configuracao", () => {
  it("le pelo provider_id e devolve o padrao (desligada) quando nao ha linha ou a linha e lixo", async () => {
    expect((await autonomiaStorage.config(PROVEDOR)).ativa).toBe(false);
    exigeProvedor(banco.consultas[0]);
    expect(banco.consultas[0].sql).toContain('from "chat_autonomia_config"');
    banco.responder = () => [[{ ativa: "sim" }]];
    expect((await autonomiaStorage.config(PROVEDOR)).ativa).toBe(false);
    banco.responder = () => [[{ ativa: true, maxTurnos: 5, tipos: ["cobranca_ativos"] }]];
    expect(await autonomiaStorage.config(PROVEDOR)).toMatchObject({ ativa: true, maxTurnos: 5, tipos: ["cobranca_ativos"], permitirPromessa: true });
  });
  it("grava por upsert no provider_id", async () => {
    await autonomiaStorage.salvarConfig(PROVEDOR, { ativa: true, maxTurnos: 12, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, tipos: ["cobranca_ativos"] });
    const c = banco.consultas[0];
    expect(c.sql).toMatch(/insert into "chat_autonomia_config"/);
    expect(c.sql).toMatch(/on conflict \("provider_id"\) do update set/);
    expect(c.params).toContain(PROVEDOR);
    expect(String(c.params[1])).toContain('"ativa":true');
  });
});

describe("fila", () => {
  it("enfileira sem duplicar a mesma mensagem do provedor", async () => {
    await autonomiaStorage.enfileirar(PROVEDOR, "conv_1", "m1");
    const c = banco.consultas[0];
    expect(c.sql).toMatch(/insert into "chat_autonomia_fila"/);
    expect(c.sql).toMatch(/on conflict \("provider_id","message_id"\) do nothing/);
    expect(c.params).toEqual(expect.arrayContaining([PROVEDOR, "conv_1", "m1"]));
  });
  it("proximos: pendentes ou presos ha 5 min, em ordem de id, 20 por vez; a varredura e do worker inteiro", async () => {
    banco.responder = () => [[15, PROVEDOR, "conv_1", "m1", "pendente"], [16, 7, "conv_9", "m9", "processando"]];
    const jobs = await autonomiaStorage.proximos();
    const c = banco.consultas[0];
    expect(c.sql).toContain('"status" = $1');
    expect(c.sql).toMatch(/"status" in \(\$2, \$3\) and "chat_autonomia_fila"\."updated_at" < now\(\) - interval '5 minutes'/);
    expect(c.params.slice(0, 3)).toEqual(["pendente", "processando", "enviando"]);
    expect(c.sql).toMatch(/order by "chat_autonomia_fila"\."id" asc limit \$4/);
    expect(c.params[3]).toBe(20);
    expect(jobs).toEqual([JOB, { id: 16, provider_id: 7, conversation_id: "conv_9", message_id: "m9", status: "processando" }]);
    expect(typeof jobs[0].id).toBe("number");
  });
  it("assumir e CAS: so vence se a linha ainda estava pendente, e do provedor do trabalho", async () => {
    banco.responder = () => [[15]];
    expect(await autonomiaStorage.assumir(JOB)).toBe(true);
    const c = banco.consultas[0];
    expect(c.sql).toMatch(/update "chat_autonomia_fila" set "status" = \$1, "updated_at" = now\(\)/);
    expect(c.params[0]).toBe("processando");
    exigeProvedor(c);
    expect(c.sql).toMatch(/"id" = \$\d+ and "chat_autonomia_fila"\."provider_id" = \$\d+ and "chat_autonomia_fila"\."status" = \$(\d+)/);
    expect(c.params).toContain("pendente");
    expect(c.sql).toMatch(/returning "id"/);
    banco.responder = () => [];
    expect(await autonomiaStorage.assumir(JOB)).toBe(false);
  });
  it("marcar grava status e motivo pelo id E provider_id do trabalho", async () => {
    await autonomiaStorage.marcar(JOB, "humano", "Cliente pediu atendente");
    const c = banco.consultas[0];
    expect(c.params.slice(0, 2)).toEqual(["humano", "Cliente pediu atendente"]);
    exigeProvedor(c);
    expect(c.params).toContain(15);
  });
  it("resumo: todo status presente, zero e zero contado; provider_id obrigatorio", async () => {
    banco.responder = () => [["pendente", 2], ["concluido", "7"], ["desconhecido", 1]];
    const r = await autonomiaStorage.resumo(PROVEDOR);
    exigeProvedor(banco.consultas[0]);
    expect(banco.consultas[0].sql).toMatch(/group by "chat_autonomia_fila"\."status"/);
    expect(r).toEqual({ pendente: 2, processando: 0, enviando: 0, concluido: 7, humano: 0, cancelado: 0 });
  });
});

describe("estado por conversa", () => {
  it("sem linha e o estado inicial; com linha, a proposta vem do jsonb", async () => {
    expect(await autonomiaStorage.estado(PROVEDOR, "conv_1")).toEqual({ turnos: 0, humano: false, proposta: null, motivo: null });
    exigeProvedor(banco.consultas[0]);
    expect(banco.consultas[0].params).toContain("conv_1");
    banco.responder = () => [[3, true, { acao: "promessa", data: "2026-09-10", valor: 100, criadaEm: "2026-09-06T15:00:00.000Z", messageId: "m1" }, "Operador assumiu"]];
    expect(await autonomiaStorage.estado(PROVEDOR, "conv_1")).toMatchObject({ turnos: 3, humano: true, proposta: { acao: "promessa", valor: 100 }, motivo: "Operador assumiu" });
  });
  it("turno soma 1 por upsert na chave (provider_id, conversation_id)", async () => {
    await autonomiaStorage.turno(PROVEDOR, "conv_1");
    const c = banco.consultas[0];
    expect(c.sql).toMatch(/on conflict \("provider_id","conversation_id"\) do update set "turnos" = "chat_autonomia_estado"\."turnos" \+ 1/);
    expect(c.params).toEqual(expect.arrayContaining([PROVEDOR, "conv_1", 1]));
  });
  it("proposta grava e apaga (null) o jsonb", async () => {
    await autonomiaStorage.proposta(PROVEDOR, "conv_1", { acao: "promessa", data: "2026-09-10", valor: 100, criadaEm: "2026-09-06T15:00:00.000Z", messageId: "m1" });
    expect(String(banco.consultas[0].params[2])).toContain('"acao":"promessa"');
    await autonomiaStorage.proposta(PROVEDOR, "conv_1", null);
    expect(banco.consultas[1].sql).toMatch(/do update set "proposta" = \$\d+/);
    expect(banco.consultas[1].params).toContain(null);
  });
  it("cancelar: humano=true, proposta cai e so o que ainda estava pendente e cancelado — tudo com provider_id", async () => {
    await autonomiaStorage.cancelar(PROVEDOR, "conv_1", "Operador assumiu o controle do atendimento");
    expect(banco.consultas).toHaveLength(2);
    const [estado, fila] = banco.consultas;
    expect(estado.sql).toMatch(/insert into "chat_autonomia_estado"/);
    expect(estado.sql).toMatch(/do update set "humano" = \$\d+, "proposta" = \$\d+, "motivo" = \$\d+/);
    expect(estado.params).toEqual(expect.arrayContaining([PROVEDOR, "conv_1", true, "Operador assumiu o controle do atendimento"]));
    expect(fila.sql).toMatch(/update "chat_autonomia_fila" set "status" = \$1/);
    expect(fila.params[0]).toBe("cancelado");
    exigeProvedor(fila);
    expect(fila.sql).toMatch(/"status" = \$(\d+)\)$/);
    expect(fila.params.at(-1)).toBe("pendente");
  });
  it("devolver: humano=false, proposta null, rodadas zeradas, na chave do provedor", async () => {
    await autonomiaStorage.devolver(PROVEDOR, "conv_1", "Atendente devolveu a conversa ao assistente");
    const c = banco.consultas[0];
    expect(c.sql).toMatch(/insert into "chat_autonomia_estado"/);
    // O `set` segue a ordem das colunas da tabela: turnos, humano, proposta, motivo.
    const set = c.sql.match(/do update set "turnos" = \$(\d+), "humano" = \$(\d+), "proposta" = \$(\d+), "motivo" = \$(\d+)/);
    expect(set, c.sql).not.toBeNull();
    expect(c.params[Number(set![1]) - 1]).toBe(0);
    expect(c.params[Number(set![2]) - 1]).toBe(false);
    expect(c.params[Number(set![3]) - 1]).toBeNull();
    expect(c.params[Number(set![4]) - 1]).toBe("Atendente devolveu a conversa ao assistente");
    expect(c.params).toEqual(expect.arrayContaining([PROVEDOR, "conv_1"]));
  });
});

describe("agendamento local de devolucao", () => {
  it("caso livre: marca scheduled_at so no caso do provedor/cliente sem agenda, e registra o evento", async () => {
    banco.responder = sql => (/^update "equipment_recovery_cases"/.test(sql) ? [[90]] : []);
    expect(await autonomiaStorage.agendar(PROVEDOR, 90, 42, "2026-09-10T14:00:00-03:00", "m2")).toBe(true);
    expect(banco.consultas).toHaveLength(2);
    const [caso, evento] = banco.consultas;
    exigeProvedor(caso);
    expect(caso.params).toEqual(expect.arrayContaining([90, 42]));
    expect(caso.sql).toMatch(/"closed_at" is null and "equipment_recovery_cases"\."disputed_at" is null and "equipment_recovery_cases"\."scheduled_at" is null/);
    expect(caso.sql).toMatch(/returning "id"/);
    expect(evento.sql).toMatch(/insert into "equipment_recovery_events"/);
    expect(evento.params).toEqual(expect.arrayContaining([PROVEDOR, 90, "caso_atualizado", "whatsapp"]));
    expect(JSON.stringify(evento.params)).toContain("Não confirma retirada nem baixa");
    expect(evento.params.join(' ')).toContain('"origem":"autonomia_chat"');
  });
  it("caso fechado, contestado ou ja agendado: nada gravado e devolve false", async () => {
    expect(await autonomiaStorage.agendar(PROVEDOR, 90, 42, "2026-09-10T14:00:00-03:00", "m2")).toBe(false);
    expect(banco.consultas).toHaveLength(1);
    expect(banco.consultas[0].sql).toMatch(/^update "equipment_recovery_cases"/);
  });
});

describe("as tabelas da 0028", () => {
  it("conta as tres no information_schema; falta uma, diz qual", async () => {
    banco.responder = () => [{ table_name: "chat_autonomia_config" }, { table_name: "chat_autonomia_fila" }];
    expect(await autonomiaStorage.tabelasExistem()).toEqual({ ok: false, faltam: ["chat_autonomia_estado"] });
    expect(banco.consultas[0].method).toBe("execute");
    expect(banco.consultas[0].params).toEqual(["chat_autonomia_config", "chat_autonomia_estado", "chat_autonomia_fila"]);
    banco.responder = () => [{ table_name: "chat_autonomia_config" }, { table_name: "chat_autonomia_estado" }, { table_name: "chat_autonomia_fila" }];
    expect(await autonomiaStorage.tabelasExistem()).toEqual({ ok: true, faltam: [] });
  });
});
