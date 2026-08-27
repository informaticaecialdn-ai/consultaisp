import { describe, expect, it } from "vitest";
import { deflateRawSync, crc32 } from "zlib";
import { lerZip } from "./zip";

/**
 * Leitor de ZIP escrito à mão para não depender de `unzip` estar instalado no
 * servidor. Erro de offset aqui não dá exceção: dá arquivo corrompido, que só
 * aparece muito depois como "o bairro não casou". Os testes montam zips byte a
 * byte para travar cada caminho.
 */

interface Entrada { nome: string; dados: Buffer; comprimir: boolean }

/** Monta um ZIP mínimo e correto, com diretório central. */
function montarZip(entradas: Entrada[], opcoes: { zerarTamanhoLocal?: boolean } = {}): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let offset = 0;

  for (const e of entradas) {
    const nome = Buffer.from(e.nome, "utf8");
    const conteudo = e.comprimir ? deflateRawSync(e.dados) : e.dados;
    const metodo = e.comprimir ? 8 : 0;
    const crc = crc32(e.dados);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    // Bit 3: tamanhos vão num descritor depois dos dados, e o cabeçalho local
    // mente zero. É o caso que obriga a ler pelo diretório central.
    local.writeUInt16LE(opcoes.zerarTamanhoLocal ? 0x08 : 0, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(opcoes.zerarTamanhoLocal ? 0 : crc, 14);
    local.writeUInt32LE(opcoes.zerarTamanhoLocal ? 0 : conteudo.length, 18);
    local.writeUInt32LE(opcoes.zerarTamanhoLocal ? 0 : e.dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);

    const bloco = Buffer.concat([local, nome, conteudo]);
    locais.push(bloco);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(conteudo.length, 20);
    central.writeUInt32LE(e.dados.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(offset, 42);
    centrais.push(Buffer.concat([central, nome]));

    offset += bloco.length;
  }

  const diretorio = Buffer.concat(centrais);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(diretorio.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locais, diretorio, eocd]);
}

const texto = (s: string) => Buffer.from(s, "utf8");

describe("lerZip", () => {
  it("extrai conteúdo comprimido", () => {
    const conteudo = "CEP;BAIRRO\n86200000;CENTRO\n".repeat(500);
    const [a] = lerZip(montarZip([{ nome: "dados.csv", dados: texto(conteudo), comprimir: true }]));
    expect(a.nome).toBe("dados.csv");
    expect(a.conteudo.toString("utf8")).toBe(conteudo);
  });

  it("extrai conteúdo armazenado sem compressão", () => {
    const [a] = lerZip(montarZip([{ nome: "cru.csv", dados: texto("abc"), comprimir: false }]));
    expect(a.conteudo.toString("utf8")).toBe("abc");
  });

  it("lê pelo diretório central quando o cabeçalho local mente tamanho zero", () => {
    // É o caso do bit 3 de flags — quem lê pelo cabeçalho local extrai vazio.
    const conteudo = "linha\n".repeat(200);
    const zip = montarZip([{ nome: "d.csv", dados: texto(conteudo), comprimir: true }], { zerarTamanhoLocal: true });
    const [a] = lerZip(zip);
    expect(a.conteudo.toString("utf8")).toBe(conteudo);
  });

  it("separa várias entradas", () => {
    const r = lerZip(montarZip([
      { nome: "um.csv", dados: texto("111"), comprimir: true },
      { nome: "dois.csv", dados: texto("222"), comprimir: true },
      { nome: "tres.txt", dados: texto("333"), comprimir: false },
    ]));
    expect(r.map(x => x.nome)).toEqual(["um.csv", "dois.csv", "tres.txt"]);
    expect(r.map(x => x.conteudo.toString())).toEqual(["111", "222", "333"]);
  });

  it("o filtro evita descomprimir o que não interessa", () => {
    const r = lerZip(montarZip([
      { nome: "leia.csv", dados: texto("sim"), comprimir: true },
      { nome: "ignore.pdf", dados: texto("nao"), comprimir: true },
    ]), n => n.endsWith(".csv"));
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe("leia.csv");
  });

  it("pula entradas de diretório", () => {
    const r = lerZip(montarZip([
      { nome: "pasta/", dados: Buffer.alloc(0), comprimir: false },
      { nome: "pasta/a.csv", dados: texto("x"), comprimir: true },
    ]));
    expect(r.map(x => x.nome)).toEqual(["pasta/a.csv"]);
  });

  it("arquivo que não é ZIP dá erro claro, não conteúdo vazio", () => {
    expect(() => lerZip(Buffer.from("<html>404 Not Found</html>")))
      .toThrow(/n[ãa]o parece um arquivo zip/i);
  });

  it("acha o EOCD mesmo com comentário no rodapé", () => {
    const zip = montarZip([{ nome: "a.csv", dados: texto("ok"), comprimir: true }]);
    const comComentario = Buffer.concat([zip, Buffer.from("comentario qualquer")]);
    comComentario.writeUInt16LE(19, comComentario.length - 19 - 2);
    const [a] = lerZip(comComentario);
    expect(a.conteudo.toString()).toBe("ok");
  });
});
