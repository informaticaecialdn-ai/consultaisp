/**
 * MK — a identificacao da instalacao (login, MAC, serial da ONU).
 *
 * O conector ja chamava `WSMKConexoesPorCliente` e lia so `bloqueada`; o MAC
 * vinha junto e ia para o lixo, e o MK — o ERP do provedor de homologacao —
 * era o unico dos tres sem identificacao tecnica no Cliente 360.
 *
 * As respostas abaixo tem a forma exata que o MK da NsLink devolveu na sonda de
 * 06/09/2026 (`script/probe-mk-conexoes.ts`), com MAC e login mascarados.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MkConnector } from "./mk";

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

const ok = (corpo: unknown) => ({ ok: true, status: 200, json: async () => corpo }) as any;
const naoExiste = () => ({ ok: false, status: 404, json: async () => ({}) }) as any;

const emDias = (n: number) => new Date(Date.now() + n * 86_400_000);
const dataBR = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const VENCIDA = emDias(-40);

const cliente = (cd: number) => ({
  CodigoPessoa: cd,
  CPF_CNPJ: cpfValido(cd),
  Nome: `Cliente ${cd}`,
  Situacao: "Ativo",
  endereco: [{ tipo: "INSTALACAO", logradouro: "Rua Teste", numero: cd, bairro: "Centro", cidade: "Ibiporã", estado: "PR", cep: "86200000" }],
});
const ATIVO = (cd: number) => [{ codcontrato: cd * 10, status_contrato: "Ativo", plano_acesso: "Fibra 300", adesao: "2024-03-01" }];

/** A conexao FTTH da resposta real: sem IP, sem sessao, serial colado no login. */
const CONEXAO_FTTH = {
  bloqueada: "Não",
  cadastro: "2025-12-27",
  cep: "86200000",
  codconexao: 2721,
  contrato: 1958,
  endereco: "Rua Teste, 1 - Centro",
  esta_reduzida: "Não",
  latitude: "",
  longitude: "",
  mac_address: "64:db:f7:ed:1d:24",
  motivo_bloqueio: null,
  tecnologia: "Ftth",
  username: "ALCLFC65623D-000",
};

/**
 * Servidor fake do MK. `conexoes` decide o que `WSMKConexoesPorCliente`
 * responde; tudo o mais e o minimo para o cliente existir e dever.
 */
function servidorFake(conexoes: (cd: string) => any) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    const cd = new URL(u).searchParams.get("cd_cliente") ?? "";
    if (u.includes("WSAutenticacao")) return ok({ Token: "sessao-fake" });
    if (u.includes("WSMKConsultaDoc")) return ok({ CodigoPessoa: 1, Nome: "Cliente 1", CPF_CNPJ: cpfValido(1), Situacao: "Ativo", status: "OK" });
    if (u.includes("WSMKConsultaClientes")) {
      const ini = new URL(u).searchParams.get("cd_cliente_inicio");
      if (ini !== null) return ok({ Clientes: Number(ini) === 1 ? [cliente(1)] : [] });
      return ok([cliente(1)]);
    }
    if (u.includes("WSMKContratosPorClienteV2")) return ok(ATIVO(Number(cd || 1)));
    if (u.includes("WSMKConexoesPorCliente")) return conexoes(cd);
    if (u.includes("WSMKFaturasPendentes")) return ok({ FaturasPendentes: [{ codfatura: 11, valor_total: 100, data_vencimento: dataBR(VENCIDA) }] });
    return naoExiste();
  });
}

const chamadasDeConexao = () =>
  (globalThis.fetch as any).mock.calls.filter((c: any[]) => String(c[0]).includes("WSMKConexoesPorCliente")).length;

let fetchOriginal: typeof globalThis.fetch;
beforeEach(() => { fetchOriginal = globalThis.fetch; });
afterEach(() => { globalThis.fetch = fetchOriginal; vi.restoreAllMocks(); });

