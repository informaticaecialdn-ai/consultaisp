/**
 * SGP — o conector conversando com a API que o SGP realmente tem.
 *
 * Ate 03/09/2026 este conector chamava `/api/financeiro/inadimplentes`,
 * `/api/contratos` e `/api/clientes` — tres caminhos que nao existem em
 * nenhuma instalacao do SGP. Como nenhum provedor tinha SGP ligado, o erro
 * nunca virou bug relatado: virou timeout na consulta ao vivo.
 *
 * O SGP de mentira aqui embaixo SO conhece os quatro caminhos da colecao
 * Postman oficial, e explode em qualquer outro. E essa a rede que impede o
 * conector de voltar a inventar endpoint — nenhum teste precisa lembrar de
 * conferir.
 *
 * Os formatos de resposta sao os exemplos da propria doc, copiados campo a
 * campo (paginacao/titulos, msg/contratos, o array cru do listacontrato).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SgpConnector, statusDoContratoSgp } from "./sgp";

const CONFIG = {
  apiUrl: "https://provedor.sgp.net.br",
  apiToken: "tok-123",
  extra: { sgpApp: "consultaisp" },
} as any;

const CPF_A = "04117982940";
const CPF_B = "52998224725";
const CPF_C = "11144477735";

/** Data ISO a N dias de hoje — negativo e passado. */
const iso = (dias: number) => {
  const d = new Date(Date.now() + dias * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const CAMINHOS_REAIS = [
  "/api/ura/consultacliente/",
  "/api/ura/titulos/",
  "/api/ura/listacontrato/",
  "/api/ura/clientes/",
];

type Rota = (params: URLSearchParams) => { status?: number; corpo?: unknown; html?: string };

/**
 * A tela de login do SGP, servida com status 200.
 *
 * E o que o servidor devolve quando a URL configurada e o endereco de
 * redirecionamento do login (`.../accounts/login?next=/admin/`) em vez da
 * origem. Foi medido em 03/09/2026: 200, text/html, 4751 bytes — e o teste de
 * conexao dizia "ok".
 */
const PAGINA_DE_LOGIN = `<!DOCTYPE html><html lang="pt-br"><head><title>SGP · Login</title></head>
<body><form action="/accounts/login" method="post"><input name="username"><input name="password" type="password">
<button>Entrar</button></form></body></html>`;

/**
 * Um SGP de mentira. Recusa qualquer caminho fora da doc — e assim que o teste
 * pega endpoint inventado sem precisar afirmar nada sobre ele.
 *
 * Responde com `Response` de verdade, e nao com um objeto de fachada: sem
 * cabecalho e sem corpo cru nao da para provar o que o conector faz diante de
 * uma pagina HTML com status 200, que e o caso que abriu este arquivo.
 */
function servidorSgp(rotas: Record<string, Rota>) {
  const chamadas: Array<{ caminho: string; params: URLSearchParams }> = [];
  const fetchFake = vi.fn(async (url: string, init?: any) => {
    const caminho = new URL(String(url)).pathname;
    if (!CAMINHOS_REAIS.includes(caminho)) {
      throw new Error(`O SGP nao tem esse endpoint: ${caminho}`);
    }
    const params = new URLSearchParams(String(init?.body ?? ""));
    chamadas.push({ caminho, params });

    const r = rotas[caminho];
    const { status = 200, corpo = {}, html } = r ? r(params) : {};
    if (typeof html === "string") {
      return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  });
  return { fetchFake, chamadas };
}

/** Um titulo no formato exato de /api/ura/titulos/. */
const titulo = (cpf: string, nome: string, valor: number, vencimento: string, extra: Record<string, unknown> = {}) => ({
  id: Math.floor(Math.random() * 1e6),
  clienteNome: nome,
  clienteCpfcnpj: cpf,
  clienteContrato: 1302,
  status: "aberto",
  valor,
  valorCorrigido: valor,
  valorPago: 0,
  valorPagoParcial: 0,
  dataVencimento: vencimento,
  ...extra,
});

const envelopeTitulos = (titulos: unknown[], total = titulos.length, offset = 0, limit = 250) => ({
  paginacao: { offset, limit, parcial: titulos.length, total },
  titulos,
});

/** Um contrato no formato exato de /api/ura/consultacliente/. */
const contrato = (cpf: string, over: Record<string, unknown> = {}) => ({
  clienteId: 2827,
  contratoId: 1302,
  cpfCnpj: cpf,
  razaoSocial: "MARIA DA SILVA",
  contratoStatus: 1,
  contratoStatusDisplay: " Ativo ",
  contratoValorAberto: 0.0,
  contratoTitulosAReceber: 0,
  dataCadastro: "20/03/2024 11:43:25",
  motivo_status: "MOTIVO",
  planointernet: "Plano Empresarial 150 Mega",
  servico_plano: "PLANO",
  emails: ["maria@exemplo.com"],
  telefones: ["(44) 99999-8888"],
  endereco_logradouro: "RUA DAS FLORES",
  endereco_numero: 100,
  endereco_complemento: "APTO 2",
  endereco_bairro: "VILA SAO JOSE",
  endereco_cidade: "MANDAGUARI",
  endereco_uf: "PR",
  endereco_cep: "86975-000",
  endereco_ll: "-23.5489,-51.6712",
  ...over,
});

let fetchOriginal: typeof globalThis.fetch;
beforeEach(() => { fetchOriginal = globalThis.fetch; });
afterEach(() => { globalThis.fetch = fetchOriginal; vi.restoreAllMocks(); });

function montar(rotas: Record<string, Rota>) {
  const { fetchFake, chamadas } = servidorSgp(rotas);
  globalThis.fetch = fetchFake as any;
  return { conector: new SgpConnector(), chamadas, fetchFake };
}

describe("statusDoContratoSgp", () => {
  it("traduz os sete codigos que a doc do SGP enumera", () => {
    expect(statusDoContratoSgp(1)).toBe("active");
    expect(statusDoContratoSgp(2)).toBe("cancelled");
    expect(statusDoContratoSgp(3)).toBe("cancelled");
    expect(statusDoContratoSgp(4)).toBe("suspended");
    expect(statusDoContratoSgp(5)).toBe("cancelled");
    expect(statusDoContratoSgp(7)).toBe("active");
  });

  it("contrato NOVO (6) nao e ativo nem cancelado — e desconhecido", () => {
    // Nao esta instalado ainda. Dar "active" faria o anti-fraude avisar um
    // provedor sobre um cliente que ele ainda nao tem.
    expect(statusDoContratoSgp(6)).toBeUndefined();
  });

  it("le o texto quando nao ha codigo, incluindo o espaco do display", () => {
    expect(statusDoContratoSgp(undefined, " Ativo ")).toBe("active");
    expect(statusDoContratoSgp(undefined, "Ativo V. Reduzida")).toBe("active");
    expect(statusDoContratoSgp(undefined, "Suspenso")).toBe("suspended");
    expect(statusDoContratoSgp(undefined, "Cancelado")).toBe("cancelled");
    expect(statusDoContratoSgp(undefined, "Inviabilidade Técnica")).toBe("cancelled");
  });

  it("status que nao reconhece vira desconhecido, nunca ativo", () => {
    expect(statusDoContratoSgp(99, "Coisa Nova")).toBeUndefined();
    expect(statusDoContratoSgp(undefined, "")).toBeUndefined();
    expect(statusDoContratoSgp(null, null)).toBeUndefined();
  });
});

describe("SGP · consulta por CPF", () => {
  it("pergunta pelo CPF em vez de baixar a base inteira", async () => {
    const { conector, chamadas } = montar({
      "/api/ura/consultacliente/": () => ({ corpo: { msg: "Contrato(s) Localizado(s)", contratos: [contrato(CPF_A)] } }),
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([]) }),
    });

    await conector.fetchCustomerByCpf(CONFIG, "041.179.829-40");

    // Era isto que estourava o tempo: a versao antiga pedia limit=2000 sem
    // filtro e procurava o CPF no meio da resposta.
    expect(chamadas).toHaveLength(2);
    for (const c of chamadas) {
      expect(c.params.get("cpfcnpj")).toBe(CPF_A);
      expect(c.params.get("token")).toBe("tok-123");
      expect(c.params.get("app")).toBe("consultaisp");
    }
  });

  it("monta o cliente com status, plano, data de contrato e endereco", async () => {
    const { conector } = montar({
      "/api/ura/consultacliente/": () => ({ corpo: { contratos: [contrato(CPF_A)] } }),
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([
        titulo(CPF_A, "MARIA DA SILVA", 122.68, iso(-40)),
        titulo(CPF_A, "MARIA DA SILVA", 100.00, iso(-10)),
      ]) }),
    });

    const r = await conector.fetchCustomerByCpf(CONFIG, CPF_A);
    expect(r.ok).toBe(true);
    const c = r.customers[0];

    expect(c.cpfCnpj).toBe(CPF_A);
    expect(c.name).toBe("MARIA DA SILVA");
    expect(c.contractStatus).toBe("active");
    expect(c.contractPlan).toBe("Plano Empresarial 150 Mega");
    expect(c.contractStartDate).toBe("20/03/2024 11:43:25");
    expect(c.city).toBe("MANDAGUARI");
    expect(c.state).toBe("PR");
    expect(c.addressNumber).toBe("100");
    expect(c.email).toBe("maria@exemplo.com");
    expect(c.phone).toBe("44999998888");
    expect(c.latitude).toBe("-23.5489");
    expect(c.longitude).toBe("-51.6712");

    expect(c.totalOverdueAmount).toBeCloseTo(222.68, 2);
    expect(c.maxDaysOverdue).toBe(40);
    expect(c.overdueInvoicesCount).toBe(2);
  });

  it("com varios contratos, quem responde pelo cliente e o ATIVO", async () => {
    const { conector } = montar({
      "/api/ura/consultacliente/": () => ({ corpo: { contratos: [
        contrato(CPF_A, { contratoStatus: 3, contratoStatusDisplay: " Cancelado ", planointernet: "Plano Antigo" }),
        contrato(CPF_A, { contratoStatus: 1, contratoStatusDisplay: " Ativo ", planointernet: "Fibra 600" }),
      ] } }),
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([]) }),
    });

    const r = await conector.fetchCustomerByCpf(CONFIG, CPF_A);
    // Um contrato cancelado de 2019 nao pode fazer o bureau dizer "ex-cliente"
    // sobre quem esta na rede hoje.
    expect(r.customers[0].contractStatus).toBe("active");
    expect(r.customers[0].contractPlan).toBe("Fibra 600");
  });

  it("CPF que nao esta na base devolve vazio, e nao erro", async () => {
    const { conector } = montar({
      "/api/ura/consultacliente/": () => ({ corpo: { msg: "Nenhum contrato localizado", contratos: [] } }),
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([]) }),
    });

    const r = await conector.fetchCustomerByCpf(CONFIG, CPF_C);
    expect(r.ok).toBe(true);
    expect(r.customers).toEqual([]);
  });

  it("token recusado diz o que fazer, e nao so o numero do status", async () => {
    const { conector } = montar({
      "/api/ura/consultacliente/": () => ({ status: 403 }),
      "/api/ura/titulos/": () => ({ status: 403 }),
    });

    const r = await conector.fetchCustomerByCpf(CONFIG, CPF_A);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/token/i);
  });

  it("faturas lidas pela metade marcam a consulta como parcial", async () => {
    let pagina = 0;
    const { conector } = montar({
      "/api/ura/consultacliente/": () => ({ corpo: { contratos: [contrato(CPF_A)] } }),
      "/api/ura/titulos/": () => {
        // Primeira pagina responde; a segunda cai.
        if (pagina++ === 0) {
          return { corpo: envelopeTitulos(
            Array.from({ length: 250 }, () => titulo(CPF_A, "MARIA", 10, iso(-5))), 400,
          ) };
        }
        return { status: 500 };
      },
    });

    const r = await conector.fetchCustomerByCpf(CONFIG, CPF_A);
    // "Nada consta" para quem deve e o pior erro possivel num bureau. Se a
    // leitura nao terminou, quem consome precisa saber.
    expect(r.leituraParcial).toBe(true);
  });
});

