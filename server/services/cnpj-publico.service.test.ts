/**
 * A consulta de CNPJ na Receita, por tres fontes com queda.
 *
 * O que se prova aqui e a QUEDA e a TRADUCAO, que sao as duas coisas que a
 * versao anterior nao tinha e que produziram o defeito relatado: o provedor
 * clicava em "buscar dados pelo CNPJ", a unica fonte recusava por cota, e a
 * tela dizia "servico indisponivel" — que ele leu como "o sistema nao busca".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { consultarCnpjPublico, normalizarCnpj, dataEmIso } from "./cnpj-publico.service";

const CNPJ = "23864873000148";

/** Respostas por URL. O que nao estiver no mapa "cai a rede". */
function montar(rotas: Record<string, () => { status?: number; corpo: unknown }>) {
  const chamadas: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    chamadas.push(String(url));
    const chave = Object.keys(rotas).find(k => String(url).includes(k));
    if (!chave) throw new Error("ECONNREFUSED");
    const { status = 200, corpo } = rotas[chave]();
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => corpo,
    } as any;
  });
  return chamadas;
}

const RECEITAWS = {
  nome: "HELIO CAINELLI TELECOM LTDA",
  fantasia: "Amplinet",
  cnpj: "23.864.873/0001-48",
  natureza_juridica: "Sociedade Empresária Limitada",
  abertura: "15/01/2016",
  telefone: "(43) 3333-4444",
  email: "contato@amplinet.com.br",
  cep: "86.010-000",
  logradouro: "DAS FLORES",
  numero: "100",
  complemento: ".",
  bairro: "Centro",
  municipio: "Londrina",
  uf: "PR",
  situacao: "ATIVA",
  qsa: [{ nome: "HELIO CAINELLI", qual: "49-Sócio-Administrador" }],
};

const BRASILAPI = {
  razao_social: "HELIO CAINELLI TELECOM LTDA",
  nome_fantasia: "Amplinet",
  cnpj: "23864873000148",
  natureza_juridica: "Sociedade Empresária Limitada",
  data_inicio_atividade: "2016-01-15",
  descricao_tipo_logradouro: "RUA",
  logradouro: "DAS FLORES",
  numero: "100",
  complemento: ".",
  bairro: "Centro",
  municipio: "Londrina",
  uf: "PR",
  cep: "86010000",
  ddd_telefone_1: "4333334444",
  qsa: [{ nome_socio: "HELIO CAINELLI", qualificacao_socio: "Sócio-Administrador", cnpj_cpf_do_socio: "***111***" }],
};

describe("normalizarCnpj", () => {
  it("aceita com e sem pontuacao", () => {
    expect(normalizarCnpj("23.864.873/0001-48")).toBe(CNPJ);
    expect(normalizarCnpj(CNPJ)).toBe(CNPJ);
  });

  it("recusa o que nao tem 14 digitos, inclusive nulo", () => {
    expect(normalizarCnpj("123")).toBeNull();
    expect(normalizarCnpj("")).toBeNull();
    expect(normalizarCnpj(null)).toBeNull();
    expect(normalizarCnpj(undefined)).toBeNull();
    // CPF tem 11: um provedor pessoa fisica cadastrado por engano nao pode
    // virar uma consulta que as tres fontes recusam uma a uma.
    expect(normalizarCnpj("12345678901")).toBeNull();
  });
});

describe("dataEmIso", () => {
  it("traduz o formato brasileiro da ReceitaWS", () => {
    // Sem isto, cair na ReceitaWS enchia o <input type="date"> com um valor que
    // o navegador descarta em silencio — a data sumia sozinha na frente do
    // provedor.
    expect(dataEmIso("15/01/2016")).toBe("2016-01-15");
  });

  it("deixa passar o que ja e ISO, com ou sem hora", () => {
    expect(dataEmIso("2016-01-15")).toBe("2016-01-15");
    expect(dataEmIso("2016-01-15T00:00:00Z")).toBe("2016-01-15");
  });

  it("devolve vazio para o que nao e data", () => {
    expect(dataEmIso("")).toBe("");
    expect(dataEmIso(null)).toBe("");
    expect(dataEmIso("nao sei")).toBe("");
  });
});

