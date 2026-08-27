/**
 * Leitor de ZIP mínimo, em Node puro.
 *
 * Os arquivos do CNEFE vêm zipados do IBGE e a alternativa seria depender do
 * `unzip` estar instalado no servidor — que numa imagem enxuta de container ou
 * numa VPS recém-criada não está, e a falha aparece só na hora da carga.
 * Como cada zip do censo tem um arquivo só, ler o formato aqui custa pouco e
 * tira uma dependência de sistema do caminho crítico.
 *
 * Lê pelo DIRETÓRIO CENTRAL, no fim do arquivo, e não pelo cabeçalho local: com
 * o bit 3 de flags ligado o cabeçalho local traz tamanho zero e os valores
 * verdadeiros ficam num descritor depois dos dados. O diretório central sempre
 * tem os tamanhos certos.
 */
import { inflateRawSync } from "zlib";

const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const METODO_ARMAZENADO = 0;
const METODO_DEFLATE = 8;

export interface ArquivoDoZip {
  nome: string;
  conteudo: Buffer;
}

/** Acha o "fim do diretório central", que fica no rodapé do arquivo. */
function acharEocd(buf: Buffer): number {
  // O comentário do zip pode ter até 64KB; além disso não há EOCD.
  const inicio = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= inicio; i--) {
    if (buf.readUInt32LE(i) === ASSINATURA_EOCD) return i;
  }
  return -1;
}

/**
 * Extrai as entradas do zip. `filtro` evita descomprimir o que não interessa —
 * num zip de 47MB isso é a diferença entre ler um arquivo e ler todos.
 */
export function lerZip(buf: Buffer, filtro?: (nome: string) => boolean): ArquivoDoZip[] {
  const eocd = acharEocd(buf);
  if (eocd < 0) throw new Error("Não parece um arquivo ZIP (fim do diretório central não encontrado)");

  const totalEntradas = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const saida: ArquivoDoZip[] = [];

  for (let i = 0; i < totalEntradas; i++) {
    if (buf.readUInt32LE(pos) !== ASSINATURA_CENTRAL) {
      throw new Error(`Entrada ${i} do diretório central com assinatura inválida`);
    }
    const metodo = buf.readUInt16LE(pos + 10);
    const tamanhoComprimido = buf.readUInt32LE(pos + 20);
    const tamanhoOriginal = buf.readUInt32LE(pos + 24);
    const tamNome = buf.readUInt16LE(pos + 28);
    const tamExtra = buf.readUInt16LE(pos + 30);
    const tamComentario = buf.readUInt16LE(pos + 32);
    const offsetLocal = buf.readUInt32LE(pos + 42);
    const nome = buf.toString("utf8", pos + 46, pos + 46 + tamNome);
    pos += 46 + tamNome + tamExtra + tamComentario;

    if (nome.endsWith("/")) continue;                 // diretório
    if (filtro && !filtro(nome)) continue;

    // Os tamanhos de nome e extra do cabeçalho LOCAL podem diferir dos do
    // central — o extra local costuma carregar campos que o central não tem.
    const tamNomeLocal = buf.readUInt16LE(offsetLocal + 26);
    const tamExtraLocal = buf.readUInt16LE(offsetLocal + 28);
    const inicioDados = offsetLocal + 30 + tamNomeLocal + tamExtraLocal;
    const dados = buf.subarray(inicioDados, inicioDados + tamanhoComprimido);

    let conteudo: Buffer;
    if (metodo === METODO_ARMAZENADO) conteudo = Buffer.from(dados);
    else if (metodo === METODO_DEFLATE) conteudo = inflateRawSync(dados);
    else throw new Error(`Método de compressão ${metodo} não suportado em "${nome}"`);

    if (tamanhoOriginal && conteudo.length !== tamanhoOriginal) {
      throw new Error(`"${nome}" saiu com ${conteudo.length} bytes, esperado ${tamanhoOriginal}`);
    }
    saida.push({ nome, conteudo });
  }

  return saida;
}
