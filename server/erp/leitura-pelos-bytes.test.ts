/**
 * A leitura do ERP passa pelos BYTES — e continua passando.
 *
 * `codificacao.test.ts` prova o reparo e cobre a varredura (`fetchCustomers`).
 * Falta a outra ponta, que e a que mais importa para o nome: a CONSULTA AO VIVO
 * (`fetchCustomerByCpf`) — ela alimenta a consulta na rede, o Cliente 360, o
 * chat, o aviso de fatura e a confissao de divida.
 *
 * Por que ela precisa de teste PROPRIO, com `Response` de verdade:
 *
 *   Os testes vizinhos do MK montam a resposta como objeto simples —
 *   `{ ok: true, status: 200, json: async () => corpo }` (veja
 *   `mk-conexoes.test.ts`, `mk-contratos.test.ts`, `mk-faturas.test.ts`). Um
 *   objeto desses NAO tem `arrayBuffer()`, entao `lerJsonDoErp` entra no desvio
 *   documentado e devolve o `json()` do proprio mock. Resultado: aqueles testes
 *   passam IGUAL com `.json()` e com `lerJsonDoErp` — nao guardam nada contra a
 *   volta do defeito. Este aqui entrega bytes, que e onde o defeito vive.
 *
 * Os bytes sao os medidos na producao em 17/09/2026: o MK declara
 * `charset=iso-8859-1`, manda UTF-8 e escapa como texto ASCII `\u00XX` todo byte
 * que caia em 0x80-0x9F — o segundo byte de TODA acentuada MAIUSCULA. Ver
 * `server/erp/codificacao.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { MkConnector } from "./connectors/mk";

const CONFIG = {
  apiUrl: "http://mk.local:8080/mk",
  apiToken: "token-de-teste",
  mkContraSenha: "contra-de-teste",
  extra: {},
} as any;

/** CPF valido e deterministico (o `cleanCpfCnpj` confere o digito). */
function cpfValido(n: number): string {
  const base = String(100000000 + n).padStart(9, "0");
  let s = 0;
  for (let i = 0; i < 9; i += 1) s += Number(base[i]) * (10 - i);
  let d1 = (s * 10) % 11;
  if (d1 === 10) d1 = 0;
  const b = base + d1;
  s = 0;
  for (let i = 0; i < 10; i += 1) s += Number(b[i]) * (11 - i);
  let d2 = (s * 10) % 11;
  if (d2 === 10) d2 = 0;
  return b + d2;
}

const CT_MK = "text/plain;charset=iso-8859-1"; // MENTE: o corpo e UTF-8

/**
 * Serializa como o MK serializa, byte a byte: JSON normal, depois todo byte em
 * 0x80-0x9F trocado pelo TEXTO ASCII `\u00XX` (hexadecimal maiusculo, como nas
 * janelas do diagnostico). Escrever a fixture assim e o ponto: uma fixture em
 * `.ts` com o nome ja acentuado nao prova nada, porque ja passou pelo decode.
 */
function corpoDoMk(objeto: unknown): Uint8Array {
  const crus = new TextEncoder().encode(JSON.stringify(objeto));
  const saida: number[] = [];
  for (const b of crus) {
    if (b >= 0x80 && b <= 0x9f) {
      const hex = b.toString(16).toUpperCase().padStart(2, "0");
      for (const c of `\\u00${hex}`) saida.push(c.charCodeAt(0));
    } else {
      saida.push(b);
    }
  }
  return new Uint8Array(saida);
}

const resposta = (objeto: unknown): Response =>
  new Response(corpoDoMk(objeto), { status: 200, headers: { "content-type": CT_MK } });

const NOME = "GENÇA SEBASTIÃO DA CONCEIÇÃO";
const LOGRADOURO = "AVENIDA JOÃO PESSOA";
const BAIRRO = "JARDIM SÃO JOSÉ";
const CIDADE = "IBIPORÃ";
const PLANO = "FIBRA 300 PROMOÇÃO";
const CPF = cpfValido(1);

