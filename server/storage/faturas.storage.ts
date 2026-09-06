/**
 * As faturas do ERP, fatura a fatura, e o resumo do MES de vencimento.
 *
 * Ate a fase 2 da cobranca (05/09/2026) o sync gravava so o agregado por
 * cliente — quanto deve, ha quantos dias — e `invoices` recebia linha apenas
 * do import CSV. A pergunta "como fechou o mes de setembro?" exige a fatura
 * com o vencimento dela: quanto foi faturado, quanto esta vencido, quanto
 * ainda vence, quanto sumiu dos pendentes (pagamento provavel) e quem ficou
 * SEM fatura — o buraco de faturamento que ninguem ve no agregado.
 *
 * A semantica e a do Provedor.ai (packages/scoring/src/cockpit/safra.ts):
 * universo = faturas que VENCEM no mes [de, ate). Sobre ele:
 *   inadimplente   = abertas com vencimento antes de hoje
 *   aVencer        = abertas com vencimento hoje ou depois
 *   recebido       = pagas — aqui SEMPRE zero: o ERP nao nos confirma
 *                    pagamento, e `recebidoConfirmado: false` diz isso
 *   emConciliacao  = sumiram dos pendentes numa varredura completa
 *                    (`baixada_no_erp`) — pagamento provavel, sem prova
 *   faturado       = tudo do universo
 *
 * Regra do dono (memoria "integridade do dado"): so dado real e verificavel,
 * nunca zero enganoso. Sem fatura vinda do ERP o resumo diz `base: false`, e
 * a tela mostra "—", nao "R$ 0".
 *
 * Tres decisoes valem para a classe inteira:
 *
 * 1. TODA consulta filtra por `provider_id`, na tabela alvo e em cada
 *    subconsulta. Ha teste que le o SQL e confere.
 * 2. A BAIXA E PROVA NEGATIVA, e prova negativa exige leitura completa. Quem
 *    decide se a varredura foi completa e o sync; aqui so ha uma trava de
 *    fundo: sem nenhuma referencia vista nao se baixa nada.
 * 3. DATA E DIA DE CALENDARIO. `due_date` e timestamp sem fuso e o Drizzle o
 *    grava como ISO UTC; toda fatura entra como meia-noite UTC do dia do
 *    vencimento e toda comparacao usa a mesma forma, para que "vence em
 *    setembro" nao escorregue tres horas para agosto.
 */
import { and, eq, gte, inArray, isNotNull, lt, max, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { customers, invoices } from "@shared/schema";
import type { FaturaAbertaDoErp } from "../erp/types";
import { STATUS_DE_CLIENTE_ATUAL } from "./cobranca.storage";

/** Pendente no ERP (ou, nas linhas legadas do CSV, pending/overdue). */
export const STATUS_FATURA_ABERTA = ["aberta", "pending", "overdue"] as const;
/** Paga com confirmacao — so o CSV afirma isso hoje. */
export const STATUS_FATURA_PAGA = ["paid"] as const;
/** Sumiu dos pendentes do ERP numa varredura completa: pagamento provavel. */
export const STATUS_FATURA_CONCILIACAO = ["baixada_no_erp"] as const;
const UNIVERSO_DO_MES = [...STATUS_FATURA_ABERTA, ...STATUS_FATURA_PAGA, ...STATUS_FATURA_CONCILIACAO];

export type GrupoDoMes = "pago" | "inadimplente" | "a_vencer" | "sem_fatura";

export interface ResumoDoMes {
  mes: string;
  /** O provedor tem alguma fatura vinda do ERP. Sem isso, os numeros nao existem. */
  base: boolean;
  faturado: number;
  recebido: number;
  /** Sempre false enquanto nenhum ERP confirmar pagamento — `recebido` fica em zero. */
  recebidoConfirmado: boolean;
  emConciliacao: number;
  inadimplente: number;
  numInadimplentes: number;
  aVencer: number;
  numAVencer: number;
  /** Clientes atuais (contrato ativo/suspenso) sem NENHUMA fatura vencendo no mes. */
  semFatura: number;
  clientes: { emDia: number; inadimplentes: number };
  /** Ultima varredura que tocou uma fatura do ERP deste provedor. */
  atualizadoEm: Date | null;
}

const LOTE_DE_UPSERT = 500;
const LIMITE_PADRAO = 20_000;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * AAAA-MM-DD como o timestamp que o Drizzle grava: meia-noite UTC. Quem le
 * `due_date` de volta recebe o mesmo instante, entao o dia nunca muda de mao.
 */
export function diaComoTimestamp(iso: string): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

/** O dia de calendario de `hoje` (relogio local do servidor), na mesma forma. */
export function diaDeHoje(hoje: Date): string {
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  const dd = String(hoje.getDate()).padStart(2, "0");
  return `${hoje.getFullYear()}-${mm}-${dd}`;
}

/** [de, ate) do mes "AAAA-MM". Recusa o que nao e mes. */
export function janelaDoMes(mes: string): { de: string; ate: string } {
  const m = mes.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`Mes invalido: ${mes} (esperado AAAA-MM)`);
  const ano = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) throw new Error(`Mes invalido: ${mes}`);
  const proximo = mm === 12 ? `${ano + 1}-01` : `${ano}-${String(mm + 1).padStart(2, "0")}`;
  return { de: `${mes}-01`, ate: `${proximo}-01` };
}