describe("SGP · faturas vencidas", () => {
  it("fatura a vencer nao e inadimplencia", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([titulo(CPF_A, "MARIA", 90, iso(15))]) }),
      "/api/ura/listacontrato/": () => ({ corpo: [] }),
    });

    const r = await conector.fetchDelinquents(CONFIG);
    expect(r.customers).toEqual([]);
  });

  it("vencimento ilegivel sai da conta em vez de virar atraso de zero dia", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([
        titulo(CPF_A, "MARIA", 90, ""),
        titulo(CPF_B, "JOAO", 50, iso(-3)),
      ]) }),
      "/api/ura/listacontrato/": () => ({ corpo: [] }),
    });

    const r = await conector.fetchDelinquents(CONFIG);
    expect(r.customers.map(c => c.cpfCnpj)).toEqual([CPF_B]);
  });

  it("pagamento parcial reduz o valor em aberto; fatura quitada sai", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([
        titulo(CPF_A, "MARIA", 100, iso(-30), { valorPagoParcial: 40 }),
        titulo(CPF_A, "MARIA", 80, iso(-60), { valorPago: 80 }),
      ]) }),
      "/api/ura/listacontrato/": () => ({ corpo: [] }),
    });

    const r = await conector.fetchDelinquents(CONFIG);
    expect(r.customers[0].totalOverdueAmount).toBeCloseTo(60, 2);
    expect(r.customers[0].overdueInvoicesCount).toBe(1);
    // A de 60 dias foi quitada, entao o atraso maximo e o da que sobrou.
    expect(r.customers[0].maxDaysOverdue).toBe(30);
  });

  it("usa o principal, e nao o valor corrigido com juros", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([
        titulo(CPF_A, "MARIA", 100, iso(-90), { valorCorrigido: 148.32 }),
      ]) }),
      "/api/ura/listacontrato/": () => ({ corpo: [] }),
    });

    const r = await conector.fetchDelinquents(CONFIG);
    // Juros e multa variam por provedor; comparar dividas entre ERPs so faz
    // sentido no principal.
    expect(r.customers[0].totalOverdueAmount).toBeCloseTo(100, 2);
  });
});

