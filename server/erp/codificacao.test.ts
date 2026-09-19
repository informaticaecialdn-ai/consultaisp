/**
 * Os acentos, medidos em bytes.
 *
 * Em 17/09/2026 a producao tinha 150 nomes de cliente do provider 1 (NsLink,
 * MK) gravados com U+FFFD — o dono viu "GENY SERET GON<invalido>ALVES" na tela
 * do quadro. O mesmo nome vai para o WhatsApp da funcionaria digital e para o
 * e-mail; na identidade ele entra no `cadastroHash` e na triagem de terceiro
 * (a resposta do desafio, desde 17/09/2026, sao so os 4 digitos do CPF).
 *
 * Toda fixture aqui e BYTE, nunca string ja decodificada: o defeito vive
 * exatamente no passo bytes -> texto, e uma fixture escrita como `"GONÇALVES"`
 * em .ts ja passou por esse passo e nao prova nada. O helper `bytes()` recusa
 * caractere nao-ASCII justamente para impedir que a fixture volte a mentir.
 *
 * Os padroes de byte sao os MEDIDOS em producao (ver o diagnostico):
 *   MK  `C3` cru + o texto ASCII `\u0087`   <- quebra
 *   IXC `Ç` para tudo, corpo ASCII puro <- ja correto
 *   SGP `C3 87` cru e valido                 <- ja correto
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  charsetDeclarado,
  decodificarCorpoDoErp,
  lerJsonDoErp,
  pareceUtf8,
  repararContinuacaoEscapada,
} from "./codificacao";
import { MkConnector } from "./connectors/mk";
import { IxcConnector } from "./connectors/ixc";

/**
 * Monta bytes de verdade: trechos ASCII literais + bytes crus em hexadecimal.
 * Recusa caractere nao-ASCII de proposito — se coubesse, a fixture deixaria de
 * ser byte e viraria string ja decodificada, que e o que nao se quer testar.
 */
function bytes(...partes: Array<string | number[]>): Uint8Array {
  const saida: number[] = [];
  for (const parte of partes) {
    if (typeof parte === "string") {
      for (let i = 0; i < parte.length; i += 1) {
        const c = parte.charCodeAt(i);
        if (c > 0x7f) throw new Error(`fixture nao-ASCII em ${JSON.stringify(parte)} — escreva o byte em hexadecimal`);
        saida.push(c);
      }
    } else {
      saida.push(...parte);
    }
  }
  return new Uint8Array(saida);
}

// ── Os bytes que o MK manda no lugar de cada acentuada MAIUSCULA ─────────────
// Cada um e o byte `C3` cru seguido do TEXTO ASCII `\u00XX` (seis bytes:
// 5C 75 30 30 + dois hexadecimais). Conferidos contra as janelas do
// diagnostico, inclusive o hexadecimal MAIUSCULO do `\u008D`.
const C3 = [0xc3];
const ESC_CEDILHA = "\\u0087"; // Ç
const ESC_A_TIL = "\\u0083"; // Ã
const ESC_E_AGUDO = "\\u0089"; // É
const ESC_A_AGUDO = "\\u0081"; // Á
const ESC_I_AGUDO = "\\u008D"; // Í — o MK usa hexadecimal maiusculo

const CT_MK = "text/plain;charset=iso-8859-1"; // MENTE: o corpo e UTF-8
const CT_IXC = "text/x-json; charset=utf-8";
const CT_SGP = "application/json"; // sem charset

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

