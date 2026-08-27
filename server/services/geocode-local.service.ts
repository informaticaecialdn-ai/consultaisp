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
 *   2. `logradouro` — a rua bate, o número não. Um endereço real da rua.
 *   3. `bairro`     — nem a rua bate. Um endereço real do bairro.
 *   4. `cidade`     — nem o bairro. Um endereço real do município.
 *   5. nada         — o município não tem base carregada.
 *
 * ── Por que endereço real, e nunca centroide ─────────────────────────────
 * A primeira versão devolvia a mediana da rua e o centroide do bairro. Todo
 * cliente do bairro recebia a MESMA coordenada, e o mapa desenhava trezentos e
 * poucos pontos empilhados num pixel — a "bola" que apareceu em Londrina.
 *
 * Um centroide não é mais preciso que um endereço qualquer do bairro: os dois
 * dizem "está neste bairro". Mas o centroide *parece* preciso, esconde quantos
 * clientes existem ali e desenha uma mancha que não corresponde a ninguém.
 * Espalhar sobre os endereços reais é a mesma precisão, dita com honestidade.
 *
 * A escolha é estável por id: sorteada a cada carga, o cliente pularia de
 * quadra a cada sincronização e o mapa nunca assentaria.
 */
import { pool } from "../db";
import { normalizarCidade } from "./area-atendida";
import { normalizarLocalidade, criarCasadorDeBairro } from "./localidade";
import { chaveLogradouro, separarLogradouroENumero } from "./logradouro";
import { logger } from "../logger";

export type PrecisaoLocal = "endereco" | "logradouro" | "bairro" | "cidade";

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
  /**
   * "RUA X" → TODOS os endereços da rua, e não a mediana dela.
   *
   * A mediana devolvia a mesma coordenada para todo cliente da rua, e o mapa
   * empilhava dezenas de pontos num pixel. Guardando a lista, cada cliente
   * recebe um endereço real e distinto daquela rua — a precisão é a mesma
   * ("está nesta rua"), mas a tela para de afirmar que todos moram na mesma
   * porta.
   */
  porLogradouro: Map<string, Array<[number, number]>>;
  /** bairro normalizado → todos os endereços do bairro, pelo mesmo motivo. */
  porBairro: Map<string, Array<[number, number]>>;
  /** Todos os endereços do município — último recurso, ainda sem rede. */
  doMunicipio: Array<[number, number]>;
  /** Bairros canônicos do município, para o casamento em cascata. */
  bairros: string[];
}

/**
 * Escolhe um endereço da lista de forma estável pelo id do cliente.
 *
 * Determinístico de propósito: sorteado a cada carga, o cliente pularia de
 * quadra a cada sincronização e o mapa nunca assentaria. E espalhado de
 * propósito: o ponto único do centroide não é mais preciso, só *parece* — e
 * ainda esconde quantos clientes existem ali, porque todos caem no mesmo pixel.
 */
function escolherEstavel(pontos: Array<[number, number]>, id: number): [number, number] {
  let x = (id * 2654435761) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  x = (x * 1274126177) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return pontos[x % pontos.length];
}

/**
 * Núcleo denso de um conjunto de endereços — descarta o que está longe demais
 * do miolo.
 *
 * O nome do bairro no censo NÃO é único dentro do município: Londrina tem sete
 * distritos rurais, e cada um tem o seu "CENTRO". Agrupando pelo nome, "CENTRO"
 * juntava o centro da cidade com os centros de Warta, Irerê e Guaravera, e o
 * conjunto passava a cobrir 12,5 km — espalhar sobre ele jogaria clientes do
 * centro para a zona rural.
 *
 * O corte é por distância mediana e não por caixa fixa: bairro compacto e
 * bairro alongado têm medianas diferentes, e a régua se ajusta a cada um. Só o
 * que está muito além do miolo sai.
 */
