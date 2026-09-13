import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O conector "demo" nao fala com nenhum ERP: le direto as tabelas que
 * `server/demo/mundo-base.ts` semeia (`customers`, `invoices`, `equipment`).
 *
 * Banco de mentira no MESMO molde de `server/demo/mundo-base.test.ts` e
 * `server/storage/cobranca.storage.test.ts`: o compilador SQL REAL do
 * Drizzle (via `drizzle-orm/pg-proxy`) fala com o callback abaixo, que
 * resolve SELECTs contra linhas semeadas DIRETAMENTE em `banco.linhas` — sem
 * passar por INSERT, porque este conector so LE. A avaliacao do WHERE e real
 * (igualdade, "and"): e o que prova isolamento multi-tenant sem precisar
 * inspecionar o SQL a mao em todo teste.
 */
const banco = vi.hoisted(() => ({
  linhas: new Map<string, Record<string, unknown>[]>(),
  db: null as any,
  /** Todo SELECT que passou pelo banco de mentira, na ordem — usado para provar ESCOPO de query, nao so o resultado final. */
  sqlExecutado: [] as string[],
}));

vi.mock("../../db", () => ({
  db: new Proxy({} as any, { get: (_alvo, chave) => banco.db[chave] }),
  pool: {},
}));

import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { customers, invoices, equipment } from "@shared/schema";
import { cpfFicticio } from "../../demo/pessoas-ficticias";
import { DemoConnector } from "./demo";
import type { ErpConnectionConfig } from "../types";

const TABELAS = [customers, invoices, equipment];
/** tabela (nome real do banco) -> (coluna do banco -> chave camelCase que o Drizzle usa em JS). */
const chavePorColuna = new Map(
  TABELAS.map((t) => [
    getTableName(t),
    new Map(Object.entries(getTableColumns(t)).map(([chave, coluna]) => [(coluna as any).name as string, chave])),
  ]),
);

/** `"id"` ou `"tabela"."id"` -> `"id"`. */
function nomesDeColuna(textoDeColunas: string): string[] {
  return textoDeColunas.split(", ").map((c) => {
    const m = c.match(/^(?:"(\w+)"\.)?"(\w+)"$/);
    if (!m) throw new Error(`Coluna nao reconhecida pelo banco de mentira: ${c}`);
    return m[2];
  });
}

/**
 * Linhas (objeto, chave camelCase) -> array-of-arrays na ordem das colunas
 * pedidas — o formato que o pg-proxy espera de volta.
 *
 * `PgTimestamp.mapFromDriverValue` (para uma coluna sem `withTimezone`, o
 * caso de `invoices.dueDate`) monta a data como `valor + "+0000"` — ele
 * espera de volta o que um driver real de Postgres devolveria para
 * "timestamp without time zone": uma STRING sem sufixo de fuso. As fixtures
 * deste arquivo (`linhaFatura`) gravam um objeto `Date` cru direto em
 * `banco.linhas`, sem passar por INSERT/`mapToDriverValue` — sem esta
 * conversão, `dataObjeto + "+0000"` cai na coerção padrão do JS
 * (`Date.prototype.toString()`, ex. "Wed Sep 02 2026 00:34:13
 * GMT-0300 (Horário Padrão de Brasília)+0000"), que `new Date(...)`
 * reconstrói como um instante ATÉ 3 horas deslocado — perto da meia-noite
 * local isso empurra o dia para o calendário ERRADO e `maxDaysOverdue` sai
 * errado por 1 (achado ao investigar uma falha real deste teste; confirmado
 * por reprodução isolada contra o drizzle-orm antes de escrever isto).
 */
function projetar(tabela: string, linhas: Record<string, unknown>[], textoDeColunas: string): unknown[][] {
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const colunas = nomesDeColuna(textoDeColunas);
  return linhas.map((linha) => colunas.map((c) => {
    const valor = mapa.get(c) ? (linha[mapa.get(c)!] ?? null) : null;
    return valor instanceof Date ? valor.toISOString().slice(0, -1) : valor;
  }));
}

