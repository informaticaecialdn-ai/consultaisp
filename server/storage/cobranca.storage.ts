import {
  and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, notExists, notInArray, or, sql,
  type SQL,
} from "drizzle-orm";
import { db } from "../db";
import {
  cobrancaCasos,
  cobrancaEventos,
  cobrancaNegociacoes,
  cobrancaParcelas,
  cobrancaPolitica,
  customers,
  users,
  STATUS_CASO_FECHADO,
  type CarteiraDeCobranca,
  type CobrancaCaso,
  type CobrancaEvento,
  type CobrancaNegociacao,
  type CobrancaParcela,
  type CobrancaPolitica,
  type Customer,
  type InsertCobrancaCaso,
  type InsertCobrancaPolitica,
  type StatusCasoCobranca,
} from "@shared/schema";
import {
  STATUS_VIVOS_DE_NEGOCIACAO,
  negociacaoEncerrada,
  statusAposNegociacaoDesfeita,
  type StatusDeCaso,
} from "@shared/cobranca/estados";
import { arredondar, brl } from "@shared/cobranca/politica";
import { dataSemHora } from "./customers.storage";

/**
 * A cobranca vista do banco: politica, casos, linha do tempo, negociacoes,
 * parcelas, os numeros da carteira, a fila do operador e os candidatos a caso.
 *
 * Tres decisoes valem para a classe inteira:
 *
 * 1. TODA consulta filtra por `provider_id` — na tabela alvo E em cada join.
 *    O join com `customers` e `users` repete `provider_id = provider_id` para
 *    um id apontado a outro tenant nao vazar nome pelo join, como faz o board
 *    de recuperacao. Ha teste que le o SQL de cada metodo e confere.
 *
 * 2. O STORAGE E DONO DA TRILHA MECANICA. Tudo que muda o estado de um caso
 *    por dentro — etapa, responsavel, encerramento, proposta, acordo aceito ou
 *    quebrado, parcela paga, acordo cumprido — grava o proprio evento na mesma
 *    transacao, com `user_id` do ator (nulo = sistema). As rotas registram so
 *    o que o FUNCIONARIO declara: contato, promessa, nota, suspensao,
 *    negativacao. Sem isso cada rota escreveria o evento por conta propria e a
 *    linha do tempo teria buracos onde uma esquecesse.
 *
 * 3. DINHEIRO ENTRA COMO NUMBER E SAI COMO STRING nas linhas cruas (e o que o
 *    Drizzle faz com DECIMAL, igual a `customers.totalOverdueAmount`); nas
 *    formas DERIVADAS (linha da carteira, KPIs, contagens) ja sai como number,
 *    porque e o que a tela soma e formata.
 */

/**
 * Status do ERP que fazem do cliente um cliente ATUAL — a carteira "ativo".
 * Suspenso por atraso ainda e cliente: cortado, mas com contrato.
 * `cancelled` e `inactive` sao ex-cliente.
 */
export const STATUS_DE_CLIENTE_ATUAL = ["active", "suspended"] as const;

export function carteiraDoStatusErp(status: string | null | undefined): CarteiraDeCobranca {
  return (STATUS_DE_CLIENTE_ATUAL as readonly string[]).includes(status ?? "") ? "ativo" : "ex_cliente";
}

/** O mesmo vocabulario de `PRIORIDADES` em shared/cobranca/estados.ts (ha teste de paridade). */
export const PRIORIDADES_DE_CASO = ["critica", "alta", "normal", "baixa"] as const;
export type PrioridadeDeCaso = (typeof PRIORIDADES_DE_CASO)[number];

export type StatusCasoFechado = (typeof STATUS_CASO_FECHADO)[number];
export type StatusCasoVivo = Exclude<StatusCasoCobranca, StatusCasoFechado>;

export const STATUS_NEGOCIACAO = ["proposta", "aceita", "ativa", "cumprida", "quebrada", "cancelada"] as const;
export type StatusNegociacao = (typeof STATUS_NEGOCIACAO)[number];

export type TipoNegociacao = "parcelamento" | "quitacao_desconto" | "baixa_negociada";

/**
 * O que o storage recusa por REGRA DE NEGOCIO, e nao por dado errado. Sai com
 * codigo para a rota traduzir em 409 (conflito com o estado atual) sem ler
 * mensagem com regex — e a mensagem, em portugues, vai para o operador.
 *
 *   NEGOCIACAO_NAO_ACEITA  pagar parcela de proposta que o cliente nao aceitou
 *   NEGOCIACAO_ENCERRADA   mexer em negociacao cumprida, quebrada ou cancelada
 *   NEGOCIACAO_VIVA        propor outra enquanto ha proposta, aceita ou ativa
 *   CASO_ENCERRADO         negociar em caso fechado
 *   MOTIVO_OBRIGATORIO     cancelamento sem motivo
 *   VALOR_INVALIDO         pagamento de zero ou negativo
 */
export const CODIGOS_DE_ERRO_DE_COBRANCA = [
  "NEGOCIACAO_NAO_ACEITA",
  "NEGOCIACAO_ENCERRADA",
  "NEGOCIACAO_VIVA",
  "CASO_ENCERRADO",
  "MOTIVO_OBRIGATORIO",
  "VALOR_INVALIDO",
] as const;
export type CodigoDeErroDeCobranca = (typeof CODIGOS_DE_ERRO_DE_COBRANCA)[number];

export class ErroDeCobranca extends Error {
  readonly codigo: CodigoDeErroDeCobranca;
  constructor(codigo: CodigoDeErroDeCobranca, mensagem: string) {
    super(mensagem);
    this.name = "ErroDeCobranca";
    this.codigo = codigo;
  }
}

/**
 * Faixas de divida da barra de filtros, sobre `customers.total_overdue_amount`
 * — a divida de HOJE segundo o ERP, nao a foto da abertura do caso.
 */
export type FaixaDeDivida = "ate-100" | "100-300" | "300-1000" | "1000-mais";
const FAIXAS_DE_DIVIDA: Record<FaixaDeDivida, { min: number; max: number | null }> = {
  "ate-100": { min: 0, max: 100 },
  "100-300": { min: 100, max: 300 },
  "300-1000": { min: 300, max: 1000 },
  "1000-mais": { min: 1000, max: null },
};

export interface FiltrosDaCarteira {
  /** Ausente = so casos vivos. `"todos"` = inclui fechados. */
  status?: StatusCasoCobranca[] | "todos";
  carteira?: CarteiraDeCobranca;
  etapa?: string;
  /** `null` = so a fila geral (sem responsavel). Ausente = todos. */
  responsavelUserId?: number | null;
  /** Nome (ILIKE) ou documento (so digitos, prefixo). */
  busca?: string;
  /** `A` | `B` | `C` (grupo) ou `A1`..`C3` (quadrante). */
  quadrante?: string;
  faixaDivida?: FaixaDeDivida;
  /** `customers.neighborhood`, igualdade. */
  bairro?: string;
}

export interface Paginacao {
  pagina: number;
  porPagina: number;
}
const PAGINA_MAXIMA = 200;

export interface ClienteDaCarteira {
  id: number;
  nome: string;
  cpfCnpj: string;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  bairro: string | null;
  /** `customers.status` como o ERP deu: active | suspended | cancelled | inactive. */
  statusErp: string;
  dividaAtual: number;
  diasAtraso: number;
  faturasAbertas: number;
  /**
   * Sempre `null` hoje: `customers` nao guarda plano (o `contractPlan` que o
   * conector traz e descartado pelo upsert). O campo fica para a tela nao
   * mudar quando a fase 2 o trouxer — ate la, mostra "—".
   */
  plano: string | null;
  /** `YYYY-MM-DD`, ou null quando o ERP nao informou. Fidelidade do DNA. */
  contractStartDate: string | null;
}

export interface LinhaDaCarteira {
  id: number;
  status: string;
  carteira: string;
  abertoEm: Date;
  etapaAtual: string | null;
  diasAtrasoAbertura: number;
  valorAbertura: number;
  valorAtual: number;
  responsavelUserId: number | null;
  responsavelNome: string | null;
  prioridade: string;
  proximoContatoEm: Date | null;
  ultimoContatoEm: Date | null;
  quadranteDna: string | null;
  tom: string | null;
  encerradoEm: Date | null;
  motivoEncerramento: string | null;
  cliente: ClienteDaCarteira;
}

export interface AberturaDeCaso {
  customerId: number;
  carteira: CarteiraDeCobranca;
  diasAtrasoAbertura: number;
  valorAbertura: number;
  etapaAtual?: string | null;
  responsavelUserId?: number | null;
  prioridade?: PrioridadeDeCaso;
  proximoContatoEm?: Date | null;
  quadranteDna?: string | null;
  tom?: string | null;
}

