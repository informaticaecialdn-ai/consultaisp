import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `FaturasStorage`: o upsert por (provider, fonte, ref), a baixa do que sumiu
 * — que e prova negativa e nao pode rodar sem referencia nenhuma —, o resumo
 * do mes com a regra do Provedor.ai e as listas por grupo. Mesmo banco de
 * mentira (pg-proxy) dos outros storages: o SQL que o Drizzle gera e o que
 * se confere aqui, e toda consulta precisa carregar o provider_id.
 */
const banco = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[]; method: string }[],
  responder: null as null | ((sql: string, params: unknown[]) => unknown[][]),
  db: null as any,
}));
vi.mock("../db", () => ({ db: new Proxy({} as any, { get: (_alvo, chave) => banco.db[chave] }), pool: {} }));

import { drizzle } from "drizzle-orm/pg-proxy";
import { FaturasStorage, diaComoTimestamp, janelaDoMes, diaDeHoje } from "./faturas.storage";

const PROVEDOR = 6;
const HOJE = new Date(2026, 8, 5, 14, 30); // 05/09/2026, tarde

let storage: FaturasStorage;
beforeEach(() => {
  banco.consultas.length = 0;
  banco.responder = null;
  banco.db = drizzle(async (sqlTexto, params, method) => {
    banco.consultas.push({ sql: sqlTexto, params, method });
    return { rows: banco.responder ? banco.responder(sqlTexto, params) : [] };
  });
  storage = new FaturasStorage();
});

/** Toda ocorrencia de "provider_id" = $n na consulta aponta para o provedor. */
function conferirTenant(c: { sql: string; params: unknown[] }) {
  const oc = Array.from(c.sql.matchAll(/"provider_id" = \$(\d+)/g));
  expect(oc.length, c.sql).toBeGreaterThan(0);
  for (const o of oc) expect(c.params[Number(o[1]) - 1]).toBe(PROVEDOR);
}