describe("SGP · sincronizacao", () => {
  /**
   * O SGP recusa `data_vencimento_fim` sozinho:
   *   400 {"erro":"[data_vencimento_inicio] obrigatória caso [data_vencimento_fim] informada"}
   *
   * O conector mandava so o fim, entao a varredura completa falhava em TODO
   * provedor com SGP — sempre, desde o primeiro dia. Como nenhum provedor tinha
   * SGP ligado, ninguem viu. Medido contra o SGP de demonstracao da TSMX em
   * 03/09/2026; a colecao Postman lista os dois parametros sem dizer que um
   * exige o outro.
   */
  it("manda as DUAS datas — o SGP recusa o fim sozinho", async () => {
    const { conector, chamadas } = montar({
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([]) }),
      "/api/ura/listacontrato/": () => ({ corpo: [] }),
    });

    await conector.fetchDelinquents(CONFIG);

    const p = chamadas.find(c => c.caminho === "/api/ura/titulos/")!.params;
    expect(p.get("data_vencimento_fim")).toBeTruthy();
    expect(p.get("data_vencimento_inicio")).toBeTruthy();
    // A janela tem de comecar antes de qualquer divida que possa existir:
    // num bureau, calote antigo e justamente o que o provedor vizinho precisa
    // enxergar. Um inicio recente esconderia inadimplencia de verdade.
    expect(Number(p.get("data_vencimento_inicio")!.slice(0, 4))).toBeLessThanOrEqual(2000);
  });

  it("quando o SGP explica a recusa, a explicacao dele chega a tela", async () => {
    // O corpo do 400 usa a chave `erro`, e nao `detail` como a autenticacao —
    // ler so `detail` transformava a frase que resolvia o problema num
    // inutil "SGP respondeu com status 400".
    const { conector } = montar({
      "/api/ura/titulos/": () => ({
        status: 400,
        corpo: { erro: "[data_vencimento_inicio] obrigatória caso [data_vencimento_fim] informada" },
      }),
      "/api/ura/listacontrato/": () => ({ corpo: [] }),
    });

    const r = await conector.fetchDelinquents(CONFIG);

    expect(r.ok).toBe(false);
    expect(r.message).toContain("data_vencimento_inicio");
  });

  it("pagina os titulos ate cobrir o total anunciado", async () => {
    const paginas = [
      envelopeTitulos(Array.from({ length: 250 }, (_, i) => titulo(CPF_A, "MARIA", 1, iso(-i - 1))), 400, 0),
      envelopeTitulos(Array.from({ length: 150 }, () => titulo(CPF_B, "JOAO", 2, iso(-5))), 400, 250),
    ];
    let i = 0;
    const { conector, chamadas } = montar({
      "/api/ura/titulos/": () => ({ corpo: paginas[i++] ?? envelopeTitulos([], 400) }),
      "/api/ura/listacontrato/": () => ({ corpo: [] }),
    });

    const r = await conector.fetchDelinquents(CONFIG);

    const pedidos = chamadas.filter(c => c.caminho === "/api/ura/titulos/");
    expect(pedidos).toHaveLength(2);
    expect(pedidos[0].params.get("limit")).toBe("250");   // teto documentado
    expect(pedidos[0].params.get("offset")).toBe("0");
    expect(pedidos[1].params.get("offset")).toBe("250");
    expect(r.leituraParcial).toBeUndefined();
    expect(r.customers.map(c => c.cpfCnpj).sort()).toEqual([CPF_A, CPF_B].sort());
  });

  it("uma pagina que falha marca a leitura como parcial", async () => {
    let i = 0;
    const { conector } = montar({
      "/api/ura/titulos/": () => (i++ === 0
        ? { corpo: envelopeTitulos(Array.from({ length: 250 }, () => titulo(CPF_A, "MARIA", 1, iso(-9))), 900) }
        : { status: 500 }),
      "/api/ura/listacontrato/": () => ({ corpo: [] }),
    });

    const r = await conector.fetchDelinquents(CONFIG);
    // O sync usa esta lista como prova NEGATIVA: sem esta marca ele baixaria a
    // divida de todo mundo que ficou nas paginas nao lidas.
    expect(r.ok).toBe(true);
    expect(r.leituraParcial).toBe(true);
  });

  it("o status do contrato vem do cadastro, com endereco", async () => {
    const { conector, chamadas } = montar({
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([
        titulo(CPF_A, "MARIA", 100, iso(-30)),
        titulo(CPF_B, "JOAO", 70, iso(-8)),
      ]) }),
      "/api/ura/listacontrato/": () => ({ corpo: [
        {
          status: "Ativo", cpfcnpj: "041.179.829-40", email: "maria@exemplo.com",
          telefone: "(44) 99999-8888", nome: "MARIA DA SILVA", data_cadastro: "2024-03-20 11:43:25",
          endereco: {
            logradouro: "RUA DAS FLORES", numero: 100, bairro: "CENTRO",
            cidade: "MANDAGUARI", uf: "PR", cep: "86975-000",
            latitude: "-23.5489", longitude: "-51.6712",
          },
        },
      ] }),
    });

    const r = await conector.fetchDelinquents(CONFIG);
    expect(chamadas.some(c => c.caminho === "/api/ura/listacontrato/" && c.params.get("exibir_endereco") === "1")).toBe(true);

    const maria = r.customers.find(c => c.cpfCnpj === CPF_A)!;
    expect(maria.contractStatus).toBe("active");
    expect(maria.contractStartDate).toBe("2024-03-20 11:43:25");
    expect(maria.city).toBe("MANDAGUARI");
    expect(maria.cep).toBe("86975-000");

    const joao = r.customers.find(c => c.cpfCnpj === CPF_B)!;
    // Nao esta no cadastro lido: fica DESCONHECIDO. Chutar "ativo" aqui faria o
    // anti-fraude avisar um provedor sobre alguem que talvez nem seja cliente.
    expect(joao.contractStatus).toBeUndefined();
  });

  it("cadastro de contratos fora do ar nao derruba a lista de inadimplentes", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([titulo(CPF_A, "MARIA", 100, iso(-30))]) }),
      "/api/ura/listacontrato/": () => ({ status: 500 }),
    });

    const r = await conector.fetchDelinquents(CONFIG);
    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(1);
    expect(r.customers[0].contractStatus).toBeUndefined();
  });

  it("erro logo na primeira pagina e falha, nao lista vazia", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ status: 401 }),
      "/api/ura/listacontrato/": () => ({ corpo: [] }),
    });

    const r = await conector.fetchDelinquents(CONFIG);
    // `ok: true` com lista vazia seria lido como "ninguem deve nada" e limparia
    // a inadimplencia do provedor inteiro.
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/401|token/i);
  });
});

