/**
 * SGP — as faturas abertas, titulo a titulo (fase 2 da cobranca).
 *
 * A Amplinet, em producao, usa SGP: sem isto a faixa do mes fica em "—" para
 * ela. O conector ja pagina `/api/ura/titulos/` com `status=abertos`; o que
 * este arquivo cobre e o campo novo — cada titulo aberto de data legivel vai
 * em `faturasAbertas` (vencido E a vencer), com o `id` do titulo como
 * referencia e o valor em aberto pela mesma conta da divida; quem so tem
 * fatura a vencer vai por documento em `faturasDeClientesEmDia`.
 *
 * Regra do dono (04/09/2026): nada se deriva de titulo cancelado/anulado —
 * so `status=abertos`. O SGP de mentira aqui e o mesmo de sgp.test.ts: so
 * conhece os caminhos da colecao Postman.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SgpConnector } from "./sgp";

const CONFIG = {
  apiUrl: "https://provedor.sgp.net.br",
  apiToken: "tok-123",
  extra: { sgpApp: "consultaisp" },
} as any;

const CPF_A = "04117982940";
const CPF_B = "52998224725";

const iso = (dias: number) => {
  const d = new Date(Date.now() + dias * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const CAMINHOS_REAIS = ["/api/ura/consultacliente/", "/api/ura/titulos/", "/api/ura/listacontrato/", "/api/ura/clientes/"];

type Rota = (params: URLSearchParams) => { status?: number; corpo?: unknown };

function servidorSgp(rotas: Record<string, Rota>) {
  const chamadas: Array<{ caminho: string; params: URLSearchParams }> = [];
  const fetchFake = vi.fn(async (url: string, init?: any) => {
    const caminho = new URL(String(url)).pathname;
    if (!CAMINHOS_REAIS.includes(caminho)) throw new Error(`O SGP nao tem esse endpoint: ${caminho}`);
    const params = new URLSearchParams(String(init?.body ?? ""));
    chamadas.push({ caminho, params });
    const r = rotas[caminho];
    const { status = 200, corpo = {} } = r ? r(params) : {};
    return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  });
  return { fetchFake, chamadas };
}

/** Um titulo no formato exato de /api/ura/titulos/ — o `id` e o da doc. */
const titulo = (id: number | undefined, cpf: string, nome: string, valor: number, vencimento: string, extra: Record<string, unknown> = {}) => ({
  ...(id === undefined ? {} : { id }),
  clienteNome: nome,
  clienteCpfcnpj: cpf,
  clienteContrato: 1302,
  status: "aberto",
  valor,
  valorCorrigido: valor * 1.3,
  valorPago: 0,
  valorPagoParcial: 0,
  dataVencimento: vencimento,
  ...extra,
});

const envelopeTitulos = (titulos: unknown[]) => ({
  paginacao: { offset: 0, limit: 250, parcial: titulos.length, total: titulos.length },
  titulos,
});

const contrato = (cpf: string) => ({
  clienteId: 2827, contratoId: 1302, cpfCnpj: cpf, razaoSocial: "MARIA DA SILVA",
  contratoStatus: 1, contratoStatusDisplay: " Ativo ", dataCadastro: "20/03/2024 11:43:25",
  planointernet: "Plano Empresarial 150 Mega", emails: [], telefones: [],
  endereco_logradouro: "RUA DAS FLORES", endereco_numero: 100, endereco_bairro: "CENTRO",
  endereco_cidade: "MANDAGUARI", endereco_uf: "PR", endereco_cep: "86975-000",
});

let fetchOriginal: typeof globalThis.fetch;
beforeEach(() => { fetchOriginal = globalThis.fetch; });
afterEach(() => { globalThis.fetch = fetchOriginal; vi.restoreAllMocks(); });

function montar(rotas: Record<string, Rota>) {
  const { fetchFake, chamadas } = servidorSgp(rotas);
  globalThis.fetch = fetchFake as any;
  return { conector: new SgpConnector(), chamadas, fetchFake };
}

