/**
 * Mapa da rede — ex-clientes com dívida de TODOS os provedores, no mapa e só
 * no mapa.
 *
 * É a pergunta que só o bureau responde: em que partes da cidade já houve
 * calote, contando a experiência de todo mundo e não só a sua. Um provedor
 * sozinho vê a própria carteira; a rede vê a cidade.
 *
 * ── O que sai daqui, e o que não sai ──────────────────────────────────────
 * Regra do dono (02/09/2026): "só mostrar ex-clientes com dívida; dados da
 * rede somente o ponto no mapa, sem informações, para não infringir a LGPD".
 * Então o payload é geometria e contagem, nada mais:
 *
 *   - bolha por BAIRRO: posição (centro do bairro pelo censo do IBGE) e
 *     quantos casos — sem o nome do bairro, sem valor em aberto, sem quantos
 *     provedores contribuíram;
 *   - ponto por OCORRÊNCIA: posição deslocada em até ~150 m — sem faixa de
 *     valor, sem bairro, sem referência.
 *
 * A cidade vai junto porque a tela filtra por cidade; ela nunca é exibida por
 * ponto. O que não sai do servidor não pode vazar pelo navegador.
 *
 * ── Quem entra ─────────────────────────────────────────────────────────────
 * Só ex-cliente (contrato cancelado ou inativo) com dívida. Cliente que ainda
 * é de alguém não entra: apontar onde mora quem está devendo ao vizinho seria
 * lista de alvos, não informação de risco. Bairro só aparece com
 * MIN_POR_BAIRRO ou mais casos: centroide de três casas não é a casa de
 * ninguém.
 *
 * ── Onde a bolha fica ──────────────────────────────────────────────────────
 * No centro do bairro segundo o censo de endereços do IBGE (CNEFE, tabela
 * geo_endereco). Até 02/09/2026 era a mediana das coordenadas dos ex-clientes,
 * e em Londrina isso pôs os 206 bairros no mesmo quarteirão: as coordenadas
 * vinham do sync antigo, que caía no centro da cidade com ruído. A carteira só
 * ancora quando o IBGE não conhece o bairro — e só com coordenada de
 * procedência conhecida.
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
 *
 * `vizinho` fica de fora POR DECISÃO, e não por esquecimento (04/09/2026).
 * Aquele ponto é derivado das instalações da MESMA carteira que este mapa está
 * agregando: usá-lo aqui seria contar como endereço apurado o que é a mediana
 * de outros clientes do próprio provedor, e o mapa entre provedores passaria a
 * afirmar a casa exatamente onde o mapa do dono diz, em voz alta, que não sabe.
 * O cliente entra na contagem de `semPonto`, que é o lugar honesto dele.
 */
const PRECISAO_CONFIAVEL = new Set(["erp", "endereco", "logradouro", "cep"]);

/** Uma bolha: onde e quantos. Nada que nomeie o bairro ou valha dinheiro. */
export interface BairroRede {
  /** Só para o filtro de cidade da tela; nunca aparece por ponto. */
  cidade: string;
  /** Ex-clientes com dívida no bairro, somando todos os provedores. */
  ocorrencias: number;
  /** Centro do bairro; null quando nem o IBGE nem a carteira sabem. */
  lat: number | null;
  lon: number | null;
}