export function nucleoDenso(pontos: Array<[number, number]>): Array<[number, number]> {
  if (pontos.length < 8) return pontos;

  const mediana = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const cLat = mediana(pontos.map(p => p[0]));
  const cLon = mediana(pontos.map(p => p[1]));
  const escalaLon = Math.cos((cLat * Math.PI) / 180);

  const dist = pontos.map(p => {
    const dLat = p[0] - cLat;
    const dLon = (p[1] - cLon) * escalaLon;
    return Math.sqrt(dLat * dLat + dLon * dLon);
  });
  // 2,5 vezes a distância mediana: generoso para a forma real do bairro,
  // apertado o bastante para cortar outro povoado a quilômetros dali.
  const limite = mediana(dist) * 2.5;
  if (!(limite > 0)) return pontos;

  const nucleo = pontos.filter((_, i) => dist[i] <= limite);
  // Se o corte levou quase tudo, a suposição não valia para este conjunto.
  return nucleo.length >= Math.max(4, pontos.length * 0.3) ? nucleo : pontos;
}

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
  const porLogradouro = new Map<string, Array<[number, number]>>();
  const porBairro = new Map<string, Array<[number, number]>>();
  const doMunicipio: Array<[number, number]> = [];

  const empilhar = (m: Map<string, Array<[number, number]>>, chave: string, p: [number, number]) => {
    const lista = m.get(chave);
    if (lista) lista.push(p); else m.set(chave, [p]);
  };

  for (const r of rows) {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const p: [number, number] = [lat, lon];

    if (r.numero !== null) {
      const k = `${r.logradouro_norm}|${r.numero}`;
      if (!porEndereco.has(k)) porEndereco.set(k, p);
    }
    empilhar(porLogradouro, r.logradouro_norm, p);
    if (r.bairro_norm) empilhar(porBairro, r.bairro_norm, p);
    doMunicipio.push(p);
  }

  // O nome do bairro e o da rua se repetem entre os distritos do município —
  // por isso os dois passam pelo mesmo corte de outliers.
  for (const [k, v] of Array.from(porBairro.entries())) porBairro.set(k, nucleoDenso(v));
  for (const [k, v] of Array.from(porLogradouro.entries())) porLogradouro.set(k, nucleoDenso(v));

  return {
    porEndereco, porLogradouro, porBairro, doMunicipio,
    // Ordenado por tamanho: em empate no casamento fuzzy vence o bairro maior.
    bairros: Array.from(porBairro.entries()).sort((a, b) => b[1].length - a[1].length).map(([k]) => k),
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
      id: number;
      address?: string | null; addressNumber?: string | null;
      neighborhood?: string | null; city?: string | null;
    }): AcertoLocal | null {
      const chaveCidade = normalizarCidade(cliente.city);
      const idx = porCidade.get(chaveCidade);
      if (!idx) return null;

      const { logradouro, numero } = separarLogradouroENumero(cliente.address, cliente.addressNumber);

      // 1. A casa: rua e número batem.
      if (logradouro && numero !== null) {
        const exato = idx.porEndereco.get(`${logradouro}|${numero}`);
        if (exato) return { lat: exato[0], lon: exato[1], precisao: "endereco" };
      }
      // 2. A rua: um endereço real dela, não a mediana.
      if (logradouro) {
        const rua = idx.porLogradouro.get(logradouro);
        if (rua?.length) {
          const p = escolherEstavel(rua, cliente.id);
          return { lat: p[0], lon: p[1], precisao: "logradouro" };
        }
      }
      // 3. O bairro: idem.
      const m = casadores.get(chaveCidade)?.(cliente.neighborhood);
      const bairro = m
        ? idx.porBairro.get(m.canonico)
        : idx.porBairro.get(normalizarLocalidade(cliente.neighborhood));
      if (bairro?.length) {
        const p = escolherEstavel(bairro, cliente.id);
        return { lat: p[0], lon: p[1], precisao: "bairro" };
      }
      // 4. A cidade. Grosso, mas ainda é um endereço REAL do município e sem
      // rede — e é o que impede o cliente de ficar fora do mapa só porque o
      // bairro do ERP não existe no censo.
      if (idx.doMunicipio.length) {
        const p = escolherEstavel(idx.doMunicipio, cliente.id);
        return { lat: p[0], lon: p[1], precisao: "cidade" };
      }
      return null;
    },
  };
}

export type GeocodificadorLocal = NonNullable<Awaited<ReturnType<typeof abrirGeocodificadorLocal>>>;

/** Chave usada na carga — exportada para o ingestor montar as mesmas linhas. */
export { chaveLogradouro };