/** `select <cols> from "t" [where "t"."col" = $1 [and ...]]` — so igualdade, e tudo que o conector emite. */
function processarSelect(sqlTexto: string, params: unknown[]): unknown[][] {
  const m = sqlTexto.match(/^select (.+) from "(\w+)"(?: where (.+))?$/s);
  if (!m) throw new Error(`SELECT nao reconhecido pelo banco de mentira: ${sqlTexto}`);
  const [, textoDeColunas, tabela, whereTexto] = m;
  let linhas = banco.linhas.get(tabela) ?? [];
  if (whereTexto) {
    const mapa = chavePorColuna.get(tabela)!;
    const condicoes = Array.from(whereTexto.matchAll(/"(?:\w+)"\."(\w+)" = \$(\d+)/g));
    linhas = linhas.filter((linha) => condicoes.every((c) => linha[mapa.get(c[1])!] === params[Number(c[2]) - 1]));
  }
  return projetar(tabela, linhas, textoDeColunas);
}

beforeEach(() => {
  banco.linhas = new Map();
  banco.sqlExecutado = [];
  banco.db = drizzle(async (sqlTexto: string, params: unknown[]) => {
    banco.sqlExecutado.push(sqlTexto);
    if (sqlTexto.startsWith("select")) return { rows: processarSelect(sqlTexto, params) };
    throw new Error(`SQL nao suportado pelo banco de mentira: ${sqlTexto}`);
  });
});

// ── Fixtures ─────────────────────────────────────────────────────────────

const PROVEDOR_A = 101;
const PROVEDOR_B = 202;

/** CPFs ficticios de verdade (digito verificador valido) — o mesmo gerador que `mundo-base.ts` usa. `cleanCpfCnpj` rejeitaria um "11111111111" de mentirinha. */
const CPF_1 = cpfFicticio(1);
const CPF_2 = cpfFicticio(2);
const CPF_3 = cpfFicticio(3);

function config(providerId: number | undefined): ErpConnectionConfig {
  return {
    apiUrl: "",
    apiToken: "",
    extra: providerId === undefined ? {} : { providerId: String(providerId) },
  };
}

function linhaCliente(o: {
  id: number;
  providerId: number;
  cpfCnpj: string;
  name?: string;
  status?: string;
  paymentStatus?: string;
  city?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  contractStartDate?: string | null;
  contractPlan?: string | null;
  motivoCorte?: string | null;
  cortadoEm?: Date | null;
}): Record<string, unknown> {
  return {
    id: o.id,
    providerId: o.providerId,
    name: o.name ?? "Cliente Teste",
    cpfCnpj: o.cpfCnpj,
    email: null,
    phone: null,
    address: null,
    addressNumber: null,
    complement: null,
    neighborhood: null,
    city: o.city ?? null,
    state: null,
    cep: null,
    latitude: o.latitude ?? null,
    longitude: o.longitude ?? null,
    status: o.status ?? "active",
    paymentStatus: o.paymentStatus ?? "current",
    contractStartDate: o.contractStartDate ?? null,
    contractPlan: o.contractPlan ?? null,
    motivoCorte: o.motivoCorte ?? null,
    cortadoEm: o.cortadoEm ?? null,
  };
}

function linhaFatura(o: {
  id: number;
  customerId: number;
  providerId: number;
  value: string;
  diasAtraso: number;
  descricao?: string | null;
  status?: string;
}): Record<string, unknown> {
  return {
    id: o.id,
    customerId: o.customerId,
    providerId: o.providerId,
    value: o.value,
    dueDate: new Date(Date.now() - o.diasAtraso * 86_400_000),
    status: o.status ?? "overdue",
    descricao: o.descricao ?? null,
  };
}

function linhaEquipamento(o: {
  id: number;
  customerId: number;
  providerId: number;
  status?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  mac?: string | null;
  value?: string;
  inRecoveryProcess?: boolean;
}): Record<string, unknown> {
  return {
    id: o.id,
    customerId: o.customerId,
    providerId: o.providerId,
    type: "ONU",
    brand: o.brand ?? "Fiberhome",
    model: o.model ?? "HG6145F3",
    serialNumber: o.serialNumber ?? "SN00000001",
    mac: o.mac ?? "9C:AA:BB:CC:DD:EE",
    status: o.status ?? "retido",
    value: o.value ?? "290.00",
    inRecoveryProcess: o.inRecoveryProcess ?? false,
  };
}