describe("MK — o byte solto seguido de escape ASCII", () => {
  it("decodifica `C3` + `\\u0087` como `Ç` (hoje sai U+FFFD)", () => {
    const corpo = bytes('{"Nome":"GON', C3, ESC_CEDILHA, 'ALVES"}');

    // O que o `.json()` faz hoje: UTF-8 decode ANTES do JSON.parse, entao o
    // `C3` sozinho vira U+FFFD e o `\u0087` vira o controle C1.
    const comoEraAntes = JSON.parse(new TextDecoder().decode(corpo)) as { Nome: string };
    expect(comoEraAntes.Nome).toBe("GON\uFFFD\u0087ALVES");

    const agora = JSON.parse(decodificarCorpoDoErp(corpo, CT_MK)) as { Nome: string };
    expect(agora.Nome).toBe("GONÇALVES");
    expect(agora.Nome).not.toContain("\uFFFD");
  });

  it("cobre as dez maiusculas que a producao tinha quebrado", () => {
    const casos: Array<[string, string]> = [
      [ESC_CEDILHA, "Ç"], // Ç — 72 ocorrencias
      [ESC_A_TIL, "Ã"], // Ã — 39
      [ESC_I_AGUDO, "Í"], // Í — 20
      [ESC_E_AGUDO, "É"], // É — 20
      [ESC_A_AGUDO, "Á"], // Á — 13
      ["\\u0095", "Õ"], // Õ — 6
      ["\\u0093", "Ó"], // Ó — 5
      ["\\u0094", "Ô"], // Ô — 5
      ["\\u0082", "Â"], // Â — 2
      ["\\u008A", "Ê"], // Ê — 1
    ];
    for (const [escape, letra] of casos) {
      const corpo = bytes('{"n":"X', [0xc3], escape, 'Y"}');
      expect(JSON.parse(decodificarCorpoDoErp(corpo, CT_MK))).toEqual({ n: `X${letra}Y` });
    }
  });

  it("duas quebradas coladas (`...CONCEI` + Ç + Ã + `O`), que e a janela medida", () => {
    const corpo = bytes('{"n":"CONCEI', [0xc3], ESC_CEDILHA, [0xc3], ESC_A_TIL, 'O"}');
    expect(JSON.parse(decodificarCorpoDoErp(corpo, CT_MK))).toEqual({ n: "CONCEIÇÃO" });
  });

  it("as minusculas do MK chegam cruas e validas — e continuam intactas", () => {
    // `ç` U+00E7 = C3 A7: o 2o byte (0xA7) esta fora de 0x80-0x9F, entao o MK
    // nao o escapa. Nunca quebrou, e o reparo nao pode inventar problema.
    const corpo = bytes('{"n":"Concei', [0xc3, 0xa7], [0xc3, 0xa3], 'o"}');
    expect(repararContinuacaoEscapada(corpo)).toBe(corpo); // no-op literal
    expect(JSON.parse(decodificarCorpoDoErp(corpo, CT_MK))).toEqual({ n: "Conceição" });
  });

  it("o charset `iso-8859-1` do MK e ignorado porque os bytes provam UTF-8", () => {
    // Obedecer o cabecalho trocaria 150 nomes quebrados por 3.222 mojibake.
    const corpo = bytes('{"n":"Concei', [0xc3, 0xa7], [0xc3, 0xa3], 'o"}');
    expect(decodificarCorpoDoErp(corpo, CT_MK)).not.toContain("Ã§"); // nada de "Ã§"
    expect(charsetDeclarado(CT_MK)).toBe("iso-8859-1");
  });
});

describe("IXC — corpo ASCII puro, tudo em `\\u00XX`", () => {
  const corpo = bytes(
    '{"page":"1","total":"1","registros":[{"id":"1","razao":"JO\\u00c3O GON\\u00c7ALVES",',
    '"endereco":"Rua Concei\\u00e7\\u00e3o","obs":"25\\u00b0 C"}]}',
  );

  it("nenhum byte alto no corpo — o reparo e no-op literal", () => {
    expect(corpo.every((b) => b < 0x80)).toBe(true);
    expect(repararContinuacaoEscapada(corpo)).toBe(corpo);
  });

  it("os acentos chegam certos, maiusculas inclusive", () => {
    const j = JSON.parse(decodificarCorpoDoErp(corpo, CT_IXC)) as any;
    expect(j.registros[0].razao).toBe("JOÃO GONÇALVES");
    expect(j.registros[0].endereco).toBe("Rua Conceição");
  });

  it("`\\u00b0` legitimo NAO e engolido, mesmo caindo na faixa 0x80-0xBF", () => {
    // A armadilha: 0xB0 esta dentro da faixa que o reparo substitui. Ele so
    // nao age porque nao ha sequencia UTF-8 aberta antes.
    const j = JSON.parse(decodificarCorpoDoErp(corpo, CT_IXC)) as any;
    expect(j.registros[0].obs).toBe("25° C");
  });
});

