/**
 * Pontos do território — as camadas fixas de fundo do mapa.
 *
 * Duas bases públicas, uma cor cada, desenhadas por trás da carteira:
 *   • cnefe — todos os endereços-domicílio do município (IBGE CNEFE 2022)
 *   • aneel — unidades consumidoras residenciais ativas (ANEEL BDGD 2024)
 *
 * O formato é o mesmo dos assets do Provedor.ai: Float32Array intercalado
 * [lat0, lon0, lat1, lon1, ...], 8 bytes por ponto, sem cabeçalho. É o que a
 * GPU consome direto — o cliente faz `new Float32Array(arrayBuffer)` e sobe.
 * JSON custaria ~6× o tamanho e um parse de centenas de milhares de números.
 *
 * ── De onde vem o dado ───────────────────────────────────────────────────
 *   1. `server/data/territorio/<camada>-<ibge>.bin`, quando existe (gerado 1×
 *      fora daqui e copiado para o repositório).
 *   2. Para o CNEFE sem .bin, a própria tabela `geo_endereco` — a base que o
 *      geocodificador local já carrega para o município. NÃO é o mesmo dado:
 *      o .bin traz só domicílios (COD_ESPECIE 1 e 2), um ponto por linha do
 *      censo; `geo_endereco` é montada por extrairEnderecosCnefe sem olhar a
 *      espécie (entra comércio, escola, igreja) e deduplicada por
 *      logradouro + número (um prédio inteiro vira um ponto). A resposta diz
 *      de onde veio (`origem`) e a tela troca o rótulo — a contagem de uma
 *      cidade "de banco" não se compara com a de uma cidade com .bin.
 *   3. Para a ANEEL sem .bin não há segunda fonte: a BDGD só guarda o
 *      agregado por bairro (geo_hps_bairro), sem ponto por UC. Devolve null e
 *      a rota responde 404 — a pill fica desabilitada dizendo o porquê.
 *
 * Não é dado de cliente nem de provedor: nada aqui é filtrado por tenant e
 * nada identifica ninguém. Por isso o cache é global ao processo.
 */
import { existsSync, readFileSync } from "fs";
import path from "path";
import { createHash } from "crypto";
import { pool } from "../db";
import { normalizarCidade } from "./area-atendida";
import { logger } from "../logger";

export type CamadaTerritorio = "cnefe" | "aneel";

export const CAMADAS_TERRITORIO: readonly CamadaTerritorio[] = ["cnefe", "aneel"];

export function ehCamadaTerritorio(s: string): s is CamadaTerritorio {
  return (CAMADAS_TERRITORIO as readonly string[]).includes(s);
}

export interface PontosTerritorio {
  /** [lat, lon] intercalado — `length / 2` é o número de pontos. */
  pontos: Float32Array;
  /** Hash do conteúdo, pronto para o cabeçalho ETag. */
  etag: string;
  origem: "bin" | "banco";
}

/**
 * process.cwd() e não __dirname: em produção o servidor é um bundle único em
 * dist/, e __dirname apontaria para lá. O pm2 sobe da raiz do repositório —
 * a mesma convenção de server/migrate.ts.
 */
const DIR_PADRAO = path.resolve(process.cwd(), "server", "data", "territorio");

/** Quanto tempo uma resposta negativa vale antes de perguntar de novo ao banco. */
const TTL_NEGATIVO_MS = 10 * 60 * 1000;

const cachePontos = new Map<string, Promise<PontosTerritorio | null>>();
const cacheMunicipio = new Map<string, Promise<string | null>>();
const negativosAte = new Map<string, number>();

/** Só para os testes: cada caso começa sem memória do anterior. */
export function limparCacheTerritorio(): void {
  cachePontos.clear();
  cacheMunicipio.clear();
  negativosAte.clear();
}

/**
 * Buffer → Float32Array sem copiar quando dá.
 *
 * Um Buffer pequeno pode vir do pool do Node com byteOffset que não é múltiplo
 * de 4, e o construtor do Float32Array estoura nesse caso; aí copia. Bytes
 * sobrando no fim (arquivo truncado) são ignorados em vez de virar um ponto
 * com lat sem lon.
 */
export function decodificarBin(buf: Buffer): Float32Array {
  const n = Math.floor(buf.byteLength / 8) * 2;
  if (buf.byteOffset % 4 === 0) {
    return new Float32Array(buf.buffer, buf.byteOffset, n);
  }
  const copia = new Float32Array(n);
  for (let i = 0; i < n; i++) copia[i] = buf.readFloatLE(i * 4);
  return copia;
}

function etagDe(pontos: Float32Array): string {
  const bytes = Buffer.from(pontos.buffer, pontos.byteOffset, pontos.byteLength);
  return `"${createHash("sha1").update(bytes).digest("hex")}"`;
}

function lerBin(dir: string, camada: CamadaTerritorio, municipioIbge: string): Float32Array | null {
  const caminho = path.join(dir, `${camada}-${municipioIbge}.bin`);
  if (!existsSync(caminho)) return null;
  return decodificarBin(readFileSync(caminho));
}

