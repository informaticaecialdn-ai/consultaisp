/**
 * Spec 010A — Snapshot builder (sem schema novo).
 *
 * Lê dados das tabelas existentes (customers, contracts, invoices,
 * communications, agreements) e monta CustomerHealthInputs para o
 * score-calculator. Permite computar health score REAL on-the-fly
 * para um cliente, sem depender de schema customer_health_snapshots
 * autorizado.
 *
 * Quando o schema for autorizado (Batch 2), este builder vira o
 * worker do cron noturno que persiste em customer_health_snapshots.
 * Por enquanto, é o backend do endpoint /api/customers/:id/health.
 *
 * Multi-tenant: sempre filtra por (providerId, customerId).
 */

import { and, count, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  agreements,
  communications,
  contracts,
  customers,
  invoices,
} from "@shared/schema";
import type { CustomerHealthInputs } from "./types";

/**
 * Erro tipado quando cliente não existe ou pertence a outro tenant.
 */
export class CustomerNotFoundError extends Error {
  constructor(providerId: number, customerId: number) {
    super(`Customer ${customerId} not found for provider ${providerId}`);
    this.name = "CustomerNotFoundError";
  }
}

/**
 * Constrói CustomerHealthInputs lendo dados reais do DB.
 * Multi-tenant: requer providerId + customerId, valida ownership.
 */
export async function buildCustomerHealthInputs(
  providerId: number,
  customerId: number,
): Promise<CustomerHealthInputs> {
  // 1. Verifica que o cliente existe e pertence ao tenant
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.providerId, providerId)))
    .limit(1);
  if (!customer) {
    throw new CustomerNotFoundError(providerId, customerId);
  }

  // 2. Tempo de contrato — primeiro contrato ativo
  const [contractRow] = await db
    .select({ status: contracts.status })
    .from(contracts)
    .where(and(eq(contracts.customerId, customerId), eq(contracts.providerId, providerId)))
    .limit(1);
  // Schema atual de `contracts` não tem `startedAt` próprio; usamos created_at do customer
  // como fallback. Quando contracts ganhar startedAt, troca aqui.
  // Por enquanto: assumimos contrato existe se customer existe.
  const [customerFull] = await db
    .select({ createdAt: customers.createdAt })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  const contractMonths = customerFull?.createdAt
    ? monthsBetween(customerFull.createdAt, new Date())
    : 0;
  void contractRow; // reserved if precisamos checar status no futuro

  // 3. Invoices stats (total, paid, late, overdue current)
  const invoiceStats = await db
    .select({
      total: count(),
    })
    .from(invoices)
    .where(and(eq(invoices.customerId, customerId), eq(invoices.providerId, providerId)));
  const invoicesTotal = Number(invoiceStats[0]?.total ?? 0);

  const [paidStats] = await db
    .select({
      paidCount: count(),
      totalRevenueCents: sql<number>`coalesce(sum(${invoices.value} * 100), 0)::int`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.customerId, customerId),
        eq(invoices.providerId, providerId),
        eq(invoices.status, "paid"),
      ),
    );
  const invoicesPaid = Number(paidStats?.paidCount ?? 0);
  const totalRevenueAccumulatedCents = Number(paidStats?.totalRevenueCents ?? 0);

  // late: paidDate > dueDate (pagas com atraso)
  const [lateStats] = await db
    .select({ lateCount: count() })
    .from(invoices)
    .where(
      and(
        eq(invoices.customerId, customerId),
        eq(invoices.providerId, providerId),
        isNotNull(invoices.paidDate),
        sql`${invoices.paidDate} > ${invoices.dueDate}`,
      ),
    );
  const invoicesLate = Number(lateStats?.lateCount ?? 0);

  // overdue current: status='overdue' ou pending + dueDate < now
  const [overdueStats] = await db
    .select({ overdueCount: count() })
    .from(invoices)
    .where(
      and(
        eq(invoices.customerId, customerId),
        eq(invoices.providerId, providerId),
        sql`(${invoices.status} = 'overdue' OR (${invoices.status} = 'pending' AND ${invoices.dueDate} < NOW()))`,
      ),
    );
  const invoicesOverdueCurrent = Number(overdueStats?.overdueCount ?? 0);

  // 4. Média de dias de atraso — calculada via SQL extract para 3 janelas
  const avgDaysLate30d = await avgLateDaysWindow(providerId, customerId, 30);
  const avgDaysLate90d = await avgLateDaysWindow(providerId, customerId, 90);
  const avgDaysLate365d = await avgLateDaysWindow(providerId, customerId, 365);

  // 5. Quebras de acordo — tabela autorizada na Spec 003, pode não existir
  // em DBs antigos sem migrate. Fallback: 0 (cliente sem histórico de acordo).
  const brokenAgreementsCount = await safeCount(async () => {
    const [row] = await db
      .select({ brokenCount: count() })
      .from(agreements)
      .where(
        and(
          eq(agreements.customerId, customerId),
          eq(agreements.providerId, providerId),
          eq(agreements.status, "broken"),
        ),
      );
    return Number(row?.brokenCount ?? 0);
  });

  // 6. Tickets (inbound communications) — idem, tolera tabela faltando
  const ticketCount30d = await ticketsInDays(providerId, customerId, 30);
  const ticketCount90d = await ticketsInDays(providerId, customerId, 90);

  // 7. Última interação (qualquer communication) — idem
  const lastInteractionDays = await safeQuery<number | null>(async () => {
    const [row] = await db
      .select({ created: sql<Date | null>`max(${communications.createdAt})` })
      .from(communications)
      .where(and(eq(communications.customerId, customerId), eq(communications.providerId, providerId)));
    return row?.created ? daysSince(row.created) : null;
  }, null);

  // 8. Sentiment — MVP retorna null. Quando integrarmos NLP (Helena memory),
  // populamos avgSentimentScore90d a partir de agent_memories.sentimentHistory.
  const avgSentimentScore90d: number | null = null;

  // 9. Consulta ISP — MVP retorna null. Quando Spec 008.5 expor consulta
  // direta por customer, populamos. Por enquanto, fica neutro (50 no calc).
  const consultaIspScore: number | null = null;

  return {
    contractMonths,
    invoicesTotal,
    invoicesPaid,
    invoicesLate,
    invoicesOverdueCurrent,
    avgDaysLate30d,
    avgDaysLate90d,
    avgDaysLate365d,
    totalRevenueAccumulatedCents,
    brokenAgreementsCount,
    ticketCount30d,
    ticketCount90d,
    lastInteractionDays,
    avgSentimentScore90d,
    consultaIspScore,
  };
}