/** O que `atualizar` aceita. Encerrar e por `fecharCasoDeCobranca`. */
export interface PatchDeCaso {
  status?: StatusCasoVivo;
  etapaAtual?: string | null;
  valorAtual?: number;
  responsavelUserId?: number | null;
  prioridade?: PrioridadeDeCaso;
  proximoContatoEm?: Date | null;
  quadranteDna?: string | null;
  tom?: string | null;
}

export type PatchDePolitica = Partial<Pick<InsertCobrancaPolitica,
  "etapas" | "negociacao" | "encargos" | "janelaContato" | "economia" | "pausada" | "pausadaMotivo"
>>;

/**
 * O DNA que o motor calculou para o caso. `arbitrado` = calculado SEM a data
 * do contrato (o ERP nao a informou), com a fidelidade assumida — o operador
 * precisa saber que o tom saiu de um chute, e a nota de sistema e o aviso.
 */
export interface DnaDoCaso {
  quadranteDna: string | null;
  tom: string | null;
  arbitrado: boolean;
}

export interface ResultadoDoPagamento {
  parcela: CobrancaParcela;
  negociacao: CobrancaNegociacao;
  acordoCumprido: boolean;
  /** O valor nao cobriu a parcela: ela continua pendente/atrasada com `valor_pago` acumulado. */
  parcial: boolean;
}

export interface NovoEvento {
  casoId: number;
  /** Nulo = sistema. */
  userId?: number | null;
  tipo: string;
  canal?: string | null;
  resultado?: string | null;
  notas?: string | null;
  metadata?: Record<string, unknown> | null;
  ocorridoEm?: Date;
}

export interface NovaNegociacao {
  casoId: number;
  tipo: TipoNegociacao;
  valorOriginal: number;
  valorNegociado: number;
  descontoPct?: number;
  entrada?: number;
  valorParcela?: number | null;
  /** `YYYY-MM-DD`. Ausente = vencimento da primeira parcela. */
  primeiroVencimento?: string | null;
  criadoPorUserId: number;
  /** O cliente ja disse sim na ligacao: nasce `aceita` e o caso vai a `acordo_ativo`. */
  aceita?: boolean;
}

export interface NovaParcela {
  numero: number;
  valor: number;
  /** `YYYY-MM-DD`. */
  vencimento: string;
}

/** `parcelas` (numero) e a CONTAGEM da coluna; as linhas de cobranca_parcelas vao em `parcelamento`. */
export type NegociacaoComParcelas = CobrancaNegociacao & { parcelamento: CobrancaParcela[] };

export interface KpisDaCobranca {
  ativosComDivida: number;
  exClientesComDivida: number;
  /** Soma da divida de hoje, as duas carteiras. */
  emAberto: number;
  contatadosHoje: number;
  /** Parcelas pagas + casos pagos sem acordo, nos ultimos 30 dias. */
  recuperado30d: number;
}

export interface ComposicaoDaCarteira {
  emDia: number;
  emCobranca: number;
  exComDivida: number;
}

export interface ContagemPorEtapa { etapa: string | null; carteira: string; casos: number; valor: number }
export interface ContagemPorQuadrante { quadrante: string | null; carteira: string; casos: number; valor: number }

export interface CandidatoACaso {
  customerId: number;
  nome: string;
  cpfCnpj: string;
  statusErp: string;
  carteira: CarteiraDeCobranca;
  dividaAtual: number;
  diasAtraso: number;
  faturasAbertas: number;
  contractStartDate: string | null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** DECIMAL no Drizzle e string. Recusa NaN aqui para nao virar erro de banco sem contexto. */
function dinheiro(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`Valor monetario invalido: ${v}`);
  return v.toFixed(2);
}

const num = (v: unknown): number => Number(v ?? 0);

const casoVivo = () => notInArray(cobrancaCasos.status, [...STATUS_CASO_FECHADO]);
const casoFechado = (status: string) => (STATUS_CASO_FECHADO as readonly string[]).includes(status);
const clienteAtual = () => inArray(customers.status, [...STATUS_DE_CLIENTE_ATUAL]);
const comDivida = () => sql`coalesce(${customers.totalOverdueAmount}, 0) > 0`;
const semDivida = () => sql`coalesce(${customers.totalOverdueAmount}, 0) <= 0`;

/** O que a tela da carteira mostra por linha, juntando caso, cliente e responsavel. */
const colunasDaLinha = {
  id: cobrancaCasos.id,
  status: cobrancaCasos.status,
  carteira: cobrancaCasos.carteira,
  abertoEm: cobrancaCasos.abertoEm,
  etapaAtual: cobrancaCasos.etapaAtual,
  diasAtrasoAbertura: cobrancaCasos.diasAtrasoAbertura,
  valorAbertura: cobrancaCasos.valorAbertura,
  valorAtual: cobrancaCasos.valorAtual,
  responsavelUserId: cobrancaCasos.responsavelUserId,
  responsavelNome: users.name,
  prioridade: cobrancaCasos.prioridade,
  proximoContatoEm: cobrancaCasos.proximoContatoEm,
  ultimoContatoEm: cobrancaCasos.ultimoContatoEm,
  quadranteDna: cobrancaCasos.quadranteDna,
  tom: cobrancaCasos.tom,
  encerradoEm: cobrancaCasos.encerradoEm,
  motivoEncerramento: cobrancaCasos.motivoEncerramento,
  clienteId: customers.id,
  clienteNome: customers.name,
  clienteCpfCnpj: customers.cpfCnpj,
  clienteTelefone: customers.phone,
  clienteEmail: customers.email,
  clienteCidade: customers.city,
  clienteBairro: customers.neighborhood,
  clienteStatusErp: customers.status,
  clienteDivida: customers.totalOverdueAmount,
  clienteDias: customers.maxDaysOverdue,
  clienteFaturas: customers.overdueInvoicesCount,
  clienteContrato: customers.contractStartDate,
};

type LinhaCrua = { [K in keyof typeof colunasDaLinha]: (typeof colunasDaLinha)[K]["_"]["data"] | null };

function montarLinha(l: LinhaCrua): LinhaDaCarteira {
  return {
    id: l.id as number,
    status: l.status as string,
    carteira: l.carteira as string,
    abertoEm: l.abertoEm as Date,
    etapaAtual: l.etapaAtual,
    diasAtrasoAbertura: num(l.diasAtrasoAbertura),
    valorAbertura: num(l.valorAbertura),
    valorAtual: num(l.valorAtual),
    responsavelUserId: l.responsavelUserId,
    responsavelNome: l.responsavelNome,
    prioridade: l.prioridade as string,
    proximoContatoEm: l.proximoContatoEm,
    ultimoContatoEm: l.ultimoContatoEm,
    quadranteDna: l.quadranteDna,
    tom: l.tom,
    encerradoEm: l.encerradoEm,
    motivoEncerramento: l.motivoEncerramento,
    cliente: {
      id: l.clienteId as number,
      nome: l.clienteNome as string,
      cpfCnpj: l.clienteCpfCnpj as string,
      telefone: l.clienteTelefone,
      email: l.clienteEmail,
      cidade: l.clienteCidade,
      bairro: l.clienteBairro,
      statusErp: l.clienteStatusErp as string,
      dividaAtual: num(l.clienteDivida),
      diasAtraso: num(l.clienteDias),
      faturasAbertas: num(l.clienteFaturas),
      plano: null,
      contractStartDate: l.clienteContrato,
    },
  };
}

/**
 * O join da carteira. O responsavel tem de ser do MESMO provedor: um id
 * apontado para usuario de outro tenant nao pode vazar nome pelo join.
 */
function daCarteira(condicao: SQL | undefined) {
  return db.select(colunasDaLinha).from(cobrancaCasos)
    .innerJoin(customers, and(
      eq(customers.id, cobrancaCasos.customerId),
      eq(customers.providerId, cobrancaCasos.providerId),
    ))
    .leftJoin(users, and(
      eq(users.id, cobrancaCasos.responsavelUserId),
      eq(users.providerId, cobrancaCasos.providerId),
    ))
    .where(condicao);
}

function condicaoDaFaixa(faixa: FaixaDeDivida): SQL | undefined {
  const { min, max } = FAIXAS_DE_DIVIDA[faixa];
  const partes: SQL[] = [
    min === 0 ? comDivida() : sql`coalesce(${customers.totalOverdueAmount}, 0) >= ${min}`,
  ];
  if (max !== null) partes.push(sql`coalesce(${customers.totalOverdueAmount}, 0) < ${max}`);
  return and(...partes);
}

/**
 * Nome ou documento, decidido pelo que foi digitado: se o texto e so digitos
 * e pontuacao de CPF/CNPJ, procura o documento por prefixo (comparando os
 * digitos, como `getCustomerByCpfCnpj`); senao, o nome por ILIKE.
 */