// ── Testes ───────────────────────────────────────────────────────────────

describe("conector demo", () => {
  const connector = new DemoConnector();

  it("declara nome, rotulo e nao carrega a marca de stub (naoImplementado)", () => {
    expect(connector.name).toBe("demo");
    expect(connector.label).toBeTruthy();
    expect(connector.naoImplementado).toBeFalsy();
  });

  it("testConnection devolve ok:true quando ha providerId na config", async () => {
    const r = await connector.testConnection(config(PROVEDOR_A));
    expect(r.ok).toBe(true);
  });

  it("testConnection recusa sem providerId, sem supor um provedor", async () => {
    const r = await connector.testConnection(config(undefined));
    expect(r.ok).toBe(false);
  });

  it("fetchCustomerByCpf acha quem existe e devolve os dados do cliente", async () => {
    banco.linhas.set("customers", [
      linhaCliente({ id: 1, providerId: PROVEDOR_A, cpfCnpj: CPF_1, name: "Fulano de Tal", city: "Londrina", latitude: "-23.3100000", longitude: "-51.1628000" }),
    ]);

    const r = await connector.fetchCustomerByCpf(config(PROVEDOR_A), CPF_1);

    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(1);
    expect(r.customers[0]).toMatchObject({
      cpfCnpj: CPF_1,
      name: "Fulano de Tal",
      city: "Londrina",
      latitude: "-23.3100000",
      longitude: "-51.1628000",
      erpSource: "demo",
      contractStatus: "active",
    });
  });

  it("fetchCustomerByCpf traz contractStartDate e contractPlan quando a base semeada os tem preenchidos", async () => {
    banco.linhas.set("customers", [
      linhaCliente({
        id: 1,
        providerId: PROVEDOR_A,
        cpfCnpj: CPF_1,
        contractStartDate: "2019-03-15",
        contractPlan: "Combo 500MB",
      }),
    ]);

    const r = await connector.fetchCustomerByCpf(config(PROVEDOR_A), CPF_1);

    expect(r.ok).toBe(true);
    expect(r.customers[0]).toMatchObject({
      contractStartDate: "2019-03-15",
      contractPlan: "Combo 500MB",
    });
  });

  it("fetchCustomerByCpf nao inventa contractStartDate/contractPlan quando a base semeada nao os tem", async () => {
    banco.linhas.set("customers", [
      linhaCliente({ id: 1, providerId: PROVEDOR_A, cpfCnpj: CPF_1 }),
    ]);

    const r = await connector.fetchCustomerByCpf(config(PROVEDOR_A), CPF_1);

    expect(r.ok).toBe(true);
    expect(r.customers[0].contractStartDate).toBeUndefined();
    expect(r.customers[0].contractPlan).toBeUndefined();
  });

  it("fetchCustomerByCpf devolve ok:true com lista vazia para quem nao existe — ausencia e resposta, nao erro", async () => {
    banco.linhas.set("customers", [
      linhaCliente({ id: 1, providerId: PROVEDOR_A, cpfCnpj: CPF_1 }),
    ]);

    const r = await connector.fetchCustomerByCpf(config(PROVEDOR_A), CPF_2);

    expect(r.ok).toBe(true);
    expect(r.customers).toEqual([]);
  });

  it("fetchCustomerByCpf recusa sem providerId na config", async () => {
    const r = await connector.fetchCustomerByCpf(config(undefined), CPF_1);
    expect(r.ok).toBe(false);
    expect(r.customers).toEqual([]);
  });

  /**
   * Rodada de correcao (Tarefa 1, 11/09/2026): antes, `fetchCustomerByCpf`
   * lia `invoices`/`equipment` do PROVEDOR INTEIRO e so DEPOIS filtrava por
   * `customerId` num Map em memoria — a resposta ja saia certa (por isso um
   * teste que so olhasse o resultado final nao pegaria a regressao se este
   * fix fosse revertido), mas o custo era uma varredura de tabela inteira por
   * consulta. Com o teto de 150 sandboxes vivos e 1.500 clientes cada, isso e
   * 155 varreduras completas por UMA consulta ao vivo. Este teste inspeciona
   * o SQL de verdade que chegou ao banco de mentira — nao so o JSON de volta
   * — porque e o unico jeito de provar que o filtro foi embutido na query.
   */
  it("fetchCustomerByCpf filtra faturas e equipamentos por customerId na propria query — nao varre a base do provedor inteiro", async () => {
    banco.linhas.set("customers", [
      linhaCliente({ id: 1, providerId: PROVEDOR_A, cpfCnpj: CPF_1 }),
      linhaCliente({ id: 2, providerId: PROVEDOR_A, cpfCnpj: CPF_2 }),
    ]);
    banco.linhas.set("invoices", [
      linhaFatura({ id: 501, customerId: 1, providerId: PROVEDOR_A, value: "119.90", diasAtraso: 45 }),
      linhaFatura({ id: 502, customerId: 2, providerId: PROVEDOR_A, value: "500.00", diasAtraso: 90 }),
    ]);
    banco.linhas.set("equipment", [
      linhaEquipamento({ id: 900, customerId: 1, providerId: PROVEDOR_A, status: "retido" }),
      linhaEquipamento({ id: 901, customerId: 2, providerId: PROVEDOR_A, status: "retido" }),
    ]);

    const r = await connector.fetchCustomerByCpf(config(PROVEDOR_A), CPF_1);
    expect(r.ok).toBe(true);
    // A resposta continua correta (nao vaza a fatura/equipamento do cliente 2) —
    // isso ja era verdade antes do fix, entao a prova real esta no SQL abaixo.
    expect(r.customers[0].totalOverdueAmount).toBeCloseTo(119.9);
    expect(r.customers[0].unreturnedEquipmentCount).toBe(1);

    const selectsDeFaturas = banco.sqlExecutado.filter((s) => s.includes(`from "invoices"`));
    const selectsDeEquipamento = banco.sqlExecutado.filter((s) => s.includes(`from "equipment"`));
    expect(selectsDeFaturas, banco.sqlExecutado.join("\n")).toHaveLength(1);
    expect(selectsDeEquipamento, banco.sqlExecutado.join("\n")).toHaveLength(1);
    expect(selectsDeFaturas[0]).toMatch(/"invoices"\."customer_id" = \$\d+/);
    expect(selectsDeEquipamento[0]).toMatch(/"equipment"\."customer_id" = \$\d+/);
  });

  it("fetchDelinquents traz so os vencidos, com totalOverdueAmount e maxDaysOverdue batendo com as faturas", async () => {
    banco.linhas.set("customers", [
      linhaCliente({ id: 1, providerId: PROVEDOR_A, cpfCnpj: CPF_1, paymentStatus: "overdue" }),
      linhaCliente({ id: 2, providerId: PROVEDOR_A, cpfCnpj: CPF_2, paymentStatus: "current" }),
      linhaCliente({ id: 3, providerId: PROVEDOR_A, cpfCnpj: CPF_3, status: "cancelled", paymentStatus: "current" }),
    ]);
    banco.linhas.set("invoices", [
      linhaFatura({ id: 501, customerId: 1, providerId: PROVEDOR_A, value: "119.90", diasAtraso: 10 }),
    ]);

    const r = await connector.fetchDelinquents(config(PROVEDOR_A));

    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(1);
    const [cliente] = r.customers;
    expect(cliente.cpfCnpj).toBe(CPF_1);
    expect(cliente.totalOverdueAmount).toBeCloseTo(119.9);
    expect(cliente.maxDaysOverdue).toBe(10);
    expect(cliente.overdueInvoicesCount).toBe(1);
    expect(cliente.faturasAbertas).toHaveLength(1);
    expect(cliente.faturasAbertas![0]).toMatchObject({ ref: "501", valor: 119.9 });
  });

  it("fetchCustomers traz a base inteira (ativos e cancelados), com o equipamento retido do cancelado", async () => {
    banco.linhas.set("customers", [
      linhaCliente({ id: 1, providerId: PROVEDOR_A, cpfCnpj: CPF_1, paymentStatus: "overdue" }),
      linhaCliente({ id: 2, providerId: PROVEDOR_A, cpfCnpj: CPF_2, paymentStatus: "current" }),
      linhaCliente({ id: 3, providerId: PROVEDOR_A, cpfCnpj: CPF_3, status: "cancelled", paymentStatus: "current" }),
    ]);
    banco.linhas.set("invoices", [
      linhaFatura({ id: 501, customerId: 1, providerId: PROVEDOR_A, value: "119.90", diasAtraso: 10 }),
    ]);
    banco.linhas.set("equipment", [
      linhaEquipamento({ id: 900, customerId: 3, providerId: PROVEDOR_A, status: "retido" }),
    ]);

    const r = await connector.fetchCustomers(config(PROVEDOR_A));

    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(3);

    const porCpf = new Map(r.customers.map((c) => [c.cpfCnpj, c]));
    expect(porCpf.get(CPF_1)).toMatchObject({ contractStatus: "active", totalOverdueAmount: 119.9 });
    expect(porCpf.get(CPF_2)).toMatchObject({ contractStatus: "active", totalOverdueAmount: 0, maxDaysOverdue: 0 });

    const cancelado = porCpf.get(CPF_3)!;
    expect(cancelado.contractStatus).toBe("cancelled");
    expect(cancelado.hasUnreturnedEquipment).toBe(true);
    expect(cancelado.unreturnedEquipmentCount).toBe(1);
    expect(cancelado.equipmentDetails).toHaveLength(1);
    expect(cancelado.equipmentDetails![0]).toMatchObject({ brand: "Fiberhome", model: "HG6145F3", serialNumber: "SN00000001" });
  });

  it("fetchCustomers recusa sem providerId, sem devolver a rede inteira por engano", async () => {
    banco.linhas.set("customers", [
      linhaCliente({ id: 1, providerId: PROVEDOR_A, cpfCnpj: CPF_1 }),
      linhaCliente({ id: 2, providerId: PROVEDOR_B, cpfCnpj: CPF_2 }),
    ]);

    const r = await connector.fetchCustomers(config(undefined));

    expect(r.ok).toBe(false);
    expect(r.customers).toEqual([]);
  });

  it("nunca le a carteira de outro provedor — mesmo CPF compartilhado entre vizinhos", async () => {
    // O mesmo CPF existe nos dois provedores (aresta compartilhada da demo),
    // com dados DIFERENTES — se o filtro vazasse, um provedor veria o outro.
    banco.linhas.set("customers", [
      linhaCliente({ id: 1, providerId: PROVEDOR_A, cpfCnpj: CPF_1, name: "Visao do Provedor A", paymentStatus: "overdue" }),
      linhaCliente({ id: 2, providerId: PROVEDOR_B, cpfCnpj: CPF_1, name: "Visao do Provedor B", paymentStatus: "current" }),
    ]);
    banco.linhas.set("invoices", [
      linhaFatura({ id: 501, customerId: 1, providerId: PROVEDOR_A, value: "50.00", diasAtraso: 5 }),
    ]);

    const viaA = await connector.fetchCustomerByCpf(config(PROVEDOR_A), CPF_1);
    expect(viaA.customers).toHaveLength(1);
    expect(viaA.customers[0].name).toBe("Visao do Provedor A");

    const viaB = await connector.fetchCustomerByCpf(config(PROVEDOR_B), CPF_1);
    expect(viaB.customers).toHaveLength(1);
    expect(viaB.customers[0].name).toBe("Visao do Provedor B");
    expect(viaB.customers[0].totalOverdueAmount).toBe(0);

    // fetchDelinquents de B nao pode trazer o inadimplente de A.
    const delinquentesB = await connector.fetchDelinquents(config(PROVEDOR_B));
    expect(delinquentesB.customers).toEqual([]);
  });
});