/** O MK da NsLink, com os bytes que ele manda de verdade. */
function servidorFake() {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("WSAutenticacao")) return resposta({ Token: "sessao-fake" });
    if (u.includes("WSMKConsultaDoc")) {
      return resposta({ CodigoPessoa: 1, Nome: NOME, CPF_CNPJ: CPF, Situacao: "Ativo", Email: "contato@exemplo.com.br", status: "OK" });
    }
    if (u.includes("WSMKConsultaClientes")) {
      return resposta({
        Clientes: [{
          CodigoPessoa: 1,
          CPF_CNPJ: CPF,
          Nome: NOME,
          Situacao: "Ativo",
          endereco: [{ tipo: "INSTALACAO", logradouro: LOGRADOURO, numero: 1234, bairro: BAIRRO, cidade: CIDADE, estado: "PR", cep: "86200000" }],
        }],
      });
    }
    // A V2 tem de vir antes: o nome dela contem o nome da V1.
    if (u.includes("WSMKContratosPorClienteV2")) {
      return resposta([{ codcontrato: 10, status_contrato: "Ativo", plano_acesso: PLANO, adesao: "2024-03-01" }]);
    }
    if (u.includes("WSMKFaturasPendentes")) return resposta({ FaturasPendentes: [] });
    return new Response(corpoDoMk({}), { status: 404, headers: { "content-type": CT_MK } });
  });
}

let fetchOriginal: typeof globalThis.fetch;
beforeEach(() => {
  fetchOriginal = globalThis.fetch;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  vi.restoreAllMocks();
});

describe("consulta ao vivo do MK — o nome e o endereco chegam com acento", () => {
  it("a fixture reproduz o defeito: pelo caminho antigo o nome sai com U+FFFD", () => {
    // Nao e decoracao: e a prova de que o teste abaixo REPROVA o codigo antigo.
    // `response.json()` e, por especificacao, `JSON.parse(UTF-8 decode(bytes))`,
    // e e exatamente isto que ele produzia.
    const antigo = JSON.parse(new TextDecoder().decode(corpoDoMk({ Nome: NOME }))) as { Nome: string };
    expect(antigo.Nome).toContain("�");
    expect(antigo.Nome).not.toBe(NOME);
  });

  it("fetchCustomerByCpf devolve nome, endereco, bairro, cidade e plano inteiros", async () => {
    globalThis.fetch = servidorFake() as any;

    const r = await new MkConnector().fetchCustomerByCpf!(CONFIG, CPF);

    expect(r.ok).toBe(true);
    const c = r.customers[0]!;
    // Um campo por vez, porque o defeito nao era do "nome": era de TODO texto.
    expect(c.name).toBe(NOME);
    expect(c.address).toBe(LOGRADOURO);
    expect(c.neighborhood).toBe(BAIRRO);
    expect(c.city).toBe(CIDADE);
    expect(c.contractPlan).toBe(PLANO);
    // E o cabecalho mentiroso tambem nao pode produzir o outro estrago possivel:
    // obedecer `iso-8859-1` num corpo UTF-8 daria "Ã‡" em vez de "Ç".
    const inteiro = JSON.stringify(r);
    expect(inteiro).not.toContain("�");
    expect(inteiro).not.toContain("Ã‡");
  });
});

/**
 * A trava de fonte. O comentario no topo do `mk.ts` ja diz "NAO volte a
 * `.json()` neste arquivo"; comentario nao reprova ninguem. Sao 16 pontos de
 * leitura no MK e um so deles esta coberto ponta a ponta — o proximo que voltar
 * para `.json()` precisa parar aqui.
 */
describe("os conectores lidos hoje em producao leem pelo modulo de codificacao", () => {
  const fonte = (caminho: string) =>
    readFileSync(new URL(caminho, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ") // comentarios de bloco
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // de linha, sem comer o "//" de uma URL

  it("mk.ts nao le nenhum corpo com `.json()` nem `.text()`", () => {
    const codigo = fonte("./connectors/mk.ts");
    expect(codigo).toContain('from "../codificacao.js"');
    expect(codigo.match(/\.json\(\)/g)).toBeNull();
    expect(codigo.match(/\.text\(\)/g)).toBeNull();
  });

  it("ixc.ts e sgp.ts decodificam o corpo de DADOS pelo modulo", () => {
    // Os dois estao corretos hoje (IXC manda ASCII puro, SGP manda UTF-8 cru), e
    // por isso mesmo o teste olha o CAMINHO, nao o resultado: e o caminho que
    // garante que uma mudanca de formato do ERP seja tratada na entrada.
    expect(fonte("./connectors/ixc.ts")).toContain("lerJsonDoErp(response)");
    expect(fonte("./connectors/sgp.ts")).toContain("lerTextoDoErp(response)");
  });
});