/* ───────────────────── Helpers ───────────────────── */

/**
 * Média de dias de atraso em uma janela temporal (dias) — apenas invoices
 * com paidDate > dueDate (atrasadas) e paidDate dentro da janela.
 *
 * Retorna null se não houve atrasos na janela.
 */
async function avgLateDaysWindow(
  providerId: number,
  customerId: number,
  daysWindow: number,
): Promise<number | null> {
  const cutoff = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000);

  const [row] = await db
    .select({
      avgDays: sql<number | null>`avg(extract(epoch from (${invoices.paidDate} - ${invoices.dueDate})) / 86400)::numeric(10,2)`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.customerId, customerId),
        eq(invoices.providerId, providerId),
        isNotNull(invoices.paidDate),
        sql`${invoices.paidDate} > ${invoices.dueDate}`,
        gte(invoices.paidDate, cutoff),
      ),
    );

  const v = row?.avgDays;
  return v === null || v === undefined ? null : Number(v);
}

/**
 * Conta tickets (communications inbound) em uma janela temporal.
 * Tolera tabela `communications` faltando (DB sem migrate Spec 003).
 */
async function ticketsInDays(
  providerId: number,
  customerId: number,
  daysWindow: number,
): Promise<number> {
  return safeCount(async () => {
    const cutoff = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({ c: count() })
      .from(communications)
      .where(
        and(
          eq(communications.customerId, customerId),
          eq(communications.providerId, providerId),
          eq(communications.direction, "inbound"),
          gte(communications.createdAt, cutoff),
        ),
      );
    return Number(row?.c ?? 0);
  });
}

/**
 * Executa uma query que pode falhar se a tabela não existir (DBs antigos
 * sem migrate Spec 003). Retorna fallback em caso de erro, logando o motivo.
 */
async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("does not exist") || msg.includes("relation")) {
      // Tabela autorizada mas não migrada — silencioso, comportamento esperado
      return fallback;
    }
    // Outro tipo de erro — re-throw pra surfar
    throw err;
  }
}

async function safeCount(fn: () => Promise<number>): Promise<number> {
  return safeQuery(fn, 0);
}

/**
 * Diferença em meses entre duas datas.
 */
function monthsBetween(from: Date, to: Date): number {
  const yearDiff = to.getFullYear() - from.getFullYear();
  const monthDiff = to.getMonth() - from.getMonth();
  return Math.max(0, yearDiff * 12 + monthDiff);
}

/**
 * Dias desde uma data até agora.
 */
function daysSince(date: Date): number {
  const diff = Date.now() - date.getTime();
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}
