/**
 * Carga das bases geográficas públicas — IBGE CNEFE 2022 e ANEEL BDGD.
 *
 * É o que transforma o funil do Raio-X de quatro travessões em números: sem
 * denominador não existe penetração, e penetração inventada é pior que
 * penetração ausente, porque o provedor decide investimento comercial em cima
 * dela.
 *
 * ── CNEFE 2022 (IBGE) ────────────────────────────────────────────────────
 * Censo de endereços. Uma linha por endereço do município, com o bairro em
 * DSC_LOCALIDADE e a espécie em COD_ESPECIE. Só 1 (domicílio particular) e 2
 * (domicílio coletivo) contam como HP — comércio e equipamento público não são
 * casa de ninguém e não compram internet residencial.
 * Arquivo por município, nomeado {codigoIbge}_{NOME}.csv, separado por ';',
 * codificação latin1.
 *
 * ── ANEEL BDGD ───────────────────────────────────────────────────────────
 * Unidades consumidoras residenciais com energia ATIVA, agregadas por bairro.
 * É o melhor denominador que existe: domicílio sem luz não é mercado.
 * CSV com cabeçalho `mun;bairro;uc_re_ativas`.
 *
 * A DDL vive aqui, idempotente, em vez de depender de `drizzle-kit push` —
 * push pergunta "criar ou renomear?" para cada tabela nova e trava um deploy
 * não-interativo. A tabela também está declarada em shared/schema.ts, que é
 * quem dá tipo às consultas.
 */
import { readFileSync, existsSync } from "fs";
import { basename } from "path";
import { pool } from "../db";
import { normalizarLocalidade } from "./localidade";
import { chaveLogradouro, numeroDoEndereco } from "./logradouro";
import { garantirTabelaEnderecos } from "./geocode-local.service";
import { logger } from "../logger";

export const FONTE_CNEFE = "CNEFE2022";
export const FONTE_ANEEL = "ANEEL_BDGD_2024";

export interface ResultadoCarga {
  fonte: string;
  municipio: string;
  cidade: string;
  uf: string;
  bairros: number;
  total: number;
  /** Endereços com coordenada extraídos do mesmo arquivo (só no CNEFE). */
  enderecos?: number;
}

const DDL = `
CREATE TABLE IF NOT EXISTS geo_hps_bairro (
  id            serial PRIMARY KEY,
  municipio_ibge text NOT NULL,
  cidade_norm    text NOT NULL,
  uf             text NOT NULL,
  bairro_norm    text NOT NULL,
  fonte          text NOT NULL,
  hps            integer NOT NULL,
  atualizado_em  timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS geo_hps_bairro_chave
  ON geo_hps_bairro (municipio_ibge, fonte, bairro_norm);
CREATE INDEX IF NOT EXISTS geo_hps_bairro_cidade
  ON geo_hps_bairro (cidade_norm, uf);
`;

export async function garantirTabelasGeo(): Promise<void> {
  await pool.query(DDL);
}

/** UF por código IBGE — os dois primeiros dígitos do código do município. */
const UF_POR_CODIGO: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL",
  "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP",
  "41": "PR", "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

/** Grava o agregado de uma fonte substituindo o que houver — recarregar o
 *  mesmo arquivo não duplica nem soma em cima. */