/** Um ponto: só a posição, já deslocada. */
export interface PontoRede {
  cidade: string;
  lat: number;
  lon: number;
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

/** Uma cidade da área declarada, na régua da rede — contagem por MUNICÍPIO. */
export interface CidadeRede {
  /**
   * O nome DECLARADO, sem o sufixo " - UF" — e o MESMO rótulo que `bairros[].cidade`
   * e `pontos[].cidade` emitem. Até 09/09/2026 a bolha saía com a grafia crua
   * da primeira linha que abriu o bairro, vinda do ERP de um tenant qualquer:
   * "LONDRINA" numa bolha e "Londrina" na outra era a única marca de origem que
   * o payload ainda carregava, e o filtro `===` do chip esvaziava o mapa.
   */
  cidade: string;
  /** Σ ocorrências dos bairros VISÍVEIS (≥ piso) — o mesmo grão de `bairros[].ocorrencias`. */
  ocorrencias: number;
  /** Σ ocorrências dos bairros da cidade abaixo do piso. O `ocultas` global é a soma. */
  ocultas: number;
  /**
   * Ocorrências do PRÓPRIO observador na cidade, visíveis + ocultas. Contadas
   * DEPOIS do portão de bairro, no mesmo universo das outras duas: assim
   * `ocorrencias + ocultas - doObservador` nunca fica negativo.
   */
  doObservador: number;
  /** Bairros VISÍVEIS da cidade sem nenhuma linha do observador — onde ele aprovaria às cegas. */
  bairrosSemObservador: number;
}

/**
 * O que a rede NÃO cobre da carteira do próprio observador. Só linhas dele
 * entram nesta conta: não é dado da rede, é dado dele.
 */
export interface ObservadorRede {
  /** Ex-clientes com dívida (e com bairro) do observador em cidades FORA da área declarada. */
  foraDaArea: number;
  /** Essas cidades, da maior para a menor, no máximo 5. Grafia do ERP dele. */
  cidadesForaDaArea: Array<{ cidade: string; ocorrencias: number }>;
}

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
  /**
   * Uma linha por cidade da área que o servidor de fato usou (cobre a cascata
   * cidades → mesorregião), zeros incluídos. Ordem: ocorrências desc, depois
   * nome. É o que alimenta os chips e os cards do modo Rede — e é o único
   * agregado NOVO no payload desde 09/09/2026: contagem por município, o grão
   * que a soma das bolhas já entregava.
   */
  cidades: CidadeRede[];
  observador: ObservadorRede;
}

/** A linha do cadastro que a agregação precisa — o que a query devolve. */
export interface LinhaRede {
  id: number;
  /**
   * Entra para UMA comparação (`=== observador`) e morre no acumulador. Nunca
   * vai para `bairros`, `pontos` nem `cidades` — o teste de chaves segura isso.
   */
  providerId: number;
  latitude: string | number | null;
  longitude: string | number | null;
  city: string | null;
  neighborhood: string | null;
  geoPrecisao: string | null;
}

const mediana = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const SEM_UF = /\s*-\s*[A-Za-z]{2}\s*$/;

/**
 * A agregação em si, pura: linhas do cadastro + cidades atendidas + centros de
 * bairro do IBGE + quem está olhando → o que a tela recebe. Separada da leitura
 * do banco para ser testável com dados inventados.
 *
 * `observador` é o provedor da SESSÃO. Ele entra em exatamente um lugar — a
 * comparação `l.providerId === observador` — e serve para separar "seus" de
 * "dos outros" nas contagens por cidade. Nunca filtra a leitura (isso faria da
 * rede a carteira própria) e nunca chaveia acumulador (contagem por tenant
 * sentada numa estrutura acaba saindo por um `...` de alguém).
 */