describe("consulta ao vivo — a instalacao do cliente", () => {
  it("devolve login, MAC e serial da ONU numa unica leitura de conexoes", async () => {
    globalThis.fetch = servidorFake(() => ok({ CodigoPessoa: 1, Nome: "Cliente 1", status: "OK", Conexoes: [CONEXAO_FTTH] })) as any;

    const r = await new MkConnector().fetchCustomerByCpf!(CONFIG, cpfValido(1));

    expect(r.customers[0].autenticacoes).toEqual([
      { login: "ALCLFC65623D-000", mac: "64DBF7ED1D24", ip: null, contrato: "1958", serial: "ALCLFC65623D", online: null, bloqueada: false, fonte: "mk" },
    ]);
    // O bloqueio e a identificacao saem do MESMO fetch — nao uma requisicao por leitura.
    expect(chamadasDeConexao()).toBe(1);
  });

  it("conexao bloqueada suspende o contrato e NAO vira 'offline'", async () => {
    globalThis.fetch = servidorFake(() => ok({ Conexoes: [{ ...CONEXAO_FTTH, bloqueada: "Sim", motivo_bloqueio: "Falta de pagamento" }] })) as any;

    const r = await new MkConnector().fetchCustomerByCpf!(CONFIG, cpfValido(1));

    expect(r.customers[0].contractStatus).toBe("suspended");
    expect(r.customers[0].autenticacoes?.[0]).toMatchObject({ bloqueada: true, online: null, ip: null });
  });

  it("a ONU em uso nao entra no inventario de equipamento retido", async () => {
    globalThis.fetch = servidorFake(() => ok({ Conexoes: [CONEXAO_FTTH] })) as any;

    const r = await new MkConnector().fetchCustomerByCpf!(CONFIG, cpfValido(1));

    expect(r.customers[0].equipmentDetails).toBeUndefined();
    expect(r.customers[0].hasUnreturnedEquipment).toBeUndefined();
  });

  it("cliente sem conexao e MK que nao respondeu ficam os dois em 'nao informado', nunca lista vazia", async () => {
    globalThis.fetch = servidorFake(() => ok({ CodigoPessoa: 1, Conexoes: [], status: "OK" })) as any;
    const semConexao = await new MkConnector().fetchCustomerByCpf!(CONFIG, cpfValido(1));
    expect(semConexao.customers[0].autenticacoes).toBeUndefined();
    expect(semConexao.customers[0].contractStatus).toBe("active");

    globalThis.fetch = servidorFake(() => ok({ status: "ERRO", CODIGO_ERRO: 7 })) as any;
    const erro200 = await new MkConnector().fetchCustomerByCpf!(CONFIG, cpfValido(1));
    expect(erro200.customers[0].autenticacoes).toBeUndefined();
    // Erro nao vira "liberada": o contrato segue como o endpoint de contratos disse.
    expect(erro200.customers[0].contractStatus).toBe("active");

    globalThis.fetch = servidorFake(() => naoExiste()) as any;
    const semResposta = await new MkConnector().fetchCustomerByCpf!(CONFIG, cpfValido(1));
    expect(semResposta.customers[0].autenticacoes).toBeUndefined();
  });

  it("MAC ilegivel some sozinho; o login continua identificando o servico", async () => {
    globalThis.fetch = servidorFake(() => ok({ Conexoes: [{ ...CONEXAO_FTTH, mac_address: "00:00:00:00:00:00" }] })) as any;

    const r = await new MkConnector().fetchCustomerByCpf!(CONFIG, cpfValido(1));

    expect(r.customers[0].autenticacoes?.[0]).toMatchObject({ mac: null, login: "ALCLFC65623D-000", serial: "ALCLFC65623D" });
  });
});

describe("varredura de inadimplentes — a instalacao vai junto", () => {
  it("o devedor leva a identificacao da conexao lida para decidir o corte", async () => {
    globalThis.fetch = servidorFake(() => ok({ Conexoes: [CONEXAO_FTTH] })) as any;

    const r = await new MkConnector().fetchDelinquents(CONFIG);

    expect(r.customers).toHaveLength(1);
    expect(r.customers[0].autenticacoes).toEqual([
      { login: "ALCLFC65623D-000", mac: "64DBF7ED1D24", ip: null, contrato: "1958", serial: "ALCLFC65623D", online: null, bloqueada: false, fonte: "mk" },
    ]);
    expect(chamadasDeConexao()).toBe(1);
  });
});
