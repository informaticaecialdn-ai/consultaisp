/**
 * As faturas abertas atravessando a varredura (fase 2 da cobranca).
 *
 * Tres riscos, um teste para cada:
 *
 *  · A fatura tem que ser gravada DEPOIS do upsert do cliente, nos dois
 *    passos, e a de quem esta em dia — que nao passa pelo passo 2 — chega por
 *    documento. Sem isso o resumo do mes diria que todo pagante ficou sem
 *    fatura.
 *  · A baixa do que sumiu e prova NEGATIVA: so depois de varredura completa,
 *    com TODAS as referencias vistas (dos dois passos e dos em dia) e com os
 *    clientes nao lidos protegidos. Varredura parcial — fonte recusada,
 *    carteira nao lida, faturas nao lidas — nao baixa nada.
 *  · Falha ao gravar fatura nao derruba o cliente nem o sync.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const CPF_DEVE = "04117982940";
const CPF_EM_DIA = "52998224725";
const CPF_SO_NO_MK = "11144477735";
const ID_POR_DOC: Record<string, number> = { [CPF_DEVE]: 71, [CPF_EM_DIA]: 72 };

const upsertFromErp = vi.fn(async (d: any) => ({ id: ID_POR_DOC[d.cpfCnpj] }));
const upsertFaturasDoErp = vi.fn(async (_p: number, _s: string, _c: number, f: any[]) => f.length);
const upsertFaturasDoErpPorDocumento = vi.fn(async (_p: number, _s: string, _d: string, f: any[]) => f.length);
const baixarFaturasSumidas = vi.fn(async (_p: number, _s: string, _r: Set<string>, _d?: string[]) => 2);
const baixarDividaQuitada = vi.fn(async () => 0);
const registrarResultadoSync = vi.fn(async (_p: number, _s: string, _d: any) => {});
const contarFalhasConsecutivas = vi.fn(async () => 0);
const getErpIntegracoesResumo = vi.fn(async () => [{ erpSource: "mk", isEnabled: true, status: "idle" } as any]);

vi.mock("../storage", () => ({
  storage: {
    upsertFromErp: (d: any) => upsertFromErp(d),
    upsertFaturasDoErp: (p: number, s: string, c: number, f: any[]) => upsertFaturasDoErp(p, s, c, f),
    upsertFaturasDoErpPorDocumento: (p: number, s: string, d: string, f: any[]) => upsertFaturasDoErpPorDocumento(p, s, d, f),
    baixarFaturasSumidas: (p: number, s: string, r: Set<string>, d?: string[]) => baixarFaturasSumidas(p, s, r, d),
    baixarDividaQuitada: () => baixarDividaQuitada(),
    registrarResultadoSync: (p: number, s: string, d: any) => registrarResultadoSync(p, s, d),
    contarFalhasConsecutivas: () => contarFalhasConsecutivas(),
    getErpIntegracoesResumo: (p: number) => getErpIntegracoesResumo(),
    getProvider: async () => ({ id: 3, name: "NsLink", addressCity: "Londrina", addressState: "PR" }),
    getUsersByProvider: async () => [],
    pausarPorFalhas: async () => {},
  },
}));

vi.mock("../db", () => ({
  pool: { connect: async () => ({ query: async () => ({ rows: [{ ok: true }] }), release() {} }) },
  db: {},
}));

// Nada de rede nem de base de municipios: a varredura aqui e sobre faturas.
vi.mock("./geocoding", () => ({ geocodeCep: async () => null, resolveIbgeCode: async () => null }));
vi.mock("./coords-erp.service", () => ({ coordenadaDoErpCoerente: async () => null }));
vi.mock("./cidade-canonica.service", () => ({ canonizarCidadeDoCadastro: () => ({ municipio: null }) }));

const conector = vi.hoisted(() => ({ atual: null as any }));
vi.mock("../erp", async (original) => {
  const real = await original<typeof import("../erp")>();
  return { ...real, getConnector: (s: string) => conector.atual ?? real.getConnector(s) };
});

import { syncProviderToDb } from "./erp-sync.service";

const INTEGRACAO = { apiUrl: "http://mk.local/mk", apiToken: "token", mkContraSenha: "contra" };

const fatura = (ref: string, dias: number, valor = 99.9) => {
  const d = new Date(Date.now() + dias * 86_400_000);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { ref, vencimento: iso, valor };
};

const DEVEDOR = {
  cpfCnpj: CPF_DEVE, name: "Maria", city: "Londrina", state: "PR",
  totalOverdueAmount: 99.9, maxDaysOverdue: 40, overdueInvoicesCount: 1,
  faturasAbertas: [fatura("A1", -40), fatura("A2", 10)],
  contractStatus: "active", erpSource: "mk",
};
const EM_DIA = {
  cpfCnpj: CPF_EM_DIA, name: "Joao", city: "Londrina", state: "PR",
  totalOverdueAmount: 0, maxDaysOverdue: 0,
  faturasAbertas: [fatura("B1", 5)],
  contractStatus: "active", erpSource: "mk",
};

/** Um conector com carteira, um devedor e um cliente em dia que so a fatura conhece. */
function conectorFake(o: {
  carteira?: any;
  inadimplentes?: any;
} = {}) {
  return {
    name: "mk",
    label: "MK Solutions",
    fetchCustomers: async () => o.carteira ?? { ok: true, message: "", customers: [DEVEDOR, EM_DIA] },
    fetchDelinquents: async () => o.inadimplentes ?? {
      ok: true, message: "", customers: [DEVEDOR],
      faturasDeClientesEmDia: [{ cpfCnpj: CPF_SO_NO_MK, faturasAbertas: [fatura("C1", 12)] }],
      docsNaoLidos: [],
    },
  };
}