/**
 * Rodada 2 da demonstração (13/09/2026). A consulta do chip "CPF limpo" saía
 * RISCO ALTO / Analisar porque o conector marcava "equipamento não devolvido"
 * para QUALQUER aparelho do cliente — inclusive a ONU em comodato, instalada
 * e funcionando na casa de quem está em dia. `consultas.routes.ts` trata o
 * sinal como pendência operacional e o motor aplica o teto de 400.
 */
describe("conector demo — pendência de equipamento pelo critério do produto", () => {
  const connector = new DemoConnector();

  it("ativo com ONU em_comodato NÃO tem equipamento não devolvido, mas a ONU continua no inventário", async () => {
    banco.linhas.set("customers", [linhaCliente({ id: 1, providerId: PROVEDOR_A, cpfCnpj: CPF_1 })]);
    banco.linhas.set("equipment", [linhaEquipamento({ id: 900, customerId: 1, providerId: PROVEDOR_A, status: "em_comodato" })]);

    const [cliente] = (await connector.fetchCustomerByCpf(config(PROVEDOR_A), CPF_1)).customers;

    expect(cliente.hasUnreturnedEquipment).toBe(false);
    expect(cliente.unreturnedEquipmentCount).toBe(0);
    expect(cliente.equipmentDetails).toHaveLength(1);
  });

  it("conta só o que tem retirada pendente (retirada_pendente, nao_localizado) — recuperado não pesa", async () => {
    banco.linhas.set("customers", [linhaCliente({ id: 1, providerId: PROVEDOR_A, cpfCnpj: CPF_1, status: "cancelled" })]);
    banco.linhas.set("equipment", [
      linhaEquipamento({ id: 900, customerId: 1, providerId: PROVEDOR_A, status: "retirada_pendente" }),
      linhaEquipamento({ id: 901, customerId: 1, providerId: PROVEDOR_A, status: "nao_localizado" }),
      linhaEquipamento({ id: 902, customerId: 1, providerId: PROVEDOR_A, status: "recuperado_triagem" }),
    ]);

    const [cliente] = (await connector.fetchCustomers(config(PROVEDOR_A))).customers;

    expect(cliente.hasUnreturnedEquipment).toBe(true);
    expect(cliente.unreturnedEquipmentCount).toBe(2);
    expect(cliente.equipmentDetails).toHaveLength(3);
  });

  it("a ONU de uma recuperação aberta (in_recovery_process) sai em processo de recuperação", async () => {
    banco.linhas.set("customers", [linhaCliente({ id: 1, providerId: PROVEDOR_A, cpfCnpj: CPF_1, status: "cancelled" })]);
    banco.linhas.set("equipment", [
      linhaEquipamento({ id: 900, customerId: 1, providerId: PROVEDOR_A, status: "retirada_pendente", inRecoveryProcess: true }),
    ]);

    const [cliente] = (await connector.fetchCustomerByCpf(config(PROVEDOR_A), CPF_1)).customers;

    expect(cliente.equipmentDetails![0].inRecoveryProcess).toBe(true);
  });
});