describe("SGP · base de clientes", () => {
  it("pagina no teto de 100 e nao pede os titulos junto", async () => {
    const pagina = (cpfs: string[], total: number, offset: number) => ({
      paginacao: { offset, limit: 100, parcial: cpfs.length, total },
      clientes: cpfs.map(cpf => ({
        nome: "CLIENTE " + cpf, cpfcnpj: cpf, dataCadastro: "2023-01-01", tipo: "F",
        endereco: { logradouro: "RUA A", numero: 1, bairro: "CENTRO", cidade: "MANDAGUARI", uf: "PR", cep: "86975-000" },
        contratos: [{ contrato: 1, dataCadastro: "2023-01-01", status: "Ativo", motivo_status: "" }],
      })),
    });
    const paginas = [pagina([CPF_A], 2, 0), pagina([CPF_B], 2, 1)];
    let i = 0;
    const { conector, chamadas } = montar({
      "/api/ura/clientes/": () => ({ corpo: paginas[i++] ?? pagina([], 2, 2) }),
    });

    const r = await conector.fetchCustomers(CONFIG);
    const pedidos = chamadas.filter(c => c.caminho === "/api/ura/clientes/");
    expect(pedidos[0].params.get("limit")).toBe("100");
    expect(pedidos[0].params.get("omitir_titulos")).toBe("1");
    expect(pedidos[1].params.get("offset")).toBe("1");
    expect(r.customers.map(c => c.cpfCnpj)).toEqual([CPF_A, CPF_B]);
    expect(r.customers[0].contractStatus).toBe("active");
    expect(r.customers[0].city).toBe("MANDAGUARI");
  });
});

