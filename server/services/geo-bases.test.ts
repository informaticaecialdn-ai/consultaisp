import { beforeEach, describe, expect, it, vi } from "vitest";

// O banco e o logger ficam de fora: o que se testa aqui é a decisão de gravar
// ou não, e com quais nome/UF — não o Postgres.
const bd = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("../db", () => ({ pool: bd, db: {} }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
  agregarCnefe, agregarAneel, validarTotaisAneel, carregarAneelDoConteudo, FONTE_ANEEL, FONTE_CNEFE,
  linhasDoBuffer,
} from "./geo-bases.service";

/**
 * Parsers de dois formatos que não são nossos e não avisam quando mudam.
 *
 * O erro que mais importa travar aqui é o de contagem: se o filtro de espécie
 * deixar passar comércio, a contagem de domicílios sobe, o denominador da
 * penetração incha e todo bairro parece mal atendido. O número certo é
 * silenciosamente diferente do errado — só um teste separa os dois.
 */

const CAB_CNEFE = "COD_UNICO_ENDERECO;COD_UF;COD_MUNICIPIO;CEP;DSC_LOCALIDADE;LATITUDE;LONGITUDE;COD_ESPECIE";
const linhaCnefe = (localidade: string, especie: string, municipio = "4109807") =>
  `1;41;${municipio};86200000;${localidade};-23.27;-51.04;${especie}`;

describe("CNEFE — só domicílio conta como HP", () => {
  it("espécie 1 e 2 entram; o resto fica de fora", () => {
    const { porBairro } = agregarCnefe([
      CAB_CNEFE,
      linhaCnefe("CENTRO", "1"),   // domicílio particular
      linhaCnefe("CENTRO", "2"),   // domicílio coletivo
      linhaCnefe("CENTRO", "6"),   // estabelecimento comercial
      linhaCnefe("CENTRO", "7"),   // equipamento público
    ].join("\n"));

    expect(porBairro.get("CENTRO")).toBe(2);
  });

  it("agrupa as grafias do mesmo bairro numa contagem só", () => {
    const { porBairro } = agregarCnefe([
      CAB_CNEFE,
      linhaCnefe("Jardim Bandeirantes", "1"),
      linhaCnefe("JARDIM BANDEIRANTES", "1"),
      linhaCnefe("jardim  bandeirantes", "1"),
    ].join("\n"));

    expect(porBairro.get("JARDIM BANDEIRANTES")).toBe(3);
    expect(porBairro.size).toBe(1);
  });

  it("tira o código do município da própria linha", () => {
    const { municipioIbge } = agregarCnefe([CAB_CNEFE, linhaCnefe("CENTRO", "1", "4113700")].join("\n"));
    expect(municipioIbge).toBe("4113700");
  });

  it("endereço sem localidade não vira bairro vazio", () => {
    const { porBairro } = agregarCnefe([
      CAB_CNEFE,
      linhaCnefe("", "1"),
      linhaCnefe("   ", "1"),
      linhaCnefe("CENTRO", "1"),
    ].join("\n"));
    expect(porBairro.size).toBe(1);
    expect(porBairro.has("")).toBe(false);
  });

  it("arquivo sem nenhum domicílio é erro, não zero silencioso", () => {
    expect(() => agregarCnefe([CAB_CNEFE, linhaCnefe("CENTRO", "6")].join("\n")))
      .toThrow(/nenhum domic/i);
  });

  it("cabeçalho fora do esperado é erro explícito", () => {
    expect(() => agregarCnefe("A;B;C\n1;2;3")).toThrow(/COD_MUNICIPIO/);
  });

  it("aceita CRLF — o arquivo do IBGE vem do Windows", () => {
    const { porBairro } = agregarCnefe(`${CAB_CNEFE}\r\n${linhaCnefe("CENTRO", "1")}\r\n`);
    expect(porBairro.get("CENTRO")).toBe(1);
  });
});

describe("ANEEL — UCs vivas por bairro", () => {
  const CAB = "mun;bairro;uc_re_ativas";

  it("separa por município e soma por bairro", () => {
    const m = agregarAneel([
      CAB,
      "4109807;CENTRO;4231",
      "4109807;SAN RAFAEL;1141",
      "4113700;CENTRO;9000",
    ].join("\n"));

    expect(m.get("4109807")!.get("CENTRO")).toBe(4231);
    expect(m.get("4109807")!.get("SAN RAFAEL")).toBe(1141);
    expect(m.get("4113700")!.get("CENTRO")).toBe(9000);
  });

  it("linhas repetidas do mesmo bairro somam — a base vem por transformador", () => {
    const m = agregarAneel([CAB, "4109807;CENTRO;100", "4109807;Centro;50"].join("\n"));
    expect(m.get("4109807")!.get("CENTRO")).toBe(150);
  });

  it("linha sem número utilizável é descartada, não vira zero", () => {
    const m = agregarAneel([CAB, "4109807;CENTRO;", "4109807;CENTRO;x", "4109807;CENTRO;7"].join("\n"));
    expect(m.get("4109807")!.get("CENTRO")).toBe(7);
  });

  it("cabeçalho fora do esperado é erro explícito", () => {
    expect(() => agregarAneel("a;b;c\n1;2;3")).toThrow(/mun/);
  });

  it("agregado com coluna a mais (uc_total) é recusado — o nome uc_re_ativas é a marca do filtro certo", () => {
    // Antes o parser pegava a primeira coluna `uc*` e somava `uc_total` (todas
    // as classes, inativas inclusive) como denominador, sem reclamar.
    expect(() => agregarAneel("mun;bairro;uc_total;uc_re_ativas\n4109807;CENTRO;500;100"))
      .toThrow(/uc_re_ativas/);
    expect(() => agregarAneel("mun;bairro;uc_total\n4109807;CENTRO;500")).toThrow(/uc_re_ativas/);
  });

  it("aceita BOM e caixa alta no cabeçalho — é o que o Excel exporta", () => {
    const m = agregarAneel(`\uFEFFMUN;BAIRRO;UC_RE_ATIVAS\n4109807;CENTRO;7`);
    expect(m.get("4109807")!.get("CENTRO")).toBe(7);
  });

  it("código que não é IBGE de 7 dígitos e contagem negativa não entram", () => {
    const m = agregarAneel([CAB, "41098;CENTRO;10", "4109807;CENTRO;-3", "4109807;CENTRO;7"].join("\n"));
    expect(m.size).toBe(1);
    expect(m.get("4109807")!.get("CENTRO")).toBe(7);
  });
});

describe("ANEEL — totais esperados conferem antes de gravar", () => {
  const CAB = "mun;bairro;uc_re_ativas";
  const csv = [CAB, "4109807;CENTRO;100", "4109807;SAN RAFAEL;50", "4113700;CENTRO;900"].join("\n");

  it("soma igual ao recon passa", () => {
    const m = agregarAneel(csv);
    expect(() => validarTotaisAneel(m, new Map([["4109807", 150], ["4113700", 900]]))).not.toThrow();
  });

  it("soma divergente lança dizendo qual município e quanto", () => {
    const m = agregarAneel(csv);
    expect(() => validarTotaisAneel(m, new Map([["4109807", 151]])))
      .toThrow(/4109807: 150 UCs no CSV, esperado 151/);
  });

  it("município esperado ausente do CSV soma zero e diverge — arquivo errado não é 'nada a fazer'", () => {
    const m = agregarAneel(csv);
    expect(() => validarTotaisAneel(m, new Map([["3550308", 10]]))).toThrow(/3550308: 0 UCs/);
  });
});

describe("ANEEL — carga", () => {
  const CAB = "mun;bairro;uc_re_ativas";
  const conn = { query: vi.fn(), release: vi.fn() };

  beforeEach(() => {
    bd.query.mockReset();
    bd.connect.mockReset();
    conn.query.mockReset();
    conn.release.mockReset();
    // Nenhum município com CNEFE: o SELECT de nome volta vazio; o DDL volta vazio também.
    bd.query.mockResolvedValue({ rows: [] });
    conn.query.mockResolvedValue({ rows: [] });
    bd.connect.mockResolvedValue(conn);
  });

  it("soma divergente aborta a carga inteira sem tocar no banco", async () => {
    const csv = [CAB, "4109807;CENTRO;100", "4113700;CENTRO;900"].join("\n");
    await expect(carregarAneelDoConteudo(csv, new Map([["4109807", 100], ["4113700", 901]])))
      .rejects.toThrow(/4113700: 900 UCs no CSV, esperado 901/);

    // Nem o município certo entrou: a validação vem antes de qualquer escrita.
    expect(bd.query).not.toHaveBeenCalled();
    expect(bd.connect).not.toHaveBeenCalled();
    expect(conn.query).not.toHaveBeenCalled();
  });

  it("município sem CNEFE carrega com nome e UF da lista oficial de municípios", async () => {
    const csv = [CAB, "4113700;CENTRO;900", "4113700;JARDIM BANDEIRANTES;100"].join("\n");
    const rs = await carregarAneelDoConteudo(csv, new Map([["4113700", 1000]]));

    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ municipio: "4113700", cidade: "LONDRINA", uf: "PR", fonte: FONTE_ANEEL, total: 1000, bairros: 2 });

    const inserts = conn.query.mock.calls.filter(([sql]) => /INSERT INTO geo_hps_bairro/.test(String(sql)));
    expect(inserts).toHaveLength(2);
    // A chave gravada é a mesma que o CNEFE produziria — é o que liga o ERP à base.
    for (const [, params] of inserts) {
      expect(params.slice(0, 3)).toEqual(["4113700", "LONDRINA", "PR"]);
      expect(params[4]).toBe(FONTE_ANEEL);
    }
  });

  it("com CNEFE carregado, o nome vem dele — é a grafia que o resto do sistema usa", async () => {
    // Só a linha do CNEFE responde: a da própria ANEEL de uma carga anterior
    // (grafia vinda de outro lugar) não pode ser a que dá nome ao município.
    bd.query.mockImplementation(async (sql: string, params?: unknown[]) =>
      /SELECT cidade_norm/.test(sql) && params?.[1] === FONTE_CNEFE
        ? { rows: [{ cidade_norm: "IBIPORA", uf: "PR" }] }
        : { rows: [] },
    );
    const rs = await carregarAneelDoConteudo([CAB, "4109807;CENTRO;10"].join("\n"));
    expect(rs[0]).toMatchObject({ cidade: "IBIPORA", uf: "PR" });

    const selects = bd.query.mock.calls.filter(([sql]) => /SELECT cidade_norm/.test(String(sql)));
    expect(selects).toHaveLength(1);
    expect(selects[0][1]).toEqual(["4109807", FONTE_CNEFE]);
  });

  it("sem linha do CNEFE, a linha da própria ANEEL anterior não dá o nome — cai na lista oficial", async () => {
    bd.query.mockImplementation(async (sql: string, params?: unknown[]) =>
      /SELECT cidade_norm/.test(sql) && params?.[1] === FONTE_ANEEL
        ? { rows: [{ cidade_norm: "IBIPORAN", uf: "PR" }] }
        : { rows: [] },
    );
    const rs = await carregarAneelDoConteudo([CAB, "4109807;CENTRO;10"].join("\n"));
    expect(rs[0]).toMatchObject({ cidade: "IBIPORA", uf: "PR" });
  });

  it("bairro com zero UC não é gravado nem contado — o número devolvido é o que está na tabela", async () => {
    const csv = [CAB, "4113700;CENTRO;10", "4113700;VAZIO;0"].join("\n");
    const rs = await carregarAneelDoConteudo(csv, new Map([["4113700", 10]]));
    expect(rs[0]).toMatchObject({ total: 10, bairros: 1 });

    const inserts = conn.query.mock.calls.filter(([sql]) => /INSERT INTO geo_hps_bairro/.test(String(sql)));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1][3]).toBe("CENTRO");
  });

  it("código IBGE que não existe em lugar nenhum é ignorado, o resto entra", async () => {
    const csv = [CAB, "9999999;CENTRO;5", "4113700;CENTRO;10"].join("\n");
    const rs = await carregarAneelDoConteudo(csv);
    expect(rs.map(r => r.municipio)).toEqual(["4113700"]);
  });

  it("sem --esperado nada é conferido e a carga segue", async () => {
    const rs = await carregarAneelDoConteudo([CAB, "4113700;CENTRO;10"].join("\n"));
    expect(rs[0].total).toBe(10);
  });
});

