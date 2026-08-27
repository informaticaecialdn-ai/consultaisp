/**
 * Mapa da rede — ex-clientes com dívida de TODOS os provedores, POR BAIRRO.
 *
 * É a pergunta que só o bureau responde: em que bairros da cidade já houve
 * calote, contando a experiência de todo mundo e não só a sua. Um provedor
 * sozinho vê a própria carteira; a rede vê a cidade.
 *
 * ── Por que bairro, e não ponto ──────────────────────────────────────────
 * A primeira versão devolvia um ponto por ex-cliente, com a coordenada
 * deslocada para tirar o número da casa. Funcionava, mas defendia um dado que
 * não precisava existir: o operador não decide nada com a casa específica de um
 * ex-cliente de outro provedor — ele decide com "neste bairro a rede já tomou
 * doze calotes". Agregando na origem, nenhuma posição individual sai do
 * servidor, e não há o que mascarar.
 *
 * O que sai é o centroide do bairro, calculado sobre no mínimo MIN_POR_BAIRRO
 * ocorrências. Centroide de três ou mais casas não é a casa de ninguém.
 *
 * Continua sem nome, sem documento, sem valor por cliente e sem dizer de qual
 * provedor veio cada ocorrência — só quantos provedores contribuíram, que é o
 * que diz se aquilo é a experiência da rede ou de um só.
 */