describe("SGP — UTF-8 cru e valido, sem charset declarado", () => {
  const corpo = bytes(
    '{"contratos":[{"razaoSocial":"GON', [0xc3, 0x87], "ALVES DA CONCEI", [0xc3, 0x87], [0xc3, 0x83],
    'O","endereco":"Rua Concei', [0xc3, 0xa7], [0xc3, 0xa3], 'o","obs":"25', [0xc2, 0xb0], ' C"}]}',
  );

  it("atravessa sem reparo e sem perda", () => {
    expect(repararContinuacaoEscapada(corpo)).toBe(corpo);
    const j = JSON.parse(decodificarCorpoDoErp(corpo, CT_SGP)) as any;
    expect(j.contratos[0].razaoSocial).toBe("GONÇALVES DA CONCEIÇÃO");
    expect(j.contratos[0].endereco).toBe("Rua Conceição");
    expect(j.contratos[0].obs).toBe("25° C");
  });

  it("sequencia valida seguida de escape legitimo nao vira uma coisa so", () => {
    // `C3 A7` ja fecha o caractere; o `\u00a0` (NBSP) que vem logo depois e
    // dado, nao continuacao. Se o reparo olhasse so "byte alto antes", ele
    // colaria os dois e produziria U+FFFD.
    const c = bytes('{"n":"a', [0xc3, 0xa7], '\\u00a0b"}');
    expect(repararContinuacaoEscapada(c)).toBe(c);
    expect(JSON.parse(decodificarCorpoDoErp(c, CT_SGP))).toEqual({ n: "aç\u00a0b" });
  });
});

describe("o reparo nao estraga o que ja esta certo", () => {
  // Estes sao os nomes que a producao TEM inteiros e nao pode perder.
  const nomes = [
    "GONÇALVES", // Ç maiusculo
    "Conceição", // ç e ã minusculos
    "JOSÉ D'ÁVILA-GONÇALVES", // apostrofo, hifen, caixa alta
    "MÜLLER", // trema
    "ANNA-MARIA", // hifen, sem acento
    "JOÃO PAULO II", // til maiusculo + numeral
    "d'Água Fria", // apostrofo no comeco
    "SEBASTIÃO DA CONCEIÇÃO", // varias maiusculas acentuadas
  ];

  it("UTF-8 bem formado passa byte a byte, sem copia e sem mudanca", () => {
    for (const nome of nomes) {
      const crus = new TextEncoder().encode(JSON.stringify({ n: nome }));
      // `toBe` e nao `toEqual`: prova que a funcao devolveu o PROPRIO buffer,
      // isto e, que nao substituiu nada.
      expect(repararContinuacaoEscapada(crus)).toBe(crus);
      expect(JSON.parse(decodificarCorpoDoErp(crus, CT_SGP))).toEqual({ n: nome });
      expect(JSON.parse(decodificarCorpoDoErp(crus, CT_MK))).toEqual({ n: nome });
      expect(JSON.parse(decodificarCorpoDoErp(crus, CT_IXC))).toEqual({ n: nome });
    }
  });

  it("barra escapada nao e confundida com escape de continuacao", () => {
    // Bytes: `\` `\` `u` `0` `0` `8` `7` — em JSON isso e uma barra literal
    // seguida do texto "u0087", nao um escape.
    const c = bytes('{"n":"a', [0xc3, 0xa7], '\\\\u0087b"}');
    expect(repararContinuacaoEscapada(c)).toBe(c);
    expect(JSON.parse(decodificarCorpoDoErp(c, CT_MK))).toEqual({ n: "aç\\u0087b" });
  });

  it("sequencia de 3 bytes com as duas continuacoes escapadas tambem volta", () => {
    // U+2019 (’) = E2 80 99: os DOIS bytes de continuacao caem em 0x80-0x9F.
    const c = bytes('{"n":"D', [0xe2], "\\u0080", "\\u0099", 'AGUA"}');
    expect(JSON.parse(decodificarCorpoDoErp(c, CT_MK))).toEqual({ n: "D’AGUA" });
  });
});

