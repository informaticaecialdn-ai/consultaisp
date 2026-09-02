/**
 * A porteira da base: cadastro sem contrato NENHUM nao entra.
 *
 * Regra do dono (01/09/2026): "nao pode importar quem nao tem contrato
 * nenhum". Medido na NsLink em 28/08/2026, 560 dos 754 cadastros "Ativo" do MK
 * nao tinham contrato — lead, orcamento, cadastro vazio. Todos entravam em
 * `customers`: PII de quem nunca foi cliente e denominador de bairro inflado.
 *
 * So a V2 de contratos prova "nenhum contrato"; a V1 so conhece os ativos.
 * E "Inativo" no cadastro e evidencia de ex-cliente, que fica.
 *
 * Os dois ultimos blocos cobrem o que o bureau nao pode inventar: atraso de
 * fatura sem data, e "inadimplente" a partir de conexao bloqueada.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MkConnector, classificarContratos, cadastroSemContrato } from "./mk";

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

const cliente = (cd: number, extra: Record<string, unknown> = {}) => ({
  CodigoPessoa: cd,
  CPF_CNPJ: cpfValido(cd),
  Nome: `Cliente ${cd}`,
  Situacao: "Ativo",
  endereco: [{ tipo: "INSTALACAO", logradouro: "Rua Teste", numero: cd, bairro: "Centro", cidade: "Ibiporã", estado: "PR", cep: "86200000" }],
  ...extra,
});

const ATIVO = (cd: number) => [{ codcontrato: cd * 10, status_contrato: "Ativo", plano_acesso: "Fibra 300", adesao: "2024-03-01" }];
const CANCELADO = (cd: number) => [{ codcontrato: cd * 10, status_contrato: "Cancelado", plano_acesso: "Fibra 100" }];

const ok = (corpo: unknown) => ({ ok: true, status: 200, json: async () => corpo }) as any;
const naoExiste = () => ({ ok: false, status: 404, json: async () => ({}) }) as any;

const dataBR = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

/**
 * Um MK de mentira. `clientes` e a faixa 1; `v2`, `v1` e `conexoes` sao
 * respostas por codigo de cliente (funcao ou valor); `faturas` idem.
 */
function servidorFake(o: {
  clientes: any[];
  v2?: (cd: string) => any;
  v1?: (cd: string) => any;
  conexoes?: (cd: string) => any;
  faturas?: (cd: string) => any;
}) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    const cd = new URL(u).searchParams.get("cd_cliente") ?? "";
    if (u.includes("WSAutenticacao")) return ok({ Token: "sessao-fake" });
    if (u.includes("WSMKConsultaClientes")) {
      const ini = Number(new URL(u).searchParams.get("cd_cliente_inicio"));
      return ok({ Clientes: ini === 1 ? o.clientes : [] });
    }
    if (u.includes("WSMKContratosPorClienteV2")) return o.v2 ? o.v2(cd) : naoExiste();
    if (u.includes("WSMKContratosPorCliente")) return o.v1 ? o.v1(cd) : naoExiste();
    if (u.includes("WSMKConexoesPorCliente")) return o.conexoes ? o.conexoes(cd) : ok({ Conexoes: [] });
    if (u.includes("WSMKFaturasPendentes")) return o.faturas ? o.faturas(cd) : ok({ FaturasPendentes: [] });
    return naoExiste();
  });
}

let fetchOriginal: typeof globalThis.fetch;
beforeEach(() => { fetchOriginal = globalThis.fetch; });
afterEach(() => { globalThis.fetch = fetchOriginal; vi.restoreAllMocks(); });