/** Um dia AAAA-MM-DD como parametro de comparacao com `due_date`. */
const ts = (dia: string): SQL => sql`${dia}::timestamp`;

export class FaturasStorage {
  /**
   * Grava (ou regrava) as faturas ABERTAS de um cliente, vindas do ERP.
   *
   * Chave (provider_id, erp_source, erp_ref): a mesma fatura, na varredura
   * seguinte, atualiza valor, vencimento e descricao, volta a `aberta` e
   * limpa `baixada_em` — uma fatura que reapareceu nos pendentes nao esta
   * mais baixada, por mais que tenhamos achado que estava.
   *
   * O que nao serve nao entra: referencia vazia, vencimento fora de
   * AAAA-MM-DD ou valor que nao e numero. Repetida no mesmo lote fica a
   * ultima — o Postgres recusa tocar a mesma linha duas vezes num INSERT.
   *
   * Devolve quantas foram gravadas.
   */
  async upsertFaturasDoErp(
    providerId: number,
    erpSource: string,
    customerId: number,
    faturas: FaturaAbertaDoErp[],
  ): Promise<number> {
    const porRef = new Map<string, FaturaAbertaDoErp>();
    for (const f of faturas) {
      const ref = String(f?.ref ?? "").trim();
      if (!ref || !DIA.test(f.vencimento ?? "") || !Number.isFinite(f.valor)) continue;
      porRef.set(ref, { ...f, ref });
    }
    const validas = Array.from(porRef.values());
    if (validas.length === 0) return 0;

    const agora = new Date();
    for (let i = 0; i < validas.length; i += LOTE_DE_UPSERT) {
      const lote = validas.slice(i, i + LOTE_DE_UPSERT);
      await db.insert(invoices)
        .values(lote.map(f => ({
          providerId,
          customerId,
          contractId: null,
          erpSource,
          erpRef: f.ref,
          value: f.valor.toFixed(2),
          dueDate: diaComoTimestamp(f.vencimento),
          descricao: f.descricao ?? null,
          status: "aberta",
          baixadaEm: null,
          updatedAt: agora,
        })))
        .onConflictDoUpdate({
          target: [invoices.providerId, invoices.erpSource, invoices.erpRef],
          // O predicado tem de ser o do indice parcial da 0027, palavra por
          // palavra, senao o Postgres nao o reconhece como alvo do conflito.
          targetWhere: sql`erp_ref IS NOT NULL`,
          set: {
            customerId: sql`excluded.customer_id`,
            value: sql`excluded.value`,
            dueDate: sql`excluded.due_date`,
            descricao: sql`excluded.descricao`,
            status: "aberta",
            baixadaEm: null,
            updatedAt: agora,
          },
        });
    }
    return validas.length;
  }

