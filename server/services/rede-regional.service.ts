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
 * ── Onde a bolha do bairro fica ──────────────────────────────────────────
 * No CENTRO DO BAIRRO segundo o censo de endereços do IBGE (CNEFE, tabela
 * geo_endereco): a mediana de todos os endereços que o IBGE conhece naquele
 * bairro. É dado público, não é a casa de ninguém, e não depende da qualidade
 * da coordenada gravada no cadastro.
 *
 * Até 02/09/2026 a bolha ficava na mediana das coordenadas dos ex-clientes. Em
 * Londrina isso pôs os 206 bairros no MESMO quarteirão: as coordenadas dos
 * ex-clientes vinham do sync antigo, que caía no centro da cidade com 2 km de
 * ruído, e a mediana de ruído em volta de um ponto é o próprio ponto. A
 * carteira só entra como âncora quando o IBGE não conhece o bairro — e aí só
 * com coordenada de procedência conhecida (ERP, endereço, rua ou CEP de rua).
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
import { criarAgrupadorDeBairro, criarCasadorDeBairro, normalizarLocalidade } from "./localidade";
import { carregarCentroidesDeBairro, type CentroidesPorCidade } from "./geo-bases.service";

/** Ocorrências mínimas para um bairro aparecer. */
export const MIN_POR_BAIRRO = 3;

/**
 * Procedências que afirmam onde a pessoa mora. `bairro` é aproximação e a
 * coordenada sem procedência (gravada antes de existir a coluna, ou pelo sync
 * antigo com queda para o centro da cidade) não é verificável — nenhuma das
 * duas vira ponto nem âncora.
 */
const PRECISAO_CONFIAVEL = new Set(["erp", "endereco", "logradouro", "cep"]);

export interface BairroRede {
  bairro: string;
  cidade: string;
  /** Ex-clientes com dívida no bairro, somando todos os provedores. */
  ocorrencias: number;
  dividaTotal: number;
  /** Quantos provedores contribuíram. Diz se é experiência da rede ou de um só. */
  provedores: number;
  /** Onde a bolha fica; null quando nem o IBGE nem a carteira sabem. */
  lat: number | null;
  lon: number | null;
  /**
   * De onde veio a posição: `ibge` = centro do bairro pelo censo de endereços;
   * `carteira` = mediana das coordenadas confiáveis dos ex-clientes.
   */
  ancora: "ibge" | "carteira" | null;
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
  /**
   * Ocorrências dos bairros visíveis que NÃO viram ponto: sem coordenada ou com
   * coordenada de procedência desconhecida. Entram na bolha do bairro (a
   * contagem não depende de coordenada), só não aparecem "por ponto".
   */
  semPonto: number;
}

/** A linha do cadastro que a agregação precisa — o que a query devolve. */
export interface LinhaRede {
  id: number;
  providerId: number | null;
  latitude: string | number | null;
  longitude: string | number | null;
  city: string | null;
  neighborhood: string | null;
  totalOverdueAmount: string | number | null;
  geoPrecisao: string | null;
}

const mediana = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * A agregação em si, pura: linhas do cadastro + cidades atendidas + centros de
 * bairro do IBGE → o que a tela recebe. Separada da leitura do banco para ser
 * testável com dados inventados.
 */
