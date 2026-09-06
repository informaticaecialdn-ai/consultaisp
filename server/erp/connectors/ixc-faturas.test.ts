/**
 * IXC — as faturas abertas, fatura a fatura (fase 2 da cobranca).
 *
 * `fn_areceber` e lido em bloco e nao carrega CPF: a fatura chega ao cliente
 * por `id_cliente`, o mesmo casamento que a divida ja usa. `ref` e o `id` da
 * fatura no IXC. A carteira inteira (`fetchCustomers`) tambem le as faturas,
 * porque e por ela que a mensalidade a vencer de quem esta em dia chega —
 * e quando essa leitura falha a resposta diz `faturasNaoLidas`, para o sync
 * nao tomar "sem fatura" por prova.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IxcConnector, faturasAbertasPorCliente } from "./ixc";

const CONFIG = { apiUrl: "https://ixc.local", apiUser: "45", apiToken: "token", extra: {} } as any;

const emDias = (n: number) => new Date(Date.now() + n * 86_400_000);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Tabelas = Record<string, (body: any) => any[] | "falha">;

function servidorIxc(tabelas: Tabelas) {
  const chamadas: Array<{ tabela: string; body: any }> = [];
  const fetchFake = vi.fn(async (url: string, init?: any) => {
    const tabela = String(url).split("/webservice/v1/")[1] ?? "";
    const body = init?.body ? JSON.parse(init.body) : {};
    chamadas.push({ tabela, body });
    const h = tabelas[tabela];
    const registros = h ? h(body) : [];
    if (registros === "falha") {
      return { ok: false, status: 500, text: async () => "erro", json: async () => ({}) } as any;
    }
    return { ok: true, status: 200, json: async () => ({ page: "1", total: String(registros.length), registros }) } as any;
  });
  return { fetchFake, chamadas };
}

const VENCIDA_200 = emDias(-200);
const VENCIDA_30 = emDias(-30);
const A_VENCER = emDias(15);

const base: Tabelas = {
  fn_areceber: () => [
    { id: "11497310", id_cliente: "7", status: "A", liberado: "S", data_vencimento: iso(VENCIDA_200), valor: "122.68", documento: "11497310" },
    { id: "11497290", id_cliente: "7", status: "A", liberado: "S", data_vencimento: iso(VENCIDA_30), valor: "100.00", obs: "Mensalidade" },
    { id: "3", id_cliente: "8", status: "A", liberado: "S", data_vencimento: iso(A_VENCER), valor: "50.00" },
    { id: "4", id_cliente: "8", status: "A", liberado: "S", data_vencimento: "", valor: "10.00" },  // sem data: fora
    { id: "", id_cliente: "8", status: "A", liberado: "S", data_vencimento: iso(A_VENCER), valor: "10.00" }, // sem id: fora
  ],
  cliente: () => [
    { id: "7", razao: "Maria", cnpj_cpf: "041.179.829-40", cidade: "4101" },
    { id: "8", razao: "Joao", cnpj_cpf: "529.982.247-25", cidade: "4101" },
  ],
  cidade: () => [{ id: "4101", nome: "Londrina", uf: "18" }],
  uf: () => [{ id: "18", uf: "PR" }],
  cliente_contrato: () => [
    { id: "1", id_cliente: "7", status: "A", status_internet: "FA", contrato: "Fibra 300" },
    { id: "2", id_cliente: "8", status: "A", status_internet: "A", contrato: "Fibra 100" },
  ],
};

let fetchOriginal: typeof globalThis.fetch;
beforeEach(() => { fetchOriginal = globalThis.fetch; });
afterEach(() => { globalThis.fetch = fetchOriginal; vi.restoreAllMocks(); });

describe("faturasAbertasPorCliente", () => {
  it("agrupa por id_cliente, com o id da fatura como ref e o mesmo valor que a divida soma", () => {
    const m = faturasAbertasPorCliente(base.fn_areceber({}) as any[]);
    expect(m.get("7")).toEqual([
      { ref: "11497310", vencimento: iso(VENCIDA_200), valor: 122.68, descricao: null },
      { ref: "11497290", vencimento: iso(VENCIDA_30), valor: 100, descricao: "Mensalidade" },
    ]);
    // A vencer entra; sem data e sem id ficam de fora.
    expect(m.get("8")).toEqual([{ ref: "3", vencimento: iso(A_VENCER), valor: 50, descricao: null }]);
  });
  it("valor_original e a reserva quando valor nao vem", () => {
    const m = faturasAbertasPorCliente([{ id: "9", id_cliente: "1", data_vencimento: "2026-09-10", valor_original: "33.30" }]);
    expect(m.get("1")).toEqual([{ ref: "9", vencimento: "2026-09-10", valor: 33.3, descricao: null }]);
  });
});

describe("fetchDelinquents", () => {
  it("o devedor leva as faturas dele, das mesmas linhas que a divida leu", async () => {
    globalThis.fetch = servidorIxc(base).fetchFake as any;
    const r = await new IxcConnector().fetchDelinquents(CONFIG);
    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(1);
    expect(r.customers[0]).toMatchObject({ cpfCnpj: "04117982940", totalOverdueAmount: 222.68, overdueInvoicesCount: 2 });
    expect(r.customers[0].faturasAbertas?.map(f => f.ref)).toEqual(["11497310", "11497290"]);
  });
});

describe("fetchCustomers — a carteira inteira com as faturas em aberto", () => {
  it("quem esta em dia leva a mensalidade a vencer; uma leitura a mais de fn_areceber", async () => {
    const { fetchFake, chamadas } = servidorIxc(base);
    globalThis.fetch = fetchFake as any;
    const r = await new IxcConnector().fetchCustomers(CONFIG);
    expect(r.ok).toBe(true);
    expect(r.faturasNaoLidas).toBeUndefined();
    const joao = r.customers.find(c => c.cpfCnpj === "52998224725")!;
    expect(joao.totalOverdueAmount).toBe(0);
    expect(joao.faturasAbertas).toEqual([{ ref: "3", vencimento: iso(A_VENCER), valor: 50, descricao: null }]);
    const maria = r.customers.find(c => c.cpfCnpj === "04117982940")!;
    expect(maria.faturasAbertas?.map(f => f.ref)).toEqual(["11497310", "11497290"]);
    expect(chamadas.filter(c => c.tabela === "fn_areceber")).toHaveLength(1);
    // Fatura em aberto = status A e liberada, o mesmo filtro da divida.
    const filtro = JSON.parse(chamadas.find(c => c.tabela === "fn_areceber")!.body.grid_param);
    expect(filtro).toEqual(expect.arrayContaining([
      expect.objectContaining({ TB: "fn_areceber.status", P: "A" }),
      expect.objectContaining({ TB: "fn_areceber.liberado", P: "S" }),
    ]));
  });

  it("fn_areceber fora do ar: a carteira vem, sem fatura, e a resposta avisa faturasNaoLidas", async () => {
    globalThis.fetch = servidorIxc({ ...base, fn_areceber: () => "falha" }).fetchFake as any;
    const r = await new IxcConnector().fetchCustomers(CONFIG);
    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(2);
    expect(r.customers.every(c => c.faturasAbertas === undefined)).toBe(true);
    expect(r.faturasNaoLidas).toBe(true);
  });
});