describe("datas: dia de calendario, sem fuso", () => {
  it("o vencimento vira meia-noite UTC — e o que o Drizzle grava e le de volta igual", () => {
    expect(diaComoTimestamp("2026-09-10").toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });
  it("a janela do mes e [primeiro dia, primeiro dia do mes seguinte)", () => {
    expect(janelaDoMes("2026-09")).toEqual({ de: "2026-09-01", ate: "2026-10-01" });
    expect(janelaDoMes("2026-12")).toEqual({ de: "2026-12-01", ate: "2027-01-01" });
    expect(() => janelaDoMes("2026-13")).toThrow(/Mes invalido/);
    expect(() => janelaDoMes("setembro")).toThrow(/Mes invalido/);
  });
  it("hoje e o dia local do relogio do servidor", () => {
    expect(diaDeHoje(HOJE)).toBe("2026-09-05");
  });
});

describe("recebimentos e DNA", () => {
  it("recibo local bloqueia título que o ERP ainda oferece, isolando cliente/fonte", async () => {
    banco.responder = () => [[10]];
    expect(await storage.faturasQuitadasAindaAbertas(PROVEDOR, 42, ["mk-10"], "mk")).toBe(true);
    conferirTenant(banco.consultas[0]);
    expect(banco.consultas[0].params).toEqual(expect.arrayContaining([PROVEDOR, 42, "mk-10", "mk"]));
    expect(banco.consultas[0].sql).toContain('inner join "cobranca_quitacoes"');
    banco.consultas.length = 0;
    expect(await storage.faturasQuitadasAindaAbertas(PROVEDOR, 42, [], "mk")).toBe(false);
    expect(banco.consultas).toHaveLength(0);
  });
  function transacaoSimulada() {
    banco.db.transaction = async (fn: (tx: typeof banco.db) => Promise<unknown>) => fn(banco.db);
  }
  const quitacao = { faturaId: 10, origem: "comprovante_conferido" as const, referencia: "recibo-10", pagoEm: "2026-08-10", valorPago: 100, userId: 9 };
  it.each(["cancelada", "renegociada", "desconhecido"])("não quita status %s", async status => {
    transacaoSimulada();
    banco.responder = texto => texto.includes('from "customers"') ? [[42]] : texto.includes('from "users"') ? [[9, "admin", PROVEDOR]] : texto.includes('from "invoices"') ? [[10, "100.00", status, "mk"]] : [];
    await expect(storage.registrarQuitacaoConfirmada(PROVEDOR, 42, quitacao)).rejects.toThrow("Esta fatura não permite confirmação de recebimento");
    expect(banco.consultas.some(c => c.sql.startsWith("insert") || c.sql.startsWith("update"))).toBe(false);
  });
  it("traduz apenas a constraint de referência usada", async () => {
    const erro = Object.assign(new Error("duplicate key"), { code: "23505", constraint: "cobranca_quitacoes_referencia_uq" });
    banco.db.transaction = async () => { throw erro; };
    await expect(storage.registrarQuitacaoConfirmada(PROVEDOR, 42, quitacao)).rejects.toThrow("Esta referência de recebimento já foi usada");
    erro.constraint = "outra_constraint";
    await expect(storage.registrarQuitacaoConfirmada(PROVEDOR, 42, quitacao)).rejects.toBe(erro);
  });
  it("grava evidência e paid na mesma transação scoped; parcial não quita", async () => {
    transacaoSimulada();
    banco.responder = texto => texto.includes('from "customers"') ? [[42]] : texto.includes('from "invoices"') ? [[10, "100.00", "aberta", "mk"]] : texto.includes('from "users"') ? [[9, "admin", PROVEDOR]] : [];
    expect(await storage.registrarQuitacaoConfirmada(PROVEDOR, 42, quitacao)).toEqual({ faturaId: 10, repetida: false });
    expect(banco.consultas.some(c => c.sql.includes('for update'))).toBe(true);
    expect(banco.consultas.some(c => c.sql.startsWith('insert into "cobranca_quitacoes"'))).toBe(true);
    expect(banco.consultas.at(-1)?.params).toContain("paid");
    banco.consultas.length = 0;
    await expect(storage.registrarQuitacaoConfirmada(PROVEDOR, 42, { ...quitacao, valorPago: 99 })).rejects.toThrow(/integral/);
    expect(banco.consultas).toHaveLength(3);
  });
  it("não aceita fatura alheia e não sobrescreve recibo existente", async () => {
    transacaoSimulada();
    await expect(storage.registrarQuitacaoConfirmada(PROVEDOR, 42, quitacao)).rejects.toThrow(/não encontrada/);
    conferirTenant(banco.consultas[0]);
    banco.responder = texto => texto.includes('from "customers"') ? [[42]] : texto.includes('from "users"') ? [[9, "admin", PROVEDOR]] : texto.includes('from "invoices"') ? [[10, "100.00", "paid", "mk"]] : texto.includes('from "cobranca_quitacoes"') ? [[1, PROVEDOR, 42, 10, "comprovante_conferido", "recibo-10", "2026-08-10", "100.00", 9, "2026-08-10T00:00:00Z", null]] : [];
    expect(await storage.registrarQuitacaoConfirmada(PROVEDOR, 42, quitacao)).toEqual({ faturaId: 10, repetida: true });
    await expect(storage.registrarQuitacaoConfirmada(PROVEDOR, 42, { ...quitacao, referencia: "outro" })).rejects.toThrow(/outra confirmação/);
    expect(banco.consultas.some(c => c.sql.startsWith("insert") || c.sql.startsWith("update"))).toBe(false);
  });
  it("acordo vivo impede receber a mesma dívida por outro caminho", async () => {
    transacaoSimulada();
    banco.responder = texto => texto.includes('from "customers"') ? [[42]] : texto.includes('from "users"') ? [[9, "admin", PROVEDOR]] : texto.includes('from "invoices"') ? [[10, "100.00", "aberta", "mk"]] : texto.includes('from "cobranca_negociacoes"') ? [[80]] : [];
    await expect(storage.registrarQuitacaoConfirmada(PROVEDOR, 42, quitacao)).rejects.toThrow(/acordo/);
    expect(banco.consultas.some(c => c.sql.startsWith("insert") || c.sql.startsWith("update"))).toBe(false);
  });
  it("histórico só conta paid com data e isola cliente/provedor", async () => {
    banco.responder = () => [[42, 4, 1, "2026-08-12T00:00:00Z"]];
    const r = await storage.historicoDePagamentosDoCliente(PROVEDOR, 42);
    expect(r).toMatchObject({ faturasPagas: 4, faturasPagasComAtraso: 1, taxaAtraso: 0.25, historicoInsuficiente: false });
    conferirTenant(banco.consultas[0]);
    expect(banco.consultas[0].params).toContain("paid");
    expect(banco.consultas[0].sql).toContain('"paid_date" is not null');
    expect(banco.consultas[0].params).toContain(42);
  });
  it("revalida o papel atual e só libera superadmin com contexto de suporte", async () => {
    transacaoSimulada();
    let papel = "employee";
    banco.responder = texto => texto.includes('from "customers"') ? [[42]] : texto.includes('from "users"') ? [[9, papel, papel === "superadmin" ? null : PROVEDOR]] : texto.includes('from "invoices"') ? [[10, "100.00", "aberta", "mk"]] : [];
    await expect(storage.registrarQuitacaoConfirmada(PROVEDOR, 42, quitacao)).rejects.toThrow(/administrador atual/);
    expect(banco.consultas.some(c => c.sql.endsWith("for share"))).toBe(true);
    papel = "superadmin";
    await expect(storage.registrarQuitacaoConfirmada(PROVEDOR, 42, quitacao)).rejects.toThrow(/suporte autorizado/);
    expect(await storage.registrarQuitacaoConfirmada(PROVEDOR, 42, quitacao, { suporteProviderId: PROVEDOR })).toEqual({ faturaId: 10, repetida: false });
  });
  it("somente abertas deixa histórico desconhecido", async () => {
    expect(await storage.historicoDePagamentosDoCliente(PROVEDOR, 42)).toMatchObject({ historicoInsuficiente: true, taxaAtraso: null });
  });
  it("recusa quitação sem referência, data civil válida e ator manual", async () => {
    await expect(storage.registrarQuitacaoConfirmada(PROVEDOR, 42, { faturaId: 10, origem: "comprovante_conferido", referencia: "", pagoEm: "2026-02-30", valorPago: 100 })).rejects.toThrow();
    expect(banco.consultas).toHaveLength(0);
  });
});

describe("upsertFaturasDoErp", () => {
  it("insere por (provider, fonte, ref) e no conflito regrava valor, vencimento e volta a aberta", async () => {
    const n = await storage.upsertFaturasDoErp(PROVEDOR, "mk", 42, [
      { ref: "11", vencimento: "2026-09-10", valor: 99.9, descricao: "Mensalidade" },
      { ref: "12", vencimento: "2026-10-10", valor: 99.9 },
    ]);
    expect(n).toBe(2);
    expect(banco.consultas).toHaveLength(2);
    const c = banco.consultas[0];
    expect(c.sql).toMatch(/^insert into "invoices"/);
    expect(c.sql).toContain('on conflict ("provider_id","erp_source","erp_ref") where erp_ref IS NOT NULL do update set');
    expect(c.sql).toContain('"customer_id" = excluded.customer_id');
    expect(c.sql).toContain('"value" = excluded.value');
    expect(c.sql).toContain('"due_date" = excluded.due_date');
    expect(c.sql).toContain('where "invoices"."status" <>');
    expect(c.params).toContain("paid");
    expect(banco.consultas[1].sql).toContain('update "cobranca_quitacoes" set "divergencia_erp_em"');
    conferirTenant(banco.consultas[1]);
    // `baixada_em` volta a nulo: fatura que reapareceu nos pendentes nao esta baixada.
    const baixada = c.sql.match(/"baixada_em" = \$(\d+)/);
    expect(baixada).not.toBeNull();
    expect(c.params[Number(baixada![1]) - 1]).toBeNull();
    // Insert nao tem "provider_id = $n": o tenant vai como VALOR — conferido nos params abaixo.
    // DECIMAL entra como texto com duas casas; a data como meia-noite UTC.
    expect(c.params).toEqual(expect.arrayContaining([PROVEDOR, 42, "mk", "11", "99.90", "2026-09-10T00:00:00.000Z", "Mensalidade", "aberta", "12"]));
  });

  it("descarta o que nao serve e deduplica pela ref — a ultima vence", async () => {
    const n = await storage.upsertFaturasDoErp(PROVEDOR, "ixc", 7, [
      { ref: "", vencimento: "2026-09-10", valor: 10 },            // sem ref
      { ref: "5", vencimento: "10/09/2026", valor: 10 },           // vencimento fora do formato
      { ref: "6", vencimento: "2026-09-10", valor: Number.NaN },   // valor que nao e numero
      { ref: "7", vencimento: "2026-09-10", valor: 10 },
      { ref: "7", vencimento: "2026-09-11", valor: 20 },           // repetida: fica esta
    ]);
    expect(n).toBe(1);
    const c = banco.consultas[0];
    expect(c.params).toEqual(expect.arrayContaining(["7", "20.00", "2026-09-11T00:00:00.000Z"]));
    expect(c.params).not.toEqual(expect.arrayContaining(["10.00"]));
  });

  it("sem fatura valida nao vai ao banco", async () => {
    expect(await storage.upsertFaturasDoErp(PROVEDOR, "mk", 1, [])).toBe(0);
    expect(banco.consultas).toHaveLength(0);
  });
});

describe("upsertFaturasDoErpPorDocumento", () => {
  it("resolve o cliente DESTE provedor pelo documento e grava; sem cliente devolve null", async () => {
    banco.responder = (sqlTexto) => sqlTexto.startsWith("select") ? [[42]] : [];
    const n = await storage.upsertFaturasDoErpPorDocumento(PROVEDOR, "mk", "041.179.829-40", [
      { ref: "1", vencimento: "2026-09-20", valor: 80 },
    ]);
    expect(n).toBe(1);
    expect(banco.consultas).toHaveLength(3);
    const busca = banco.consultas[0];
    expect(busca.sql).toMatch(/from "customers"/);
    conferirTenant(busca);
    expect(busca.params).toContain("04117982940");
    expect(banco.consultas[1].params).toContain(42);

    banco.consultas.length = 0;
    banco.responder = () => [];
    expect(await storage.upsertFaturasDoErpPorDocumento(PROVEDOR, "mk", "04117982940", [{ ref: "1", vencimento: "2026-09-20", valor: 80 }])).toBeNull();
    expect(banco.consultas).toHaveLength(1);
  });
});

describe("baixarFaturasSumidas", () => {
  it("marca baixada_no_erp so a aberta desta fonte cuja ref nao veio — a lista vai como UM parametro de array", async () => {
    banco.responder = () => [[101], [102]];
    const n = await storage.baixarFaturasSumidas(PROVEDOR, "mk", new Set(["11", "12", " 13 "]));
    expect(n).toBe(2);
    const c = banco.consultas[0];
    expect(c.sql).toMatch(/^update "invoices" set/);
    expect(c.sql).toContain('"status" = $1');
    expect(c.params[0]).toBe("baixada_no_erp");
    expect(c.sql).toContain('"erp_source" = $');
    expect(c.sql).toContain('"erp_ref" is not null');
    expect(c.sql).toContain('not ("invoices"."erp_ref" = any($');
    expect(c.sql).toContain("::text[]))");
    expect(c.sql).toMatch(/returning "id"$/);
    conferirTenant(c);
    expect(c.params).toContainEqual(["11", "12", "13"]);
    expect(c.params).toContain("aberta");
    expect(c.params).toContain("mk");
    // Sem a lista de protegidos nao ha subconsulta em customers.
    expect(c.sql).not.toContain('"customers"');
  });

  it("os clientes nao lidos ficam como estavam: subconsulta por documento, com provider_id", async () => {
    banco.responder = () => [];
    await storage.baixarFaturasSumidas(PROVEDOR, "sgp", new Set(["1"]), ["041.179.829-40", ""]);
    const c = banco.consultas[0];
    expect(c.sql).toContain('not exists (');
    expect(c.sql).toContain('"customers"."cpf_cnpj" = any($');
    expect(c.params).toContainEqual(["04117982940"]);
    // Duas ocorrencias de provider_id: a da tabela e a da subconsulta.
    expect(Array.from(c.sql.matchAll(/"provider_id" = \$(\d+)/g))).toHaveLength(2);
    conferirTenant(c);
  });

  it("sem NENHUMA referencia vista nao baixa nada — lista vazia nao e prova de que ninguem tem fatura", async () => {
    expect(await storage.baixarFaturasSumidas(PROVEDOR, "mk", new Set())).toBe(0);
    expect(await storage.baixarFaturasSumidas(PROVEDOR, "mk", new Set(["", "  "]))).toBe(0);
    expect(banco.consultas).toHaveLength(0);
  });
});

/**
 * As tres consultas do resumo, na ordem em que o storage as faz, e as colunas
 * na ordem em que ele as seleciona — o pg-proxy devolve linhas posicionais.
 */
function responderResumo(o: {
  faturas?: (string | number)[];
  clientes?: (string | number)[];
  base?: (string | number | null)[];
}) {
  banco.responder = (sqlTexto) => {
    if (sqlTexto.includes('from "customers"')) return [o.clientes ?? ["0", "0", "0"]];
    if (sqlTexto.includes("max(")) return [o.base ?? ["0", null]];
    return [o.faturas ?? ["0", "0", "0", "0", "0", "0", "0"]];
  };
}

describe("resumoDoMes", () => {
  it("recebimento explícito com data torna o indicador confirmado", async () => {
    responderResumo({ faturas: ["100", "100", "0", "0", "0", "0", "0"], base: ["1", null] });
    expect(await storage.resumoDoMes(PROVEDOR, "2026-09", HOJE)).toMatchObject({ recebido: 100, recebidoConfirmado: true });
    expect(banco.consultas[0].sql).toContain('"paid_date" is not null');
  });
  it("sem fatura do ERP: base=false, tudo zero e recebido nunca confirmado — a tela mostra '—'", async () => {
    responderResumo({});
    const r = await storage.resumoDoMes(PROVEDOR, "2026-09", HOJE);
    expect(r).toEqual({
      mes: "2026-09", base: false,
      faturado: 0, recebido: 0, recebidoConfirmado: false, emConciliacao: 0,
      inadimplente: 0, numInadimplentes: 0, aVencer: 0, numAVencer: 0,
      semFatura: 0, clientes: { emDia: 0, inadimplentes: 0 }, atualizadoEm: null,
    });
    expect(banco.consultas).toHaveLength(3);
    for (const c of banco.consultas) conferirTenant(c);
  });

  it("as quatro categorias saem das faturas do mes, e os clientes atuais sao contados contra elas", async () => {
    responderResumo({
      faturas: ["1000.00", "0", "150.00", "300.00", "2", "550.00", "5"],
      clientes: ["4", "2", "30"],
      base: ["12", "2026-09-05 03:10:00"],
    });
    const r = await storage.resumoDoMes(PROVEDOR, "2026-09", HOJE);
    expect(r).toMatchObject({
      base: true, faturado: 1000, recebido: 0, recebidoConfirmado: false, emConciliacao: 150,
      inadimplente: 300, numInadimplentes: 2, aVencer: 550, numAVencer: 5,
      semFatura: 4, clientes: { emDia: 30, inadimplentes: 2 },
    });
    expect(r.atualizadoEm).toBeInstanceOf(Date);
    expect(r.atualizadoEm!.toISOString()).toBe("2026-09-05T03:10:00.000Z");

    const [faturas, clientes, base] = banco.consultas;
    // O universo: faturas do provedor vencendo em [de, ate), nos cinco status.
    expect(faturas.sql).toContain('"invoices"."due_date" >= $');
    expect(faturas.sql).toContain('"invoices"."due_date" < $');
    expect(faturas.params).toEqual(expect.arrayContaining(["2026-09-01", "2026-10-01", "2026-09-05", "aberta", "pending", "overdue", "paid", "baixada_no_erp"]));
    // Vencida = aberta e antes de HOJE (fatura que vence hoje ainda nao venceu).
    expect(faturas.sql).toMatch(/filter \(where \("invoices"\."status" in \(\$\d+, \$\d+, \$\d+\) and "invoices"\."due_date" < \$\d+::timestamp\)\)/);
    expect(faturas.sql).toMatch(/filter \(where \("invoices"\."status" in \(\$\d+, \$\d+, \$\d+\) and "invoices"\."due_date" >= \$\d+::timestamp\)\)/);
    // Clientes ATUAIS (ativo/suspenso), contra as faturas DELES no mes.
    expect(clientes.sql).toContain('"customers"."status" in ($');
    expect(clientes.params).toEqual(expect.arrayContaining(["active", "suspended"]));
    expect(clientes.sql).toContain('"invoices"."customer_id" = "customers"."id"');
    expect(clientes.sql).toContain("not exists (");
    // A base: alguma fatura do ERP (erp_source nao nulo) deste provedor.
    expect(base.sql).toContain('"invoices"."erp_source" is not null');
  });
});

describe("clientesDoMes", () => {
  it("sem_fatura: cliente atual sem nenhuma fatura no mes", async () => {
    banco.responder = () => [[1], [2]];
    const ids = await storage.clientesDoMes(PROVEDOR, "2026-09", "sem_fatura", { hoje: HOJE, limite: 10 });
    expect(ids).toEqual([1, 2]);
    const c = banco.consultas[0];
    expect(c.sql).toMatch(/^select "id" from "customers"/);
    expect(c.sql).toContain("not exists (select 1 from \"invoices\"");
    expect(c.sql).toMatch(/limit \$\d+$/);
    expect(c.params).toContain(10);
    conferirTenant(c);
  });

  it("pago, inadimplente e a_vencer saem das faturas do mes, distintos por cliente", async () => {
    banco.responder = () => [[42]];
    for (const grupo of ["pago", "inadimplente", "a_vencer"] as const) {
      banco.consultas.length = 0;
      const ids = await storage.clientesDoMes(PROVEDOR, "2026-09", grupo, { hoje: HOJE });
      expect(ids).toEqual([42]);
      const c = banco.consultas[0];
      expect(c.sql).toMatch(/^select distinct "customer_id" from "invoices"/);
      conferirTenant(c);
      expect(c.params).toEqual(expect.arrayContaining(["2026-09-01", "2026-10-01"]));
      if (grupo === "pago") expect(c.params).toEqual(expect.arrayContaining(["paid", "baixada_no_erp"]));
      if (grupo === "inadimplente") expect(c.sql).toMatch(/"due_date" < \$\d+::timestamp/);
      if (grupo === "a_vencer") expect(c.sql).toMatch(/"due_date" >= \$\d+::timestamp/);
      expect(c.params).toContain(20_000);
    }
  });
});

/**
 * `recuperacaoAposContato` — o KPI C6: quanto a cobranca trouxe de volta.
 *
 * O que precisa ficar provado aqui, porque nada disso e visivel na tela:
 *
 *   · sem fatura do ERP, ou sem nenhuma baixa, a resposta e "—" COM MOTIVO e
 *     valores nulos — nunca R$ 0,00 (regra do dono, integridade do dado);
 *   · so entra fatura `baixada_no_erp`, que so a varredura COMPLETA grava;
 *   · o contato tem de ser do MESMO provedor, do MESMO cliente, dentro da
 *     janela que antecede a baixa;
 *   · cada fatura conta uma vez (ultimo toque), senao dois canais dobrariam o
 *     mesmo dinheiro;
 *   · provider_id em toda consulta.
 */
describe("recuperacaoAposContato", () => {
  /** As tres consultas do caminho feliz, na ordem em que saem. */
  const responderComBase = (linhas: { total?: unknown[][]; origem?: unknown[][]; canal?: unknown[][] }) => {
    banco.responder = (sql: string) => {
      if (sql.startsWith("select count(*) filter")) return [[10, 3]];
      if (sql.endsWith('group by "origem"')) return linhas.origem ?? [];
      if (sql.endsWith('group by "canal"')) return linhas.canal ?? [];
      return linhas.total ?? [[0, 0, 0]];
    };
  };

  it.each(['ativo', 'ex_cliente'] as const)('recuperacao %s recorta base e todas as agregacoes pelo cliente atual', async carteira => {
    responderComBase({});
    await storage.recuperacaoAposContato(PROVEDOR, { hoje: HOJE, carteira });
    expect(banco.consultas).toHaveLength(4);
    for (const q of banco.consultas) {
      expect(q.sql).toContain('"customers"."status"');
      expect(q.params).toContain('active');
      expect(q.params).toContain('suspended');
      conferirTenant(q);
    }
  });

  it("sem fatura vinda do ERP: base falsa, motivo escrito, valores nulos", async () => {
    banco.responder = () => [[0, 0]];
    const r = await storage.recuperacaoAposContato(PROVEDOR, { hoje: HOJE });
    expect(r.base).toBe(false);
    expect(r.motivo).toMatch(/Nenhuma fatura veio do ERP/);
    expect(r.valor).toBeNull();
    expect(r.faturas).toBeNull();
    expect(r.clientes).toBeNull();
    expect(r.porOrigem).toEqual([]);
    // Uma consulta so: sem base nao se pergunta mais nada ao banco.
    expect(banco.consultas).toHaveLength(1);
    conferirTenant(banco.consultas[0]);
  });

  it("com fatura do ERP mas nenhuma baixa: tambem e '—', e o motivo diz por que", async () => {
    banco.responder = () => [[120, 0]];
    const r = await storage.recuperacaoAposContato(PROVEDOR, { hoje: HOJE });
    expect(r.base).toBe(false);
    expect(r.motivo).toMatch(/varredura completa/);
    expect(r.valor).toBeNull();
    expect(banco.consultas).toHaveLength(1);
  });

  it("cruza baixa com contato: mesmo provedor, mesmo cliente, dentro da janela antes da baixa", async () => {
    responderComBase({});
    await storage.recuperacaoAposContato(PROVEDOR, { hoje: HOJE, dias: 30, janelaDias: 7 });
    expect(banco.consultas).toHaveLength(4);
    for (const c of banco.consultas) conferirTenant(c);

    const q = banco.consultas[1];
    // So a fatura que sumiu dos pendentes numa varredura completa.
    expect(q.params).toContain("baixada_no_erp");
    expect(q.sql).toContain('"invoices"."erp_source" is not null');
    expect(q.sql).toContain('"invoices"."baixada_em" is not null');
    // O contato e do mesmo cliente e do mesmo provedor.
    expect(q.sql).toContain('"cobranca_eventos"."customer_id" = "invoices"."customer_id"');
    expect(q.params).toContain("contato");
    // A janela: contato ANTES da baixa e a no maximo `janelaDias` dela.
    expect(q.sql).toContain('"cobranca_eventos"."ocorrido_em" <= "invoices"."baixada_em"');
    expect(q.sql).toContain("make_interval(days => $");
    expect(q.params).toContain(7);
    // O periodo medido entra como data, e nao como texto.
    const desde = new Date(HOJE.getTime() - 30 * 86_400_000);
    expect(q.params.some(p => p instanceof Date && (p as Date).getTime() === desde.getTime())
      || q.params.includes(desde.toISOString())).toBe(true);
  });

  it("ultimo toque: uma fatura conta uma vez, para o contato mais recente da janela", async () => {
    responderComBase({});
    await storage.recuperacaoAposContato(PROVEDOR, { hoje: HOJE });
    const q = banco.consultas[1];
    expect(q.sql).toContain('row_number() over (partition by "invoices"."id" order by "cobranca_eventos"."ocorrido_em" desc');
    expect(q.sql).toContain('"pares" where "ordem" = $');
  });

  it("origem: mensagem da maquina e assistente; texto de gente com usuario e operador; o resto e indefinido", async () => {
    responderComBase({});
    await storage.recuperacaoAposContato(PROVEDOR, { hoje: HOJE });
    const sql = banco.consultas[1].sql;
    expect(sql).toContain("'agente_ia', 'template_aprovado'");
    expect(sql).toContain("then 'assistente'");
    expect(sql).toContain('when "cobranca_eventos"."user_id" is not null then \'operador\'');
    expect(sql).toContain("else 'indefinido'");
  });

  it("devolve total, quebra por origem e quebra por canal, do maior valor para o menor", async () => {
    responderComBase({
      total: [[1234.5, 9, 6]],
      origem: [["operador", 400, 3, 2], ["assistente", 834.5, 6, 4]],
      canal: [["whatsapp", 900, 7, 5], ["telefone", 334.5, 2, 1]],
    });
    const r = await storage.recuperacaoAposContato(PROVEDOR, { hoje: HOJE, dias: 30 });
    expect(r.base).toBe(true);
    expect(r.motivo).toBeNull();
    expect(r.valor).toBe(1234.5);
    expect(r.faturas).toBe(9);
    expect(r.clientes).toBe(6);
    expect(r.dias).toBe(30);
    expect(r.ate).toEqual(HOJE);
    expect(r.porOrigem.map(x => x.chave)).toEqual(["assistente", "operador"]);
    expect(r.porOrigem[0]).toEqual({ chave: "assistente", valor: 834.5, faturas: 6, clientes: 4 });
    expect(r.porCanal.map(x => x.chave)).toEqual(["whatsapp", "telefone"]);
  });

  it("periodo e janela sao aparados: nada de 0 dia nem de ano inteiro por engano", async () => {
    responderComBase({});
    const r = await storage.recuperacaoAposContato(PROVEDOR, { hoje: HOJE, dias: 0, janelaDias: 9999 });
    expect(r.dias).toBe(1);
    expect(r.janelaDias).toBe(90);
  });
});

/**
 * `faturasDoCliente` — o que o painel do caso abre quando o operador clica no
 * card (pedido do dono, 06/09/2026).
 *
 * O que precisa ficar provado, porque nada disso aparece na tela:
 *
 *   · as duas consultas filtram `provider_id` E `customer_id` — a lista de
 *     faturas de um cliente e o lugar obvio para vazar tenant;
 *   · a ordem e por vencimento, mais recente primeiro, com teto;
 *   · os agregados saem da carteira INTEIRA do cliente, nao da pagina: a
 *     fatura mais antiga e justamente a que o teto corta;
 *   · vencida = ABERTA e antes de hoje (a que vence hoje ainda nao venceu),
 *     a mesma regua do resumo do mes;
 *   · sem fatura vencida gravada, `vencimentoMaisAntigo` e null — a tela
 *     mostra "—" em vez de derivar "hoje menos os dias de atraso".
 */
describe("faturasDoCliente", () => {
  const CLIENTE = 77;

  /** A consulta que lista (tem `order by`) e a que agrega (tem `count(*)`). */
  const listagem = () => banco.consultas.find(c => /order by/.test(c.sql))!;
  const agregado = () => banco.consultas.find(c => /count\(\*\)/.test(c.sql))!;

  it("duas consultas, as duas com provedor e cliente juntos", async () => {
    await storage.faturasDoCliente(PROVEDOR, CLIENTE, { hoje: HOJE });
    expect(banco.consultas).toHaveLength(2);
    for (const c of banco.consultas) {
      conferirTenant(c);
      const oc = Array.from(c.sql.matchAll(/"customer_id" = \$(\d+)/g));
      expect(oc.length, c.sql).toBeGreaterThan(0);
      for (const o of oc) expect(c.params[Number(o[1]) - 1]).toBe(CLIENTE);
    }
  });

  it("lista da mais recente para a mais antiga, com teto", async () => {
    await storage.faturasDoCliente(PROVEDOR, CLIENTE, { hoje: HOJE, limite: 5 });
    const c = listagem();
    expect(c.sql).toContain('order by "invoices"."due_date" desc, "invoices"."id" desc');
    expect(c.sql).toMatch(/limit \$\d+$/);
    expect(c.params).toContain(5);
  });

  it("o teto e 200, mesmo que a rota peca mais — e nunca menos que 1", async () => {
    expect((await storage.faturasDoCliente(PROVEDOR, CLIENTE, { limite: 5000 })).limite).toBe(200);
    banco.consultas.length = 0;
    expect((await storage.faturasDoCliente(PROVEDOR, CLIENTE, { limite: 0 })).limite).toBe(200);
    banco.consultas.length = 0;
    expect((await storage.faturasDoCliente(PROVEDOR, CLIENTE, { limite: -3 })).limite).toBe(1);
  });

  it("vencida e ABERTA e antes de hoje — a que vence hoje ainda nao venceu", async () => {
    await storage.faturasDoCliente(PROVEDOR, CLIENTE, { hoje: HOJE });
    const c = agregado();
    expect(c.sql).toMatch(/filter \(where \("invoices"\."status" in \(\$\d+, \$\d+, \$\d+\) and "invoices"\."due_date" < \$\d+::timestamp\)\)/);
    expect(c.params).toEqual(expect.arrayContaining(["aberta", "pending", "overdue", "2026-09-05"]));
    // O agregado NAO tem janela de mes nem limite: e a carteira inteira do cliente.
    expect(c.sql).not.toContain("limit");
    expect(c.sql).toContain(`min("due_date") filter`);
    expect(c.sql).toContain(`count(*) filter (where "erp_source" is not null)`);
  });

  // O texto do timestamp e o do Postgres ("AAAA-MM-DD HH:MM:SS"): e assim que o
  // decodificador do Drizzle o le, somando +0000. O agregado passa pelo MESMO
  // decodificador (`mapWith`), senao a fatura mais antiga escorregaria de dia.
  it("devolve a fatura como a tela a mostra, e o valor vira numero", async () => {
    banco.responder = (sql) => /order by/.test(sql)
      ? [[10, "mk", "551", "2026-09-10 00:00:00", "99.90", "Mensalidade setembro", "aberta", null]]
      : [[7, 7, 3, "310.50", "2026-07-10 00:00:00", "2026-09-01 00:00:00"]];

    const r = await storage.faturasDoCliente(PROVEDOR, CLIENTE, { hoje: HOJE });
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toEqual({
      id: 10, erpSource: "mk", erpRef: "551",
      vencimento: new Date("2026-09-10T00:00:00.000Z"),
      valor: 99.9, descricao: "Mensalidade setembro", status: "aberta", baixadaEm: null,
    });
    expect(r.total).toBe(7);
    expect(r.doErp).toBe(7);
    expect(r.vencidas).toBe(3);
    expect(r.valorVencido).toBe(310.5);
    expect(r.vencimentoMaisAntigo).toEqual(new Date("2026-07-10T00:00:00.000Z"));
    // A vencida mais recente sai pelo MESMO decodificador — Date, nao texto.
    expect(r.vencimentoMaisRecente).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(banco.consultas.some(c => /max\("due_date"\) filter \(where/.test(c.sql) || /max\("invoices"\."due_date"\) filter \(where/.test(c.sql))).toBe(true);
  });

  it("cliente sem fatura gravada: tudo zero e vencimento NULO — a tela mostra o traco", async () => {
    banco.responder = (sql) => /order by/.test(sql) ? [] : [[0, 0, 0, 0, null, null]];
    const r = await storage.faturasDoCliente(PROVEDOR, CLIENTE, { hoje: HOJE });
    expect(r.linhas).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.doErp).toBe(0);
    expect(r.vencidas).toBe(0);
    expect(r.vencimentoMaisAntigo).toBeNull();
    expect(r.vencimentoMaisRecente).toBeNull();
  });
});

describe("mensalidade observada em lote", () => {
  /**
   * A mesma moda de mensalidadeDoCliente, para a carteira inteira numa
   * consulta: e o ARPU que o card "Prejuizo acumulado" soma. Uma linha por
   * cliente, so a posicao 1 do ranking (mais repeticoes, depois vencimento
   * mais novo), e valor nao positivo nao vira mensalidade.
   */
  it("uma consulta, uma linha por cliente, moda por repeticao e vencimento; valor <= 0 fica de fora", async () => {
    banco.responder = () => [
      [42, "89.90", 5, "2026-09-10T00:00:00Z", 7, 4],
      [43, "0.00", 3, "2026-08-10T00:00:00Z", 3, 0],
      [44, "2924.66", 1, "2026-05-25T00:00:00Z", 1, 0],
    ];
    const m = await storage.mensalidadesDoProvedor(PROVEDOR);
    expect(banco.consultas).toHaveLength(1);
    conferirTenant(banco.consultas[0]);
    expect(banco.consultas[0].sql).toContain('"erp_source" is not null');
    expect(banco.consultas[0].sql).toContain("row_number() over (partition by");
    expect(banco.consultas[0].sql).toContain('group by');
    expect(m.get(42)).toMatchObject({ valor: 89.9, concordam: 5, faturas: 7, baixadas: 4 });
    expect(banco.consultas[0].params).toContain("baixada_no_erp");
    // A fatura PAGA que o ERP confirmou (0036) e prova tao boa quanto a baixa.
    expect(banco.consultas[0].params).toContain("paid");
    // As baixadas sao do GRUPO (cliente, valor): nenhuma janela somando os valores todos.
    expect(banco.consultas[0].sql).not.toMatch(/filter \(where "status" in[^)]*\)\) over/);
    expect(m.get(42)!.maisRecente).toEqual(new Date("2026-09-10T00:00:00Z"));
    expect(m.has(43)).toBe(false);
    // O ex-cliente com UMA fatura-saldo entra no mapa como qualquer outro: quem
    // decide se isso e mensalidade e quem le a evidencia (concordam/faturas).
    expect(m.get(44)).toMatchObject({ valor: 2924.66, concordam: 1, faturas: 1, baixadas: 0 });
  });
  it("com ids: recorta por cliente no SQL; lista vazia e recorte vazio, sem ir ao banco", async () => {
    expect((await storage.mensalidadesDoProvedor(PROVEDOR, [])).size).toBe(0);
    expect(banco.consultas).toHaveLength(0);
    banco.responder = () => [];
    await storage.mensalidadesDoProvedor(PROVEDOR, [7, 9]);
    expect(banco.consultas).toHaveLength(1);
    conferirTenant(banco.consultas[0]);
    expect(banco.consultas[0].sql).toContain('"customer_id" in (');
    expect(banco.consultas[0].params).toEqual(expect.arrayContaining([7, 9]));
  });
});