/**
 * O CSV QUE NAO CABE NUMA STRING (04/09/2026).
 *
 * A carga de Sao Paulo capital falhava com "Cannot create a string longer than
 * 0x1fffffe8 characters" — o limite de string do V8, que o CNEFE da capital
 * ultrapassa. O provedor Amplinet atende parte da zona sul, na divisa de
 * Embu-Guacu, entao a capital nao era resíduo: era area de atendimento, e 21
 * clientes ficavam fora do mapa por causa disso.
 *
 * `linhasDoBuffer` decodifica em fatias e nunca monta o arquivo inteiro. O que
 * estes casos protegem e o CORTE: uma fatia que cai no meio de uma linha nao
 * pode partir a linha em duas.
 */
describe("linhasDoBuffer", () => {
  const junta = (buf: Buffer) => [...linhasDoBuffer(buf)];

  it("devolve as mesmas linhas que split, para conteudo pequeno", () => {
    const texto = "cab;a;b\n1;2;3\n4;5;6";
    expect(junta(Buffer.from(texto, "latin1"))).toEqual(texto.split("\n"));
  });

  it("aceita CRLF, como o arquivo do IBGE", () => {
    expect(junta(Buffer.from("a\r\nb\r\nc", "latin1"))).toEqual(["a", "b", "c"]);
  });

  it("uma linha cortada entre duas fatias continua inteira", () => {
    // A fatia e de 8 MB. Um conteudo que a atravesse vai ter uma linha partida
    // no meio, e e exatamente isso que a variavel `resto` existe para costurar.
    const linha = (i: number) => `LINHA_${i};${"x".repeat(200)}`;
    const n = 60_000;                                  // ~12 MB, mais de uma fatia
    const esperado = Array.from({ length: n }, (_, i) => linha(i));
    const buf = Buffer.from(esperado.join("\n"), "latin1");

    expect(buf.length).toBeGreaterThan(8 * 1024 * 1024);
    const lido = junta(buf);

    expect(lido).toHaveLength(n);
    expect(lido[0]).toBe(linha(0));
    expect(lido[n - 1]).toBe(linha(n - 1));
    // Nenhuma linha partida: todas comecam com o prefixo inteiro.
    expect(lido.every(l => l.startsWith("LINHA_"))).toBe(true);
  });

  it("preserva latin1 — acento do CNEFE nao pode virar caractere invalido", () => {
    // "IBIPORÃ" lido como UTF-8 quebra o casamento de bairro com o do ERP.
    const buf = Buffer.from("IBIPORÃ;CENTRO\nSÃO PAULO;SÉ", "latin1");
    expect(junta(buf)).toEqual(["IBIPORÃ;CENTRO", "SÃO PAULO;SÉ"]);
  });

  it("buffer vazio nao produz linha nenhuma", () => {
    expect(junta(Buffer.alloc(0))).toEqual([]);
  });
});

describe("agregarCnefe e enderecosCnefe aceitam buffer", () => {
  it("o mesmo conteudo da o mesmo resultado por string e por buffer", () => {
    // A garantia que permite a mudanca: quem passa string (teste, municipio
    // pequeno) continua vendo exatamente o que via.
    const csv = [CAB_CNEFE, linhaCnefe("CENTRO", "1"), linhaCnefe("CENTRO", "1"), linhaCnefe("JARDIM", "1")].join("\n");

    const porString = agregarCnefe(csv);
    const porBuffer = agregarCnefe(linhasDoBuffer(Buffer.from(csv, "latin1")));

    expect(porBuffer.municipioIbge).toBe(porString.municipioIbge);
    expect([...porBuffer.porBairro.entries()].sort()).toEqual([...porString.porBairro.entries()].sort());
  });
});