describe("SGP · teste de conexao", () => {
  it("usa a chamada mais barata e diz quando o token e o problema", async () => {
    const { conector, chamadas } = montar({
      "/api/ura/titulos/": () => ({ status: 401 }),
    });

    const r = await conector.testConnection(CONFIG);
    expect(chamadas[0].caminho).toBe("/api/ura/titulos/");
    expect(chamadas[0].params.get("limit")).toBe("1");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Token/);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("conexao boa responde ok", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([]) }),
    });
    const r = await conector.testConnection(CONFIG);
    expect(r.ok).toBe(true);
  });

  it("pagina de login com status 200 nao pode passar por conexao boa", async () => {
    // O defeito medido: o operador colou a URL de redirecionamento do login, o
    // SGP devolveu a propria tela de login com 200, e o teste — que olhava so
    // `response.ok` — respondeu "conexao ok, 216 ms". A integracao foi ligada e
    // a varredura passou a ler HTML: zero inadimplentes, que o sync le como
    // prova de que ninguem deve nada.
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ html: PAGINA_DE_LOGIN }),
    });

    const r = await conector.testConnection(CONFIG);
    expect(r.ok).toBe(false);
    // O erro esta no endereco, e nao na credencial. Mandar o operador conferir
    // o token faria ele trocar o que estava certo.
    expect(r.message).toMatch(/endereco|URL/i);
    expect(r.message).not.toMatch(/token/i);
  });

  it("JSON que nao tem a forma da API do SGP tambem reprova", async () => {
    // Proxy reverso, CDN e dominio parqueado respondem 200 com JSON qualquer.
    for (const corpo of [{}, { status: "ok" }, { titulos: [] }]) {
      const { conector } = montar({ "/api/ura/titulos/": () => ({ corpo }) });
      const r = await conector.testConnection(CONFIG);
      // `{ titulos: [] }` sem `paginacao` entra na lista de proposito: meia
      // forma nao prova que quem respondeu foi o SGP.
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/endereco|URL/i);
    }
  });

  it("a resposta com paginacao e titulos e o que prova que quem atendeu foi o SGP", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([titulo(CPF_A, "MARIA", 90, iso(-3))], 1) }),
    });
    const r = await conector.testConnection(CONFIG);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/SGP/);
  });

  /**
   * AS DUAS FRASES DO 403, E POR QUE ELAS ESTIVERAM TROCADAS.
   *
   * Ate 04/09/2026 este arquivo afirmava o contrario do que o SGP faz, e a
   * tela mandou um provedor real conferir o nome do app durante dois dias —
   * ele trocou o token duas vezes e mexeu na permissao do usuario atras de um
   * erro que nao era nenhum dos dois.
   *
   * O experimento que desfez a confusao, contra o SGP da Amplinet, do IP
   * liberado, variando UMA coisa por vez sobre a credencial gravada:
   *
   *   app="Consultaisp"  (o gravado)  -> "As credenciais ... nao foram fornecidas."
   *   app="consultaisp"               -> "Credenciais de autenticacao incorretas."
   *   app="CONSULTAISP"               -> "Credenciais de autenticacao incorretas."
   *   app="ConsultaISP"               -> "Credenciais de autenticacao incorretas."
   *   sem app                         -> "Credenciais de autenticacao incorretas."
   *
   * Se "incorretas" saisse de par valido bloqueado, ela nao mudaria conforme a
   * grafia. Logo "incorretas" = o par NAO EXISTE (AuthenticationFailed), e
   * "nao foram fornecidas" = o par existe e o autenticador desistiu por outro
   * motivo (NotAuthenticated: host fora da lista, token inativo, usuario sem
   * permissao). A frase do Django engana porque parece dizer "voce nao mandou
   * credencial"; ela quer dizer "nenhum autenticador produziu um usuario".
   */
  it("403 INCORRETAS = o par nao existe: manda copiar o nome do app", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ status: 403, corpo: { detail: "Credenciais de autenticação incorretas." } }),
    });

    const r = await conector.testConnection(CONFIG);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/nao encontrou/i);
    expect(r.message).toMatch(/Nome do App/i);
    expect(r.message).toMatch(/maiuscul/i);   // a caixa e o que muda a resposta
    // NAO manda conferir host aqui: com o par inexistente, host permitido nao
    // e a variavel, e citar tres causas faz o operador mexer no que estava bom.
    expect(r.message).not.toMatch(/host/i);
  });

  it("403 NAO FORNECIDAS = o par existe: manda conferir host, token e usuario", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ status: 403, corpo: { detail: "As credenciais de autenticação não foram fornecidas." } }),
    });

    const r = await conector.testConnection(CONFIG);
    expect(r.ok).toBe(false);
    // O ponto da mensagem e tirar o operador do nome do app, que esta certo.
    expect(r.message).toMatch(/reconheceu/i);
    expect(r.message).toMatch(/host/i);
    expect(r.message).toMatch(/permiss/i);
  });

  /**
   * O PALPITE QUE VIROU ERRO DE CREDENCIAL.
   *
   * `corpo()` tinha `config.extra?.sgpApp || "consultaisp"`. Com o campo vazio
   * ele mandava uma grafia inventada junto do token bom, o SGP nao achava o
   * par, e o operador lia uma mensagem sobre credencial recusada — para um
   * campo que ele simplesmente nao tinha preenchido.
   */
  it("sem o nome do app o conector nao chuta: recusa dizendo o que preencher", async () => {
    let chamou = false;
    const { conector } = montar({
      "/api/ura/titulos/": () => { chamou = true; return { status: 200, corpo: { titulos: [] } }; },
    });

    const r = await conector.testConnection({ ...CONFIG, extra: {} });

    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Nome do App/i);
    expect(r.message).toMatch(/nao esta preenchido/i);
    // E nao gasta uma ida ao SGP para descobrir o que ja se sabia aqui.
    expect(chamou).toBe(false);
  });
});

