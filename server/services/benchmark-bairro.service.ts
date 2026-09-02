/**
 * Benchmark regional de inadimplência por bairro — o "mercado" do Raio-X.
 *
 * A pergunta que o card responde é "meus 12% no Jardim Bandeirantes são muito
 * ou pouco?". Sozinho o número não diz nada; contra a média dos provedores que
 * atendem o mesmo bairro, diz. É a única leitura cross-tenant que sai do
 * módulo de localização, e por isso é a mais vigiada:
 *
 * 1. O agregado é POR BAIRRO CANÔNICO DO CENSO, nunca pelo texto do ERP. Cada
 *    provedor escreve o bairro do seu jeito, e "Jd. Bandeirantes" de um só soma
 *    com "JARDIM BANDEIRANTES" de outro se os dois forem casados contra a mesma
 *    lista do CNEFE — a mesma cascata (exato → núcleo → fuzzy) que o Raio-X usa
 *    para achar o HP do bairro. Chave igual dos dois lados é o que garante que
 *    o benchmark mostrado ao lado de um bairro é o benchmark DAQUELE bairro.
 *    A cidade é chaveada com a UF: "CENTRO" de Santa Helena/PR e de Santa
 *    Helena/SC são lugares diferentes, e somá-los contaria provedores de dois
 *    estados num k só.
 * 2. k-anonimato: o número só sai quando >= BENCHMARK_K_MINIMO provedores
 *    CONTRIBUINTES existem no bairro. Contribuinte é provedor aprovado e ativo
 *    (o cadastro é livre: qualquer e-mail cria uma conta e importa um CSV) com
 *    massa no bairro (>= BENCHMARK_MIN_CLIENTES_POR_PROVEDOR). Sem as duas
 *    travas, duas contas gratuitas com um cliente importado à mão cada fechariam
 *    o k sozinhas, e o "mercado" viraria a taxa do único concorrente real.
 * 3. O observador fica FORA do número que ele vê. Se entrasse, conheceria a
 *    própria parcela e, variando a própria base entre duas leituras, resolveria
 *    a dos outros por subtração. Fora, o que ele vê é a soma dos demais — e dos
 *    demais ele não conhece nenhum. O Provedor.ai inclui o observador; aqui a
 *    escolha foi divergir, porque o recálculo lá é script manual e aqui é
 *    cache de uma hora que o próprio observador pode provocar.
 * 4. Nada por provedor atravessa a fronteira. O resultado é contagem e
 *    percentual; o conjunto de ids que entrou no k fica aqui e morre aqui.
 *
 * Mesma doutrina do Provedor.ai (packages/database/scripts/recompute-benchmark.ts
 * e apps/api/src/routes/geo.ts), sem a tabela materializada: a base do
 * Consulta ISP cabe numa agregação em memória, refeita a cada hora.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { customers, providers } from "@shared/schema";
import { normalizarCidade } from "./area-atendida";
import { criarCasadorDeBairro, normalizarLocalidade } from "./localidade";
import { carregarTerritorio, type TerritorioDoMunicipio } from "./geo-bases.service";

/** k-anonimato: abaixo disto o "mercado" identifica um concorrente. */
export const BENCHMARK_K_MINIMO = 3;
/** Provedor só conta no k com esta massa no bairro; um cliente importado à mão não é um provedor. */
export const BENCHMARK_MIN_CLIENTES_POR_PROVEDOR = 10;
/** Piso do universo mostrado (sem o observador): abaixo disto o percentual vira contagem. */
export const BENCHMARK_MIN_CLIENTES_TOTAL = 30;

/**
 * Uma linha do agregado do banco: quantos clientes e quantos inadimplentes um
 * provedor tem num (UF, cidade, bairro) como o ERP dele escreveu. É o grão
 * mínimo que o casamento precisa — e o máximo que sai do SQL.
 */
export interface LinhaAgregadaBenchmark {
  providerId: number;
  state: string | null;
  city: string | null;
  neighborhood: string | null;
  clientes: number;
  inadimplentes: number;
}

/** A parcela de um provedor num bairro canônico. Existe só dentro deste módulo. */
export interface ParcelaProvedor { clientes: number; inadimplentes: number }

/** providerId → parcela. É o que o cache guarda; nunca sai daqui. */
export type ContribuicoesBairro = Map<number, ParcelaProvedor>;

