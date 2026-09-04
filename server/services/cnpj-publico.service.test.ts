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

import {
  consultarCnpjPublico, normalizarCnpj, dataEmIso, situacaoCanonica,
} from "./cnpj-publico.service";

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
  descricao_situacao_cadastral: "ATIVA",
  qsa: [{ nome_socio: "HELIO CAINELLI", qualificacao_socio: "Sócio-Administrador", cnpj_cpf_do_socio: "***111***" }],
};

/**
 * A terceira fonte, a que so entra quando as duas primeiras recusam por cota —
 * e a unica que escreve a situacao em caixa mista ("Ativa", nao "ATIVA").
 */
const PUBLICA = {
  razao_social: "HELIO CAINELLI TELECOM LTDA",
  natureza_juridica: { descricao: "Sociedade Empresária Limitada" },
  estabelecimento: {
    nome_fantasia: "Amplinet",
    data_inicio_atividade: "2016-01-15",
    atividade_principal: { descricao: "Provedores de acesso às redes de comunicações" },
    ddd1: "43",
    telefone1: "33334444",
    email: "contato@amplinet.com.br",
    cep: "86010000",
    tipo_logradouro: "RUA",
    logradouro: "DAS FLORES",
    numero: "100",
    complemento: "-",
    bairro: "Centro",
    cidade: { nome: "Londrina" },
    estado: { sigla: "PR" },
    situacao_cadastral: "Ativa",
  },
  socios: [{ nome: "HELIO CAINELLI", qualificacao: { descricao: "Sócio-Administrador" }, cpf_cnpj_socio: "***111***" }],
};

/** As duas primeiras recusam por cota — o caminho que leva ate a Publica. */
const SO_A_PUBLICA_RESPONDE = {
  "receitaws.com.br": () => ({ status: 429, corpo: {} }),
  "brasilapi.com.br": () => ({ status: 429, corpo: {} }),
  "publica.cnpj.ws": () => ({ corpo: PUBLICA }),
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

describe("situacaoCanonica", () => {
  it("poe as tres fontes na mesma lingua, uma grafia por fonte", () => {
    // ReceitaWS e BrasilAPI ja mandam em caixa alta; a Publica manda "Ativa".
    // Sao as tres grafias que existem hoje, conferidas nos parsers.
    expect(situacaoCanonica("ATIVA")).toBe("ATIVA");
    expect(situacaoCanonica("Ativa")).toBe("ATIVA");
  });

  it("nao muda o fato, so a caixa — as outras situacoes passam iguais", () => {
    // Canonizar nao pode transformar irregular em regular: uma empresa baixada
    // continua baixada, e o aviso ambar continua aparecendo.
    expect(situacaoCanonica("Baixada")).toBe("BAIXADA");
    expect(situacaoCanonica("SUSPENSA")).toBe("SUSPENSA");
    expect(situacaoCanonica("Inapta")).toBe("INAPTA");
  });

  it("apara espaco em volta e colapsa o do meio", () => {
    expect(situacaoCanonica("  ativa  ")).toBe("ATIVA");
    expect(situacaoCanonica("BAIXADA  POR  OFICIO")).toBe("BAIXADA POR OFICIO");
  });

  it("o ausente vira vazio, e nao a palavra 'null'", () => {
    // Vazio e o que as telas testam com `cnpjData?.situacao &&` para NAO
    // desenhar o aviso: qualquer texto ali acenderia o ambar sem motivo.
    expect(situacaoCanonica("")).toBe("");
    expect(situacaoCanonica(null)).toBe("");
    expect(situacaoCanonica(undefined)).toBe("");
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

  it("a situacao sai em caixa alta na primeira fonte", async () => {
    montar({ "receitaws.com.br": () => ({ corpo: RECEITAWS }) });

    expect((await consultarCnpjPublico(CNPJ))?.situacao).toBe("ATIVA");
  });

  it("a situacao sai em caixa alta na segunda fonte", async () => {
    montar({
      "receitaws.com.br": () => ({ status: 429, corpo: {} }),
      "brasilapi.com.br": () => ({ corpo: BRASILAPI }),
    });

    expect((await consultarCnpjPublico(CNPJ))?.situacao).toBe("ATIVA");
  });

  it("a terceira fonte manda 'Ativa', e a empresa regular NAO vira irregular", async () => {
    // ESTE e o defeito: as duas telas comparam com `=== "ATIVA"`, entao a
    // grafia da Publica acendia o aviso ambar de irregularidade para uma
    // empresa em dia. Quem le esse aviso e o superadmin, que pode reprovar ou
    // suspender o provedor — e as duas acoes mandam e-mail sem volta.
    const chamadas = montar(SO_A_PUBLICA_RESPONDE);

    const e = await consultarCnpjPublico(CNPJ);

    expect(e?.fonte).toBe("Publica");
    expect(e?.situacao).toBe("ATIVA");
    expect(e!.situacao !== "ATIVA").toBe(false);   // a comparacao que as telas fazem
    expect(chamadas).toHaveLength(3);
  });

  it("a terceira fonte tambem nao esconde a empresa baixada", async () => {
    // O outro lado da mesma regra: canonizar so muda a caixa, nunca o fato.
    montar({
      ...SO_A_PUBLICA_RESPONDE,
      "publica.cnpj.ws": () => ({
        corpo: {
          ...PUBLICA,
          estabelecimento: { ...PUBLICA.estabelecimento, situacao_cadastral: "Baixada" },
        },
      }),
    });

    expect((await consultarCnpjPublico(CNPJ))?.situacao).toBe("BAIXADA");
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