describe("os devedores com as datas do card de prejuizo", () => {
  /**
   * Uma consulta, a populacao do KPI (comDivida dentro da carteira), e as
   * datas como DIA EM TEXTO: due_date e meia-noite UTC e um Date lido no fuso
   * do servidor escorregaria de mes na fronteira.
   */
  it.each(["ativo", "ex_cliente"] as const)("carteira %s: uma consulta, datas em texto, o predicado da carteira e o corte de hoje", async carteira => {
    banco.responder = () => [
      [42, "cancelled", "589.65", "2025-09-01", null, "2026-03-05", "2026-03-05"],
      [43, "cancelled", "50.00", null, null, null, null],
    ];
    const r = await storage.devedoresComVencimento(PROVEDOR, carteira, HOJE);
    expect(banco.consultas).toHaveLength(1);
    conferirTenant(banco.consultas[0]);
    // A populacao e a da carteira pedida: ativos = status atual; ex = not (status atual).
    expect(banco.consultas[0].sql).toContain('"customers"."status" in (');
    if (carteira === "ex_cliente") expect(banco.consultas[0].sql).toContain("not (");
    else expect(banco.consultas[0].sql).not.toContain("not (");
    expect(banco.consultas[0].params).toEqual(expect.arrayContaining(["active", "suspended"]));
    expect(banco.consultas[0].sql).toContain("to_char(min(");
    expect(banco.consultas[0].sql).toContain("to_char(max(");
    expect(banco.consultas[0].sql).toContain("'YYYY-MM-DD'");
    expect(banco.consultas[0].sql).toContain("left join");
    expect(banco.consultas[0].sql).toContain('coalesce("customers"."total_overdue_amount", 0) > 0');
    // A regua da casa: fatura que vence HOJE ainda nao venceu — o corte e o dia, em texto.
    expect(banco.consultas[0].params).toContain("2026-09-05");
    expect(r).toEqual([
      { id: 42, statusErp: "cancelled", dividaAtual: 589.65, contractStartDate: "2025-09-01", cortadoEm: null, plano: null, devemDesde: "2026-03-05", ultimaFatura: "2026-03-05" },
      { id: 43, statusErp: "cancelled", dividaAtual: 50, contractStartDate: null, cortadoEm: null, plano: null, devemDesde: null, ultimaFatura: null },
    ]);
  });
  it("a base de faturas diz se ha fatura do ERP e quando a varredura tocou a ultima", async () => {
    banco.responder = () => [[12, "2026-09-09T06:05:00Z"]];
    const b = await storage.baseDeFaturas(PROVEDOR);
    conferirTenant(banco.consultas[0]);
    expect(banco.consultas[0].sql).toContain('"erp_source" is not null');
    expect(b.total).toBe(12);
    expect(b.atualizadoEm).toBeTruthy();
  });
});