describe("charset: o cabecalho so vence quando os bytes concordam", () => {
  it("latin-1 de verdade e lido como latin-1", () => {
    // `Ç` em latin-1 e o byte unico 0xC7, que nao forma UTF-8 nenhum.
    const c = bytes('{"n":"GON', [0xc7], 'ALVES"}');
    expect(pareceUtf8(c)).toBe(false);
    expect(JSON.parse(decodificarCorpoDoErp(c, "text/plain; charset=iso-8859-1"))).toEqual({ n: "GONÇALVES" });
  });

  it("sem Content-Type nenhum, UTF-8 — que e o padrao do JSON", () => {
    const c = bytes('{"n":"Concei', [0xc3, 0xa7], [0xc3, 0xa3], 'o"}');
    expect(JSON.parse(decodificarCorpoDoErp(c, null))).toEqual({ n: "Conceição" });
    expect(charsetDeclarado(null)).toBeNull();
    expect(charsetDeclarado("application/json")).toBeNull();
  });

  it("le o charset com aspas e espacos", () => {
    expect(charsetDeclarado('text/plain; charset="UTF-8"')).toBe("utf-8");
    expect(charsetDeclarado("text/plain;charset = ISO-8859-1")).toBe("iso-8859-1");
  });

  it("corpo ASCII puro nao e ambiguo na pratica — responde UTF-8", () => {
    expect(pareceUtf8(bytes('{"n":"JOAO"}'))).toBe(true);
  });
});

describe("lerJsonDoErp", () => {
  it("le pelos BYTES quando recebe um Response de verdade", async () => {
    const corpo = bytes('{"Nome":"GON', [0xc3], ESC_CEDILHA, 'ALVES"}');
    const resp = new Response(corpo, { status: 200, headers: { "content-type": CT_MK } });
    expect(await lerJsonDoErp(resp)).toEqual({ Nome: "GONÇALVES" });
  });

  it("rejeita corpo que nao e JSON — o `.catch(() => null)` de quem chama continua valendo", async () => {
    const resp = new Response(bytes("<html>erro do MK</html>"), { status: 200, headers: { "content-type": CT_MK } });
    await expect(lerJsonDoErp(resp)).rejects.toBeInstanceOf(SyntaxError);
    const comCatch = await lerJsonDoErp(
      new Response(bytes("<html>"), { status: 200 }),
    ).catch(() => null);
    expect(comCatch).toBeNull();
  });
});

