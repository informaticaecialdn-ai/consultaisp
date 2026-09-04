/**
 * Busca do CNEFE no FTP do IBGE.
 *
 * O provedor não deveria ter de achar, baixar e descompactar um arquivo de
 * 47MB para que o mapa funcione — muito menos repetir isso a cada cidade nova
 * que ele passar a atender. Aqui basta o nome da cidade.
 *
 * O nome do arquivo no IBGE segue `{codigo}_{NOME_COM_UNDERSCORE}.zip`, mas o
 * NOME tem casos que não dá para prever de fora ("Santa Bárbara d'Oeste"). Por
 * isso o arquivo é localizado LENDO o índice do diretório da UF e procurando o
 * que começa com o código do município — imune a acento, apóstrofo e hífen.
 */
import citiesData from "../../shared/data/cidades-brasil.json";
import { normalizarCidade } from "./area-atendida";
import { lerZip } from "./zip";
import { logger } from "../logger";

const BASE_IBGE =
  "https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos" +
  "/Censo_Demografico_2022/Arquivos_CNEFE/CSV/Municipio";

interface Municipio { nome: string; uf: string; ibge: string }

/** Aceita o nome da cidade ("Londrina", "Cambé - PR") ou o código IBGE. */
export function resolverMunicipio(entrada: string): Municipio | null {
  const bruto = entrada.trim();
  const lista = citiesData as Municipio[];

  if (/^\d{7}$/.test(bruto)) return lista.find(c => c.ibge === bruto) ?? null;

  // "Cambé - PR" carrega a UF, que desempata as homônimas (existem várias
  // "Bom Jesus" e "Santa Luzia" no país).
  const comUf = bruto.match(/^(.*?)\s*[-\/]\s*([A-Za-z]{2})$/);
  const nome = normalizarCidade(comUf ? comUf[1] : bruto);
  const uf = comUf ? comUf[2].toUpperCase() : null;

  const achados = lista.filter(c =>
    normalizarCidade(c.nome) === nome && (uf === null || c.uf === uf));

  if (achados.length === 1) return achados[0];
  if (achados.length > 1) {
    throw new Error(
      `"${bruto}" existe em ${achados.map(c => c.uf).join(", ")} — informe a UF ` +
      `("${bruto} - ${achados[0].uf}") ou o código IBGE.`,
    );
  }
  return null;
}

/** Localiza o zip do município no índice do diretório da UF. */
async function acharUrlDoZip(m: Municipio): Promise<string> {
  const dir = `${BASE_IBGE}/${m.ibge.slice(0, 2)}_${m.uf}`;
  const r = await fetch(`${dir}/`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`Índice do IBGE respondeu HTTP ${r.status} em ${dir}`);

  const html = await r.text();
  const nomes = Array.from(html.matchAll(/href="([^"]+\.zip)"/g)).map(x => x[1]);
  const alvo = nomes.find(n => n.startsWith(`${m.ibge}_`));
  if (!alvo) {
    throw new Error(`Nenhum arquivo começando com ${m.ibge}_ no índice de ${m.uf}`);
  }
  return `${dir}/${encodeURI(alvo)}`;
}

/**
 * Baixa e descompacta o CNEFE do município. Devolve o CSV em memória — o
 * ingestor já lê tudo de uma vez, e gravar 47MB em disco só para reler seria
 * um passo a mais para dar errado.
 */
export async function baixarCnefe(entrada: string): Promise<{ municipio: Municipio; csv: Buffer }> {
  const m = resolverMunicipio(entrada);
  if (!m) throw new Error(`Município "${entrada}" não encontrado na tabela do IBGE`);

  const url = await acharUrlDoZip(m);
  logger.info({ municipio: m.nome, uf: m.uf, url }, "Baixando CNEFE do IBGE");

  // Municípios grandes passam de 40MB; o download leva minutos numa conexão
  // modesta e não pode morrer num timeout curto.
  const r = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
  if (!r.ok) throw new Error(`Download falhou: HTTP ${r.status} em ${url}`);

  const zip = Buffer.from(await r.arrayBuffer());
  const arquivos = lerZip(zip, n => n.toLowerCase().endsWith(".csv"));
  if (arquivos.length === 0) throw new Error("O zip do IBGE não trouxe nenhum CSV");

  /**
   * Devolve o BUFFER, e nao a string.
   *
   * `toString("latin1")` estourava em Sao Paulo capital: "Cannot create a
   * string longer than 0x1fffffe8 characters", o limite de string do V8. Quem
   * decodifica agora e `linhasDoBuffer` (geo-bases.service.ts), em fatias, e o
   * arquivo inteiro nunca vira uma string so.
   *
   * A decodificacao continua latin1 la: o CNEFE nao e UTF-8, e lido como UTF-8
   * "IBIPORA" com til vira caractere invalido e o bairro deixa de casar com o
   * do ERP.
   */
  return { municipio: m, csv: arquivos[0].conteudo };
}