/**
 * O bloco "Conexão" do Cliente 360 e o painel do chat liam `conexoes: []` na
 * demonstração inteira: o conector não devolvia autenticação nenhuma.
 */
describe("conector demo — autenticações, corte e segunda via", () => {
  const connector = new DemoConnector();
  afterEach(() => vi.unstubAllGlobals());

  function carteiraDeTresHistorias() {
    banco.linhas.set("customers", [
      linhaCliente({ id: 11, providerId: PROVEDOR_A, cpfCnpj: CPF_1, contractStartDate: "2021-05-10" }),
      linhaCliente({ id: 12, providerId: PROVEDOR_A, cpfCnpj: CPF_2, paymentStatus: "overdue" }),
      linhaCliente({
        id: 13, providerId: PROVEDOR_A, cpfCnpj: CPF_3, status: "cancelled",
        motivoCorte: "Financeiro", cortadoEm: new Date("2026-04-16T12:00:00.000Z"),
      }),
    ]);
    banco.linhas.set("invoices", [
      linhaFatura({ id: 501, customerId: 12, providerId: PROVEDOR_A, value: "119.90", diasAtraso: 20 }),
    ]);
    banco.linhas.set("equipment", [
      linhaEquipamento({ id: 900, customerId: 11, providerId: PROVEDOR_A, status: "em_comodato", mac: "9C:00:07:C8:10:FF", serialNumber: "SB00510000" }),
    ]);
  }

  it("devolve a MESMA autenticação em duas leituras, com MAC e serial do equipamento do cliente", async () => {
    carteiraDeTresHistorias();

    const primeira = (await connector.fetchCustomerByCpf(config(PROVEDOR_A), CPF_1)).customers[0];
    const segunda = (await connector.fetchCustomers(config(PROVEDOR_A))).customers.find((c) => c.cpfCnpj === CPF_1)!;

    expect(primeira.autenticacoes).toEqual(segunda.autenticacoes);
    expect(primeira.autenticacoes).toHaveLength(1);
    expect(primeira.autenticacoes![0]).toMatchObject({
      mac: "9C0007C810FF",
      serial: "SB00510000",
      contrato: "11",
      fonte: "demo",
    });
    expect(primeira.autenticacoes![0].login).toBeTruthy();
  });

  it("online só para o ativo em dia; o inadimplente ativo não é bloqueado; o cancelado fica offline e bloqueado", async () => {
    carteiraDeTresHistorias();

    const porCpf = new Map((await connector.fetchCustomers(config(PROVEDOR_A))).customers.map((c) => [c.cpfCnpj, c.autenticacoes![0]]));

    expect(porCpf.get(CPF_1)).toMatchObject({ online: true, bloqueada: false });
    expect(porCpf.get(CPF_1)!.ip).toMatch(/^100\.64\.\d{1,3}\.\d{1,3}$/);
    expect(porCpf.get(CPF_2)).toMatchObject({ online: false, bloqueada: false, ip: null });
    expect(porCpf.get(CPF_3)).toMatchObject({ online: false, bloqueada: true, ip: null });
    // Sem aparelho na base: a conexão existe, mas nada de MAC ou serial inventado.
    expect(porCpf.get(CPF_2)).toMatchObject({ mac: null, serial: null });
  });

  it("o cancelado devolve cortadoEm (dia) e motivoCorte da base; o ativo não inventa nenhum dos dois", async () => {
    carteiraDeTresHistorias();

    const porCpf = new Map((await connector.fetchCustomers(config(PROVEDOR_A))).customers.map((c) => [c.cpfCnpj, c]));

    expect(porCpf.get(CPF_3)).toMatchObject({ cortadoEm: "2026-04-16", motivoCorte: "Financeiro" });
    expect(porCpf.get(CPF_1)!.cortadoEm).toBeUndefined();
    expect(porCpf.get(CPF_1)!.motivoCorte).toBeUndefined();
  });

  it("fetchSegundaVia da fatura aberta do próprio cliente: linha digitável e PIX fictícios, sem link e sem rede", async () => {
    carteiraDeTresHistorias();
    const rede = vi.fn();
    vi.stubGlobal("fetch", rede);

    const pagamento = await connector.fetchSegundaVia(config(PROVEDOR_A), CPF_2, "501");

    expect(pagamento).not.toBeNull();
    expect(pagamento!.link).toBeNull();
    expect(pagamento!.linhaDigitavel).toMatch(/^[\d. ]+$/);
    expect(pagamento!.linhaDigitavel!.replace(/\D/g, "")).toHaveLength(47);
    expect(pagamento!.pix).toMatch(/^000201/);
    expect(pagamento!.valor).toBeCloseTo(119.9);
    expect(pagamento!.vencimento).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Determinística: a mesma fatura devolve o mesmo instrumento.
    expect(await connector.fetchSegundaVia(config(PROVEDOR_A), CPF_2, "501")).toEqual(pagamento);
    expect(rede).not.toHaveBeenCalled();
  });

  it("fetchSegundaVia recusa fatura de outro cliente, fatura paga, referência que não é id e config sem providerId", async () => {
    carteiraDeTresHistorias();
    banco.linhas.set("invoices", [
      linhaFatura({ id: 501, customerId: 12, providerId: PROVEDOR_A, value: "119.90", diasAtraso: 20 }),
      linhaFatura({ id: 502, customerId: 12, providerId: PROVEDOR_A, value: "119.90", diasAtraso: 50, status: "paid" }),
    ]);
    const rede = vi.fn();
    vi.stubGlobal("fetch", rede);

    expect(await connector.fetchSegundaVia(config(PROVEDOR_A), CPF_1, "501")).toBeNull();
    expect(await connector.fetchSegundaVia(config(PROVEDOR_A), CPF_2, "502")).toBeNull();
    expect(await connector.fetchSegundaVia(config(PROVEDOR_A), CPF_2, "demo-fatura-12")).toBeNull();
    expect(await connector.fetchSegundaVia(config(PROVEDOR_B), CPF_2, "501")).toBeNull();
    expect(await connector.fetchSegundaVia(config(undefined), CPF_2, "501")).toBeNull();
    expect(rede).not.toHaveBeenCalled();
  });
});