export function agregarRede(
  linhas: LinhaRede[],
  cidades: string[],
  centroides: CentroidesPorCidade,
  observador: number,
): ResultadoRede {
  const vazio: ResultadoRede = {
    bairros: [], pontos: [], ocultas: 0, semPonto: 0, cidades: [],
    observador: { foraDaArea: 0, cidadesForaDaArea: [] },
  };
  if (cidades.length === 0) return vazio;

  // O recorte vem da área atendida como "Londrina - PR" e o cadastro guarda
  // "Londrina": a comparação usa a mesma canonização do resto do produto. O
  // rótulo que sai é o DECLARADO, sem UF — e a primeira grafia vence quando a
  // lista declara a mesma cidade duas vezes, para o rótulo não depender da
  // ordem do array.
  const rotulo = new Map<string, string>();
  for (const c of cidades) {
    const k = normalizarCidade(c);
    if (k && !rotulo.has(k)) rotulo.set(k, c.replace(SEM_UF, "").trim() || c.trim());
  }
  if (rotulo.size === 0) return vazio;

  interface Acc {
    /** Rótulo do bairro: só para casar com o censo; não sai no payload. */
    bairro: string;
    /** O rótulo canônico da cidade (o que sai) e a chave normalizada (o que casa com o censo). */
    cidade: string; cidadeNorm: string;
    ocorrencias: number;
    /** Linhas do observador neste bairro. Não sai para BairroRede. */
    doObservador: number;
    lats: number[]; lons: number[];
    /** Guardados aqui e só liberados se o bairro passar o piso. */
    pontos: PontoRede[];
    semPonto: number;
  }
  const porBairro = new Map<string, Acc>();
  // Um agrupador por cidade: bairros homônimos em cidades diferentes são
  // lugares diferentes.
  const agrupadores = new Map<string, ReturnType<typeof criarAgrupadorDeBairro>>();
  // Só linhas do observador, só fora da área: o que a rede não cobre dele.
  const foraDaArea = new Map<string, { cidade: string; ocorrencias: number }>();

  for (const l of linhas) {
    const cidadeNorm = normalizarCidade(l.city);
    const naArea = rotulo.has(cidadeNorm);
    const proprio = l.providerId === observador;
    // Linha de outro provedor fora da área não interessa a ninguém — e não
    // vale a pena agrupar bairro de cidade que a rede não vai desenhar.
    if (!naArea && !proprio) continue;
    if (!cidadeNorm) continue;

    let ag = agrupadores.get(cidadeNorm);
    if (!ag) { ag = criarAgrupadorDeBairro(); agrupadores.set(cidadeNorm, ag); }
    const grupo = ag.agrupar(l.neighborhood);
    // O portão de bairro vale para TODAS as contagens, dentro e fora da área:
    // é o que faz "seus na área" e "seus fora dela" serem o mesmo universo.
    if (!grupo) continue;

    if (!naArea) {
      const f = foraDaArea.get(cidadeNorm) ?? { cidade: (l.city || "").trim(), ocorrencias: 0 };
      f.ocorrencias++;
      foraDaArea.set(cidadeNorm, f);
      continue;
    }

    const chave = `${cidadeNorm}||${grupo.chave}`;
    let a = porBairro.get(chave);
    if (!a) {
      a = {
        bairro: grupo.rotulo, cidade: rotulo.get(cidadeNorm)!, cidadeNorm,
        ocorrencias: 0, doObservador: 0, lats: [], lons: [], pontos: [], semPonto: 0,
      };
      porBairro.set(chave, a);
    }
    a.ocorrencias++;
    if (proprio) a.doObservador++;

    const coord = coordenadaValida(l.latitude, l.longitude);
    if (coord && PRECISAO_CONFIAVEL.has(l.geoPrecisao ?? "")) {
      a.lats.push(coord.lat);
      a.lons.push(coord.lng);
      const d = deslocarPonto(l.id, coord.lat, coord.lng);
      a.pontos.push({ cidade: a.cidade, lat: d.lat, lon: d.lon });
    } else {
      a.semPonto++;
    }
  }

  // Casador por cidade contra os bairros que o IBGE conhece, do maior para o
  // menor: em empate no fuzzy vence o bairro com mais endereços. A chave do
  // censo é a normalizada, nunca o rótulo — "Londrina - PR" viraria
  // "LONDRINA PR" e nenhum centroide casaria.
  const casadores = new Map<string, ReturnType<typeof criarCasadorDeBairro>>();
  const ancorar = (a: Acc): Pick<BairroRede, "lat" | "lon"> => {
    const cidadeIbge = normalizarLocalidade(a.cidadeNorm);
    const lista = centroides.get(cidadeIbge);
    if (lista && lista.length > 0) {
      let casar = casadores.get(cidadeIbge);
      if (!casar) {
        casar = criarCasadorDeBairro([...lista].sort((x, y) => y.enderecos - x.enderecos).map(c => c.bairroNorm));
        casadores.set(cidadeIbge, casar);
      }
      const m = casar(a.bairro);
      const c = m ? lista.find(x => x.bairroNorm === m.canonico) : undefined;
      if (c) return { lat: c.lat, lon: c.lon };
    }
    // Mediana e não média: uma coordenada errada a centenas de km puxaria a
    // média para fora da cidade e levaria o bairro inteiro junto.
    if (a.lats.length > 0) return { lat: mediana(a.lats), lon: mediana(a.lons) };
    return { lat: null, lon: null };
  };

  const todos = Array.from(porBairro.values());
  const visiveis = todos.filter(a => a.ocorrencias >= MIN_POR_BAIRRO);

  // Uma linha por cidade DECLARADA, zeros incluídos: a tela precisa saber onde
  // a rede está calada, não só onde ela fala.
  const porCidade = new Map<string, CidadeRede>(
    Array.from(rotulo.entries(), ([k, nome]) => [k, { cidade: nome, ocorrencias: 0, ocultas: 0, doObservador: 0, bairrosSemObservador: 0 }]),
  );
  for (const a of todos) {
    const c = porCidade.get(a.cidadeNorm)!;
    const visivel = a.ocorrencias >= MIN_POR_BAIRRO;
    if (visivel) c.ocorrencias += a.ocorrencias; else c.ocultas += a.ocorrencias;
    c.doObservador += a.doObservador;
    if (visivel && a.doObservador === 0) c.bairrosSemObservador++;
  }

  return {
    ocultas: todos.filter(a => a.ocorrencias < MIN_POR_BAIRRO)
      .reduce((s, a) => s + a.ocorrencias, 0),
    semPonto: visiveis.reduce((s, a) => s + a.semPonto, 0),
    // Do maior para o menor, e SÓ o que o mapa desenha: cidade (filtro),
    // contagem (tamanho da bolha) e posição. Montado campo a campo, de
    // propósito: `doObservador` e `cidadeNorm` ficam no acumulador.
    bairros: visiveis
      .map(a => ({ cidade: a.cidade, ocorrencias: a.ocorrencias, ...ancorar(a) }))
      .sort((x, y) => y.ocorrencias - x.ocorrencias),
    pontos: visiveis.flatMap(a => a.pontos),
    cidades: Array.from(porCidade.values())
      .sort((x, y) => y.ocorrencias - x.ocorrencias || x.cidade.localeCompare(y.cidade, "pt-BR")),
    observador: {
      foraDaArea: Array.from(foraDaArea.values()).reduce((s, f) => s + f.ocorrencias, 0),
      cidadesForaDaArea: Array.from(foraDaArea.values())
        .sort((x, y) => y.ocorrencias - x.ocorrencias || x.cidade.localeCompare(y.cidade, "pt-BR"))
        .slice(0, 5),
    },
  };
}

/**
 * Ex-clientes com dívida de todos os provedores, agregados por bairro.
 *
 * "Ex-cliente" é contrato encerrado — cancelado ou inativo. Cliente que ainda é
 * de alguém não entra: ele está sendo cobrado por quem o atende, e apontar onde
 * ele mora para a concorrência não é informação de risco, é lista de alvos.
 *
 * `observador` é o provedor da sessão, e SÓ dele: a rota o tira de
 * `req.session.providerId`, nunca do pedido. Ele não entra no WHERE — filtrar
 * por provedor aqui transformaria a rede na carteira própria.
 */
export async function bairrosDaRede(cidades: string[], observador: number): Promise<ResultadoRede> {
  if (cidades.length === 0) return agregarRede([], [], new Map(), observador);

  const [linhas, centroides] = await Promise.all([
    db
      .select({
        id: customers.id,
        providerId: customers.providerId,
        latitude: customers.latitude,
        longitude: customers.longitude,
        city: customers.city,
        neighborhood: customers.neighborhood,
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

  return agregarRede(linhas, cidades, centroides, observador);
}