describe("classificarContratos", () => {
  it("array direto com status_contrato: conta e classifica", () => {
    const r = classificarContratos([
      { codcontrato: 1, status_contrato: "Ativo", plano_acesso: "Fibra 300", adesao: "2024-03-01" },
      { codcontrato: 2, status_contrato: "Cancelado" },
    ]);
    expect(r).toMatchObject({ total: 2, ativos: 1, cancelados: 1, status: "active", plano: "Fibra 300", inicio: "2024-03-01" });
  });

  it("so cancelados e ex-cliente — nao 'sem contrato'", () => {
    expect(classificarContratos([{ codcontrato: 1, status_contrato: "Cancelado" }]))
      .toMatchObject({ total: 1, status: "cancelled" });
  });

  it("lista vazia e LEGIVEL: zero contratos", () => {
    expect(classificarContratos([])).toMatchObject({ total: 0, status: undefined });
    // `status: "OK"` na raiz e envelope bom, nao erro.
    expect(classificarContratos({ CodigoPessoa: 1, Nome: "X", status: "OK", ContratosAtivos: [] }))
      .toMatchObject({ total: 0 });
  });

  it("chaves separadas somam — cancelado numa segunda lista nao vira 'sem contrato'", () => {
    const r = classificarContratos({ ContratosAtivos: [], ContratosCancelados: [{ codcontrato: 5 }] });
    expect(r).toMatchObject({ total: 1, cancelados: 1, status: "cancelled" });
  });

  it("o mesmo contrato em duas chaves conta uma vez", () => {
    const r = classificarContratos({
      Contratos: [{ codcontrato: 1, status_contrato: "Ativo" }],
      ContratosAtivos: [{ codcontrato: 1 }],
    });
    expect(r).toMatchObject({ total: 1, ativos: 1 });
  });

  it("item sem campo de status herda o estado da chave", () => {
    expect(classificarContratos({ ContratosAtivos: [{ codcontrato: 1 }] })).toMatchObject({ status: "active" });
  });

  it("suspenso e reconhecido", () => {
    expect(classificarContratos([{ codcontrato: 1, status_contrato: "Suspenso" }])).toMatchObject({ status: "suspended" });
  });

  it("erro com HTTP 200 e corpo desconhecido NAO sao legiveis", () => {
    expect(classificarContratos({ CODIGO_ERRO: "004", Mensagem: "Pelo menos um parametro", status: "ERRO" })).toBeNull();
    expect(classificarContratos({ status: "ERRO" })).toBeNull();
    expect(classificarContratos({})).toBeNull();
    expect(classificarContratos({ Nome: "sem lista nenhuma" })).toBeNull();
    expect(classificarContratos(null)).toBeNull();
    expect(classificarContratos("texto")).toBeNull();
  });
});

describe("cadastroSemContrato — so a V2 prova 'nenhum contrato'", () => {
  const zero = { total: 0, ativos: 0, suspensos: 0, cancelados: 0, status: undefined } as const;
  it("V2 vazia com cadastro Ativo: sem contrato", () => {
    expect(cadastroSemContrato({ contratos: zero, fonte: "v2" }, "Ativo")).toBe(true);
  });
  it("V2 vazia com cadastro Inativo: ex-cliente, fica", () => {
    expect(cadastroSemContrato({ contratos: zero, fonte: "v2" }, "Inativo")).toBe(false);
  });
  it("V1 vazia nao prova nada — so conhece os ativos", () => {
    expect(cadastroSemContrato({ contratos: zero, fonte: "v1" }, "Ativo")).toBe(false);
  });
  it("com contrato, ou sem leitura, nao fecha", () => {
    expect(cadastroSemContrato({ contratos: { ...zero, total: 1, cancelados: 1, status: "cancelled" }, fonte: "v2" }, "Ativo")).toBe(false);
    expect(cadastroSemContrato(null, "Ativo")).toBe(false);
  });
});

describe("porteira na varredura da carteira", () => {
  it("cadastro sem contrato nenhum nao entra; ex-cliente entra como cancelado", async () => {
    globalThis.fetch = servidorFake({
      clientes: [cliente(1), cliente(2), cliente(3)],
      v2: cd => ok(cd === "1" ? ATIVO(1) : cd === "3" ? CANCELADO(3) : []),
    }) as any;

    const r = await new MkConnector().fetchCustomers(CONFIG);

    expect(r.ok).toBe(true);
    expect(r.customers.map(c => c.cpfCnpj).sort()).toEqual([cpfValido(1), cpfValido(3)].sort());
    expect(r.customers.find(c => c.cpfCnpj === cpfValido(1))).toMatchObject({
      contractStatus: "active", contractPlan: "Fibra 300", contractStartDate: "2024-03-01",
    });
    expect(r.customers.find(c => c.cpfCnpj === cpfValido(3))?.contractStatus).toBe("cancelled");
    expect(r.message).toMatch(/1 sem contrato ignorados/);
  });

  it("Inativo sem contrato na V2 fica — o cadastro e evidencia de ex-cliente", async () => {
    globalThis.fetch = servidorFake({
      clientes: [cliente(4, { Situacao: "Inativo" })],
      v2: () => ok([]),
    }) as any;

    const r = await new MkConnector().fetchCustomers(CONFIG);

    expect(r.customers).toHaveLength(1);
    expect(r.customers[0].contractStatus).toBe("cancelled");
  });

  it("V2 inexistente cai na V1 — e ai a porteira nao fecha, porque a V1 nao prova nada", async () => {
    globalThis.fetch = servidorFake({
      clientes: [cliente(1), cliente(2)],
      v1: cd => ok({ ContratosAtivos: cd === "1" ? [{ codcontrato: 10, plano_acesso: "Fibra 300" }] : [] }),
    }) as any;

    const r = await new MkConnector().fetchCustomers(CONFIG);

    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(2);
    expect(r.customers.find(c => c.cpfCnpj === cpfValido(1))?.contractStatus).toBe("active");
    expect(r.customers.find(c => c.cpfCnpj === cpfValido(2))?.contractStatus).toBe("cancelled");
  });

  it("nenhuma resposta de contrato: nao importa ninguem e avisa — nao abre a porteira as cegas", async () => {
    globalThis.fetch = servidorFake({
      clientes: [cliente(1), cliente(2)],
      v2: () => ({ ok: false, status: 500, json: async () => ({}) }) as any,
      v1: () => ({ ok: false, status: 500, json: async () => ({}) }) as any,
    }) as any;

    const r = await new MkConnector().fetchCustomers(CONFIG);

    expect(r.ok).toBe(false);
    expect(r.customers).toHaveLength(0);
    expect(r.message).toMatch(/nao respondeu/);
  });
});