/** O que existe por bairro canônico para UM observador. Sem id de ninguém, de propósito. */
export interface BenchmarkBairro {
  /** Provedores contribuintes no bairro (com massa), observador incluído — é contra este que o k é medido. */
  provedores: number;
  /** Soma dos contribuintes SEM o observador. */
  clientes: number;
  inadimplentes: number;
  /** inadimplentes / clientes, em %, uma casa. */
  pct: number;
}

/** chaveCidadeBenchmark(uf, cidadeNorm) → bairro canônico do CNEFE → contribuições. */
export type BenchmarkPorCidade = Map<string, Map<string, ContribuicoesBairro>>;

/** Sigla de dois caracteres em caixa alta; qualquer outra coisa é "não sei". */
export function normalizarUf(uf: string | null | undefined): string {
  const s = (uf || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : "";
}

/**
 * Chave de cidade do benchmark: "PR|LONDRINA". UF vazia ("|LONDRINA") é o
 * pedido de quem não sabe o estado — casa com qualquer linha da cidade, que é
 * a ambiguidade que já existia antes da UF entrar na chave, não uma nova.
 */
export function chaveCidadeBenchmark(uf: string | null | undefined, cidadeNorm: string): string {
  return `${normalizarUf(uf)}|${cidadeNorm}`;
}

/**
 * Lista canônica ordenada por tamanho decrescente. Em empate no fuzzy vence o
 * primeiro da lista, então o bairro dominante tem de vir primeiro — e tem de
 * vir na MESMA ordem aqui e no Raio-X, senão o mesmo texto do ERP casa com um
 * bairro numa tela e com outro no benchmark.
 */
export function ordenarCanonicosPorTamanho(m: Map<string, number>): string[] {
  return Array.from(m.entries()).sort((x, y) => y[1] - x[1]).map(([k]) => k);
}

/**
 * A agregação em si, pura: linhas do banco + lista canônica por cidade →
 * contribuições por bairro. Separada da leitura para ser testável com dados
 * inventados, como agregarRede.
 *
 * `canonicos` é chaveado por chaveCidadeBenchmark e já vem ordenado por
 * tamanho (ver ordenarCanonicosPorTamanho). Linha cujo estado contradiz a UF
 * pedida fica de fora; linha sem estado não contradiz ninguém.
 */
export function agregarBenchmarkBairro(
  linhas: LinhaAgregadaBenchmark[],
  canonicos: Map<string, string[]>,
): BenchmarkPorCidade {
  // cidadeNorm → chaves pedidas naquela cidade (uma por UF).
  const chavesPorCidade = new Map<string, string[]>();
  for (const chave of Array.from(canonicos.keys())) {
    const cidadeNorm = chave.slice(chave.indexOf("|") + 1);
    const l = chavesPorCidade.get(cidadeNorm) ?? [];
    l.push(chave);
    chavesPorCidade.set(cidadeNorm, l);
  }

  const resultado: BenchmarkPorCidade = new Map();
  const casadores = new Map<string, ReturnType<typeof criarCasadorDeBairro>>();

  for (const l of linhas) {
    // O cadastro guarda "Londrina", "LONDRINA" ou "Londrina - PR"; o censo
    // indexa por "LONDRINA". Passa pelas duas réguas do produto, na ordem.
    const cidadeNorm = normalizarLocalidade(normalizarCidade(l.city));
    const chaves = chavesPorCidade.get(cidadeNorm);
    if (!chaves) continue;
    const ufLinha = normalizarUf(l.state);

    for (const chave of chaves) {
      const ufPedida = chave.slice(0, chave.indexOf("|"));
      if (ufPedida && ufLinha && ufPedida !== ufLinha) continue;
      const lista = canonicos.get(chave);
      if (!lista || lista.length === 0) continue;

      let casar = casadores.get(chave);
      if (!casar) { casar = criarCasadorDeBairro(lista); casadores.set(chave, casar); }
      // Bairro que não casa com o censo não agrega: sem chave canônica o número
      // somaria lugares diferentes com o mesmo apelido.
      const m = casar(l.neighborhood);
      if (!m) continue;

      let porBairro = resultado.get(chave);
      if (!porBairro) { porBairro = new Map(); resultado.set(chave, porBairro); }
      let contrib = porBairro.get(m.canonico);
      if (!contrib) { contrib = new Map(); porBairro.set(m.canonico, contrib); }
      // O mesmo provedor pode chegar em duas grafias do ERP que caem no mesmo
      // canônico: soma na parcela dele, não vira dois provedores.
      const p = contrib.get(l.providerId) ?? { clientes: 0, inadimplentes: 0 };
      p.clientes += Number(l.clientes) || 0;
      p.inadimplentes += Number(l.inadimplentes) || 0;
      contrib.set(l.providerId, p);
    }
  }
  return resultado;
}

/**
 * O mercado de UM observador num bairro, ou null quando as travas não fecham:
 * k contribuintes com massa, e o que sobra sem o observador ainda tem piso.
 * É aqui que o conjunto de ids morre: daqui em diante só existe a contagem.
 */
export function resumirBenchmark(
  contrib: ContribuicoesBairro | null | undefined,
  observador: number,
): BenchmarkBairro | null {
  if (!contrib) return null;
  let provedores = 0;
  let clientes = 0;
  let inadimplentes = 0;
  for (const [providerId, p] of Array.from(contrib.entries())) {
    if (p.clientes < BENCHMARK_MIN_CLIENTES_POR_PROVEDOR) continue;
    provedores++;
    if (providerId === observador) continue;
    clientes += p.clientes;
    inadimplentes += p.inadimplentes;
  }
  if (provedores < BENCHMARK_K_MINIMO) return null;
  if (clientes < BENCHMARK_MIN_CLIENTES_TOTAL) return null;
  return {
    provedores, clientes, inadimplentes,
    pct: Math.round((inadimplentes / clientes) * 1000) / 10,
  };
}

/**
 * O que vai para a tela: o percentual, ou null quando as travas não fecham. É
 * o único caminho pelo qual o benchmark chega ao payload — a trava fica num
 * lugar só.
 */
export function benchmarkParaTela(
  contrib: ContribuicoesBairro | null | undefined,
  observador: number,
): number | null {
  return resumirBenchmark(contrib, observador)?.pct ?? null;
}

/* ── Leitura ────────────────────────────────────────────────────────────── */

/**
 * O agregado do banco é UM só, global, e é ele que vale por uma hora. O
 * benchmark muda quando um sync roda, e o sync roda de hora em hora no melhor
 * caso — uma varredura da tabela inteira por render do Raio-X seria pagar toda
 * vez por um número que não mudou. Cachear por cidade sobre uma query global
 * era pior: cada cidade nova na hora disparava a varredura de novo e jogava
 * fora o resultado das outras.
 *
 * O casamento por cidade é derivado daqui e barato; ele fica guardado enquanto
 * o agregado for o mesmo E a lista canônica do censo for a mesma — reingestão
 * do CNEFE muda o casamento do HP na hora, e o mercado precisa mudar junto.
 */
const BENCHMARK_TTL_MS = 60 * 60 * 1000;
let agregadoCache: { em: number; linhas: LinhaAgregadaBenchmark[] } | null = null;
// Promise em voo: dois renders no cache frio dividem a mesma ida ao banco.
let agregadoEmVoo: Promise<LinhaAgregadaBenchmark[]> | null = null;
const derivadoCache = new Map<string, {
  linhas: LinhaAgregadaBenchmark[]; assinatura: string; bairros: Map<string, ContribuicoesBairro>;
}>();

/** Só para os testes: esvazia os caches. */
export function _limparCacheDeBenchmarkParaTestes(): void {
  agregadoCache = null;
  agregadoEmVoo = null;
  derivadoCache.clear();
}

/**
 * Uma ida ao banco, já agregada por (provedor, UF, cidade, bairro): o SQL
 * devolve contagens, nunca linhas de cliente, e o casamento com o censo é
 * feito em memória sobre poucos milhares de tuplas.
 *
 * Só provedor aprovado e ativo contribui — ver o item 2 do cabeçalho. Bairro
 * vazio sai no SQL: sem bairro não há o que casar, e é o mesmo corte do
 * AGREGADO_SQL do Provedor.ai.
 *
 * A régua de universo é a do Raio-X (localizacao.storage.ts): entra quem ainda
 * é cliente (status fora de cancelled/inactive) OU quem saiu devendo; é
 * inadimplente quem tem valor em aberto. Dois universos diferentes dos dois
 * lados fariam o provedor comparar a sua taxa com uma taxa de outra coisa.
 *
 * Não filtra por cidade no SQL de propósito: o nome vem como texto livre e
 * normalizar com acento dentro do Postgres exigiria extensão. O GROUP BY já
 * reduz a tabela a uma linha por bairro por provedor; o corte por cidade cabe
 * na memória.
 */
async function lerAgregado(): Promise<LinhaAgregadaBenchmark[]> {
  const rows = await db
    .select({
      providerId: customers.providerId,
      state: customers.state,
      city: customers.city,
      neighborhood: customers.neighborhood,
      clientes: sql<number>`count(*)::int`,
      inadimplentes: sql<number>`count(*) filter (where coalesce(${customers.totalOverdueAmount}, 0) > 0)::int`,
    })
    .from(customers)
    .innerJoin(providers, eq(providers.id, customers.providerId))
    .where(sql`
      ${providers.status} = 'active'
      and ${providers.verificationStatus} = 'approved'
      and ${customers.neighborhood} is not null
      and ${customers.neighborhood} <> ''
      and (
        lower(${customers.status}) not in ('cancelled', 'inactive')
        or coalesce(${customers.totalOverdueAmount}, 0) > 0
      )
    `)
    .groupBy(customers.providerId, customers.state, customers.city, customers.neighborhood);
  return rows as LinhaAgregadaBenchmark[];
}

async function agregadoDaHora(agora: number): Promise<LinhaAgregadaBenchmark[]> {
  if (agregadoCache && agora - agregadoCache.em < BENCHMARK_TTL_MS) return agregadoCache.linhas;
  if (!agregadoEmVoo) {
    agregadoEmVoo = lerAgregado()
      .then(linhas => { agregadoCache = { em: Date.now(), linhas }; return linhas; })
      .finally(() => { agregadoEmVoo = null; });
  }
  return agregadoEmVoo;
}

export interface PedidoBenchmark { cidadeNorm: string; uf: string | null }

/**
 * Benchmark das cidades pedidas (chave de retorno: chaveCidadeBenchmark;
 * cidadeNorm na régua de normalizarLocalidade, a mesma de
 * geo_hps_bairro.cidade_norm). Cidade sem CNEFE carregado não entra no mapa de
 * retorno — sem lista canônica não há como casar, e a tela mostra "aguardando
 * benchmark", que é a verdade.
 *
 * `territorio` é o que aplicarTerritorio já carregou para o HP: reaproveitar
 * evita a segunda ida a geo_hps_bairro na mesma requisição e garante que os
 * dois lados casaram contra a MESMA lista.
 */
export async function calcularBenchmarkBairro(
  pedidos: PedidoBenchmark[],
  territorio?: Map<string, TerritorioDoMunicipio>,
): Promise<BenchmarkPorCidade> {
  const mapa: BenchmarkPorCidade = new Map();
  const unicos = new Map<string, PedidoBenchmark>();
  for (const p of pedidos) {
    if (!p.cidadeNorm) continue;
    unicos.set(chaveCidadeBenchmark(p.uf, p.cidadeNorm), p);
  }
  if (unicos.size === 0) return mapa;

  const cidades = Array.from(new Set(Array.from(unicos.values()).map(p => p.cidadeNorm)));
  const terr = territorio ?? await carregarTerritorio(cidades);

  // Mesma lista e mesma ordem do casador de HPs do Raio-X: é o que faz o
  // benchmark mostrado num bairro ser o benchmark daquele bairro.
  const canonicos = new Map<string, string[]>();
  for (const [chave, p] of Array.from(unicos.entries())) {
    const t = terr.get(p.cidadeNorm);
    if (!t || t.hps.size === 0) continue;
    canonicos.set(chave, ordenarCanonicosPorTamanho(t.hps));
  }
  // Sem censo em nenhuma das cidades pedidas, nem vale ir ao banco de clientes.
  if (canonicos.size === 0) return mapa;

  const linhas = await agregadoDaHora(Date.now());

  // Nome de bairro não tem quebra de linha: a lista inteira, na ordem, é a
  // assinatura do casamento.
  const faltam = new Map<string, string[]>();
  for (const [chave, lista] of Array.from(canonicos.entries())) {
    const hit = derivadoCache.get(chave);
    if (hit && hit.linhas === linhas && hit.assinatura === lista.join("\n")) mapa.set(chave, hit.bairros);
    else faltam.set(chave, lista);
  }
  if (faltam.size === 0) return mapa;

  const calculado = agregarBenchmarkBairro(linhas, faltam);
  for (const [chave, lista] of Array.from(faltam.entries())) {
    const bairros = calculado.get(chave) ?? new Map<string, ContribuicoesBairro>();
    derivadoCache.set(chave, { linhas, assinatura: lista.join("\n"), bairros });
    mapa.set(chave, bairros);
  }
  return mapa;
}
