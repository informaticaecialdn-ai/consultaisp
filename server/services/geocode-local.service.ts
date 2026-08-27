/**
 * Geocodificador local — endereço vira coordenada sem sair da máquina.
 *
 * O censo de endereços do IBGE (CNEFE 2022) traz latitude e longitude de cada
 * endereço do município. Com ele na base, geocodificar deixa de ser uma chamada
 * de rede por cliente — serializada a 1 req/s pelo limite do Nominatim, sujeita
 * a quota e a o serviço estar de pé — e vira uma consulta ao próprio banco.
 *
 * ── A cascata, do melhor para o pior ────────────────────────────────────
 *   1. `endereco`   — logradouro + número batem exatamente. É a casa.
 *   2. `logradouro` — a rua bate, o número não. Devolve a mediana da rua:
 *                     erro de alguns quarteirões, dentro do bairro certo.
 *   3. `bairro`     — nem a rua bate. Devolve o centroide do bairro.
 *   4. nada         — o endereço não existe no censo daquele município.
 *
 * O que ela substitui é pior em tudo: quando a rua não resolvia na rede, o
 * cliente ia para o centro da cidade com jitter de ±2km. Isso não é uma
 * aproximação, é um endereço inventado — e, plotado, forma aquela bola de
 * pontos no meio do mapa que não corresponde a ninguém morando ali.
 */
import { pool } from "../db";
import { normalizarCidade } from "./area-atendida";
import { normalizarLocalidade, criarCasadorDeBairro } from "./localidade";
import { chaveLogradouro, separarLogradouroENumero } from "./logradouro";
import { logger } from "../logger";

export type PrecisaoLocal = "endereco" | "logradouro" | "bairro";

export interface AcertoLocal {
  lat: number;
  lon: number;
  precisao: PrecisaoLocal;
}

const DDL = `
CREATE TABLE IF NOT EXISTS geo_endereco (
  id              serial PRIMARY KEY,
  municipio_ibge  text NOT NULL,
  logradouro_norm text NOT NULL,
  numero          integer,
  cep             text,
  bairro_norm     text,
  latitude        numeric(10,7) NOT NULL,
  longitude       numeric(10,7) NOT NULL
);
CREATE INDEX IF NOT EXISTS geo_endereco_rua
  ON geo_endereco (municipio_ibge, logradouro_norm, numero);
CREATE INDEX IF NOT EXISTS geo_endereco_bairro
  ON geo_endereco (municipio_ibge, bairro_norm);
`;

export async function garantirTabelaEnderecos(): Promise<void> {
  await pool.query(DDL);
}

/* ── Índice em memória ───────────────────────────────────────────────────
   Uma carteira inteira é geocodificada de uma vez; consultar o banco por
   cliente seriam milhares de idas. O município cabe folgado em memória
   (Londrina são ~247 mil endereços) e é carregado uma vez por passada. */

interface IndiceMunicipio {
  /** "RUA X|1234" → coordenada exata. */
  porEndereco: Map<string, [number, number]>;
  /** "RUA X" → mediana da rua. */
  porLogradouro: Map<string, [number, number]>;
  /** bairro normalizado → centroide. */
  porBairro: Map<string, [number, number]>;
  /** Bairros canônicos do município, para o casamento em cascata. */
  bairros: string[];
}

const mediana = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function carregarMunicipio(municipioIbge: string): Promise<IndiceMunicipio | null> {
  let rows: Array<{ logradouro_norm: string; numero: number | null; bairro_norm: string | null; latitude: string; longitude: string }>;
  try {
    ({ rows } = await pool.query(
      `SELECT logradouro_norm, numero, bairro_norm, latitude::text, longitude::text
         FROM geo_endereco WHERE municipio_ibge = $1`,
      [municipioIbge],
    ));
  } catch (err: any) {
    if (err?.code === "42P01") return null;   // tabela ainda não existe
    throw err;
  }
  if (rows.length === 0) return null;

  const porEndereco = new Map<string, [number, number]>();
  const ruaLats = new Map<string, number[]>();
  const ruaLons = new Map<string, number[]>();
  const bairroLats = new Map<string, number[]>();
  const bairroLons = new Map<string, number[]>();

  for (const r of rows) {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    if (r.numero !== null) {
      const k = `${r.logradouro_norm}|${r.numero}`;
      if (!porEndereco.has(k)) porEndereco.set(k, [lat, lon]);
    }
    (ruaLats.get(r.logradouro_norm) ?? ruaLats.set(r.logradouro_norm, []).get(r.logradouro_norm)!).push(lat);
    (ruaLons.get(r.logradouro_norm) ?? ruaLons.set(r.logradouro_norm, []).get(r.logradouro_norm)!).push(lon);
    if (r.bairro_norm) {
      (bairroLats.get(r.bairro_norm) ?? bairroLats.set(r.bairro_norm, []).get(r.bairro_norm)!).push(lat);
      (bairroLons.get(r.bairro_norm) ?? bairroLons.set(r.bairro_norm, []).get(r.bairro_norm)!).push(lon);
    }
  }

  // Mediana e não média: um endereço com coordenada errada puxaria a média da
  // rua para fora dela, e o erro contaminaria todos os clientes da rua.
  const porLogradouro = new Map<string, [number, number]>();
  for (const [rua, lats] of Array.from(ruaLats.entries())) {
    porLogradouro.set(rua, [mediana(lats), mediana(ruaLons.get(rua)!)]);
  }
  const porBairro = new Map<string, [number, number]>();
  for (const [b, lats] of Array.from(bairroLats.entries())) {
    porBairro.set(b, [mediana(lats), mediana(bairroLons.get(b)!)]);
  }

  return {
    porEndereco, porLogradouro, porBairro,
    // Ordenado por tamanho: em empate no casamento fuzzy vence o bairro maior.
    bairros: Array.from(bairroLats.entries()).sort((a, b) => b[1].length - a[1].length).map(([k]) => k),
  };
}