describe("SGP · fetchDelinquents — faturasAbertas e faturasDeClientesEmDia", () => {
  it("o devedor leva os titulos abertos dele, vencidos e a vencer, com o id do titulo e o valor em aberto", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([
        titulo(9001, CPF_A, "MARIA", 100, iso(-30), { valorPagoParcial: 40 }), // vencida, 60 em aberto
        titulo(9002, CPF_A, "MARIA", 80, iso(12)),                             // a vencer
        titulo(9003, CPF_A, "MARIA", 50, iso(-60), { valorPago: 50 }),         // quitada: sai
        titulo(9004, CPF_A, "MARIA", 70, ""),                                  // sem data: sai
        titulo(9005, CPF_A, "MARIA", 90, iso(-5), { status: "cancelado" }),    // cancelado: NUNCA
      ]) }),
      "/api/ura/listacontrato/": () => ({ corpo: [] }),
    });

    const r = await conector.fetchDelinquents(CONFIG);

    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(1);
    // A divida nao mudou: so a vencida, pelo principal menos o pago.
    expect(r.customers[0]).toMatchObject({ cpfCnpj: CPF_A, overdueInvoicesCount: 1 });
    expect(r.customers[0].totalOverdueAmount).toBeCloseTo(60, 2);
    expect(r.customers[0].faturasAbertas).toEqual([
      { ref: "9001", vencimento: iso(-30), valor: 60, descricao: null },
      { ref: "9002", vencimento: iso(12), valor: 80, descricao: null },
    ]);
    expect(r.faturasDeClientesEmDia).toEqual([]);
  });

  it("quem so tem titulo a vencer nao e inadimplente — vai por documento", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([
        titulo(1, CPF_A, "MARIA", 100, iso(-30)),
        titulo(2, CPF_B, "JOAO", 99.9, iso(15), { descricao: "Mensalidade 09/2026" }),
      ]) }),
      "/api/ura/listacontrato/": () => ({ corpo: [] }),
    });

    const r = await conector.fetchDelinquents(CONFIG);

    expect(r.customers.map(c => c.cpfCnpj)).toEqual([CPF_A]);
    expect(r.faturasDeClientesEmDia).toEqual([
      { cpfCnpj: CPF_B, faturasAbertas: [{ ref: "2", vencimento: iso(15), valor: 99.9, descricao: "Mensalidade 09/2026" }] },
    ]);
  });

  it("titulo sem id ganha a referencia de reserva cpf:vencimento:valor", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([titulo(undefined, CPF_A, "MARIA", 100, iso(-30))]) }),
      "/api/ura/listacontrato/": () => ({ corpo: [] }),
    });
    const r = await conector.fetchDelinquents(CONFIG);
    expect(r.customers[0].faturasAbertas?.[0].ref).toBe(`${CPF_A}:${iso(-30)}:100.00`);
  });

  it("a janela de vencimento vai ate um ano a frente, para a fatura a vencer entrar — e continua so status=abertos", async () => {
    const { conector, chamadas } = montar({
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([]) }),
      "/api/ura/listacontrato/": () => ({ corpo: [] }),
    });
    await conector.fetchDelinquents(CONFIG);
    const p = chamadas.find(c => c.caminho === "/api/ura/titulos/")!.params;
    expect(p.get("status")).toBe("abertos");
    expect(p.get("data_vencimento_inicio")).toBe("2000-01-01");
    const fim = p.get("data_vencimento_fim")!;
    expect(fim > iso(300)).toBe(true);
    expect(fim <= iso(367)).toBe(true);
  });
});

describe("SGP · consulta ao vivo", () => {
  it("fetchCustomerByCpf traz os titulos abertos fatura a fatura", async () => {
    const { conector } = montar({
      "/api/ura/consultacliente/": () => ({ corpo: { msg: "Contrato(s) Localizado(s)", contratos: [contrato(CPF_A)] } }),
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([
        titulo(11, CPF_A, "MARIA", 122.68, iso(-40)),
        titulo(12, CPF_A, "MARIA", 100, iso(10)),
      ]) }),
    });
    const r = await conector.fetchCustomerByCpf(CONFIG, CPF_A);
    expect(r.ok).toBe(true);
    expect(r.customers[0]).toMatchObject({ overdueInvoicesCount: 1 });
    expect(r.customers[0].faturasAbertas).toEqual([
      { ref: "11", vencimento: iso(-40), valor: 122.68, descricao: null },
      { ref: "12", vencimento: iso(10), valor: 100, descricao: null },
    ]);
  });
});
