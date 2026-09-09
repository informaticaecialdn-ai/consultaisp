/**
 * As faturas PAGAS que cada ERP confirma (0036) — a materia-prima da Economia
 * do contrato encerrado. Tres conectores, tres formas:
 *
 *   IXC  em lote: fn_areceber status=R, pagamento_data/pagamento_valor
 *   SGP  em lote: /api/ura/titulos/ status=pagos, dataPagamento/valorPago
 *   MK   por cliente: WSMKFaturas liquidado=true — API licenciada; HTTP 500
 *        tres vezes seguidas declara "indisponivel" e para (nao bate em 3.000
 *        clientes para colher 3.000 erros)
 *
 * O que se prova aqui: o filtro que vai ao ERP, o mapeamento campo a campo
 * (nada inferido: data e valor pago sao os do ERP), o que fica de fora (sem
 * data, estornado, sem documento) e a janela de datas.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IxcConnector } from "./ixc";
import { SgpConnector } from "./sgp";
import { MkConnector } from "./mk";

let fetchOriginal: typeof globalThis.fetch;
beforeEach(() => { fetchOriginal = globalThis.fetch; });
afterEach(() => { globalThis.fetch = fetchOriginal; vi.restoreAllMocks(); });

describe("IXC · fetchFaturasPagas", () => {
  const CONFIG = { apiUrl: "https://ixc.local", apiUser: "45", apiToken: "token", extra: {} } as any;
  const recebida = (id: string, over: Record<string, unknown> = {}) => ({
    id, id_cliente: "28485", status: "R", liberado: "S", estornado: "N", data_vencimento: "2026-09-10", valor: "99.90",
    valor_recebido: "99.90", pagamento_valor: "99.90", pagamento_data: "2026-09-09", baixa_data: "2026-09-09 13:43:45", obs: "de 10/08/2026 até 09/09/2026", ...over,
  });
  it("filtra status=R e liberado=S com a janela de pagamento, e mapeia data e valor PAGOS do IXC", async () => {
    const chamadas: any[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: any) => {
      const body = JSON.parse(init?.body ?? "{}");
      chamadas.push({ url: String(url), body });
      const registros = [
        recebida("1761853"),
        recebida("1761854", { pagamento_valor: "95.00", valor: "99.90" }),        // pagou com desconto: o pago vale
        recebida("1761855", { estornado: "S" }),                                  // estornado: fora
        recebida("1761856", { pagamento_data: "", baixa_data: "", credito_data: "" }), // sem data: fora
      ];
      return { ok: true, status: 200, json: async () => ({ page: "1", total: String(registros.length), registros }) } as any;
    }) as any;
    const r = await new IxcConnector().fetchFaturasPagas(CONFIG, { desde: "2026-08-25", ate: "2026-09-09" });
    expect(r.ok).toBe(true);
    expect(r.parcial).toBe(false);
    const filtros = JSON.parse(chamadas[0].body.grid_param);
    expect(filtros).toEqual(expect.arrayContaining([
      expect.objectContaining({ TB: "fn_areceber.status", P: "R" }),
      expect.objectContaining({ TB: "fn_areceber.liberado", P: "S" }),
      expect.objectContaining({ TB: "fn_areceber.pagamento_data", OP: ">=", P: "2026-08-25" }),
      expect.objectContaining({ TB: "fn_areceber.pagamento_data", OP: "<=", P: "2026-09-09" }),
    ]));
    expect(chamadas[0].url).toContain("/webservice/v1/fn_areceber");
    expect(r.faturas).toEqual([
      { ref: "1761853", erpCustomerId: "28485", vencimento: "2026-09-10", valor: 99.9, valorPago: 99.9, pagoEm: "2026-09-09", descricao: "de 10/08/2026 até 09/09/2026" },
      expect.objectContaining({ ref: "1761854", valor: 99.9, valorPago: 95 }),
    ]);
  });
  it("sem janela, nenhum filtro de data; erro do IXC vira ok=false, nunca lista vazia disfarçada", async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async (_url: string, init?: any) => {
      n++;
      const body = JSON.parse(init?.body ?? "{}");
      const filtros = JSON.parse(body.grid_param);
      expect(filtros.some((f: any) => f.TB === "fn_areceber.pagamento_data")).toBe(false);
      return { ok: false, status: 500, text: async () => "erro", json: async () => ({}) } as any;
    }) as any;
    const r = await new IxcConnector().fetchFaturasPagas(CONFIG, { desde: null });
    expect(r.ok).toBe(false);
    expect(r.parcial).toBe(true);
    expect(r.faturas).toEqual([]);
    expect(n).toBeGreaterThan(0);
  });
});

describe("SGP · fetchFaturasPagas", () => {
  const CONFIG = { apiUrl: "https://amplisinal.sgp.net.br", apiToken: "tok", extra: { sgpApp: "consultaisp" } } as any;
  const pago = (id: number, over: Record<string, unknown> = {}) => ({
    id, clienteNome: "X", clienteCpfcnpj: "041.179.829-40", clienteContrato: 808, status: "pago",
    valor: 145, valorDesconto: 0, valorCorrigido: 145, valorPago: 145, valorPagoParcial: 0,
    dataEmissao: "2026-09-08", dataVencimento: "2026-09-08", dataPagamento: "2026-09-08", dataCancelamento: "",
    demonstrativo: "referente boletos atrasados", formaPagamento: "Transferência Bancária", ...over,
  });
  it("pede status=pagos com a janela de pagamento e mapeia id, documento, data e valor pagos", async () => {
    const chamadas: URLSearchParams[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: any) => {
      expect(String(url)).toContain("/api/ura/titulos/");
      const params = new URLSearchParams(String(init?.body ?? ""));
      chamadas.push(params);
      const titulos = [
        pago(43495),
        pago(43457, { valorPago: 0, valorPagoParcial: 60, valor: 100 }),   // parcial: o que entrou
        pago(43458, { dataPagamento: "" }),                                 // sem data: fora
        pago(43459, { clienteCpfcnpj: "" }),                                // sem documento: fora
      ];
      return new Response(JSON.stringify({ paginacao: { offset: 0, limit: 250, parcial: titulos.length, total: titulos.length }, titulos }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    const r = await new SgpConnector().fetchFaturasPagas(CONFIG, { desde: "2026-01-01", ate: "2026-06-30" });
    expect(r.ok).toBe(true);
    expect(chamadas[0].get("status")).toBe("pagos");
    expect(chamadas[0].get("data_pagamento_inicio")).toBe("2026-01-01");
    expect(chamadas[0].get("data_pagamento_fim")).toBe("2026-06-30");
    expect(r.faturas).toEqual([
      { ref: "43495", cpfCnpj: "04117982940", vencimento: "2026-09-08", valor: 145, valorPago: 145, pagoEm: "2026-09-08", descricao: "referente boletos atrasados" },
      expect.objectContaining({ ref: "43457", valor: 100, valorPago: 60 }),
    ]);
  });
});

describe("MK · fetchFaturasPagas — por cliente, pela API licenciada", () => {
  const CONFIG = { apiUrl: "http://mk.local:8080/mk", apiToken: "token-de-teste", mkContraSenha: "contra-de-teste", extra: {} } as any;
  const ok = (corpo: unknown) => ({ ok: true, status: 200, json: async () => corpo }) as any;
  const clientes = [
    { erpCustomerId: "1660", cpfCnpj: "04117982940" },
    { erpCustomerId: "1661", cpfCnpj: "52998224725" },
    { erpCustomerId: "1662", cpfCnpj: "11144477735" },
    { erpCustomerId: "1663", cpfCnpj: "22233344405" },
  ];
  it("HTTP 500 tres vezes seguidas: declara a API indisponivel e para de bater", async () => {
    let faturasChamadas = 0;
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("WSAutenticacao")) return ok({ Token: "sessao-fake" });
      if (u.includes("WSMKFaturas.rule")) { faturasChamadas++; return { ok: false, status: 500, json: async () => ({}) } as any; }
      return ok({});
    }) as any;
    const r = await new MkConnector().fetchFaturasPagas(CONFIG, { desde: null, clientes });
    expect(r.ok).toBe(true);
    expect(r.indisponivel).toBe(true);
    expect(r.message).toMatch(/liberada pela MK Solutions/);
    expect(r.faturas).toEqual([]);
    // 3 chamadas e nao 4: o quarto cliente nao e consultado.
    expect(faturasChamadas).toBeLessThanOrEqual(4);
    expect(faturasChamadas).toBeGreaterThanOrEqual(3);
  });
  it("com a API liberada: liquidado=true por cliente, datas do MK em dd/mm/aaaa viram AAAA-MM-DD, e a janela vira quantidade_meses", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("WSAutenticacao")) return ok({ Token: "sessao-fake" });
      if (u.includes("WSMKFaturas.rule")) {
        urls.push(u);
        const cd = new URL(u).searchParams.get("codigo_cliente");
        return ok({ Faturas: cd === "1660"
          ? [{ codfatura: 38512, data_vencimento: "10/08/2026", data_pagamento: "12/08/2026", valor_total: 89.9, valor_pago: 89.9, descricao: "Ref.: Smart 700MB" },
             { codfatura: 38513, data_vencimento: "10/09/2026", data_pagamento: "", valor_total: 89.9 }]   // sem pagamento: fora
          : [] });
      }
      return ok({});
    }) as any;
    const r = await new MkConnector().fetchFaturasPagas(CONFIG, { desde: "2026-06-01", clientes: clientes.slice(0, 2) });
    expect(r.ok).toBe(true);
    expect(r.indisponivel).toBeUndefined();
    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/codigo_cliente=1660&liquidado=true&quantidade_meses=\d+/);
    expect(r.faturas).toEqual([
      { ref: "38512", erpCustomerId: "1660", cpfCnpj: "04117982940", vencimento: "2026-08-10", valor: 89.9, valorPago: 89.9, pagoEm: "2026-08-12", descricao: "Ref.: Smart 700MB" },
    ]);
  });
});