/**
 * Geocodificador carregado para um conjunto de municípios.
 *
 * Devolve `null` quando nenhum município pedido tem base — aí quem chama sabe
 * que precisa do caminho de rede, em vez de achar que o endereço não existe.
 */
export async function abrirGeocodificadorLocal(cidades: Array<{ cidade: string; uf?: string | null }>) {
  await garantirTabelaEnderecos();

  // cidade normalizada → município. A tabela de HPs já guarda esse vínculo.
  const nomes = Array.from(new Set(cidades.map(c => normalizarCidade(c.cidade)).filter(Boolean)));
  if (nomes.length === 0) return null;

  let vinculos: Array<{ cidade_norm: string; municipio_ibge: string }> = [];
  try {
    const r = await pool.query(
      `SELECT DISTINCT cidade_norm, municipio_ibge FROM geo_hps_bairro
        WHERE lower(cidade_norm) = ANY($1::text[]) OR cidade_norm = ANY($2::text[])`,
      [nomes, nomes.map(n => n.toUpperCase())],
    );
    vinculos = r.rows;
  } catch (err: any) {
    if (err?.code !== "42P01") throw err;
  }
  if (vinculos.length === 0) return null;

  const porCidade = new Map<string, IndiceMunicipio>();
  const casadores = new Map<string, ReturnType<typeof criarCasadorDeBairro>>();
  for (const v of vinculos) {
    const idx = await carregarMunicipio(v.municipio_ibge);
    if (!idx) continue;
    const chave = normalizarCidade(v.cidade_norm);
    porCidade.set(chave, idx);
    casadores.set(chave, criarCasadorDeBairro(idx.bairros));
  }
  if (porCidade.size === 0) return null;

  logger.info(
    { municipios: porCidade.size, enderecos: Array.from(porCidade.values()).reduce((s, i) => s + i.porEndereco.size, 0) },
    "Geocodificador local carregado",
  );

  return {
    municipios: porCidade.size,

    /** Cidades cobertas — quem chama usa para saber quando ainda precisa da rede. */
    cobre(cidade: string | null | undefined): boolean {
      return porCidade.has(normalizarCidade(cidade));
    },

    resolver(cliente: {
      address?: string | null; addressNumber?: string | null;
      neighborhood?: string | null; city?: string | null;
    }): AcertoLocal | null {
      const idx = porCidade.get(normalizarCidade(cliente.city));
      if (!idx) return null;

      const { logradouro, numero } = separarLogradouroENumero(cliente.address, cliente.addressNumber);

      if (logradouro && numero !== null) {
        const exato = idx.porEndereco.get(`${logradouro}|${numero}`);
        if (exato) return { lat: exato[0], lon: exato[1], precisao: "endereco" };
      }
      if (logradouro) {
        const rua = idx.porLogradouro.get(logradouro);
        if (rua) return { lat: rua[0], lon: rua[1], precisao: "logradouro" };
      }

      const casador = casadores.get(normalizarCidade(cliente.city));
      const m = casador?.(cliente.neighborhood);
      if (m) {
        const b = idx.porBairro.get(m.canonico);
        if (b) return { lat: b[0], lon: b[1], precisao: "bairro" };
      }
      // Última tentativa: bairro escrito exatamente como no censo.
      const direto = idx.porBairro.get(normalizarLocalidade(cliente.neighborhood));
      if (direto) return { lat: direto[0], lon: direto[1], precisao: "bairro" };

      return null;
    },
  };
}

export type GeocodificadorLocal = NonNullable<Awaited<ReturnType<typeof abrirGeocodificadorLocal>>>;

/** Chave usada na carga — exportada para o ingestor montar as mesmas linhas. */
export { chaveLogradouro };