// resetAllMocks (Vitest 4): limpa as chamadas E devolve a implementacao original de cada vi.fn(impl) —
// um mockImplementation de um cenario nao vaza para o seguinte.
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { conector.atual = null; });

describe("as faturas abertas na varredura", () => {
  it("grava as abertas de cada cliente depois do upsert dele, nos dois passos, e as de quem esta em dia por documento", async () => {
    conector.atual = conectorFake();
    const r = await syncProviderToDb(3, "NsLink", "mk", INTEGRACAO, "auto");
    expect(r).toEqual({ upserted: 1, errors: 0 });

    // Passo 1: os dois clientes da carteira; passo 2: o devedor de novo.
    const chamadas = upsertFaturasDoErp.mock.calls.map(([p, s, c, f]) => [p, s, c, f.map((x: any) => x.ref)]);
    expect(chamadas).toEqual(expect.arrayContaining([
      [3, "mk", 71, ["A1", "A2"]],
      [3, "mk", 72, ["B1"]],
    ]));
    expect(upsertFaturasDoErp.mock.calls.filter(([, , c]) => c === 71)).toHaveLength(2);

    // A ordem: o cliente antes da fatura dele.
    const ordemCliente = upsertFromErp.mock.invocationCallOrder[0];
    const ordemFatura = upsertFaturasDoErp.mock.invocationCallOrder[0];
    expect(ordemCliente).toBeLessThan(ordemFatura);

    // Quem esta em dia e nao passou pelo passo 2 chega por documento.
    expect(upsertFaturasDoErpPorDocumento).toHaveBeenCalledTimes(1);
    expect(upsertFaturasDoErpPorDocumento.mock.calls[0].slice(0, 3)).toEqual([3, "mk", CPF_SO_NO_MK]);
  });

  it("varredura completa: baixa as sumidas com TODAS as referencias vistas, protegendo quem nao foi lido", async () => {
    const c = conectorFake();
    c.fetchDelinquents = async () => ({
      ok: true, message: "", customers: [DEVEDOR],
      faturasDeClientesEmDia: [{ cpfCnpj: CPF_SO_NO_MK, faturasAbertas: [fatura("C1", 12)] }],
      docsNaoLidos: ["99988877766"],
    });
    conector.atual = c;
    await syncProviderToDb(3, "NsLink", "mk", INTEGRACAO, "auto");

    expect(baixarFaturasSumidas).toHaveBeenCalledTimes(1);
    const [providerId, fonte, refs, protegidos] = baixarFaturasSumidas.mock.calls[0];
    expect(providerId).toBe(3);
    expect(fonte).toBe("mk");
    expect(Array.from(refs).sort()).toEqual(["A1", "A2", "B1", "C1"]);
    expect(protegidos).toEqual(["99988877766"]);
    // A baixa de divida e a de fatura andam juntas: mesma prova, mesma condicao.
    expect(baixarDividaQuitada).toHaveBeenCalledTimes(1);
    expect(registrarResultadoSync.mock.calls[0][2].status).toBe("success");
  });

  it("leitura parcial dos inadimplentes: grava as abertas, mas NAO baixa nada", async () => {
    conector.atual = conectorFake({
      inadimplentes: { ok: true, message: "", customers: [DEVEDOR], leituraParcial: true },
    });
    await syncProviderToDb(3, "NsLink", "mk", INTEGRACAO, "auto");
    expect(upsertFaturasDoErp).toHaveBeenCalled();
    expect(baixarFaturasSumidas).not.toHaveBeenCalled();
    expect(baixarDividaQuitada).not.toHaveBeenCalled();
  });

  it("carteira nao lida (passo 1 recusado): a fatura a vencer de quem esta em dia nao veio — nada e baixado", async () => {
    conector.atual = conectorFake({ carteira: { ok: false, message: "MK nao respondeu", customers: [] } });
    await syncProviderToDb(3, "NsLink", "mk", INTEGRACAO, "auto");
    expect(upsertFaturasDoErp).toHaveBeenCalled(); // o devedor do passo 2 ainda grava
    expect(baixarFaturasSumidas).not.toHaveBeenCalled();
    // A baixa de DIVIDA segue a regra dela (so o passo 2): continua rodando.
    expect(baixarDividaQuitada).toHaveBeenCalledTimes(1);
  });

  it("faturas nao lidas no passo 1 (IXC sem fn_areceber): clientes gravados, nada baixado", async () => {
    conector.atual = conectorFake({
      carteira: { ok: true, message: "", customers: [{ ...DEVEDOR, faturasAbertas: undefined }, { ...EM_DIA, faturasAbertas: undefined }], faturasNaoLidas: true },
    });
    await syncProviderToDb(3, "NsLink", "mk", INTEGRACAO, "auto");
    expect(upsertFromErp).toHaveBeenCalledTimes(3);
    expect(baixarFaturasSumidas).not.toHaveBeenCalled();
  });

  it("sem nenhuma referencia vista nao ha o que provar: nao chama a baixa", async () => {
    conector.atual = conectorFake({
      carteira: { ok: true, message: "", customers: [{ ...DEVEDOR, faturasAbertas: undefined }] },
      inadimplentes: { ok: true, message: "", customers: [{ ...DEVEDOR, faturasAbertas: undefined }] },
    });
    await syncProviderToDb(3, "NsLink", "mk", INTEGRACAO, "auto");
    expect(upsertFaturasDoErp).not.toHaveBeenCalled();
    expect(baixarFaturasSumidas).not.toHaveBeenCalled();
  });

  it("falha ao gravar fatura nao derruba o cliente nem o sync", async () => {
    upsertFaturasDoErp.mockRejectedValue(new Error("deadlock detected"));
    conector.atual = conectorFake();
    const r = await syncProviderToDb(3, "NsLink", "mk", INTEGRACAO, "auto");
    expect(r).toEqual({ upserted: 1, errors: 0 });
    expect(upsertFromErp).toHaveBeenCalledTimes(3);
    expect(registrarResultadoSync.mock.calls[0][2].status).toBe("success");
  });

  it("upsert do cliente falhou no passo 2: a fatura dele ainda conta como vista — o ERP a mencionou", async () => {
    upsertFromErp.mockImplementation(async (d: any) => {
      if (d.cpfCnpj === CPF_DEVE && !d.skipPaymentStatus) throw new Error("deadlock detected");
      return { id: ID_POR_DOC[d.cpfCnpj] };
    });
    conector.atual = conectorFake();
    const r = await syncProviderToDb(3, "NsLink", "mk", INTEGRACAO, "auto");
    expect(r).toEqual({ upserted: 0, errors: 1 });
    // Com erro de upsert a varredura nao e completa: nada e baixado...
    expect(baixarFaturasSumidas).not.toHaveBeenCalled();
    // ...e as faturas de quem gravou no passo 1 seguem gravadas.
    expect(upsertFaturasDoErp).toHaveBeenCalledWith(3, "mk", 72, expect.anything());
  });

  it("cliente em dia que a porteira barrou (nao esta na base) nao e erro", async () => {
    upsertFaturasDoErpPorDocumento.mockResolvedValue(null);
    conector.atual = conectorFake();
    const r = await syncProviderToDb(3, "NsLink", "mk", INTEGRACAO, "auto");
    expect(r.errors).toBe(0);
    // A referencia dele ainda conta como vista: o ERP a mencionou.
    const refs = baixarFaturasSumidas.mock.calls[0][2];
    expect(refs.has("C1")).toBe(true);
  });
});