function condicaoDaBusca(busca: string): SQL | undefined {
  const texto = busca.trim();
  const digitos = texto.replace(/\D/g, "");
  const pareceDocumento = digitos.length >= 3 && digitos.length === texto.replace(/[.\-/\s]/g, "").length;
  if (pareceDocumento) {
    return sql`regexp_replace(${customers.cpfCnpj}, '[^0-9]', '', 'g') like ${digitos + "%"}`;
  }
  const escapado = texto.replace(/[\\%_]/g, (m) => `\\${m}`);
  return ilike(customers.name, `%${escapado}%`);
}

function condicoesDaCarteira(providerId: number, f: FiltrosDaCarteira): SQL | undefined {
  const conds: (SQL | undefined)[] = [eq(cobrancaCasos.providerId, providerId)];
  if (f.status === "todos") {
    // sem filtro de status
  } else if (f.status && f.status.length > 0) {
    conds.push(inArray(cobrancaCasos.status, f.status));
  } else {
    conds.push(casoVivo());
  }
  if (f.carteira) conds.push(eq(cobrancaCasos.carteira, f.carteira));
  if (f.etapa) conds.push(eq(cobrancaCasos.etapaAtual, f.etapa));
  if (f.responsavelUserId === null) conds.push(isNull(cobrancaCasos.responsavelUserId));
  else if (f.responsavelUserId !== undefined) conds.push(eq(cobrancaCasos.responsavelUserId, f.responsavelUserId));
  if (f.quadrante) {
    const q = f.quadrante.trim().toUpperCase();
    conds.push(q.length === 1
      ? sql`left(${cobrancaCasos.quadranteDna}, 1) = ${q}`
      : eq(cobrancaCasos.quadranteDna, q));
  }
  if (f.faixaDivida) conds.push(condicaoDaFaixa(f.faixaDivida));
  if (f.bairro) conds.push(eq(customers.neighborhood, f.bairro));
  if (f.busca?.trim()) conds.push(condicaoDaBusca(f.busca));
  return and(...conds);
}

/** critica antes de alta, alta antes de normal, normal antes de baixa. */
const pesoDaPrioridade = () =>
  sql`case ${cobrancaCasos.prioridade} when 'critica' then 0 when 'alta' then 1 when 'normal' then 2 else 3 end`;

export class CobrancaStorage {
  // ── Politica ──────────────────────────────────────────────────────────────

  /** Undefined = o provedor nunca configurou; o motor aplica o catalogo e POLITICA_DE_COBRANCA_PADRAO. */
  async getPoliticaDeCobranca(providerId: number): Promise<CobrancaPolitica | undefined> {
    const [linha] = await db.select().from(cobrancaPolitica)
      .where(eq(cobrancaPolitica.providerId, providerId))
      .limit(1);
    return linha;
  }

  /**
   * Insere ou atualiza SO os campos enviados. Uma chamada com `{ pausada: true }`
   * numa linha que nao existe cria a linha com os defaults da coluna — e o
   * botao de pausar a regua funciona antes de qualquer configuracao.
   */
  async upsertPoliticaDeCobranca(providerId: number, dados: PatchDePolitica): Promise<CobrancaPolitica> {
    const set: PatchDePolitica & { updatedAt: Date } = { updatedAt: new Date() };
    if (dados.etapas !== undefined) set.etapas = dados.etapas;
    if (dados.negociacao !== undefined) set.negociacao = dados.negociacao;
    if (dados.encargos !== undefined) set.encargos = dados.encargos;
    if (dados.janelaContato !== undefined) set.janelaContato = dados.janelaContato;
    if (dados.economia !== undefined) set.economia = dados.economia;
    if (dados.pausada !== undefined) set.pausada = dados.pausada;
    if (dados.pausadaMotivo !== undefined) set.pausadaMotivo = dados.pausadaMotivo;

    const [linha] = await db.insert(cobrancaPolitica)
      .values({ providerId, ...set })
      .onConflictDoUpdate({ target: cobrancaPolitica.providerId, set })
      .returning();
    return linha;
  }

  // ── Casos ─────────────────────────────────────────────────────────────────

  async listarCasosDeCobranca(
    providerId: number,
    filtros: FiltrosDaCarteira = {},
    paginacao: Paginacao = { pagina: 1, porPagina: 50 },
  ): Promise<{ linhas: LinhaDaCarteira[]; total: number }> {
    const porPagina = Math.min(Math.max(1, Math.trunc(paginacao.porPagina) || 50), PAGINA_MAXIMA);
    const pagina = Math.max(1, Math.trunc(paginacao.pagina) || 1);
    const condicao = condicoesDaCarteira(providerId, filtros);

    const linhas = await daCarteira(condicao)
      .orderBy(desc(cobrancaCasos.valorAtual), asc(cobrancaCasos.id))
      .limit(porPagina)
      .offset((pagina - 1) * porPagina);

    // O total precisa do join com `customers`: bairro, faixa e busca filtram
    // colunas do cliente.
    const [contagem] = await db.select({ total: count() }).from(cobrancaCasos)
      .innerJoin(customers, and(
        eq(customers.id, cobrancaCasos.customerId),
        eq(customers.providerId, cobrancaCasos.providerId),
      ))
      .where(condicao);

    return { linhas: linhas.map(montarLinha), total: num(contagem?.total) };
  }

  async obterCasoDeCobranca(providerId: number, id: number): Promise<LinhaDaCarteira | undefined> {
    const [linha] = await daCarteira(and(
      eq(cobrancaCasos.providerId, providerId),
      eq(cobrancaCasos.id, id),
    )).limit(1);
    return linha ? montarLinha(linha) : undefined;
  }

  /** O caso VIVO do cliente, se houver — por construcao ha no maximo um. */
  async casoAbertoDoCliente(providerId: number, customerId: number): Promise<CobrancaCaso | undefined> {
    const [caso] = await db.select().from(cobrancaCasos)
      .where(and(
        eq(cobrancaCasos.providerId, providerId),
        eq(cobrancaCasos.customerId, customerId),
        casoVivo(),
      ))
      .limit(1);
    return caso;
  }