describe("porteira nos inadimplentes", () => {
  const ontem = dataBR(new Date(Date.now() - 40 * 86_400_000));
  const vencida = () => ok({ FaturasPendentes: [{ codfatura: 1, valor_total: 100, data_vencimento: ontem }] });

  it("lead com fatura vencida nao entra — fatura sem contrato nao e divida de cliente", async () => {
    globalThis.fetch = servidorFake({
      clientes: [cliente(1), cliente(2)],
      v2: cd => ok(cd === "1" ? ATIVO(1) : []),
      faturas: () => vencida(),
    }) as any;

    const r = await new MkConnector().fetchDelinquents(CONFIG);

    expect(r.ok).toBe(true);
    expect(r.customers.map(c => c.cpfCnpj)).toEqual([cpfValido(1)]);
    expect(r.message).toMatch(/1 sem contrato ignorados/);
  });

  it("conexao bloqueada vira suspenso; sem bloqueio fica ativo", async () => {
    globalThis.fetch = servidorFake({
      clientes: [cliente(1), cliente(3)],
      v2: cd => ok(ATIVO(Number(cd))),
      faturas: () => vencida(),
      conexoes: cd => ok({ Conexoes: [{ codconexao: 7, bloqueada: cd === "1" ? "Sim" : "Não" }] }),
    }) as any;

    const r = await new MkConnector().fetchDelinquents(CONFIG);

    expect(r.customers.find(c => c.cpfCnpj === cpfValido(1))?.contractStatus).toBe("suspended");
    expect(r.customers.find(c => c.cpfCnpj === cpfValido(3))?.contractStatus).toBe("active");
  });

  it("endereco de INSTALACAO vence o de cobranca, e traz a coordenada", async () => {
    globalThis.fetch = servidorFake({
      clientes: [cliente(1, {
        endereco: [
          { tipo: "COBRANCA", logradouro: "Av. Escritorio", bairro: "Centro", cidade: "Londrina" },
          { tipo: "INSTALACAO", logradouro: "Rua da Casa", numero: 12, bairro: "Jardim Pérola", cidade: "Ibiporã", latitude: "-23.1", longitude: "-51.0" },
        ],
      })],
      v2: () => ok(ATIVO(1)),
      faturas: () => vencida(),
    }) as any;

    const r = await new MkConnector().fetchDelinquents(CONFIG);

    expect(r.customers[0]).toMatchObject({
      address: "Rua da Casa", neighborhood: "Jardim Pérola", city: "Ibiporã", latitude: "-23.1", longitude: "-51.0",
    });
  });
});

describe("consulta ao vivo nao inventa atraso", () => {
  it("fatura sem data e fatura a vencer nao contam; bloqueio vira suspenso, nao divida", async () => {
    const aVencer = dataBR(new Date(Date.now() + 10 * 86_400_000));
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("WSAutenticacao")) return ok({ Token: "sessao-fake" });
      if (u.includes("WSMKConsultaDoc")) return ok({ CodigoPessoa: 1, Nome: "Fulano", CPF_CNPJ: cpfValido(1), Situacao: "Ativo", status: "OK" });
      if (u.includes("WSMKConsultaClientes")) return ok([cliente(1)]);
      if (u.includes("WSMKFaturasPendentes")) {
        return ok({ FaturasPendentes: [
          { codfatura: 1, valor_total: 50 },                          // sem data: ninguem sabe se venceu
          { codfatura: 2, valor_total: 80, data_vencimento: aVencer }, // a mensalidade do mes, no prazo
        ] });
      }
      if (u.includes("WSMKContratosPorClienteV2")) return ok(ATIVO(1));
      if (u.includes("WSMKConexoesPorCliente")) return ok({ Conexoes: [{ codconexao: 7, bloqueada: "Sim", motivo_bloqueio: "Solicitacao" }] });
      return naoExiste();
    }) as any;

    const r = await new MkConnector().fetchCustomerByCpf!(CONFIG, cpfValido(1));

    expect(r.ok).toBe(true);
    expect(r.customers[0]).toMatchObject({
      overdueInvoicesCount: 0, totalOverdueAmount: 0, maxDaysOverdue: 0, contractStatus: "suspended",
    });
    expect(r.message).toMatch(/sem inadimplencia/);
    expect(r.message).toMatch(/1 fatura\(s\) sem data/);
  });
});