async function gravar(
  municipioIbge: string, cidadeNorm: string, uf: string, fonte: string,
  porBairro: Map<string, number>,
): Promise<ResultadoCarga> {
  await garantirTabelasGeo();
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    await conn.query(
      "DELETE FROM geo_hps_bairro WHERE municipio_ibge = $1 AND fonte = $2",
      [municipioIbge, fonte],
    );
    let total = 0;
    for (const [bairro, n] of Array.from(porBairro.entries())) {
      if (!bairro || n <= 0) continue;
      total += n;
      await conn.query(
        `INSERT INTO geo_hps_bairro (municipio_ibge, cidade_norm, uf, bairro_norm, fonte, hps)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [municipioIbge, cidadeNorm, uf, bairro, fonte, n],
      );
    }
    await conn.query("COMMIT");
    return { fonte, municipio: municipioIbge, cidade: cidadeNorm, uf, bairros: porBairro.size, total };
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Domicílios por bairro a partir do conteúdo do CSV do CNEFE. Puro. */
export function agregarCnefe(conteudo: string): { municipioIbge: string; porBairro: Map<string, number> } {
  const linhas = conteudo.split(/\r?\n/);
  if (linhas.length < 2) throw new Error("CSV vazio");

  const cab = linhas[0].split(";").map(c => c.trim().toUpperCase());
  const iMunicipio = cab.indexOf("COD_MUNICIPIO");
  const iLocalidade = cab.indexOf("DSC_LOCALIDADE");
  const iEspecie = cab.indexOf("COD_ESPECIE");
  if (iMunicipio < 0 || iLocalidade < 0 || iEspecie < 0) {
    throw new Error("Cabeçalho do CNEFE sem COD_MUNICIPIO, DSC_LOCALIDADE ou COD_ESPECIE");
  }

  const porBairro = new Map<string, number>();
  let municipioIbge = "";
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l) continue;
    const f = l.split(";");
    // Só domicílio: HP é casa, não loja nem escola.
    const especie = (f[iEspecie] || "").trim();
    if (especie !== "1" && especie !== "2") continue;
    if (!municipioIbge) municipioIbge = (f[iMunicipio] || "").trim();
    const bairro = normalizarLocalidade(f[iLocalidade]);
    if (!bairro) continue;
    porBairro.set(bairro, (porBairro.get(bairro) ?? 0) + 1);
  }

  if (!municipioIbge) throw new Error("Nenhum domicílio encontrado no arquivo");
  return { municipioIbge, porBairro };
}

/** UCs vivas por município e bairro a partir do CSV da ANEEL. Puro. */
export function agregarAneel(conteudo: string): Map<string, Map<string, number>> {
  const linhas = conteudo.split(/\r?\n/);
  if (linhas.length < 2) throw new Error("CSV vazio");

  const cab = linhas[0].split(";").map(c => c.trim().toLowerCase());
  const iMun = cab.indexOf("mun");
  const iBairro = cab.indexOf("bairro");
  const iUc = cab.findIndex(c => c.startsWith("uc"));
  if (iMun < 0 || iBairro < 0 || iUc < 0) {
    throw new Error("Cabeçalho da ANEEL sem mun, bairro ou uc_*");
  }

  const porMunicipio = new Map<string, Map<string, number>>();
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l) continue;
    const f = l.split(";");
    const mun = (f[iMun] || "").trim();
    const bairro = normalizarLocalidade(f[iBairro]);
    const uc = parseInt((f[iUc] || "").trim(), 10);
    if (!mun || !bairro || !Number.isFinite(uc)) continue;
    let m = porMunicipio.get(mun);
    if (!m) { m = new Map(); porMunicipio.set(mun, m); }
    // Duas linhas do mesmo bairro somam: a base vem por transformador, e o
    // mesmo bairro pode aparecer em mais de um.
    m.set(bairro, (m.get(bairro) ?? 0) + uc);
  }
  return porMunicipio;
}

export interface EnderecoCnefe {
  logradouroNorm: string;
  numero: number | null;
  cep: string | null;
  bairroNorm: string | null;
  lat: number;
  lon: number;
}

/**
 * Endereços com coordenada, a partir do conteúdo do CSV. Puro.
 *
 * Deduplicado por (logradouro, número): um prédio de cem apartamentos tem cem
 * linhas no censo e uma única porta na rua. Sem isso, Londrina sozinha traria
 * centenas de milhares de linhas redundantes para responder a mesma pergunta.
 */
export function extrairEnderecosCnefe(conteudo: string): EnderecoCnefe[] {
  const linhas = conteudo.split(/\r?\n/);
  if (linhas.length < 2) throw new Error("CSV vazio");

  const cab = linhas[0].split(";").map(c => c.trim().toUpperCase());
  const idx = (nome: string) => cab.indexOf(nome);
  const iTipo = idx("NOM_TIPO_SEGLOGR");
  const iTitulo = idx("NOM_TITULO_SEGLOGR");
  const iNome = idx("NOM_SEGLOGR");
  const iNumero = idx("NUM_ENDERECO");
  const iCep = idx("CEP");
  const iLocalidade = idx("DSC_LOCALIDADE");
  const iLat = idx("LATITUDE");
  const iLon = idx("LONGITUDE");
  if (iNome < 0 || iLat < 0 || iLon < 0) {
    throw new Error("Cabeçalho do CNEFE sem NOM_SEGLOGR, LATITUDE ou LONGITUDE");
  }

  const vistos = new Set<string>();
  const saida: EnderecoCnefe[] = [];

  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l) continue;
    const f = l.split(";");

    const lat = parseFloat((f[iLat] || "").trim());
    const lon = parseFloat((f[iLon] || "").trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat === 0 && lon === 0) continue;

    // O logradouro do censo vem em três campos: tipo, título e nome. Juntos
    // formam a mesma string que a normalização do ERP produz.
    const partes = [
      iTipo >= 0 ? f[iTipo] : "",
      iTitulo >= 0 ? f[iTitulo] : "",
      f[iNome],
    ].map(p => (p || "").trim()).filter(Boolean);
    const logradouroNorm = chaveLogradouro(partes.join(" "));
    if (!logradouroNorm) continue;

    const numero = iNumero >= 0 ? numeroDoEndereco(f[iNumero]) : null;
    const chave = `${logradouroNorm}|${numero ?? ""}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const cepBruto = iCep >= 0 ? (f[iCep] || "").replace(/\D/g, "") : "";
    saida.push({
      logradouroNorm,
      numero,
      cep: cepBruto.length === 8 ? cepBruto : null,
      bairroNorm: iLocalidade >= 0 ? normalizarLocalidade(f[iLocalidade]) || null : null,
      lat,
      lon,
    });
  }

  return saida;
}

/**
 * Carrega um CSV do CNEFE. O município e o nome saem do próprio arquivo — o
 * código está em toda linha, e o nome no nome do arquivo.
 */
export async function carregarCnefe(caminho: string): Promise<ResultadoCarga> {
  if (!existsSync(caminho)) throw new Error(`Arquivo não encontrado: ${caminho}`);

  // latin1: o CNEFE não é UTF-8, e lido como UTF-8 "IBIPORÃ" vira caractere
  // inválido e o bairro deixa de casar com o do ERP.
  const conteudo = readFileSync(caminho, "latin1");
  const { municipioIbge, porBairro } = agregarCnefe(conteudo);

  // "4113700_LONDRINA.csv" → LONDRINA
  const nomeArquivo = basename(caminho).replace(/\.csv$/i, "");
  const cidadeNorm = normalizarLocalidade(nomeArquivo.replace(/^\d+[_-]?/, "").replace(/_/g, " "));
  const uf = UF_POR_CODIGO[municipioIbge.slice(0, 2)] ?? "";
  if (!cidadeNorm) throw new Error(`Não deu para extrair a cidade do nome do arquivo: ${nomeArquivo}`);

  const r = await gravar(municipioIbge, cidadeNorm, uf, FONTE_CNEFE, porBairro);

  // O mesmo arquivo alimenta o geocodificador local. Ler duas vezes o CSV de
  // 47MB para separar as duas cargas seria desperdício.
  const enderecos = extrairEnderecosCnefe(conteudo);
  await gravarEnderecos(municipioIbge, enderecos);
  logger.info({ ...r, enderecos: enderecos.length }, "CNEFE carregado");
  return { ...r, enderecos: enderecos.length };
}

/** Substitui os endereços do município — recarregar não duplica. */
async function gravarEnderecos(municipioIbge: string, enderecos: EnderecoCnefe[]): Promise<void> {
  await garantirTabelaEnderecos();
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    await conn.query("DELETE FROM geo_endereco WHERE municipio_ibge = $1", [municipioIbge]);

    // Em lotes: um INSERT por endereço seriam centenas de milhares de idas ao
    // banco, e um INSERT único estouraria o limite de parâmetros do protocolo.
    const LOTE = 1000;
    for (let i = 0; i < enderecos.length; i += LOTE) {
      const fatia = enderecos.slice(i, i + LOTE);
      const valores: any[] = [];
      const marcadores = fatia.map((e, k) => {
        const b = k * 7;
        valores.push(municipioIbge, e.logradouroNorm, e.numero, e.cep, e.bairroNorm, String(e.lat), String(e.lon));
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
      });
      await conn.query(
        `INSERT INTO geo_endereco
           (municipio_ibge, logradouro_norm, numero, cep, bairro_norm, latitude, longitude)
         VALUES ${marcadores.join(",")}`,
        valores,
      );
    }
    await conn.query("COMMIT");
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Carrega o agregado da ANEEL. Um arquivo pode cobrir vários municípios, então
 * a carga é feita por município encontrado.
 *
 * O CSV não traz o nome da cidade, só o código IBGE — o nome vem do CNEFE já
 * carregado. Município sem CNEFE é ignorado com aviso: sem o nome, o cliente
 * do ERP nunca encontraria essas linhas.
 */
export async function carregarAneel(caminho: string): Promise<ResultadoCarga[]> {
  if (!existsSync(caminho)) throw new Error(`Arquivo não encontrado: ${caminho}`);
  await garantirTabelasGeo();

  const porMunicipio = agregarAneel(readFileSync(caminho, "latin1"));
  const resultados: ResultadoCarga[] = [];
  for (const [mun, porBairro] of Array.from(porMunicipio.entries())) {
    const { rows } = await pool.query<{ cidade_norm: string; uf: string }>(
      "SELECT cidade_norm, uf FROM geo_hps_bairro WHERE municipio_ibge = $1 LIMIT 1",
      [mun],
    );
    if (rows.length === 0) {
      logger.warn({ municipio: mun }, "ANEEL: município sem CNEFE carregado — ignorado");
      continue;
    }
    const r = await gravar(mun, rows[0].cidade_norm, rows[0].uf, FONTE_ANEEL, porBairro);
    logger.info(r, "ANEEL carregada");
    resultados.push(r);
  }
  return resultados;
}

/* ── Leitura ────────────────────────────────────────────────────────────── */

export interface TerritorioDoMunicipio {
  /** bairroNorm → HPs do CNEFE */
  hps: Map<string, number>;
  /** bairroNorm → UCs vivas da ANEEL */
  ucs: Map<string, number>;
}

/**
 * Território das cidades pedidas, indexado por cidade normalizada.
 * Uma consulta só: a tela pede o território de todas as cidades da carteira de
 * uma vez, e uma ida ao banco por cidade seria N idas por render.
 */
export async function carregarTerritorio(
  cidadesNorm: string[],
): Promise<Map<string, TerritorioDoMunicipio>> {
  const mapa = new Map<string, TerritorioDoMunicipio>();
  if (cidadesNorm.length === 0) return mapa;

  let rows: Array<{ cidade_norm: string; bairro_norm: string; fonte: string; hps: number }>;
  try {
    ({ rows } = await pool.query(
      `SELECT cidade_norm, bairro_norm, fonte, hps
         FROM geo_hps_bairro
        WHERE cidade_norm = ANY($1::text[])`,
      [cidadesNorm],
    ));
  } catch (err: any) {
    // Tabela ainda não existe (nenhuma base carregada): o território fica vazio
    // e a tela mostra "sem bases públicas", que é a verdade.
    if (err?.code === "42P01") return mapa;
    throw err;
  }

  for (const r of rows) {
    let t = mapa.get(r.cidade_norm);
    if (!t) { t = { hps: new Map(), ucs: new Map() }; mapa.set(r.cidade_norm, t); }
    const destino = r.fonte === FONTE_ANEEL ? t.ucs : t.hps;
    destino.set(r.bairro_norm, Number(r.hps));
  }
  return mapa;
}