  /**
   * Abre o caso com a FOTO do momento (dias, valor, carteira). Recusa cliente
   * de outro provedor e cliente que ja tem caso vivo — o indice parcial e a
   * ultima guarda para a corrida entre dois jobs.
   */
  async abrirCasoDeCobranca(providerId: number, dados: AberturaDeCaso): Promise<CobrancaCaso> {
    const [cliente] = await db.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.id, dados.customerId), eq(customers.providerId, providerId)))
      .limit(1);
    if (!cliente) throw new Error(`Cliente ${dados.customerId} nao pertence ao provedor ${providerId}`);

    const vivo = await this.casoAbertoDoCliente(providerId, dados.customerId);
    if (vivo) throw new Error(`Cliente ${dados.customerId} ja tem caso de cobranca aberto (#${vivo.id})`);

    const [caso] = await db.insert(cobrancaCasos).values({
      providerId,
      customerId: dados.customerId,
      status: "aberto",
      carteira: dados.carteira,
      diasAtrasoAbertura: Math.max(0, Math.trunc(dados.diasAtrasoAbertura)),
      valorAbertura: dinheiro(dados.valorAbertura),
      valorAtual: dinheiro(dados.valorAbertura),
      etapaAtual: dados.etapaAtual ?? null,
      responsavelUserId: dados.responsavelUserId ?? null,
      prioridade: dados.prioridade ?? "normal",
      proximoContatoEm: dados.proximoContatoEm ?? null,
      quadranteDna: dados.quadranteDna ?? null,
      tom: dados.tom ?? null,
    }).returning();
    return caso;
  }

  /**
   * Mudanca de etapa e de responsavel deixam evento (`etapa_mudou`,
   * `responsavel_mudou`) com o antes e o depois — e a linha do tempo que a
   * ficha 360 mostra. `userId` nulo = foi o motor.
   */
  async atualizarCasoDeCobranca(
    providerId: number,
    id: number,
    patch: PatchDeCaso,
    userId: number | null = null,
  ): Promise<CobrancaCaso | undefined> {
    if (patch.status && casoFechado(patch.status)) {
      throw new Error("Para encerrar um caso use fecharCasoDeCobranca: ele carimba encerrado_em e o motivo");
    }
    return db.transaction(async (tx) => {
      const [atual] = await tx.select().from(cobrancaCasos)
        .where(and(eq(cobrancaCasos.id, id), eq(cobrancaCasos.providerId, providerId)))
        .limit(1);
      if (!atual) return undefined;

      const agora = new Date();
      const set: Partial<InsertCobrancaCaso> = { updatedAt: agora };
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.etapaAtual !== undefined) set.etapaAtual = patch.etapaAtual;
      if (patch.valorAtual !== undefined) set.valorAtual = dinheiro(patch.valorAtual);
      if (patch.responsavelUserId !== undefined) set.responsavelUserId = patch.responsavelUserId;
      if (patch.prioridade !== undefined) set.prioridade = patch.prioridade;
      if (patch.proximoContatoEm !== undefined) set.proximoContatoEm = patch.proximoContatoEm;
      if (patch.quadranteDna !== undefined) set.quadranteDna = patch.quadranteDna;
      if (patch.tom !== undefined) set.tom = patch.tom;

      const [novo] = await tx.update(cobrancaCasos).set(set)
        .where(and(eq(cobrancaCasos.id, id), eq(cobrancaCasos.providerId, providerId)))
        .returning();

      if (patch.etapaAtual !== undefined && patch.etapaAtual !== atual.etapaAtual) {
        await tx.insert(cobrancaEventos).values({
          providerId, casoId: id, customerId: atual.customerId, userId,
          tipo: "etapa_mudou", canal: "sistema",
          metadata: { de: atual.etapaAtual, para: patch.etapaAtual },
          ocorridoEm: agora,
        });
      }
      if (patch.responsavelUserId !== undefined && patch.responsavelUserId !== atual.responsavelUserId) {
        await tx.insert(cobrancaEventos).values({
          providerId, casoId: id, customerId: atual.customerId, userId,
          tipo: "responsavel_mudou", canal: "sistema",
          metadata: { de: atual.responsavelUserId, para: patch.responsavelUserId },
          ocorridoEm: agora,
        });
      }
      return novo;
    });
  }

  /**
   * Encerra com um status TERMINAL (pago | baixado | encerrado |
   * cancelamento). Caso ja fechado volta como esta: reescrever `encerrado_em`
   * apagaria quando ele de fato terminou.
   *
   * Encerrar DESFAZ o que ficou pendurado: negociacao viva (proposta, aceita,
   * ativa) e cancelada e as parcelas pendentes dela tambem, na mesma
   * transacao e com evento — achado da revisao: sem isso o caso fechava e a
   * parcela continuava vencendo, o job a marcava atrasada e quebrava um
   * acordo de um caso que nao existia mais.
   *
   * `cancelamento` exige motivo e vai por `cancelarCaso`, que grava o evento
   * proprio (com a sugestao de recuperar o equipamento).
   */
  async fecharCasoDeCobranca(
    providerId: number,
    id: number,
    status: StatusCasoFechado,
    motivo: string | null,
    userId: number | null = null,
  ): Promise<CobrancaCaso | undefined> {
    if (!casoFechado(status)) {
      throw new Error(`Status "${status}" nao encerra um caso; use ${STATUS_CASO_FECHADO.join(" | ")}`);
    }
    if (status === "cancelamento") return this.cancelarCaso(providerId, id, motivo ?? "", userId);
    return db.transaction(async (tx) => {
      const [atual] = await tx.select().from(cobrancaCasos)
        .where(and(eq(cobrancaCasos.id, id), eq(cobrancaCasos.providerId, providerId)))
        .limit(1);
      if (!atual) return undefined;
      if (casoFechado(atual.status)) return atual;
      return encerrarCaso(tx, providerId, atual, status, motivo, new Date(), userId);
    });
  }

  /**
   * O contrato entrou em cancelamento: o caso fecha como `cancelamento`, com
   * o evento `cancelamento` carregando o motivo e `sugerirRecuperacao: true`
   * — e a tela que oferece abrir o caso de recuperacao do equipamento. O
   * motivo e obrigatorio porque e o que o funcionario le antes de ir buscar
   * o aparelho. `userId` nulo = o job, quando o ERP disse que o cliente foi
   * cancelado com caso vivo. Caso ja fechado volta como esta.
   */
  async cancelarCaso(
    providerId: number,
    id: number,
    motivo: string,
    userId: number | null = null,
  ): Promise<CobrancaCaso | undefined> {
    const texto = motivo.trim();
    if (!texto) {
      throw new ErroDeCobranca("MOTIVO_OBRIGATORIO", "Cancelamento exige o motivo: e o que o funcionario le antes de ir buscar o equipamento");
    }
    return db.transaction(async (tx) => {
      const [atual] = await tx.select().from(cobrancaCasos)
        .where(and(eq(cobrancaCasos.id, id), eq(cobrancaCasos.providerId, providerId)))
        .limit(1);
      if (!atual) return undefined;
      if (casoFechado(atual.status)) return atual;
      return encerrarCaso(tx, providerId, atual, "cancelamento", texto, new Date(), userId, {
        motivo: texto,
        sugerirRecuperacao: true,
      });
    });
  }

  /**
   * Grava o quadrante e o tom que o motor calculou. Quando `arbitrado` (o
   * ERP nao deu a data do contrato e a fidelidade foi assumida), deixa UMA
   * nota de sistema no caso — uma vez so, como a nota de saida do cliente —
   * para o operador saber que o tom veio de um chute e nao de dado. Caso
   * fechado nao muda: o DNA de quem saiu nao interessa mais.
   */
  async atualizarDnaDoCaso(
    providerId: number,
    casoId: number,
    dna: DnaDoCaso,
    userId: number | null = null,
  ): Promise<CobrancaCaso | undefined> {
    return db.transaction(async (tx) => {
      const [atual] = await tx.select().from(cobrancaCasos)
        .where(and(eq(cobrancaCasos.id, casoId), eq(cobrancaCasos.providerId, providerId)))
        .limit(1);
      if (!atual) return undefined;
      if (casoFechado(atual.status)) return atual;

      const agora = new Date();
      const mudou = dna.quadranteDna !== atual.quadranteDna || dna.tom !== atual.tom;
      let caso = atual;
      if (mudou) {
        [caso] = await tx.update(cobrancaCasos)
          .set({ quadranteDna: dna.quadranteDna, tom: dna.tom, updatedAt: agora })
          .where(and(eq(cobrancaCasos.id, casoId), eq(cobrancaCasos.providerId, providerId)))
          .returning();
      }

      if (dna.arbitrado) {
        const [jaAvisado] = await tx.select({ um: sql`1` }).from(cobrancaEventos)
          .where(and(
            eq(cobrancaEventos.providerId, providerId),
            eq(cobrancaEventos.casoId, casoId),
            eq(cobrancaEventos.tipo, "nota"),
            sql`${cobrancaEventos.metadata}->>'motivo' = ${MOTIVO_NOTA_DNA_ARBITRADO}`,
          ))
          .limit(1);
        if (!jaAvisado) {
          await tx.insert(cobrancaEventos).values({
            providerId, casoId, customerId: atual.customerId, userId,
            tipo: "nota", canal: "sistema",
            notas: `Quadrante ${dna.quadranteDna ?? "—"} arbitrado: o ERP nao informou a data do contrato e a fidelidade foi assumida. O tom pode nao ser o certo para este cliente ate a data chegar no proximo sync.`,
            metadata: {
              motivo: MOTIVO_NOTA_DNA_ARBITRADO,
              quadrante: dna.quadranteDna,
              tom: dna.tom,
              de: { quadrante: atual.quadranteDna, tom: atual.tom },
            },
            ocorridoEm: agora,
          });
        }
      }
      return caso;
    });
  }

  /** Casos vivos por etapa e carteira — a regua desenhada com os numeros de hoje. */
  async contarCasosPorEtapa(providerId: number): Promise<ContagemPorEtapa[]> {
    const linhas = await db.select({
      etapa: cobrancaCasos.etapaAtual,
      carteira: cobrancaCasos.carteira,
      casos: count(),
      valor: sql<number>`coalesce(sum(${cobrancaCasos.valorAtual}), 0)`.mapWith(Number),
    }).from(cobrancaCasos)
      .where(and(eq(cobrancaCasos.providerId, providerId), casoVivo()))
      .groupBy(cobrancaCasos.etapaAtual, cobrancaCasos.carteira);
    return linhas.map(l => ({ etapa: l.etapa, carteira: l.carteira, casos: num(l.casos), valor: num(l.valor) }));
  }

  /** Casos vivos por quadrante do DNA e carteira — a grade 3x3. */
  async contarCasosPorQuadrante(providerId: number): Promise<ContagemPorQuadrante[]> {
    const linhas = await db.select({
      quadrante: cobrancaCasos.quadranteDna,
      carteira: cobrancaCasos.carteira,
      casos: count(),
      valor: sql<number>`coalesce(sum(${cobrancaCasos.valorAtual}), 0)`.mapWith(Number),
    }).from(cobrancaCasos)
      .where(and(eq(cobrancaCasos.providerId, providerId), casoVivo()))
      .groupBy(cobrancaCasos.quadranteDna, cobrancaCasos.carteira);
    return linhas.map(l => ({ quadrante: l.quadrante, carteira: l.carteira, casos: num(l.casos), valor: num(l.valor) }));
  }

  // ── Eventos ───────────────────────────────────────────────────────────────

  /**
   * Grava na linha do tempo. `customer_id` vem do CASO, nunca do chamador — e
   * o que impede um evento ser pendurado no cliente errado. Um `contato`
   * atualiza `ultimo_contato_em` do caso; os outros tipos nao (uma nota nao e
   * uma tentativa de falar com o cliente).
   */
  async registrarEventoDeCobranca(providerId: number, evento: NovoEvento): Promise<CobrancaEvento> {
    return db.transaction(async (tx) => {
      const [caso] = await tx.select().from(cobrancaCasos)
        .where(and(eq(cobrancaCasos.id, evento.casoId), eq(cobrancaCasos.providerId, providerId)))
        .limit(1);
      if (!caso) throw new Error(`Caso ${evento.casoId} nao pertence ao provedor ${providerId}`);

      const ocorridoEm = evento.ocorridoEm ?? new Date();
      const [gravado] = await tx.insert(cobrancaEventos).values({
        providerId,
        casoId: caso.id,
        customerId: caso.customerId,
        userId: evento.userId ?? null,
        tipo: evento.tipo,
        canal: evento.canal ?? null,
        resultado: evento.resultado ?? null,
        notas: evento.notas ?? null,
        metadata: evento.metadata ?? null,
        ocorridoEm,
      }).returning();

      if (evento.tipo === "contato") {
        await tx.update(cobrancaCasos)
          .set({ ultimoContatoEm: ocorridoEm, updatedAt: new Date() })
          .where(and(eq(cobrancaCasos.id, caso.id), eq(cobrancaCasos.providerId, providerId)));
      }
      return gravado;
    });
  }

  async listarEventosDoCaso(providerId: number, casoId: number): Promise<CobrancaEvento[]> {
    return db.select().from(cobrancaEventos)
      .where(and(eq(cobrancaEventos.providerId, providerId), eq(cobrancaEventos.casoId, casoId)))
      .orderBy(desc(cobrancaEventos.ocorridoEm), desc(cobrancaEventos.id));
  }

  /** A vida inteira do cliente na cobranca, atravessando casos — a ficha 360. */
  async listarEventosDoCliente(providerId: number, customerId: number, limite = 200): Promise<CobrancaEvento[]> {
    return db.select().from(cobrancaEventos)
      .where(and(eq(cobrancaEventos.providerId, providerId), eq(cobrancaEventos.customerId, customerId)))
      .orderBy(desc(cobrancaEventos.ocorridoEm), desc(cobrancaEventos.id))
      .limit(Math.max(1, limite));
  }

  // ── Leituras pontuais ─────────────────────────────────────────────────────

  /**
   * O cliente pelo id, do provedor da sessao. A rota fazia
   * `getCustomersByProvider(...).find(...)` — a lista inteira (~8k linhas na
   * maior) para achar uma — porque nao havia um getter por id no storage.
   */
  async obterCliente(providerId: number, customerId: number): Promise<Customer | undefined> {
    const [cliente] = await db.select().from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.providerId, providerId)))
      .limit(1);
    return cliente;
  }

  async obterNegociacao(providerId: number, id: number): Promise<NegociacaoComParcelas | undefined> {
    const [negociacao] = await db.select().from(cobrancaNegociacoes)
      .where(and(eq(cobrancaNegociacoes.id, id), eq(cobrancaNegociacoes.providerId, providerId)))
      .limit(1);
    if (!negociacao) return undefined;
    const parcelamento = await this.listarParcelasDaNegociacao(providerId, id);
    return { ...negociacao, parcelamento };
  }

  async obterParcela(providerId: number, id: number): Promise<CobrancaParcela | undefined> {
    const [parcela] = await db.select().from(cobrancaParcelas)
      .where(and(eq(cobrancaParcelas.id, id), eq(cobrancaParcelas.providerId, providerId)))
      .limit(1);
    return parcela;
  }

  // ── Negociacoes e parcelas ────────────────────────────────────────────────

  /**
   * Negociacao e parcelas nascem na MESMA transacao: uma proposta de 6x sem
   * as 6 linhas nao e uma proposta. O caso passa a `negociando` (ou a
   * `acordo_ativo`, se ja nasce aceita) e o evento vai junto.
   *
   * Uma negociacao viva por caso (achado da revisao): com duas propostas
   * abertas, a segunda cancelada devolvia o caso a `aberto` enquanto a
   * primeira seguia `aceita`, e a parcela dela era paga num caso "sem acordo".
   * Renegociar e cancelar a que existe e propor outra.
   */
  async criarNegociacao(
    providerId: number,
    dados: NovaNegociacao,
    parcelas: NovaParcela[],
  ): Promise<NegociacaoComParcelas> {
    return db.transaction(async (tx) => {
      const [caso] = await tx.select().from(cobrancaCasos)
        .where(and(eq(cobrancaCasos.id, dados.casoId), eq(cobrancaCasos.providerId, providerId)))
        .limit(1);
      if (!caso) throw new Error(`Caso ${dados.casoId} nao pertence ao provedor ${providerId}`);
      if (casoFechado(caso.status)) {
        throw new ErroDeCobranca("CASO_ENCERRADO", `Caso ${dados.casoId} esta encerrado (${caso.status}) e nao recebe negociacao`);
      }
      const [viva] = await tx.select({ id: cobrancaNegociacoes.id, status: cobrancaNegociacoes.status })
        .from(cobrancaNegociacoes)
        .where(and(
          eq(cobrancaNegociacoes.providerId, providerId),
          eq(cobrancaNegociacoes.casoId, caso.id),
          inArray(cobrancaNegociacoes.status, [...STATUS_VIVOS_DE_NEGOCIACAO]),
        ))
        .limit(1);
      if (viva) {
        throw new ErroDeCobranca(
          "NEGOCIACAO_VIVA",
          `Caso ${dados.casoId} ja tem a negociacao #${viva.id} em andamento (${viva.status}): cancele-a antes de propor outra`,
        );
      }

      const agora = new Date();
      const aceita = dados.aceita === true;
      const [negociacao] = await tx.insert(cobrancaNegociacoes).values({
        providerId,
        casoId: caso.id,
        customerId: caso.customerId,
        tipo: dados.tipo,
        valorOriginal: dinheiro(dados.valorOriginal),
        valorNegociado: dinheiro(dados.valorNegociado),
        descontoPct: dinheiro(dados.descontoPct ?? 0),
        entrada: dinheiro(dados.entrada ?? 0),
        parcelas: parcelas.length,
        valorParcela: dados.valorParcela != null
          ? dinheiro(dados.valorParcela)
          : parcelas[0] ? dinheiro(parcelas[0].valor) : null,
        primeiroVencimento: dados.primeiroVencimento ?? parcelas[0]?.vencimento ?? null,
        status: aceita ? "aceita" : "proposta",
        criadoPorUserId: dados.criadoPorUserId,
        aceitaEm: aceita ? agora : null,
      }).returning();

      const linhas = parcelas.length === 0 ? [] : await tx.insert(cobrancaParcelas).values(
        parcelas.map(p => ({
          providerId,
          negociacaoId: negociacao.id,
          numero: p.numero,
          valor: dinheiro(p.valor),
          vencimento: p.vencimento,
          status: "pendente",
        })),
      ).returning();

      const statusDoCaso = aceita ? "acordo_ativo" : "negociando";
      if (caso.status !== statusDoCaso) {
        await tx.update(cobrancaCasos)
          .set({ status: statusDoCaso, updatedAt: agora })
          .where(and(eq(cobrancaCasos.id, caso.id), eq(cobrancaCasos.providerId, providerId)));
      }
      await tx.insert(cobrancaEventos).values({
        providerId, casoId: caso.id, customerId: caso.customerId, userId: dados.criadoPorUserId,
        tipo: aceita ? "acordo_aceito" : "negociacao_proposta",
        metadata: {
          negociacaoId: negociacao.id, tipo: dados.tipo,
          valorNegociado: dados.valorNegociado, parcelas: parcelas.length,
        },
        ocorridoEm: agora,
      });

      return { ...negociacao, parcelamento: linhas };
    });
  }

  /**
   * Muda o status e arrasta o caso junto: aceita/ativa -> `acordo_ativo`;
   * quebrada/cancelada -> o caso volta ao que era antes da negociacao (a
   * fila, ou `negativado` se estava negativado — `statusAposNegociacaoDesfeita`)
   * e as parcelas pendentes sao canceladas; cumprida -> o caso e encerrado
   * como `pago`. Negociacao ja encerrada nao muda: a rota confere a transicao,
   * mas a guarda aqui e o que vale para o job e para duas abas abertas.
   */
  async atualizarStatusDaNegociacao(
    providerId: number,
    id: number,
    status: StatusNegociacao,
    userId: number | null = null,
  ): Promise<CobrancaNegociacao | undefined> {
    if (!(STATUS_NEGOCIACAO as readonly string[]).includes(status)) {
      throw new Error(`Status de negociacao desconhecido: ${status}`);
    }
    return db.transaction(async (tx) => {
      const [negociacao] = await tx.select().from(cobrancaNegociacoes)
        .where(and(eq(cobrancaNegociacoes.id, id), eq(cobrancaNegociacoes.providerId, providerId)))
        .limit(1);
      if (!negociacao) return undefined;
      if (negociacaoEncerrada(negociacao.status)) {
        throw new ErroDeCobranca("NEGOCIACAO_ENCERRADA", `Negociacao #${id} esta ${negociacao.status} e nao muda mais`);
      }

      const agora = new Date();
      const set: Partial<typeof cobrancaNegociacoes.$inferInsert> = { status, updatedAt: agora };
      if (status === "aceita" || status === "ativa") set.aceitaEm = negociacao.aceitaEm ?? agora;
      if (status === "quebrada") set.quebradaEm = agora;
      const [nova] = await tx.update(cobrancaNegociacoes).set(set)
        .where(and(eq(cobrancaNegociacoes.id, id), eq(cobrancaNegociacoes.providerId, providerId)))
        .returning();

      if (status === "quebrada" || status === "cancelada") {
        await tx.update(cobrancaParcelas).set({ status: "cancelada" })
          .where(and(
            eq(cobrancaParcelas.negociacaoId, id),
            eq(cobrancaParcelas.providerId, providerId),
            inArray(cobrancaParcelas.status, ["pendente", "atrasada"]),
          ));
      }

      const [caso] = await tx.select().from(cobrancaCasos)
        .where(and(eq(cobrancaCasos.id, negociacao.casoId), eq(cobrancaCasos.providerId, providerId)))
        .limit(1);
      if (caso && !casoFechado(caso.status)) {
        if (status === "cumprida") {
          await encerrarCaso(tx, providerId, caso, "pago", `acordo #${id} cumprido`, agora, userId);
        } else {
          const statusDoCaso = status === "aceita" || status === "ativa" ? "acordo_ativo"
            : status === "quebrada" || status === "cancelada"
              ? statusAposNegociacaoDesfeita(await statusDeFundoDoCaso(tx, providerId, caso))
              : null;
          if (statusDoCaso && statusDoCaso !== caso.status) {
            await tx.update(cobrancaCasos).set({ status: statusDoCaso, updatedAt: agora })
              .where(and(eq(cobrancaCasos.id, caso.id), eq(cobrancaCasos.providerId, providerId)));
          }
        }
      }

      if (status !== "cumprida") {
        await tx.insert(cobrancaEventos).values({
          providerId, casoId: negociacao.casoId, customerId: negociacao.customerId, userId,
          tipo: status === "aceita" ? "acordo_aceito" : status === "quebrada" ? "acordo_quebrado" : "nota",
          metadata: { negociacaoId: id, status },
          ocorridoEm: agora,
        });
      }
      return nova;
    });
  }

  async listarNegociacoesDoCaso(providerId: number, casoId: number): Promise<NegociacaoComParcelas[]> {
    const negociacoes = await db.select().from(cobrancaNegociacoes)
      .where(and(eq(cobrancaNegociacoes.providerId, providerId), eq(cobrancaNegociacoes.casoId, casoId)))
      .orderBy(desc(cobrancaNegociacoes.createdAt), desc(cobrancaNegociacoes.id));
    if (negociacoes.length === 0) return [];

    const parcelas = await db.select().from(cobrancaParcelas)
      .where(and(
        eq(cobrancaParcelas.providerId, providerId),
        inArray(cobrancaParcelas.negociacaoId, negociacoes.map(n => n.id)),
      ))
      .orderBy(asc(cobrancaParcelas.numero));

    const porNegociacao = new Map<number, CobrancaParcela[]>();
    for (const p of parcelas) {
      const lista = porNegociacao.get(p.negociacaoId) ?? [];
      lista.push(p);
      porNegociacao.set(p.negociacaoId, lista);
    }
    return negociacoes.map(n => ({ ...n, parcelamento: porNegociacao.get(n.id) ?? [] }));
  }

  async listarParcelasDaNegociacao(providerId: number, negociacaoId: number): Promise<CobrancaParcela[]> {
    return db.select().from(cobrancaParcelas)
      .where(and(eq(cobrancaParcelas.providerId, providerId), eq(cobrancaParcelas.negociacaoId, negociacaoId)))
      .orderBy(asc(cobrancaParcelas.numero));
  }

  /**
   * Registra dinheiro que entrou numa parcela.
   *
   * So negociacao ACEITA ou ATIVA recebe pagamento. Proposta, nao (achado A1
   * da revisao): o pagamento fazia proposta -> ativa, transicao que a maquina
   * de estados proibe, e deixava o caso em `negociando` — fora da blindagem
   * do job, que so protege `acordo_ativo`. Encerrada tambem nao.
   *
   * O UPDATE da parcela so pega `pendente` ou `atrasada`: duas abas pagando
   * a mesma parcela, a segunda nao encontra linha e NADA acontece — nem
   * evento, nem status. Sem a guarda, a segunda gravava um `parcela_paga` a
   * mais e o KPI de recuperado contava o dinheiro duas vezes.
   *
   * Pagamento PARCIAL (valor abaixo da parcela, com meio centavo de
   * tolerancia) acumula em `valor_pago` e mantem a parcela como esta; a
   * parcela so vira `paga` quando o acumulado cobrir. A primeira parcela paga
   * leva a negociacao a `ativa`; a ultima a `cumprida`, e ai o caso e
   * encerrado como `pago` — sem isso o caso ficaria em `acordo_ativo` para
   * sempre com um acordo ja quitado.
   */
  async marcarParcelaPaga(
    providerId: number,
    parcelaId: number,
    valorPago: number,
    pagoEm: Date,
    userId: number | null = null,
  ): Promise<ResultadoDoPagamento | undefined> {
    if (!Number.isFinite(valorPago) || valorPago <= 0) {
      throw new ErroDeCobranca("VALOR_INVALIDO", "O valor pago precisa ser maior que zero");
    }
    return db.transaction(async (tx) => {
      const [parcela] = await tx.select().from(cobrancaParcelas)
        .where(and(eq(cobrancaParcelas.id, parcelaId), eq(cobrancaParcelas.providerId, providerId)))
        .limit(1);
      if (!parcela) return undefined;

      const [negociacao] = await tx.select().from(cobrancaNegociacoes)
        .where(and(
          eq(cobrancaNegociacoes.id, parcela.negociacaoId),
          eq(cobrancaNegociacoes.providerId, providerId),
        ))
        .limit(1);
      if (!negociacao) throw new Error(`Parcela ${parcelaId} aponta para negociacao inexistente`);
      if (negociacao.status === "proposta") {
        throw new ErroDeCobranca(
          "NEGOCIACAO_NAO_ACEITA",
          `Negociacao #${negociacao.id} ainda e proposta: registre o aceite do cliente antes de receber a parcela`,
        );
      }
      if (negociacaoEncerrada(negociacao.status)) {
        throw new ErroDeCobranca("NEGOCIACAO_ENCERRADA", `Negociacao #${negociacao.id} esta ${negociacao.status} e nao recebe pagamento`);
      }

      const valorDaParcela = num(parcela.valor);
      const acumulado = arredondar(num(parcela.valorPago) + valorPago);
      const cobre = acumulado + 0.005 >= valorDaParcela;
      const [gravada] = await tx.update(cobrancaParcelas)
        .set(cobre
          ? { status: "paga", pagoEm, valorPago: dinheiro(acumulado) }
          : { valorPago: dinheiro(acumulado) })
        .where(and(
          eq(cobrancaParcelas.id, parcelaId),
          eq(cobrancaParcelas.providerId, providerId),
          inArray(cobrancaParcelas.status, ["pendente", "atrasada"]),
        ))
        .returning();
      // Ja paga ou cancelada entre a leitura e a escrita: nada aconteceu.
      if (!gravada) return undefined;

      if (!cobre) {
        const restante = arredondar(valorDaParcela - acumulado);
        await tx.insert(cobrancaEventos).values({
          providerId, casoId: negociacao.casoId, customerId: negociacao.customerId, userId,
          tipo: "parcela_paga",
          notas: `Pagamento parcial da parcela ${parcela.numero}: ${brl(valorPago)} de ${brl(valorDaParcela)} (restam ${brl(restante)}).`,
          metadata: { negociacaoId: negociacao.id, parcelaId, numero: parcela.numero, valorPago, acumulado, restante, parcial: true },
          ocorridoEm: pagoEm,
        });
        return { parcela: gravada, negociacao, acordoCumprido: false, parcial: true };
      }

      const [contagem] = await tx.select({ restantes: count() }).from(cobrancaParcelas)
        .where(and(
          eq(cobrancaParcelas.negociacaoId, negociacao.id),
          eq(cobrancaParcelas.providerId, providerId),
          inArray(cobrancaParcelas.status, ["pendente", "atrasada"]),
        ));
      const cumprida = num(contagem?.restantes) === 0;

      const novoStatus: StatusNegociacao = cumprida ? "cumprida"
        : negociacao.status === "aceita" ? "ativa"
        : negociacao.status as StatusNegociacao;
      let atualizada = negociacao;
      if (novoStatus !== negociacao.status) {
        [atualizada] = await tx.update(cobrancaNegociacoes)
          .set({ status: novoStatus, aceitaEm: negociacao.aceitaEm ?? pagoEm, updatedAt: new Date() })
          .where(and(eq(cobrancaNegociacoes.id, negociacao.id), eq(cobrancaNegociacoes.providerId, providerId)))
          .returning();
      }

      await tx.insert(cobrancaEventos).values({
        providerId, casoId: negociacao.casoId, customerId: negociacao.customerId, userId,
        tipo: "parcela_paga",
        metadata: { negociacaoId: negociacao.id, parcelaId, numero: parcela.numero, valorPago, acumulado, parcial: false },
        ocorridoEm: pagoEm,
      });

      if (cumprida) {
        const [caso] = await tx.select().from(cobrancaCasos)
          .where(and(eq(cobrancaCasos.id, negociacao.casoId), eq(cobrancaCasos.providerId, providerId)))
          .limit(1);
        if (caso && !casoFechado(caso.status)) {
          await encerrarCaso(tx, providerId, caso, "pago", `acordo #${negociacao.id} cumprido`, pagoEm, userId);
        }
      }

      return { parcela: gravada, negociacao: atualizada, acordoCumprido: cumprida, parcial: false };
    });
  }

  /**
   * Para o job: parcela pendente com vencimento ANTERIOR a hoje vira
   * `atrasada`. Devolve as negociacoes tocadas para o job decidir a quebra
   * (quantos dias tolera e do motor, nao daqui).
   */
  async marcarParcelasAtrasadas(providerId: number, hoje: Date): Promise<{ marcadas: number; negociacoes: number[] }> {
    const linhas = await db.update(cobrancaParcelas)
      .set({ status: "atrasada" })
      .where(and(
        eq(cobrancaParcelas.providerId, providerId),
        eq(cobrancaParcelas.status, "pendente"),
        lt(cobrancaParcelas.vencimento, dataSemHora(hoje)),
      ))
      .returning({ id: cobrancaParcelas.id, negociacaoId: cobrancaParcelas.negociacaoId });
    return { marcadas: linhas.length, negociacoes: Array.from(new Set(linhas.map(l => l.negociacaoId))) };
  }

  // ── Carteira ──────────────────────────────────────────────────────────────

  /**
   * Os numeros do cabecalho. `hoje` entra como parametro para o "contatados
   * hoje" contar o dia do PROVEDOR (meia-noite local do processo, como o
   * dashboard faz), e nao o dia UTC do banco.
   *
   * `recuperado30d` soma tres fontes que nao se sobrepoem: parcelas pagas no
   * periodo; a ENTRADA das negociacoes aceitas no periodo (e paga no aceite,
   * nao e parcela — achado da revisao: ficava fora da conta); e casos
   * encerrados como `pago` no periodo que NAO tiveram acordo — os que tiveram
   * ja estao contados pelas parcelas e pela entrada. Pagamento parcial ainda
   * em curso nao entra: a parcela so conta quando fecha.
   */
  async kpisDaCobranca(providerId: number, hoje: Date = new Date()): Promise<KpisDaCobranca> {
    const inicioDoDia = new Date(hoje);
    inicioDoDia.setHours(0, 0, 0, 0);
    const ha30Dias = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [carteira] = await db.select({
      ativosComDivida: sql<number>`count(*) filter (where ${clienteAtual()} and ${comDivida()})`.mapWith(Number),
      exClientesComDivida: sql<number>`count(*) filter (where not (${clienteAtual()}) and ${comDivida()})`.mapWith(Number),
      emAberto: sql<number>`coalesce(sum(${customers.totalOverdueAmount}) filter (where ${comDivida()}), 0)`.mapWith(Number),
    }).from(customers).where(eq(customers.providerId, providerId));

    const [contatos] = await db.select({
      total: sql<number>`count(distinct ${cobrancaEventos.customerId})`.mapWith(Number),
    }).from(cobrancaEventos).where(and(
      eq(cobrancaEventos.providerId, providerId),
      eq(cobrancaEventos.tipo, "contato"),
      gte(cobrancaEventos.ocorridoEm, inicioDoDia),
    ));

    const [parcelas] = await db.select({
      total: sql<number>`coalesce(sum(${cobrancaParcelas.valorPago}), 0)`.mapWith(Number),
    }).from(cobrancaParcelas).where(and(
      eq(cobrancaParcelas.providerId, providerId),
      eq(cobrancaParcelas.status, "paga"),
      gte(cobrancaParcelas.pagoEm, ha30Dias),
    ));

    const comAcordo = db.select({ um: sql`1` }).from(cobrancaNegociacoes).where(and(
      eq(cobrancaNegociacoes.casoId, cobrancaCasos.id),
      eq(cobrancaNegociacoes.providerId, providerId),
      inArray(cobrancaNegociacoes.status, ["aceita", "ativa", "cumprida"]),
    ));
    const [casos] = await db.select({
      total: sql<number>`coalesce(sum(${cobrancaCasos.valorAtual}), 0)`.mapWith(Number),
    }).from(cobrancaCasos).where(and(
      eq(cobrancaCasos.providerId, providerId),
      eq(cobrancaCasos.status, "pago"),
      gte(cobrancaCasos.encerradoEm, ha30Dias),
      notExists(comAcordo),
    ));

    const [entradas] = await db.select({
      total: sql<number>`coalesce(sum(${cobrancaNegociacoes.entrada}), 0)`.mapWith(Number),
    }).from(cobrancaNegociacoes).where(and(
      eq(cobrancaNegociacoes.providerId, providerId),
      // Quebrada fica de fora: "aceita mas a entrada nunca veio" e o que a quebra de uma aceita significa.
      inArray(cobrancaNegociacoes.status, ["aceita", "ativa", "cumprida"]),
      gte(cobrancaNegociacoes.aceitaEm, ha30Dias),
    ));

    return {
      ativosComDivida: num(carteira?.ativosComDivida),
      exClientesComDivida: num(carteira?.exClientesComDivida),
      emAberto: num(carteira?.emAberto),
      contatadosHoje: num(contatos?.total),
      recuperado30d: arredondar(num(parcelas?.total) + num(entradas?.total) + num(casos?.total)),
    };
  }

  /** A barra de composicao: em dia + em cobranca + ex com divida, de `customers`. */
  async composicaoDaCarteira(providerId: number): Promise<ComposicaoDaCarteira> {
    const [c] = await db.select({
      emDia: sql<number>`count(*) filter (where ${clienteAtual()} and ${semDivida()})`.mapWith(Number),
      emCobranca: sql<number>`count(*) filter (where ${clienteAtual()} and ${comDivida()})`.mapWith(Number),
      exComDivida: sql<number>`count(*) filter (where not (${clienteAtual()}) and ${comDivida()})`.mapWith(Number),
    }).from(customers).where(eq(customers.providerId, providerId));
    return { emDia: num(c?.emDia), emCobranca: num(c?.emCobranca), exComDivida: num(c?.exComDivida) };
  }

  /** Opcoes do filtro de bairro: os 40 com mais devedores. */
  async bairrosDaCarteira(providerId: number): Promise<Array<{ bairro: string; total: number }>> {
    const linhas = await db.select({ bairro: customers.neighborhood, total: count() }).from(customers)
      .where(and(
        eq(customers.providerId, providerId),
        comDivida(),
        isNotNull(customers.neighborhood),
        ne(customers.neighborhood, ""),
      ))
      .groupBy(customers.neighborhood)
      .orderBy(desc(count()), asc(customers.neighborhood))
      .limit(40);
    return linhas.map(l => ({ bairro: l.bairro as string, total: num(l.total) }));
  }

  // ── Fila ──────────────────────────────────────────────────────────────────

  /**
   * O que o operador trabalha hoje: casos vivos dele MAIS a fila geral (sem
   * responsavel — qualquer operador pega). Sem `responsavelUserId`, todos.
   *
   * Ordem: prioridade; depois quem esta VENCIDO (proximo contato ja passou ou
   * nunca foi marcado) antes de quem tem data futura; entre os vencidos, o
   * mais antigo; por fim a maior divida.
   */
  async filaDeCobranca(
    providerId: number,
    opcoes: { responsavelUserId?: number; hoje?: Date; limite?: number } = {},
  ): Promise<LinhaDaCarteira[]> {
    const hoje = opcoes.hoje ?? new Date();
    const conds: (SQL | undefined)[] = [eq(cobrancaCasos.providerId, providerId), casoVivo()];
    if (opcoes.responsavelUserId !== undefined) {
      conds.push(or(
        eq(cobrancaCasos.responsavelUserId, opcoes.responsavelUserId),
        isNull(cobrancaCasos.responsavelUserId),
      ));
    }
    const vencido = sql`case when ${or(
      isNull(cobrancaCasos.proximoContatoEm),
      lte(cobrancaCasos.proximoContatoEm, hoje),
    )} then 0 else 1 end`;

    const linhas = await daCarteira(and(...conds))
      .orderBy(pesoDaPrioridade(), vencido, asc(cobrancaCasos.proximoContatoEm), desc(cobrancaCasos.valorAtual))
      .limit(Math.min(Math.max(1, opcoes.limite ?? 100), PAGINA_MAXIMA));
    return linhas.map(montarLinha);
  }

  // ── Candidatos ────────────────────────────────────────────────────────────

  /**
   * Para o job de abertura: cliente com divida acima do minimo, ao menos um
   * dia de atraso e SEM caso vivo.
   *
   * Duas exclusoes a mais, porque a fase 1 nao tem fatura para saber se a
   * divida de hoje e a mesma de ontem:
   *   · cliente com caso `baixado` ou `encerrado` nao volta sozinho. O
   *     provedor desistiu dessa divida (ou ela prescreveu — CC 206 §5); abrir
   *     de novo no dia seguinte desfaria a decisao. Reabrir e ato manual.
   *   · caso `pago` ha menos de 7 dias: o ERP ainda nao sincronizou a baixa e
   *     `customers` segue mostrando a divida que acabou de ser paga.
   */
  async clientesParaAbrirCaso(providerId: number, minimoValor: number, limite = 5000): Promise<CandidatoACaso[]> {
    const vivo = db.select({ um: sql`1` }).from(cobrancaCasos).where(and(
      eq(cobrancaCasos.providerId, providerId),
      eq(cobrancaCasos.customerId, customers.id),
      casoVivo(),
    ));
    const desistido = db.select({ um: sql`1` }).from(cobrancaCasos).where(and(
      eq(cobrancaCasos.providerId, providerId),
      eq(cobrancaCasos.customerId, customers.id),
      inArray(cobrancaCasos.status, ["baixado", "encerrado"]),
    ));
    const pagoHaPouco = db.select({ um: sql`1` }).from(cobrancaCasos).where(and(
      eq(cobrancaCasos.providerId, providerId),
      eq(cobrancaCasos.customerId, customers.id),
      eq(cobrancaCasos.status, "pago"),
      gte(cobrancaCasos.encerradoEm, sql`now() - interval '7 days'`),
    ));

    const linhas = await db.select({
      customerId: customers.id,
      nome: customers.name,
      cpfCnpj: customers.cpfCnpj,
      statusErp: customers.status,
      dividaAtual: customers.totalOverdueAmount,
      diasAtraso: customers.maxDaysOverdue,
      faturasAbertas: customers.overdueInvoicesCount,
      contractStartDate: customers.contractStartDate,
    }).from(customers)
      .where(and(
        eq(customers.providerId, providerId),
        sql`coalesce(${customers.totalOverdueAmount}, 0) > ${minimoValor}`,
        gte(customers.maxDaysOverdue, 1),
        notExists(vivo),
        notExists(desistido),
        notExists(pagoHaPouco),
      ))
      .orderBy(desc(customers.totalOverdueAmount), asc(customers.id))
      .limit(Math.max(1, limite));

    return linhas.map(l => ({
      customerId: l.customerId,
      nome: l.nome,
      cpfCnpj: l.cpfCnpj,
      statusErp: l.statusErp,
      carteira: carteiraDoStatusErp(l.statusErp),
      dividaAtual: num(l.dividaAtual),
      diasAtraso: num(l.diasAtraso),
      faturasAbertas: num(l.faturasAbertas),
      contractStartDate: l.contractStartDate,
    }));
  }
}