/**
 * O mesmo engano da URL, agora nas leituras.
 *
 * Aqui o estrago e maior que uma mensagem errada: `ok: true` com lista vazia e
 * lido pelo sync como prova NEGATIVA — quem nao esta na lista tem a divida
 * baixada. Uma pagina de login lida como "nenhum inadimplente" zeraria a
 * inadimplencia do provedor inteiro.
 */
describe("SGP · resposta que nao e do SGP nas leituras", () => {
  it("pagina de login na varredura falha, e nunca vira lista vazia", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ html: PAGINA_DE_LOGIN }),
      "/api/ura/listacontrato/": () => ({ corpo: [] }),
    });

    const r = await conector.fetchDelinquents(CONFIG);
    expect(r.ok).toBe(false);
    expect(r.customers).toEqual([]);
    expect(r.message).toMatch(/endereco|URL/i);
  });

  it("JSON sem os campos do SGP na varredura tambem falha", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ corpo: { status: "ok" } }),
      "/api/ura/listacontrato/": () => ({ corpo: [] }),
    });

    const r = await conector.fetchDelinquents(CONFIG);
    expect(r.ok).toBe(false);
  });

  it("pagina de login na consulta ao vivo falha em vez de dizer 'nada consta'", async () => {
    const { conector } = montar({
      "/api/ura/consultacliente/": () => ({ html: PAGINA_DE_LOGIN }),
      "/api/ura/titulos/": () => ({ html: PAGINA_DE_LOGIN }),
    });

    const r = await conector.fetchCustomerByCpf(CONFIG, CPF_A);
    // "Cliente nao encontrado" aqui viraria "nada consta" sobre quem deve — o
    // pior erro possivel num bureau de credito.
    expect(r.ok).toBe(false);
    expect(r.customers).toEqual([]);
  });

  it("consultacliente respondendo JSON de outro sistema nao vira cliente sem contrato", async () => {
    const { conector } = montar({
      "/api/ura/consultacliente/": () => ({ corpo: { erro: "rota desconhecida" } }),
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([]) }),
    });

    const r = await conector.fetchCustomerByCpf(CONFIG, CPF_A);
    expect(r.ok).toBe(false);
  });

  it("pagina de login na base de clientes falha, e nao devolve carteira vazia", async () => {
    const { conector } = montar({
      "/api/ura/clientes/": () => ({ html: PAGINA_DE_LOGIN }),
    });

    const r = await conector.fetchCustomers(CONFIG);
    expect(r.ok).toBe(false);
    expect(r.customers).toEqual([]);
  });

  it("cadastro de contratos ilegivel nao derruba a lista de inadimplentes", async () => {
    const { conector } = montar({
      "/api/ura/titulos/": () => ({ corpo: envelopeTitulos([titulo(CPF_A, "MARIA", 100, iso(-30))]) }),
      "/api/ura/listacontrato/": () => ({ html: PAGINA_DE_LOGIN }),
    });

    const r = await conector.fetchDelinquents(CONFIG);
    // Status ausente e inofensivo: o anti-fraude so avisa com prova de contrato
    // ativo. Perder a divida ja lida seria pior.
    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(1);
    expect(r.customers[0].contractStatus).toBeUndefined();
  });
});