  /**
   * O mesmo upsert, para quem o conector so identifica pelo DOCUMENTO — o
   * cliente em dia, que nao passa pelo upsert de inadimplente e por isso nao
   * tem o id na mao do sync (`faturasDeClientesEmDia`).
   *
   * Resolve o cliente na base DESTE provedor. `null` = ele nao esta na base
   * (cadastro sem contrato, que a porteira barrou) — nada gravado, e nao e
   * erro.
   */
  async upsertFaturasDoErpPorDocumento(
    providerId: number,
    erpSource: string,
    cpfCnpj: string,
    faturas: FaturaAbertaDoErp[],
  ): Promise<number | null> {
    const doc = String(cpfCnpj ?? "").replace(/\D/g, "");
    if (!doc) return null;
    const [cliente] = await db.select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.providerId, providerId), eq(customers.cpfCnpj, doc)))
      .limit(1);
    if (!cliente) return null;
    return this.upsertFaturasDoErp(providerId, erpSource, cliente.id, faturas);
  }

  /**
   * Marca `baixada_no_erp` toda fatura `aberta` deste provedor/fonte cuja
   * referencia NAO apareceu nesta varredura.
   *
   * E prova negativa, e so vale depois de uma varredura COMPLETA — quem decide
   * isso e o sync (a mesma condicao de `baixarDividaQuitada`). Aqui ha duas
   * travas de fundo: sem nenhuma referencia vista nao se baixa nada (uma lista
   * vazia nao e "ninguem tem fatura", e leitura que nao serviu — foi assim que
   * a divida da O L I sumiu em 31/08/2026); e os clientes que o conector
   * declarou NAO LIDOS (`docsProtegidos`, por documento) ficam como estavam:
   * a fatura deles nao sumiu, so nao foi olhada.
   *
   * `baixada_em` e quando NOTAMOS, nao quando foi paga. Devolve quantas.
   */
  async baixarFaturasSumidas(
    providerId: number,
    erpSource: string,
    refsVistas: Set<string>,
    docsProtegidos: string[] = [],
  ): Promise<number> {
    const refs = Array.from(refsVistas).map(r => String(r).trim()).filter(Boolean);
    if (refs.length === 0) return 0;
    const docs = docsProtegidos.map(d => String(d ?? "").replace(/\D/g, "")).filter(Boolean);

    const condicoes: SQL[] = [
      eq(invoices.providerId, providerId),
      eq(invoices.erpSource, erpSource),
      eq(invoices.status, "aberta"),
      isNotNull(invoices.erpRef),
      // Um parametro so, como array: a O L I tem 42.883 faturas abertas, e
      // `NOT IN ($1, ..., $42883)` encosta no teto de parametros do protocolo.
      sql`not (${invoices.erpRef} = any(${sql.param(refs)}::text[]))`,
    ];
    if (docs.length > 0) {
      condicoes.push(sql`not exists (
        select 1 from ${customers}
        where ${customers.id} = ${invoices.customerId}
          and ${customers.providerId} = ${providerId}
          and ${customers.cpfCnpj} = any(${sql.param(docs)}::text[])
      )`);
    }

    const agora = new Date();
    const baixadas = await db.update(invoices)
      .set({ status: "baixada_no_erp", baixadaEm: agora, updatedAt: agora })
      .where(and(...condicoes))
      .returning({ id: invoices.id });
    return baixadas.length;
  }

  /**
   * O mes de vencimento, fechado com a regra do Provedor.ai — ver o cabecalho.
   *
   * `hoje` decide o que e vencido: fatura que vence HOJE ainda nao venceu
   * (mesma regua de `diasDesdeVencimento`, por dia de calendario). Tres
   * consultas, todas com provider_id: as faturas do mes, os clientes atuais
   * contra elas, e a existencia de base.
   */
  async resumoDoMes(providerId: number, mes: string, hoje: Date): Promise<ResumoDoMes> {
    const { de, ate } = janelaDoMes(mes);
    const corte = diaDeHoje(hoje);

    const aberta = inArray(invoices.status, [...STATUS_FATURA_ABERTA]);
    const vencida = and(aberta, lt(invoices.dueDate, ts(corte)))!;
    const aVencer = and(aberta, gte(invoices.dueDate, ts(corte)))!;
    const soma = (cond: SQL) => sql<number>`coalesce(sum(${invoices.value}) filter (where ${cond}), 0)`.mapWith(Number);
    const conta = (cond: SQL) => sql<number>`count(*) filter (where ${cond})`.mapWith(Number);

    const [f] = await db.select({
      faturado: sql<number>`coalesce(sum(${invoices.value}), 0)`.mapWith(Number),
      recebido: soma(inArray(invoices.status, [...STATUS_FATURA_PAGA])),
      emConciliacao: soma(inArray(invoices.status, [...STATUS_FATURA_CONCILIACAO])),
      inadimplente: soma(vencida),
      numInadimplentes: conta(vencida),
      aVencer: soma(aVencer),
      numAVencer: conta(aVencer),
    })
      .from(invoices)
      .where(and(
        eq(invoices.providerId, providerId),
        gte(invoices.dueDate, ts(de)),
        lt(invoices.dueDate, ts(ate)),
        inArray(invoices.status, UNIVERSO_DO_MES),
      ));

    // Cliente ATUAL contra as faturas dele no mes. Tres grupos que se somam
    // ao total de clientes atuais: sem fatura, inadimplente (alguma aberta
    // vencida no mes) e em dia (tem fatura no mes e nenhuma vencida).
    const doClienteNoMes = sql`select 1 from ${invoices}
      where ${invoices.providerId} = ${providerId}
        and ${invoices.customerId} = ${customers.id}
        and ${invoices.dueDate} >= ${ts(de)} and ${invoices.dueDate} < ${ts(ate)}`;
    const temFaturaNoMes = sql`exists (${doClienteNoMes} and ${invoices.status} in ${UNIVERSO_DO_MES})`;
    const deveNoMes = sql`exists (${doClienteNoMes} and ${aberta} and ${invoices.dueDate} < ${ts(corte)})`;

    const [c] = await db.select({
      semFatura: conta(sql`not ${temFaturaNoMes}`),
      inadimplentes: conta(deveNoMes),
      emDia: conta(sql`${temFaturaNoMes} and not ${deveNoMes}`),
    })
      .from(customers)
      .where(and(
        eq(customers.providerId, providerId),
        inArray(customers.status, [...STATUS_DE_CLIENTE_ATUAL]),
      ));

    const [b] = await db.select({
      total: sql<number>`count(*)`.mapWith(Number),
      atualizadoEm: max(invoices.updatedAt),
    })
      .from(invoices)
      .where(and(eq(invoices.providerId, providerId), isNotNull(invoices.erpSource)));

    return {
      mes,
      base: (b?.total ?? 0) > 0,
      faturado: f?.faturado ?? 0,
      recebido: f?.recebido ?? 0,
      recebidoConfirmado: false,
      emConciliacao: f?.emConciliacao ?? 0,
      inadimplente: f?.inadimplente ?? 0,
      numInadimplentes: f?.numInadimplentes ?? 0,
      aVencer: f?.aVencer ?? 0,
      numAVencer: f?.numAVencer ?? 0,
      semFatura: c?.semFatura ?? 0,
      clientes: { emDia: c?.emDia ?? 0, inadimplentes: c?.inadimplentes ?? 0 },
      atualizadoEm: b?.atualizadoEm ?? null,
    };
  }

  /**
   * Os ids de `customers` de um grupo do mes — para a tela listar quem esta
   * atras de cada numero do resumo.
   *
   *   pago          fatura do mes paga ou baixada no ERP
   *   inadimplente  fatura do mes aberta e vencida
   *   a_vencer      fatura do mes aberta, vencendo hoje ou depois
   *   sem_fatura    cliente ATUAL sem nenhuma fatura no mes
   *
   * Um cliente pode estar em mais de um grupo (pagou uma, deve outra): sao
   * listas, nao uma particao. Limite para a resposta nao virar a carteira
   * inteira num JSON.
   */
  async clientesDoMes(
    providerId: number,
    mes: string,
    grupo: GrupoDoMes,
    opcoes: { hoje?: Date; limite?: number } = {},
  ): Promise<number[]> {
    const { de, ate } = janelaDoMes(mes);
    const corte = diaDeHoje(opcoes.hoje ?? new Date());
    const limite = Math.max(1, Math.min(opcoes.limite ?? LIMITE_PADRAO, LIMITE_PADRAO));

    if (grupo === "sem_fatura") {
      const linhas = await db.select({ id: customers.id })
        .from(customers)
        .where(and(
          eq(customers.providerId, providerId),
          inArray(customers.status, [...STATUS_DE_CLIENTE_ATUAL]),
          sql`not exists (select 1 from ${invoices}
            where ${invoices.providerId} = ${providerId}
              and ${invoices.customerId} = ${customers.id}
              and ${invoices.dueDate} >= ${ts(de)} and ${invoices.dueDate} < ${ts(ate)}
              and ${invoices.status} in ${UNIVERSO_DO_MES})`,
        ))
        .limit(limite);
      return linhas.map(l => l.id);
    }

    const aberta = inArray(invoices.status, [...STATUS_FATURA_ABERTA]);
    const doGrupo: SQL = grupo === "pago"
      ? inArray(invoices.status, [...STATUS_FATURA_PAGA, ...STATUS_FATURA_CONCILIACAO])
      : grupo === "inadimplente"
        ? and(aberta, lt(invoices.dueDate, ts(corte)))!
        : and(aberta, gte(invoices.dueDate, ts(corte)))!;

    const linhas = await db.selectDistinct({ id: invoices.customerId })
      .from(invoices)
      .where(and(
        eq(invoices.providerId, providerId),
        gte(invoices.dueDate, ts(de)),
        lt(invoices.dueDate, ts(ate)),
        doGrupo,
      ))
      .limit(limite);
    return linhas.map(l => l.id);
  }
}