describe("consultarCnpjPublico", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("usa a primeira fonte quando ela responde", async () => {
    const chamadas = montar({ "receitaws.com.br": () => ({ corpo: RECEITAWS }) });

    const e = await consultarCnpjPublico(CNPJ);

    expect(e?.fonte).toBe("ReceitaWS");
    expect(e?.razaoSocial).toBe("HELIO CAINELLI TELECOM LTDA");
    expect(e?.dataAbertura).toBe("2016-01-15");
    expect(chamadas).toHaveLength(1);
  });

  it("cai para a segunda quando a primeira recusa por cota (429)", async () => {
    // ESTE e o caso do defeito: a versao no navegador so conhecia a BrasilAPI e
    // desistia aqui.
    const chamadas = montar({
      "receitaws.com.br": () => ({ status: 429, corpo: {} }),
      "brasilapi.com.br": () => ({ corpo: BRASILAPI }),
    });

    const e = await consultarCnpjPublico(CNPJ);

    expect(e?.fonte).toBe("BrasilAPI");
    expect(e?.razaoSocial).toBe("HELIO CAINELLI TELECOM LTDA");
    expect(chamadas).toHaveLength(2);
  });

  it("cai tambem quando a fonte responde 200 com erro no corpo", async () => {
    // A ReceitaWS devolve 200 com {status:"ERROR"} para CNPJ que nao conhece.
    // Sem esta checagem, a busca terminava ali com um objeto vazio — que na
    // tela vira "encontramos, e nao tem nada", pior do que nao achar.
    const chamadas = montar({
      "receitaws.com.br": () => ({ corpo: { status: "ERROR", message: "CNPJ invalido" } }),
      "brasilapi.com.br": () => ({ corpo: BRASILAPI }),
    });

    expect((await consultarCnpjPublico(CNPJ))?.fonte).toBe("BrasilAPI");
    expect(chamadas).toHaveLength(2);
  });

  it("cai quando a fonte responde sem razao social", async () => {
    const chamadas = montar({
      "receitaws.com.br": () => ({ corpo: { nome: "", qsa: [] } }),
      "brasilapi.com.br": () => ({ corpo: BRASILAPI }),
    });

    expect((await consultarCnpjPublico(CNPJ))?.fonte).toBe("BrasilAPI");
    expect(chamadas).toHaveLength(2);
  });

  it("devolve null — e nao lanca — quando as tres recusam", async () => {
    montar({});   // toda chamada cai a rede

    await expect(consultarCnpjPublico(CNPJ)).resolves.toBeNull();
  });

  it("junta o tipo do logradouro ao nome da rua", async () => {
    // A BrasilAPI separa "RUA" de "DAS FLORES". A copia que vivia no navegador
    // fazia isso; a do servidor nao — e era a do servidor que o superadmin
    // usava. Duas implementacoes do mesmo parser divergem sempre.
    montar({ "brasilapi.com.br": () => ({ corpo: BRASILAPI }), "receitaws.com.br": () => ({ status: 500, corpo: {} }) });

    const e = await consultarCnpjPublico(CNPJ);

    expect(e?.logradouro).toBe("RUA DAS FLORES");
  });

  it("o ponto sozinho no complemento nao vai para a ficha", async () => {
    // E como a Receita marca "sem complemento". Copiado literalmente, ele vira
    // um ponto no meio do endereco impresso na nota fiscal.
    montar({ "receitaws.com.br": () => ({ corpo: RECEITAWS }) });

    expect((await consultarCnpjPublico(CNPJ))?.complemento).toBe("");
  });

  it("o CEP sai so com digitos, qualquer que seja a fonte", async () => {
    montar({ "receitaws.com.br": () => ({ corpo: RECEITAWS }) });

    expect((await consultarCnpjPublico(CNPJ))?.cep).toBe("86010000");
  });

  it("os socios saem no mesmo formato, venha de onde vier", async () => {
    montar({ "receitaws.com.br": () => ({ corpo: RECEITAWS }) });
    const a = await consultarCnpjPublico(CNPJ);

    vi.unstubAllGlobals();
    montar({ "receitaws.com.br": () => ({ status: 500, corpo: {} }), "brasilapi.com.br": () => ({ corpo: BRASILAPI }) });
    const b = await consultarCnpjPublico(CNPJ);

    expect(a?.socios[0].nome).toBe("HELIO CAINELLI");
    expect(b?.socios[0].nome).toBe("HELIO CAINELLI");
    expect(Object.keys(a!.socios[0]).sort()).toEqual(Object.keys(b!.socios[0]).sort());
  });

  it("CNPJ invalido nem chega a perguntar", async () => {
    const chamadas = montar({ "receitaws.com.br": () => ({ corpo: RECEITAWS }) });

    await expect(consultarCnpjPublico("123")).resolves.toBeNull();

    expect(chamadas).toHaveLength(0);
  });

  it("o numero completo nunca vai para o log", async () => {
    // Documento de terceiro em arquivo de log e o incidente que este
    // repositorio ja teve com credencial de ERP, com outro nome de campo.
    const { logger } = await import("../logger");
    montar({ "receitaws.com.br": () => ({ corpo: RECEITAWS }) });

    await consultarCnpjPublico(CNPJ);

    const tudo = JSON.stringify((logger.info as any).mock.calls);
    expect(tudo).not.toContain(CNPJ);
    expect(tudo).toContain("2386***");
  });
});
