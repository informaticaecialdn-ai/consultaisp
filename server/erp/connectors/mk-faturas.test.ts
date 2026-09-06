/**
 * MK — as faturas abertas, fatura a fatura (fase 2 da cobranca).
 *
 * `WSMKFaturasPendentes` devolve VENCIDAS e A VENCER. A divida continua
 * somando so as vencidas (isso e o que mk-contratos.test.ts protege); o que
 * este arquivo cobre e o campo novo: cada fatura com data legivel vai em
 * `faturasAbertas`, com a referencia do MK, e a de quem esta em dia — que nao
 * entra na lista de inadimplentes — vai por documento em
 * `faturasDeClientesEmDia`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MkConnector, refDaFaturaMk, faturaAbertaDoMk } from "./mk";

const CONFIG = {
  apiUrl: "http://mk.local:8080/mk",
  apiToken: "token-de-teste",
  mkContraSenha: "contra-de-teste",
  extra: {},
} as any;

function cpfValido(n: number): string {
  const base = String(100000000 + n).padStart(9, "0");
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(base[i]) * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0;
  const b = base + d1;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(b[i]) * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0;
  return b + d2;
}

const cliente = (cd: number) => ({
  CodigoPessoa: cd,
  CPF_CNPJ: cpfValido(cd),
  Nome: `Cliente ${cd}`,
  Situacao: "Ativo",
  endereco: [{ tipo: "INSTALACAO", logradouro: "Rua Teste", numero: cd, bairro: "Centro", cidade: "Ibiporã", estado: "PR", cep: "86200000" }],
});

const ATIVO = (cd: number) => [{ codcontrato: cd * 10, status_contrato: "Ativo", plano_acesso: "Fibra 300", adesao: "2024-03-01" }];
const ok = (corpo: unknown) => ({ ok: true, status: 200, json: async () => corpo }) as any;
const naoExiste = () => ({ ok: false, status: 404, json: async () => ({}) }) as any;

const emDias = (n: number) => new Date(Date.now() + n * 86_400_000);
const dataBR = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const VENCIDA = emDias(-40);
const A_VENCER = emDias(10);
const A_VENCER_2 = emDias(5);

function servidorFake(faturas: (cd: string) => any) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    const cd = new URL(u).searchParams.get("cd_cliente") ?? "";
    if (u.includes("WSAutenticacao")) return ok({ Token: "sessao-fake" });
    if (u.includes("WSMKConsultaClientes")) {
      const ini = Number(new URL(u).searchParams.get("cd_cliente_inicio"));
      return ok({ Clientes: ini === 1 ? [cliente(1), cliente(2)] : [] });
    }
    if (u.includes("WSMKContratosPorClienteV2")) return ok(ATIVO(Number(cd)));
    if (u.includes("WSMKConexoesPorCliente")) return ok({ Conexoes: [] });
    if (u.includes("WSMKFaturasPendentes")) return faturas(cd);
    return naoExiste();
  });
}

let fetchOriginal: typeof globalThis.fetch;
beforeEach(() => { fetchOriginal = globalThis.fetch; });
afterEach(() => { globalThis.fetch = fetchOriginal; vi.restoreAllMocks(); });

describe("a referencia da fatura do MK", () => {
  it("e o codfatura quando o MK o manda — o nome visto na NsLink", () => {
    expect(refDaFaturaMk({ codfatura: 4471, valor_total: 100 }, "1", "2026-09-10", 100)).toBe("4471");
    expect(refDaFaturaMk({ CodFatura: " 12 " }, "1", "2026-09-10", 100)).toBe("12");
  });
  it("sem id nenhum, cai em cliente:vencimento:valor — documentado e reconhecivel entre varreduras", () => {
    expect(refDaFaturaMk({ valor_total: 100, data_vencimento: "10/09/2026" }, "77", "2026-09-10", 100)).toBe("77:2026-09-10:100.00");
  });
  it("fatura sem vencimento legivel nao vira fatura aberta", () => {
    expect(faturaAbertaDoMk({ codfatura: 1 }, "1", null, 50)).toBeNull();
    expect(faturaAbertaDoMk({ codfatura: 1 }, "1", "ontem", 50)).toBeNull();
    expect(faturaAbertaDoMk({ codfatura: 1, descricao: " Mensalidade " }, "1", "10/09/2026", 50))
      .toEqual({ ref: "1", vencimento: "2026-09-10", valor: 50, descricao: "Mensalidade" });
  });
});

describe("fetchDelinquents (v2) — faturasAbertas e faturasDeClientesEmDia", () => {
  it("o devedor leva todas as pendentes de data legivel; a divida segue so com as vencidas", async () => {
    globalThis.fetch = servidorFake(cd => ok({
      FaturasPendentes: cd === "1"
        ? [
          { codfatura: 11, valor_total: 100, data_vencimento: dataBR(VENCIDA) },
          { codfatura: 12, valor_total: 80, data_vencimento: dataBR(A_VENCER) },
          { codfatura: 13, valor_total: 50 },                          // sem data: fora de tudo
        ]
        : [{ codfatura: 21, valor_total: 90, data_vencimento: dataBR(A_VENCER_2) }],
    })) as any;

    const r = await new MkConnector().fetchDelinquents(CONFIG);

    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(1);
    expect(r.customers[0]).toMatchObject({
      cpfCnpj: cpfValido(1), totalOverdueAmount: 100, overdueInvoicesCount: 1,
    });
    expect(r.customers[0].faturasAbertas).toEqual([
      { ref: "11", vencimento: iso(VENCIDA), valor: 100, descricao: null },
      { ref: "12", vencimento: iso(A_VENCER), valor: 80, descricao: null },
    ]);

    // O cliente 2 nao deve: nao entra na lista, mas a mensalidade dele vai por documento.
    expect(r.faturasDeClientesEmDia).toEqual([
      { cpfCnpj: cpfValido(2), faturasAbertas: [{ ref: "21", vencimento: iso(A_VENCER_2), valor: 90, descricao: null }] },
    ]);
  });

  it("cliente sem fatura nenhuma nao aparece em lugar algum", async () => {
    globalThis.fetch = servidorFake(cd => ok({ FaturasPendentes: cd === "1" ? [{ codfatura: 11, valor_total: 100, data_vencimento: dataBR(VENCIDA) }] : [] })) as any;
    const r = await new MkConnector().fetchDelinquents(CONFIG);
    expect(r.customers.map(c => c.cpfCnpj)).toEqual([cpfValido(1)]);
    expect(r.faturasDeClientesEmDia).toEqual([]);
  });

  it("cliente nao lido nao vira 'sem fatura': continua em docsNaoLidos e fora dos em dia", async () => {
    globalThis.fetch = servidorFake(cd => cd === "2"
      ? ({ ok: false, status: 500, json: async () => ({}) }) as any
      : ok({ FaturasPendentes: [{ codfatura: 11, valor_total: 100, data_vencimento: dataBR(VENCIDA) }] })) as any;
    const r = await new MkConnector().fetchDelinquents(CONFIG);
    expect(r.docsNaoLidos).toEqual([cpfValido(2)]);
    expect(r.faturasDeClientesEmDia).toEqual([]);
  });
});

describe("consulta ao vivo — fetchCustomerByCpf", () => {
  it("traz as pendentes fatura a fatura, vencidas e a vencer", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("WSAutenticacao")) return ok({ Token: "sessao-fake" });
      if (u.includes("WSMKConsultaDoc")) return ok({ CodigoPessoa: 1, Nome: "Fulano", CPF_CNPJ: cpfValido(1), Situacao: "Ativo", status: "OK" });
      if (u.includes("WSMKConsultaClientes")) return ok([cliente(1)]);
      if (u.includes("WSMKFaturasPendentes")) {
        return ok({ FaturasPendentes: [
          { codfatura: 1, valor_total: 50 },
          { codfatura: 2, valor_total: 80, data_vencimento: dataBR(A_VENCER) },
          { codfatura: 3, valor_total: 120, data_vencimento: dataBR(VENCIDA) },
        ] });
      }
      if (u.includes("WSMKContratosPorClienteV2")) return ok(ATIVO(1));
      if (u.includes("WSMKConexoesPorCliente")) return ok({ Conexoes: [] });
      return naoExiste();
    }) as any;

    const r = await new MkConnector().fetchCustomerByCpf!(CONFIG, cpfValido(1));

    expect(r.ok).toBe(true);
    expect(r.customers[0]).toMatchObject({ overdueInvoicesCount: 1, totalOverdueAmount: 120 });
    expect(r.customers[0].faturasAbertas).toEqual([
      { ref: "2", vencimento: iso(A_VENCER), valor: 80, descricao: null },
      { ref: "3", vencimento: iso(VENCIDA), valor: 120, descricao: null },
    ]);
  });
});