describe("as faturas PAGAS que o ERP confirma (0036)", () => {
  const paga = (ref: string, over: Record<string, unknown> = {}) => ({
    ref, erpCustomerId: "28485", vencimento: "2026-08-10", valor: 99.9, valorPago: 99.9, pagoEm: "2026-08-09", descricao: "mensalidade", ...over,
  });
  it("casa o cliente pelo id no ERP ou pelo documento, grava paid com data e valor pagos, e conta quem nao esta na base", async () => {
    banco.responder = (sql) =>
      /"erp_customer_id" in \(/.test(sql) ? [[71, "28485"]]
      : /"cpf_cnpj" in \(/.test(sql) ? [[72, "52998224725"]]
      : [];
    const r = await storage.upsertFaturasPagasDoErp(PROVEDOR, "ixc", [
      paga("P1"),
      paga("P2", { erpCustomerId: undefined, cpfCnpj: "529.982.247-25" }),
      paga("P3", { erpCustomerId: "999" }),                 // ninguem: fora
      paga("P4", { pagoEm: "" }),                            // sem data de pagamento: fora
    ]);
    expect(r).toEqual({ gravadas: 2, semCliente: 2 });
    const insert = banco.consultas.find(c => c.sql.startsWith("insert into \"invoices\""))!;
    expect(insert).toBeTruthy();
    // No insert o tenant vai por VALOR (provider_id em cada linha), nao por where.
    expect(insert.sql).toContain('"provider_id"');
    expect(insert.params.filter(v => v === PROVEDOR)).toHaveLength(2);
    expect(insert.sql).toContain("on conflict");
    // Prova positiva: vence aberta/baixada na mesma referencia — sem `where status <> 'paid'`.
    expect(insert.sql).not.toMatch(/where "invoices"\."status" <> /);
    expect(insert.params).toEqual(expect.arrayContaining(["paid", "P1", "P2", "99.90", 71, 72]));
    expect(insert.params).not.toContain("P3");
    expect(insert.sql).toContain('"paid_value"');
  });
  it("lista vazia ou so invalidas: nada vai ao banco", async () => {
    expect(await storage.upsertFaturasPagasDoErp(PROVEDOR, "ixc", [paga("X", { valorPago: NaN })])).toEqual({ gravadas: 0, semCliente: 1 });
    expect(banco.consultas).toHaveLength(0);
  });
  it("o ultimo pagamento lido e o dia em texto, so das pagas com valor pago (as do ERP), por fonte", async () => {
    banco.responder = () => [["2026-09-08"]];
    expect(await storage.ultimoPagamentoLido(PROVEDOR, "sgp")).toBe("2026-09-08");
    conferirTenant(banco.consultas[0]);
    expect(banco.consultas[0].sql).toContain("to_char(max(");
    expect(banco.consultas[0].sql).toContain('"paid_value" is not null');
    expect(banco.consultas[0].params).toEqual(expect.arrayContaining(["sgp", "paid"]));
    banco.consultas.length = 0;
    banco.responder = () => [[null]];
    expect(await storage.ultimoPagamentoLido(PROVEDOR, "sgp")).toBeNull();
  });
  it("o historico em lote traz o RECEBIDO (valor pago, ou o da fatura) e aceita recorte por ids", async () => {
    banco.responder = () => [[42, 4, 1, "359.60", "2026-08-12T00:00:00Z"]];
    const m = await storage.historicosDePagamentosDoProvedor(PROVEDOR, [42, 43]);
    expect(m.get(42)).toMatchObject({ faturasPagas: 4, faturasPagasComAtraso: 1, recebido: 359.6, taxaAtraso: 0.25 });
    conferirTenant(banco.consultas[0]);
    expect(banco.consultas[0].sql).toContain('coalesce("paid_value", "value")');
    expect(banco.consultas[0].sql).toContain('"customer_id" in (');
    expect((await storage.historicosDePagamentosDoProvedor(PROVEDOR, [])).size).toBe(0);
  });
});

describe("o ERP deste provedor ja confirmou algum pagamento? (0036)", () => {
  it("uma linha paid com valor pago basta, no tenant, com limit 1", async () => {
    banco.responder = () => [[123]];
    expect(await storage.erpConfirmaPagamentos(PROVEDOR)).toBe(true);
    conferirTenant(banco.consultas[0]);
    expect(banco.consultas[0].sql).toContain("limit");
    expect(banco.consultas[0].sql).toContain('"paid_value" is not null');
    expect(banco.consultas[0].params).toContain("paid");
    banco.consultas.length = 0;
    banco.responder = () => [];
    expect(await storage.erpConfirmaPagamentos(PROVEDOR)).toBe(false);
  });
  it("o devedor do card traz o plano do ERP (contract_plan), na ultima coluna", async () => {
    banco.responder = () => [[7, "cancelled", "100.00", "2025-09-05", null, "2026-03-05", "2026-03-05", "Smart 800MB"]];
    const [d] = await storage.devedoresComVencimento(PROVEDOR, "ex_cliente", new Date("2026-09-09T12:00:00Z"));
    expect(d).toMatchObject({ id: 7, plano: "Smart 800MB", devemDesde: "2026-03-05" });
    expect(banco.consultas[0].sql).toContain('"contract_plan"');
  });
});

describe("a cobranca de saida por cliente (multa + equipamento nas faturas vencidas)", () => {
  it("uma consulta no tenant, so vencidas em aberto, so dos ids, so descricao que fala nisso — e o parser soma por cliente", async () => {
    banco.responder = () => [
      [42, "719.86", "Proporcional 40 dias + multa 600,00"],
      [42, "300.00", "referente ao equipamento"],
      [43, "700.00", "2 Mensalidades + multa"],
    ];
    const m = await storage.cobrancasDeSaida(PROVEDOR, [42, 43, 44], new Date("2026-09-05T12:00:00Z"));
    expect(banco.consultas).toHaveLength(1);
    conferirTenant(banco.consultas[0]);
    expect(banco.consultas[0].sql).toContain('"customer_id" in (');
    expect(banco.consultas[0].sql).toContain("~*");
    expect(banco.consultas[0].params.some(v => typeof v === "string" && v.startsWith("\\m(multas?|"))).toBe(true);
    expect(banco.consultas[0].params).toContain("2026-09-05");
    expect(banco.consultas[0].params).toEqual(expect.arrayContaining(["aberta", "pending", "overdue"]));
    // A MESMA foto da divida: o corte e o menor entre hoje e o dia da varredura do cliente.
    expect(banco.consultas[0].sql).toContain("least(");
    expect(banco.consultas[0].sql).toContain('"last_sync_at"');
    expect(banco.consultas[0].sql).toContain("inner join");
    expect(m.get(42)).toEqual({ multa: 600, equipamento: 300, indeterminadas: 0, faturas: 2, mensalidadeLida: 89.9 });
    expect(m.get(43)).toEqual({ multa: 0, equipamento: 0, indeterminadas: 1, faturas: 1, mensalidadeLida: null });
    expect(m.has(44)).toBe(false);
  });
  it("lista vazia de ids: nada vai ao banco", async () => {
    expect((await storage.cobrancasDeSaida(PROVEDOR, [], new Date())).size).toBe(0);
    expect(banco.consultas).toHaveLength(0);
  });
});

describe("a fatura de saida nao concorre a moda da mensalidade (revisao de 09/09/2026)", () => {
  it("no lote e no unitario, a ordem da moda comeca por 'nao e fatura de saida'", async () => {
    banco.responder = () => [];
    await storage.mensalidadesDoProvedor(PROVEDOR, [1]);
    expect(banco.consultas[0].sql).toMatch(/order by bool_or\((?:"invoices"\.)?"descricao" ~\* \$\d+\) asc, count\(\*\) desc/);
    banco.consultas.length = 0;
    await storage.mensalidadeDoCliente(PROVEDOR, 1);
    expect(banco.consultas[0].sql).toMatch(/order by bool_or\((?:"invoices"\.)?"descricao" ~\* \$\d+\) asc, count\(\*\) desc/);
  });
});
