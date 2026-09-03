import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// O Postgres nao entra aqui: o que precisa de prova e a FORMA dos comandos —
// que o credito e reivindicado por um UPDATE condicional dentro de uma
// transacao, e que a numeracao pede nextval() em vez de contar linhas.
const chamadas = vi.hoisted(() => ({
  execute: [] as unknown[],
  claimSet: [] as unknown[],
  claimWhere: [] as unknown[],
  insert: [] as { tabela: unknown; valores: unknown }[],
  transacoes: 0,
}));

const retornos = vi.hoisted(() => ({
  claim: [] as any[],
  selectPedido: [] as any[],
  execute: { rows: [{ n: "9" }] } as any,
}));

const dbMock = vi.hoisted(() => {
  const tx = {
    update: (_tabela: unknown) => ({
      set: (valores: unknown) => {
        chamadas.claimSet.push(valores);
        return {
          where: (cond: unknown) => {
            chamadas.claimWhere.push(cond);
            return { returning: async () => retornos.claim };
          },
        };
      },
    }),
    select: () => ({ from: (_t: unknown) => ({ where: async (_c: unknown) => retornos.selectPedido }) }),
    execute: async (q: unknown) => {
      chamadas.execute.push(q);
      return retornos.execute;
    },
    insert: (tabela: unknown) => ({
      values: async (valores: unknown) => {
        chamadas.insert.push({ tabela, valores });
      },
    }),
  };
  return {
    db: {
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
        chamadas.transacoes++;
        return fn(tx);
      },
      execute: async (q: unknown) => {
        chamadas.execute.push(q);
        return retornos.execute;
      },
      // Chamar qualquer um destes fora da transacao e exatamente o defeito que
      // duplicava credito; por isso eles explodem no teste.
      update: () => { throw new Error("update fora da transacao"); },
      insert: () => { throw new Error("insert fora da transacao"); },
      select: () => { throw new Error("select fora da transacao"); },
    },
  };
});
vi.mock("../db", () => dbMock);

const nfseMock = vi.hoisted(() => ({ emitirNfseParaCompra: vi.fn(async () => {}) }));
vi.mock("../services/nfse-auto", () => nfseMock);

import { FinancialStorage } from "./financial.storage";

const dialeto = new PgDialect();
const paraSql = (q: unknown) => dialeto.sqlToQuery(q as SQL);

const PEDIDO = {
  id: 501, orderNumber: "CR-202609-0009", packageName: "100 créditos",
  providerId: 42, ispCredits: 100, spcCredits: 0, bigdataCredits: 0,
  amount: "100.00", status: "pending",
};

let storage: FinancialStorage;

beforeEach(() => {
  vi.clearAllMocks();
  chamadas.execute.length = 0;
  chamadas.claimSet.length = 0;
  chamadas.claimWhere.length = 0;
  chamadas.insert.length = 0;
  chamadas.transacoes = 0;
  retornos.claim = [];
  retornos.selectPedido = [];
  retornos.execute = { rows: [{ n: "9" }] };
  storage = new FinancialStorage();
});

describe("releaseCreditOrder", () => {
  it("reivindica o pedido com UPDATE condicional dentro de uma transacao", async () => {
    retornos.claim = [{ ...PEDIDO, status: "paid" }];

    const r = await storage.releaseCreditOrder(501);

    expect(chamadas.transacoes).toBe(1);
    expect(r.liberadoAgora).toBe(true);
    expect(chamadas.claimSet[0]).toMatchObject({ status: "paid" });

    // A trava contra credito dobrado e o `status <> 'paid'` no WHERE: sem ele,
    // duas entregas do webhook leem "pending" juntas e creditam duas vezes.
    const where = paraSql(chamadas.claimWhere[0]);
    expect(where.sql).toContain("<>");
    expect(where.params).toContain("paid");
    expect(where.params).toContain(501);
  });

  it("soma os creditos ao provedor e registra a movimentacao, uma vez so", async () => {
    retornos.claim = [{ ...PEDIDO, status: "paid" }];

    await storage.releaseCreditOrder(501);

    const credito = paraSql(chamadas.execute[0]);
    expect(credito.sql).toContain("UPDATE providers");
    expect(credito.sql).toContain("isp_credits = isp_credits +");
    expect(credito.params).toEqual([100, 0, 0, 42]);

    expect(chamadas.insert).toHaveLength(1);
    expect(chamadas.insert[0].valores).toMatchObject({
      providerId: 42, ispCreditsAdded: 100, spcCreditsAdded: 0, bigdataCreditsAdded: 0,
    });
  });

  it("reentrega do webhook: nao credita de novo e nao lanca erro", async () => {
    retornos.claim = [];                                  // ninguem casou com status <> 'paid'
    retornos.selectPedido = [{ ...PEDIDO, status: "paid" }];

    const r = await storage.releaseCreditOrder(501);

    expect(r.liberadoAgora).toBe(false);
    expect(r.pedido.status).toBe("paid");
    expect(chamadas.execute).toHaveLength(0);   // nenhum saldo mexido
    expect(chamadas.insert).toHaveLength(0);    // nenhuma linha de movimentacao
  });

  it("nao emite a segunda NFS-e na reentrega", async () => {
    retornos.claim = [{ ...PEDIDO, status: "paid" }];
    await storage.releaseCreditOrder(501);
    expect(nfseMock.emitirNfseParaCompra).toHaveBeenCalledTimes(1);

    retornos.claim = [];
    retornos.selectPedido = [{ ...PEDIDO, status: "paid" }];
    await storage.releaseCreditOrder(501);
    expect(nfseMock.emitirNfseParaCompra).toHaveBeenCalledTimes(1);
  });

  it("pedido que nao existe continua sendo erro", async () => {
    retornos.claim = [];
    retornos.selectPedido = [];
    await expect(storage.releaseCreditOrder(999)).rejects.toThrow("Pedido nao encontrado");
  });
});

describe("numeracao de pedido e fatura", () => {
  it("pedido pede nextval da sequence, e o formato nao muda", async () => {
    retornos.execute = { rows: [{ n: "12" }] };
    const numero = await storage.getNextOrderNumber();

    const q = paraSql(chamadas.execute[0]);
    expect(q.sql).toContain("nextval");
    expect(q.params).toEqual(["credit_orders_numero_seq"]);
    expect(numero).toMatch(/^CR-\d{6}-0012$/);
  });

  it("fatura pede a propria sequence e mantem NF-ANO-000000", async () => {
    retornos.execute = { rows: [{ n: "7" }] };
    const numero = await storage.getNextInvoiceNumber();

    const q = paraSql(chamadas.execute[0]);
    expect(q.params).toEqual(["provider_invoices_numero_seq"]);
    expect(numero).toBe(`NF-${new Date().getFullYear()}-000007`);
  });

  it("numero grande nao e truncado pelo padStart", async () => {
    retornos.execute = { rows: [{ n: "123456" }] };
    expect(await storage.getNextOrderNumber()).toMatch(/^CR-\d{6}-123456$/);
  });
});
