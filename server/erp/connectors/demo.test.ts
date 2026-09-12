import { beforeEach, describe, expect, it, vi } from "vitest";

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

/** Linhas (objeto, chave camelCase) -> array-of-arrays na ordem das colunas pedidas — o formato que o pg-proxy espera de volta. */
function projetar(tabela: string, linhas: Record<string, unknown>[], textoDeColunas: string): unknown[][] {
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const colunas = nomesDeColuna(textoDeColunas);
  return linhas.map((linha) => colunas.map((c) => (mapa.get(c) ? (linha[mapa.get(c)!] ?? null) : null)));
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
  banco.db = drizzle(async (sqlTexto: string, params: unknown[]) => {
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
  };
}

function linhaFatura(o: {
  id: number;
  customerId: number;
  providerId: number;
  value: string;
  diasAtraso: number;
  descricao?: string | null;
}): Record<string, unknown> {
  return {
    id: o.id,
    customerId: o.customerId,
    providerId: o.providerId,
    value: o.value,
    dueDate: new Date(Date.now() - o.diasAtraso * 86_400_000),
    status: "overdue",
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
