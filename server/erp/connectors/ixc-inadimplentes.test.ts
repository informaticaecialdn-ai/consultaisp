/**
 * IXC — quem realmente deve.
 *
 * A fatura (`fn_areceber`) nao carrega CPF nem nome: `documento` e o numero do
 * boleto. Ate 01/09/2026 `fetchDelinquents` lia o documento DA FATURA, e desde
 * que numero de boleto deixou de passar por CPF (29/08) ela devolvia ZERO
 * inadimplentes ativos com `ok: true` — e o sync, lendo a lista curta como
 * completa, baixava a divida de quem estava gravado como devedor. O CPF tem de
 * vir do cadastro, em lote.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IxcConnector } from "./ixc";

const CONFIG = { apiUrl: "https://ixc.local", apiUser: "45", apiToken: "token", extra: {} } as any;

const iso = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

type Tabelas = Record<string, (body: any) => any[] | "falha">;

/** Um IXC de mentira: POST /webservice/v1/<tabela>, envelope {page,total,registros}. */
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

const CPF_7 = "041.179.829-40";
const CPF_8 = "529.982.247-25";
const CPF_9 = "111.444.777-35";

const base: Tabelas = {
  fn_areceber: () => [
    { id: "11497310", id_cliente: "7", status: "A", liberado: "S", data_vencimento: iso(-200), valor: "122.68", documento: "11497310" },
    { id: "11497290", id_cliente: "7", status: "A", liberado: "S", data_vencimento: iso(-30), valor: "100.00", documento: "11497290" },
    { id: "3", id_cliente: "8", status: "A", liberado: "S", data_vencimento: iso(15), valor: "50.00" }, // a vencer
    { id: "4", id_cliente: "9", status: "A", liberado: "S", data_vencimento: iso(-500), valor: "30.00" },
  ],
  cliente: () => [
    { id: "7", razao: "Maria", cnpj_cpf: CPF_7, cidade: "4101", bairro: "Centro", endereco: "RUA X, 10", cep: "86200-000" },
    { id: "8", razao: "Joao", cnpj_cpf: CPF_8, cidade: "4101" },
    { id: "9", razao: "Lead sem contrato", cnpj_cpf: CPF_9, cidade: "4101" },
  ],
  cidade: () => [{ id: "4101", nome: "Londrina", uf: "18" }],
  uf: () => [{ id: "18", uf: "PR" }],
  cliente_contrato: () => [
    { id: "1", id_cliente: "7", status: "A", status_internet: "FA", contrato: "Fibra 300", data_ativacao: "2022-01-01" },
    { id: "2", id_cliente: "8", status: "A", status_internet: "A", contrato: "Fibra 100" },
  ],
};

let fetchOriginal: typeof globalThis.fetch;
beforeEach(() => { fetchOriginal = globalThis.fetch; });
afterEach(() => { globalThis.fetch = fetchOriginal; vi.restoreAllMocks(); });

describe("fetchDelinquents — o CPF vem do cadastro, em lote", () => {
  it("devolve o devedor ativo com CPF, cidade resolvida e contrato", async () => {
    const { fetchFake, chamadas } = servidorIxc(base);
    globalThis.fetch = fetchFake as any;

    const r = await new IxcConnector().fetchDelinquents(CONFIG);

    expect(r.ok).toBe(true);
    // 7 deve (duas vencidas); 8 so tem fatura a vencer; 9 nao tem contrato.
    expect(r.customers).toHaveLength(1);
    expect(r.customers[0]).toMatchObject({
      cpfCnpj: "04117982940", name: "Maria", city: "Londrina", state: "PR",
      totalOverdueAmount: 222.68, overdueInvoicesCount: 2,
      contractStatus: "suspended", contractPlan: "Fibra 300", contractStartDate: "2022-01-01",
    });
    expect(r.customers[0].maxDaysOverdue).toBeGreaterThanOrEqual(199);
    expect(r.message).toMatch(/1 sem contrato ignorados/);

    // O cadastro veio em LOTE: uma pagina, nao uma requisicao por cliente.
    expect(chamadas.filter(c => c.tabela === "cliente")).toHaveLength(1);
    // E a fatura em aberto exige `liberado = S` — filtro que veio do Provedor.ai.
    const filtro = JSON.parse(chamadas.find(c => c.tabela === "fn_areceber")!.body.grid_param);
    expect(filtro).toEqual(expect.arrayContaining([
      expect.objectContaining({ TB: "fn_areceber.status", P: "A" }),
      expect.objectContaining({ TB: "fn_areceber.liberado", P: "S" }),
    ]));
  });

  it("sem a tabela de contratos, nao fecha a porteira nem afirma status", async () => {
    const { fetchFake } = servidorIxc({ ...base, cliente_contrato: () => "falha" });
    globalThis.fetch = fetchFake as any;

    const r = await new IxcConnector().fetchDelinquents(CONFIG);

    expect(r.ok).toBe(true);
    // Sem prova de "nenhum contrato", o 9 entra; e ninguem ganha status.
    expect(r.customers.map(c => c.cpfCnpj).sort()).toEqual(["04117982940", "11144477735"]);
    expect(r.customers.every(c => c.contractStatus === undefined)).toBe(true);
  });

  it("devedor cujo cadastro nao veio nao some em silencio — vira leitura falha", async () => {
    const { fetchFake } = servidorIxc({ ...base, cliente: () => [] });
    globalThis.fetch = fetchFake as any;

    const r = await new IxcConnector().fetchDelinquents(CONFIG);

    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(0);
    // Dois devedores sem cadastro: o sync nao pode baixar divida com essa lista.
    expect(r.leiturasFalhas).toBe(2);
  });
});

describe("fetchCustomers — a carteira inteira, com status e sem lead", () => {
  it("cadastro sem contrato nenhum nao entra; os outros ganham o status do contrato", async () => {
    const { fetchFake } = servidorIxc(base);
    globalThis.fetch = fetchFake as any;

    const r = await new IxcConnector().fetchCustomers(CONFIG);

    expect(r.ok).toBe(true);
    expect(r.customers.map(c => c.cpfCnpj).sort()).toEqual(["04117982940", "52998224725"]);
    expect(r.customers.find(c => c.cpfCnpj === "04117982940")?.contractStatus).toBe("suspended");
    expect(r.customers.find(c => c.cpfCnpj === "52998224725")?.contractStatus).toBe("active");
    expect(r.message).toMatch(/1 sem contrato ignorados/);
  });
});