/** `metadata.motivo` da nota de sistema que avisa que o DNA saiu sem a data do contrato. */
export const MOTIVO_NOTA_DNA_ARBITRADO = "dna_arbitrado";

/**
 * O que o caso ERA antes da negociacao — o que ele volta a ser quando ela se
 * desfaz. `negativado` se esta negativado agora (a proposta nasceu com o caso
 * ja negativado, ou foi negativado com a proposta aberta) ou se ja foi um dia:
 * a maquina de estados nao deixa negativado voltar a fila, entao "ja foi" e
 * "ainda e". A prova e o evento `negativacao` na linha do tempo — a rota o
 * grava em toda transicao para `negativado`, e e o unico caminho ate la.
 */
async function statusDeFundoDoCaso(tx: Tx, providerId: number, caso: CobrancaCaso): Promise<StatusDeCaso> {
  if (caso.status === "negativado") return "negativado";
  const [negativado] = await tx.select({ um: sql`1` }).from(cobrancaEventos)
    .where(and(
      eq(cobrancaEventos.providerId, providerId),
      eq(cobrancaEventos.casoId, caso.id),
      eq(cobrancaEventos.tipo, "negativacao"),
    ))
    .limit(1);
  return negativado ? "negativado" : "aberto";
}

/**
 * O encerramento em si, com o evento — usado pelo fechar manual, pelo
 * cancelamento e pela cascata do acordo cumprido. Encerrar desfaz o que ficou
 * vivo por baixo: negociacao em proposta/aceita/ativa vira `cancelada`, as
 * parcelas pendentes dela tambem, e cada uma deixa nota. O acordo CUMPRIDO
 * que encerra o caso como pago ja foi marcado antes de chegar aqui e nao e
 * tocado.
 */