/**
 * CADASTRO SEM CONTRATO — a regra do dono, e o estrago de nao ter tido ela.
 *
 * Medido na Amplinet em 04/09/2026: dos 937 clientes gravados, 71 nao tinham
 * contrato nenhum no SGP e os 71 estavam ATIVOS. `customers.storage.ts` faz
 * `data.status ?? "active"` na criacao, entao "o conector nao sabe" virava
 * "cliente ativo" — e "ativo + fatura vencida" e a condicao que dispara o
 * anti-fraude. Avisar um provedor sobre alguem que nunca foi cliente dele e o
 * falso positivo mais caro que este produto pode cometer.
 *
 * O IXC e o MK ja descartavam esses cadastros; o SGP ficou de fora.
 */
describe("SGP · cadastro sem contrato nao entra", () => {
  const cadastro = (cpf: string, contratos: unknown) => ({
    nome: "CLIENTE " + cpf, cpfcnpj: cpf, dataCadastro: "2023-01-01", tipo: "F",
    endereco: { logradouro: "RUA A", numero: 1, bairro: "CENTRO", cidade: "EMBU GUACU", uf: "SP", cep: "06900-000" },
    ...(contratos === undefined ? {} : { contratos }),
  });

  const pagina = (clientes: unknown[]) => ({
    paginacao: { offset: 0, limit: 100, parcial: clientes.length, total: clientes.length },
    clientes,
  });

  it("array VAZIO e prova de que nao ha contrato: o cadastro e descartado", async () => {
    const { conector } = montar({
      "/api/ura/clientes/": () => ({
        corpo: pagina([
          cadastro(CPF_A, [{ contrato: 1, dataCadastro: "2023-01-01", status: "Ativo" }]),
          cadastro(CPF_B, []),
        ]),
      }),
    });

    const r = await conector.fetchCustomers(CONFIG);

    expect(r.customers.map(c => c.cpfCnpj)).toEqual([CPF_A]);
    // A contagem sai na mensagem: sem ela, a carteira menor parece perda de dado.
    expect(r.message).toMatch(/1 cadastro\(s\) sem contrato ignorados/);
  });

  it("campo AUSENTE nao e prova: o cadastro entra, com status desconhecido", async () => {
    // A diferenca entre as duas linhas e o ponto todo. Pular aqui esvaziaria a
    // carteira de um SGP que, por versao ou permissao, nao devolvesse contratos.
    const { conector } = montar({
      "/api/ura/clientes/": () => ({ corpo: pagina([cadastro(CPF_A, undefined)]) }),
    });

    const r = await conector.fetchCustomers(CONFIG);

    expect(r.customers.map(c => c.cpfCnpj)).toEqual([CPF_A]);
    expect(r.customers[0].contractStatus).toBeUndefined();
    expect(r.message).not.toMatch(/sem contrato/);
  });

  it("contrato cancelado NAO e cadastro sem contrato — ex-cliente continua entrando", async () => {
    // Ex-cliente com divida e o sinal de migrador serial que o bureau existe
    // para ter. Confundir "sem contrato" com "contrato encerrado" apagaria isso.
    const { conector } = montar({
      "/api/ura/clientes/": () => ({
        corpo: pagina([cadastro(CPF_A, [{ contrato: 1, dataCadastro: "2020-01-01", status: "Cancelado" }])]),
      }),
    });

    const r = await conector.fetchCustomers(CONFIG);

    expect(r.customers).toHaveLength(1);
    expect(r.customers[0].contractStatus).toBe("cancelled");
  });

  it("com um contrato ativo entre varios encerrados, vale o ativo", async () => {
    const { conector } = montar({
      "/api/ura/clientes/": () => ({
        corpo: pagina([cadastro(CPF_A, [
          { contrato: 1, dataCadastro: "2019-01-01", status: "Cancelado" },
          { contrato: 2, dataCadastro: "2024-01-01", status: "Ativo" },
        ])]),
      }),
    });

    const r = await conector.fetchCustomers(CONFIG);

    expect(r.customers[0].contractStatus).toBe("active");
  });
});