import { and, gt, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { customers } from "@shared/schema";
import { coordenadaValida } from "./coordenada";
import { normalizarCidade } from "./area-atendida";
import { criarAgrupadorDeBairro } from "./localidade";

/** Ocorrências mínimas para um bairro aparecer. */
export const MIN_POR_BAIRRO = 3;

export interface BairroRede {
  bairro: string;
  cidade: string;
  /** Ex-clientes com dívida no bairro, somando todos os provedores. */
  ocorrencias: number;
  dividaTotal: number;
  /** Quantos provedores contribuíram. Diz se é experiência da rede ou de um só. */
  provedores: number;
  /** Centroide das ocorrências; null quando nenhuma tem coordenada. */
  lat: number | null;
  lon: number | null;
}

/**
 * Ponto individual da rede. Existe porque o agregado por bairro esconde a
 * distribuição DENTRO do bairro — e ver que os casos se concentram numa quadra
 * é uma leitura diferente de saber que o bairro tem doze.
 *
 * Como é individual, é o único conjunto que precisa de mascaramento: sem
 * cliente, sem provedor, sem valor exato, e com a coordenada deslocada em até
 * ~150m. Coordenada exata é endereço, e entre provedores o endereço vai sem
 * número.
 */
export interface PontoRede {
  ref: string;
  lat: number;
  lon: number;
  bairro: string;
  cidade: string;
  faixa: "ate300" | "de300a1000" | "acima1000";
}

/** Raio máximo do deslocamento, em graus (~150m na latitude do Brasil). */
export const FUZZ_GRAUS = 0.00135;

/**
 * Deslocamento estável: mesma entrada, mesmo deslocamento, sempre. Sorteado a
 * cada requisição pareceria mais seguro e seria menos — recarregar a página
 * muitas vezes e tirar a média das posições devolveria o ponto verdadeiro.
 */
export function deslocarPonto(id: number, lat: number, lon: number): { lat: number; lon: number } {
  // Cada passo termina em `>>> 0`: sem isso o XOR devolve inteiro COM SINAL, e
  // metade dos ids saía com hash negativo — raiz de negativo é NaN, e o ponto
  // desaparecia do mapa sem erro nenhum.
  const h = (n: number, sal: number) => {
    let x = (n * 2654435761 + sal * 40503) >>> 0;
    x = (x ^ (x >>> 13)) >>> 0;
    x = (x * 1274126177) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return x / 4294967296;
  };
  const angulo = h(id, 1) * Math.PI * 2;
  // Raiz do raio: sem ela o sorteio concentra os pontos no centro do círculo.
  const raio = Math.sqrt(h(id, 2)) * FUZZ_GRAUS;
  return {
    lat: lat + Math.sin(angulo) * raio,
    // A longitude encolhe com o cosseno da latitude; sem isso o borrão fica
    // oval e mais estreito do que os 150m prometidos.
    lon: lon + (Math.cos(angulo) * raio) / Math.max(0.2, Math.cos((lat * Math.PI) / 180)),
  };
}

const faixaDivida = (v: number): PontoRede["faixa"] =>
  v > 1000 ? "acima1000" : v > 300 ? "de300a1000" : "ate300";

export interface ResultadoRede {
  bairros: BairroRede[];
  /**
   * Pontos individuais, apenas dos bairros que passaram o piso. Bairro que não
   * aparece no agregado também não solta ponto — senão o piso não valeria nada.
   */
  pontos: PontoRede[];
  /**
   * Ocorrências que existem mas ficaram fora por estarem em bairros com menos
   * de MIN_POR_BAIRRO casos. Mapa vazio sem explicação faz o operador achar que
   * quebrou; "não há nada" e "há, mas é pouco para agregar" são coisas
   * diferentes.
   */
  ocultas: number;
}

const mediana = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Ex-clientes com dívida de todos os provedores, agregados por bairro.
 *
 * "Ex-cliente" é contrato encerrado — cancelado ou inativo. Cliente que ainda é
 * de alguém não entra: ele está sendo cobrado por quem o atende, e apontar onde
 * ele mora para a concorrência não é informação de risco, é lista de alvos.
 */
export async function bairrosDaRede(cidades: string[]): Promise<ResultadoRede> {
  if (cidades.length === 0) return { bairros: [], pontos: [], ocultas: 0 };

  const linhas = await db
    .select({
      id: customers.id,
      providerId: customers.providerId,
      latitude: customers.latitude,
      longitude: customers.longitude,
      city: customers.city,
      neighborhood: customers.neighborhood,
      totalOverdueAmount: customers.totalOverdueAmount,
    })
    .from(customers)
    .where(and(
      inArray(customers.status, ["cancelled", "inactive"]),
      gt(customers.totalOverdueAmount, "0"),
      isNotNull(customers.neighborhood),
    ));

  // O recorte vem da área atendida como "Londrina - PR" e o cadastro guarda
  // "Londrina": a comparação usa a mesma canonização do resto do produto.
  const alvo = new Set(cidades.map(normalizarCidade));

  interface Acc {
    bairro: string; cidade: string; ocorrencias: number; divida: number;
    provedores: Set<number>; lats: number[]; lons: number[];
    /** Guardados aqui e só liberados se o bairro passar o piso. */
    pontos: PontoRede[];
  }
  const porBairro = new Map<string, Acc>();
  // Um agrupador por cidade: bairros homônimos em cidades diferentes são
  // lugares diferentes.
  const agrupadores = new Map<string, ReturnType<typeof criarAgrupadorDeBairro>>();

  for (const l of linhas) {
    const cidadeNorm = normalizarCidade(l.city);
    if (!alvo.has(cidadeNorm)) continue;

    let ag = agrupadores.get(cidadeNorm);
    if (!ag) { ag = criarAgrupadorDeBairro(); agrupadores.set(cidadeNorm, ag); }
    const grupo = ag.agrupar(l.neighborhood);
    if (!grupo) continue;

    const chave = `${cidadeNorm}||${grupo.chave}`;
    let a = porBairro.get(chave);
    if (!a) {
      a = {
        bairro: grupo.rotulo, cidade: (l.city || "").trim(),
        ocorrencias: 0, divida: 0, provedores: new Set(), lats: [], lons: [], pontos: [],
      };
      porBairro.set(chave, a);
    }
    const divida = Number(l.totalOverdueAmount || 0) || 0;
    a.ocorrencias++;
    a.divida += divida;
    if (l.providerId != null) a.provedores.add(l.providerId);

    const coord = coordenadaValida(l.latitude, l.longitude);
    if (coord) {
      a.lats.push(coord.lat);
      a.lons.push(coord.lng);
      const d = deslocarPonto(l.id, coord.lat, coord.lng);
      a.pontos.push({
        // Referência opaca: o id real não sai daqui.
        ref: `r${(l.id * 2654435761) % 100000000}`,
        lat: d.lat, lon: d.lon,
        bairro: a.bairro, cidade: a.cidade,
        faixa: faixaDivida(divida),
      });
    }
  }

  const todos = Array.from(porBairro.values());
  const visiveis = todos.filter(a => a.ocorrencias >= MIN_POR_BAIRRO);

  return {
    ocultas: todos.filter(a => a.ocorrencias < MIN_POR_BAIRRO)
      .reduce((s, a) => s + a.ocorrencias, 0),
    bairros: visiveis
      .map(a => ({
        bairro: a.bairro,
        cidade: a.cidade,
        ocorrencias: a.ocorrencias,
        dividaTotal: Math.round(a.divida * 100) / 100,
        provedores: a.provedores.size,
        // Mediana e não média: uma coordenada errada a centenas de km puxaria
        // a média para fora da cidade e levaria o bairro inteiro junto.
        lat: a.lats.length ? mediana(a.lats) : null,
        lon: a.lons.length ? mediana(a.lons) : null,
      }))
      .sort((x, y) => y.ocorrencias - x.ocorrencias || y.dividaTotal - x.dividaTotal),
    pontos: visiveis.flatMap(a => a.pontos),
  };
}