async function encerrarCaso(
  tx: Tx,
  providerId: number,
  caso: CobrancaCaso,
  status: StatusCasoFechado,
  motivo: string | null,
  quando: Date,
  userId: number | null,
  metadataExtra: Record<string, unknown> = {},
): Promise<CobrancaCaso> {
  const [fechado] = await tx.update(cobrancaCasos)
    .set({ status, encerradoEm: quando, motivoEncerramento: motivo, updatedAt: quando })
    .where(and(eq(cobrancaCasos.id, caso.id), eq(cobrancaCasos.providerId, providerId)))
    .returning();
  await tx.insert(cobrancaEventos).values({
    providerId, casoId: caso.id, customerId: caso.customerId, userId,
    tipo: status === "cancelamento" ? "cancelamento" : "encerramento",
    canal: userId === null ? "sistema" : null,
    notas: motivo,
    metadata: { status, de: caso.status, ...metadataExtra },
    ocorridoEm: quando,
  });
  await desfazerNegociacoesVivas(tx, providerId, caso, status, quando, userId);
  return fechado;
}

async function desfazerNegociacoesVivas(
  tx: Tx,
  providerId: number,
  caso: CobrancaCaso,
  statusDoCaso: StatusCasoFechado,
  quando: Date,
  userId: number | null,
): Promise<void> {
  const vivas = await tx.select({ id: cobrancaNegociacoes.id, status: cobrancaNegociacoes.status })
    .from(cobrancaNegociacoes)
    .where(and(
      eq(cobrancaNegociacoes.providerId, providerId),
      eq(cobrancaNegociacoes.casoId, caso.id),
      inArray(cobrancaNegociacoes.status, [...STATUS_VIVOS_DE_NEGOCIACAO]),
    ));
  if (vivas.length === 0) return;

  const ids = vivas.map(v => v.id);
  await tx.update(cobrancaNegociacoes)
    .set({ status: "cancelada", updatedAt: quando })
    .where(and(eq(cobrancaNegociacoes.providerId, providerId), inArray(cobrancaNegociacoes.id, ids)));
  await tx.update(cobrancaParcelas)
    .set({ status: "cancelada" })
    .where(and(
      eq(cobrancaParcelas.providerId, providerId),
      inArray(cobrancaParcelas.negociacaoId, ids),
      inArray(cobrancaParcelas.status, ["pendente", "atrasada"]),
    ));
  await tx.insert(cobrancaEventos).values(vivas.map(v => ({
    providerId, casoId: caso.id, customerId: caso.customerId, userId,
    tipo: "nota", canal: "sistema" as const,
    notas: `Negociacao #${v.id} (${v.status}) cancelada: o caso foi encerrado como ${statusDoCaso}.`,
    metadata: { negociacaoId: v.id, status: "cancelada", de: v.status, motivo: "caso_encerrado" },
    ocorridoEm: quando,
  })));
}