/**
 * CNEFE a partir de geo_endereco. Latitude e longitude são numeric no banco;
 * pedir como texto evita o pg devolver Number já arredondado por conta própria.
 */
async function lerCnefeDoBanco(municipioIbge: string): Promise<Float32Array | null> {
  let rows: Array<{ latitude: string; longitude: string }>;
  try {
    ({ rows } = await pool.query(
      `SELECT latitude::text, longitude::text FROM geo_endereco WHERE municipio_ibge = $1`,
      [municipioIbge],
    ));
  } catch (err: any) {
    if (err?.code === "42P01") return null; // tabela ainda não existe
    throw err;
  }
  if (rows.length === 0) return null;

  const out = new Float32Array(rows.length * 2);
  let n = 0;
  for (const r of rows) {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out[n++] = lat;
    out[n++] = lon;
  }
  return n === 0 ? null : out.subarray(0, n);
}

/**
 * Pontos da camada para um município. `null` = não há base para desenhar.
 *
 * O resultado positivo fica em memória pelo tempo do processo: são até ~2 MB
 * por município e a base não muda entre deploys. O negativo expira em minutos,
 * para que carregar o CNEFE no banco apareça no mapa sem reiniciar nada.
 */
export function pontosDoTerritorio(
  camada: CamadaTerritorio,
  municipioIbge: string,
  opts: { dir?: string } = {},
): Promise<PontosTerritorio | null> {
  const dir = opts.dir ?? DIR_PADRAO;
  const chave = `${camada}-${municipioIbge}`;

  const negativoAte = negativosAte.get(chave);
  if (negativoAte !== undefined) {
    if (Date.now() < negativoAte) return Promise.resolve(null);
    negativosAte.delete(chave);
  }

  const emCache = cachePontos.get(chave);
  if (emCache) return emCache;

  const p = (async (): Promise<PontosTerritorio | null> => {
    const doBin = lerBin(dir, camada, municipioIbge);
    if (doBin) return { pontos: doBin, etag: etagDe(doBin), origem: "bin" };
    if (camada !== "cnefe") return null;
    const doBanco = await lerCnefeDoBanco(municipioIbge);
    if (!doBanco) return null;
    logger.info({ municipioIbge, pontos: doBanco.length / 2 }, "Camada CNEFE montada a partir de geo_endereco");
    return { pontos: doBanco, etag: etagDe(doBanco), origem: "banco" };
  })();

  cachePontos.set(chave, p);
  p.then(
    r => {
      if (r === null) {
        cachePontos.delete(chave);
        negativosAte.set(chave, Date.now() + TTL_NEGATIVO_MS);
      }
    },
    () => cachePontos.delete(chave), // falha não fica em cache: o próximo pedido tenta de novo
  );
  return p;
}

/**
 * Cidade como o ERP escreve → código IBGE do município.
 *
 * O vínculo mora em geo_hps_bairro, gravado junto com cada base carregada —
 * o mesmo caminho que o geocodificador local usa. Os dois lados são
 * comparados normalizados, porque a tabela guarda em caixa alta e a tela
 * manda "Londrina" ou "Londrina - PR".
 *
 * A UF desempata homônimas (Bom Jesus, Santa Luzia, Planalto…) quando duas
 * bases de estados diferentes convivem no banco. Sem UF e com mais de um
 * município para o nome, devolve null em vez de escolher um: o resultado fica
 * em cache pelo processo inteiro e o navegador prende por 7 dias — um mapa
 * com os endereços de outro estado por baixo da carteira não é dado real.
 */
export function municipioDaCidade(cidade: string, uf?: string | null): Promise<string | null> {
  const nome = normalizarCidade(cidade);
  if (!nome) return Promise.resolve(null);
  const ufNorm = (uf ?? "").trim().toUpperCase() || null;
  const chave = ufNorm ? `${nome}|${ufNorm}` : nome;

  const emCache = cacheMunicipio.get(chave);
  if (emCache) return emCache;

  const p = (async (): Promise<string | null> => {
    try {
      const params: string[] = [nome, nome.toUpperCase()];
      if (ufNorm) params.push(ufNorm);
      const { rows } = await pool.query(
        `SELECT DISTINCT municipio_ibge FROM geo_hps_bairro
          WHERE (lower(cidade_norm) = $1 OR cidade_norm = $2)${ufNorm ? " AND upper(uf) = $3" : ""}
          ORDER BY municipio_ibge`,
        params,
      );
      if (rows.length > 1) {
        logger.warn(
          { cidade: nome, uf: ufNorm, municipios: rows.map((r: any) => r.municipio_ibge) },
          "Cidade com mais de um município na base — informe a UF para desempatar",
        );
        return null;
      }
      return rows[0]?.municipio_ibge ?? null;
    } catch (err: any) {
      if (err?.code === "42P01") return null;
      throw err;
    }
  })();

  cacheMunicipio.set(chave, p);
  // Só o acerto fica: a cidade pode ganhar base amanhã.
  p.then(r => { if (r === null) cacheMunicipio.delete(chave); }, () => cacheMunicipio.delete(chave));
  return p;
}