export function agregarRede(linhas: LinhaRede[], cidades: string[], centroides: CentroidesPorCidade): ResultadoRede {
  if (cidades.length === 0) return { bairros: [], pontos: [], ocultas: 0, semPonto: 0 };

  // O recorte vem da área atendida como "Londrina - PR" e o cadastro guarda
  // "Londrina": a comparação usa a mesma canonização do resto do produto.
  const alvo = new Set(cidades.map(normalizarCidade));

  interface Acc {
    bairro: string; cidade: string; ocorrencias: number; divida: number;
    provedores: Set<number>; lats: number[]; lons: number[];
    /** Guardados aqui e só liberados se o bairro passar o piso. */
    pontos: PontoRede[];
    semPonto: number;
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
        ocorrencias: 0, divida: 0, provedores: new Set(), lats: [], lons: [], pontos: [], semPonto: 0,
      };
      porBairro.set(chave, a);
    }
    const divida = Number(l.totalOverdueAmount || 0) || 0;
    a.ocorrencias++;
    a.divida += divida;
    if (l.providerId != null) a.provedores.add(l.providerId);

    const coord = coordenadaValida(l.latitude, l.longitude);
    if (coord && PRECISAO_CONFIAVEL.has(l.geoPrecisao ?? "")) {
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
    } else {
      a.semPonto++;
    }
  }

  // Casador por cidade contra os bairros que o IBGE conhece, do maior para o
  // menor: em empate no fuzzy vence o bairro com mais endereços.
  const casadores = new Map<string, ReturnType<typeof criarCasadorDeBairro>>();
  const ancorar = (a: Acc): Pick<BairroRede, "lat" | "lon" | "ancora"> => {
    const cidadeIbge = normalizarLocalidade(a.cidade);
    const lista = centroides.get(cidadeIbge);
    if (lista && lista.length > 0) {
      let casar = casadores.get(cidadeIbge);
      if (!casar) {
        casar = criarCasadorDeBairro([...lista].sort((x, y) => y.enderecos - x.enderecos).map(c => c.bairroNorm));
        casadores.set(cidadeIbge, casar);
      }
      const m = casar(a.bairro);
      const c = m ? lista.find(x => x.bairroNorm === m.canonico) : undefined;
      if (c) return { lat: c.lat, lon: c.lon, ancora: "ibge" };
    }
    // Mediana e não média: uma coordenada errada a centenas de km puxaria a
    // média para fora da cidade e levaria o bairro inteiro junto.
    if (a.lats.length > 0) return { lat: mediana(a.lats), lon: mediana(a.lons), ancora: "carteira" };
    return { lat: null, lon: null, ancora: null };
  };

  const todos = Array.from(porBairro.values());
  const visiveis = todos.filter(a => a.ocorrencias >= MIN_POR_BAIRRO);

  return {
    ocultas: todos.filter(a => a.ocorrencias < MIN_POR_BAIRRO)
      .reduce((s, a) => s + a.ocorrencias, 0),
    semPonto: visiveis.reduce((s, a) => s + a.semPonto, 0),
    bairros: visiveis
      .map(a => ({
        bairro: a.bairro,
        cidade: a.cidade,
        ocorrencias: a.ocorrencias,
        dividaTotal: Math.round(a.divida * 100) / 100,
        provedores: a.provedores.size,
        ...ancorar(a),
      }))
      .sort((x, y) => y.ocorrencias - x.ocorrencias || y.dividaTotal - x.dividaTotal),
    pontos: visiveis.flatMap(a => a.pontos),
  };
}

/**
 * Ex-clientes com dívida de todos os provedores, agregados por bairro.
 *
 * "Ex-cliente" é contrato encerrado — cancelado ou inativo. Cliente que ainda é
 * de alguém não entra: ele está sendo cobrado por quem o atende, e apontar onde
 * ele mora para a concorrência não é informação de risco, é lista de alvos.
 */
export async function bairrosDaRede(cidades: string[]): Promise<ResultadoRede> {
  if (cidades.length === 0) return { bairros: [], pontos: [], ocultas: 0, semPonto: 0 };

  const [linhas, centroides] = await Promise.all([
    db
      .select({
        id: customers.id,
        providerId: customers.providerId,
        latitude: customers.latitude,
        longitude: customers.longitude,
        city: customers.city,
        neighborhood: customers.neighborhood,
        totalOverdueAmount: customers.totalOverdueAmount,
        geoPrecisao: customers.geoPrecisao,
      })
      .from(customers)
      .where(and(
        inArray(customers.status, ["cancelled", "inactive"]),
        gt(customers.totalOverdueAmount, "0"),
        isNotNull(customers.neighborhood),
      )),
    carregarCentroidesDeBairro(cidades.map(c => normalizarLocalidade(normalizarCidade(c)))),
  ]);

  return agregarRede(linhas, cidades, centroides);
}