describe("ponta a ponta: o conector MK com Response de verdade", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const CONFIG = {
    apiUrl: "http://mk.local:8080/mk",
    apiToken: "token-de-teste",
    mkContraSenha: "contra-de-teste",
    extra: {},
  } as any;

  /** O corpo do WSMKConsultaClientes, com os bytes que o MK manda de verdade. */
  const CLIENTES = bytes(
    '{"Clientes":[{"CodigoPessoa":1,"CPF_CNPJ":"', cpfValido(1), '","Situacao":"Ativo",',
    '"Nome":"GEN', [0xc3], ESC_CEDILHA, "A SEBASTI", [0xc3], ESC_A_TIL, "O DA CONCEI", [0xc3], ESC_CEDILHA,
    [0xc3], ESC_A_TIL, 'O",',
    '"endereco":[{"logradouro":"Rua Concei', [0xc3, 0xa7], [0xc3, 0xa3], 'o","numero":10,',
    '"bairro":"Centro","cidade":"Ibipor', [0xc3, 0xa3], '","estado":"PR","cep":"86200000"}]}]}',
  );

  function resposta(corpo: Uint8Array | string): Response {
    const b = typeof corpo === "string" ? bytes(corpo) : corpo;
    return new Response(b, { status: 200, headers: { "content-type": CT_MK } });
  }

  it("grava o nome com os acentos certos, e nao com U+FFFD", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("WSAutenticacao")) return resposta('{"Token":"sessao-fake"}');
        if (u.includes("WSMKConsultaClientes")) {
          const ini = Number(new URL(u).searchParams.get("cd_cliente_inicio"));
          return resposta(ini === 1 ? CLIENTES : '{"Clientes":[]}');
        }
        // A V2 tem de vir antes: o nome dela contem o nome da V1.
        if (u.includes("WSMKContratosPorClienteV2")) {
          return resposta('[{"codcontrato":1,"status_contrato":"Ativo"}]');
        }
        if (u.includes("WSMKContratosPorCliente")) {
          return resposta('{"ContratosAtivos":[{"codcontrato":1}]}');
        }
        return resposta("{}");
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const r = await new MkConnector().fetchCustomers(CONFIG);

    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(1);
    const c = r.customers[0]!;
    expect(c.name).toBe("GENÇA SEBASTIÃO DA CONCEIÇÃO");
    expect(c.name).not.toContain("\uFFFD");
    // O endereco, que e caixa mista, mantem as minusculas que nunca quebraram.
    expect(c.address).toContain("Conceição");
    expect(c.city).toContain("Ibiporã");
  });
});

describe("ponta a ponta: o conector IXC segue certo depois da mudanca", () => {
  // O IXC nunca quebrou, e o risco desta tarefa e justamente estragar quem
  // estava bom. As fixtures dos testes vizinhos do IXC entregam o objeto ja
  // pronto (`json: async () => ...`), entao nao passam pelo caminho de bytes.
  // Este passa: `Response` de verdade, com o corpo ASCII escapado que o IXC
  // manda mesmo.
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const CONFIG = { apiUrl: "https://ixc.local", apiUser: "45", apiToken: "token", extra: {} } as any;
  const CPF = "041.179.829-40";
  const vencida = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);

  /** Envelope do IXC: ASCII puro, acento so em `\u00XX`. */
  function envelope(registros: string): Response {
    const corpo = bytes('{"page":"1","total":"1","registros":[', registros, "]}");
    expect(corpo.every((b) => b < 0x80)).toBe(true); // a fixture tem de ser ASCII
    return new Response(corpo, { status: 200, headers: { "content-type": CT_IXC } });
  }

  it("le razao social com acento pelo escape, sem U+FFFD", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const tabela = String(url).split("/webservice/v1/")[1] ?? "";
        if (tabela === "fn_areceber") {
          return envelope(
            `{"id":"1","id_cliente":"7","status":"A","liberado":"S","data_vencimento":"${vencida}","valor":"122.68","documento":"1"}`,
          );
        }
        if (tabela === "cliente") {
          return envelope(
            `{"id":"7","razao":"JO\\u00c3O GON\\u00c7ALVES","cnpj_cpf":"${CPF}","cidade":"4101",` +
              '"bairro":"S\\u00e3o Jos\\u00e9","endereco":"Rua Concei\\u00e7\\u00e3o","cep":"86200-000"}',
          );
        }
        if (tabela === "cidade") return envelope('{"id":"4101","nome":"Londrina","uf":"18"}');
        if (tabela === "uf") return envelope('{"id":"18","uf":"PR"}');
        if (tabela === "cliente_contrato") {
          return envelope('{"id":"1","id_cliente":"7","status":"A","status_internet":"FA","contrato":"Fibra 300"}');
        }
        return new Response(bytes('{"page":"1","total":"0","registros":[]}'), {
          status: 200,
          headers: { "content-type": CT_IXC },
        });
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const r = await new IxcConnector().fetchDelinquents(CONFIG);

    expect(r.ok).toBe(true);
    const c = r.customers.find((x) => x.name?.includes("GON"));
    expect(c?.name).toBe("JOÃO GONÇALVES");
    expect(JSON.stringify(r.customers)).not.toContain("\uFFFD");
  });
});
