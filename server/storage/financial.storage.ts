import { eq, and, ne, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../logger";
import {
  providers, contracts, invoices, providerInvoices, creditOrders,
  planChanges, providerPartners, providerDocuments,
  PLAN_PRICES,
  type Provider,
  type Contract, type InsertContract,
  type Invoice, type InsertInvoice,
  type ProviderInvoice, type InsertProviderInvoice,
  type CreditOrder, type InsertCreditOrder,
  type PlanChange, type InsertPlanChange,
  type ProviderPartner, type InsertProviderPartner,
  type ProviderDocument, type InsertProviderDocument,
} from "@shared/schema";

/**
 * Proximo numero de uma das sequences da migracao 0012.
 *
 * O contador precisa ser atomico: COUNT(*)+1 devolve o MESMO numero para duas
 * compras simultaneas e a segunda morre no UNIQUE de `order_number`. O nome da
 * sequence e literal no codigo (nunca vem de entrada) porque identificador nao
 * aceita bind de parametro.
 */
async function proximoNumero(sequence: "credit_orders_numero_seq" | "provider_invoices_numero_seq"): Promise<number> {
  const r = await db.execute(sql`SELECT nextval(${sequence}) AS n`);
  const linha = r.rows[0] as { n: string | number } | undefined;
  return Number(linha?.n ?? 0);
}

/** O que `releaseCreditOrder` fez de fato — ver a nota de idempotencia la. */
export interface ResultadoLiberacao {
  pedido: CreditOrder;
  /** false quando o pedido ja estava pago: reentrega do webhook, nada a creditar. */
  liberadoAgora: boolean;
}

export class FinancialStorage {
  async getContractsByCustomer(customerId: number): Promise<Contract[]> {
    return db.select().from(contracts).where(eq(contracts.customerId, customerId));
  }

  async getContractsByProvider(providerId: number): Promise<Contract[]> {
    return db.select().from(contracts).where(eq(contracts.providerId, providerId));
  }

  async createContract(contract: InsertContract): Promise<Contract> {
    const [created] = await db.insert(contracts).values(contract).returning();
    return created;
  }

  async getInvoicesByProvider(providerId: number): Promise<Invoice[]> {
    return db.select().from(invoices).where(eq(invoices.providerId, providerId)).orderBy(desc(invoices.dueDate));
  }

  async getInvoicesByCustomer(customerId: number): Promise<Invoice[]> {
    return db.select().from(invoices).where(eq(invoices.customerId, customerId)).orderBy(desc(invoices.dueDate));
  }

  async getOverdueInvoicesByProvider(providerId: number): Promise<Invoice[]> {
    return db.select().from(invoices).where(
      and(
        eq(invoices.providerId, providerId),
        eq(invoices.status, "overdue"),
      )
    );
  }

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const [created] = await db.insert(invoices).values(invoice).returning();
    return created;
  }

  async getNextInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const seq = await proximoNumero("provider_invoices_numero_seq");
    return `NF-${year}-${String(seq).padStart(6, "0")}`;
  }

  async getAllProviderInvoices(providerId?: number): Promise<(ProviderInvoice & { providerName: string })[]> {
    const allInvoices = providerId
      ? await db.select().from(providerInvoices).where(eq(providerInvoices.providerId, providerId)).orderBy(desc(providerInvoices.createdAt))
      : await db.select().from(providerInvoices).orderBy(desc(providerInvoices.createdAt));
    return Promise.all(allInvoices.map(async (inv) => {
      const [provider] = await db.select({ name: providers.name }).from(providers).where(eq(providers.id, inv.providerId));
      return { ...inv, providerName: provider?.name || "Desconhecido" };
    }));
  }

  async getProviderInvoice(id: number): Promise<(ProviderInvoice & { providerName: string; providerCnpj: string; providerSubdomain: string | null }) | undefined> {
    const [inv] = await db.select().from(providerInvoices).where(eq(providerInvoices.id, id));
    if (!inv) return undefined;
    const [provider] = await db.select({ name: providers.name, cnpj: providers.cnpj, subdomain: providers.subdomain }).from(providers).where(eq(providers.id, inv.providerId));
    return { ...inv, providerName: provider?.name || "Desconhecido", providerCnpj: provider?.cnpj || "", providerSubdomain: provider?.subdomain || null };
  }

  async createProviderInvoice(invoice: InsertProviderInvoice): Promise<ProviderInvoice> {
    const [created] = await db.insert(providerInvoices).values(invoice).returning();
    return created;
  }

  async updateProviderInvoiceStatus(id: number, status: string, paidDate?: Date, paidAmount?: string): Promise<ProviderInvoice> {
    const updateData: Partial<typeof providerInvoices.$inferInsert> = { status };
    if (paidDate) updateData.paidDate = paidDate;
    if (paidAmount) updateData.paidAmount = paidAmount;
    const [updated] = await db.update(providerInvoices).set(updateData).where(eq(providerInvoices.id, id)).returning();
    return updated;
  }

  async updateProviderInvoiceAsaas(id: number, asaasData: {
    asaasChargeId?: string;
    asaasCustomerId?: string;
    asaasStatus?: string;
    asaasInvoiceUrl?: string;
    asaasBankSlipUrl?: string;
    asaasPixKey?: string;
    asaasBillingType?: string;
    status?: string;
    paidDate?: Date;
    paidAmount?: string;
    // O webhook registra aqui por que recusou um pagamento (valor divergente,
    // cobranca de outra fatura); e o unico lugar que o superadmin ve.
    notes?: string;
  }): Promise<ProviderInvoice> {
    const [updated] = await db.update(providerInvoices).set(asaasData).where(eq(providerInvoices.id, id)).returning();
    return updated;
  }

  async getFinancialSummary(): Promise<any> {
    const allProviders = await db.select().from(providers);
    const allInvoices = await db.select().from(providerInvoices);

    const activeProviders = allProviders.filter(p => p.status === "active");
    const mrr = activeProviders.reduce((sum, p) => sum + (PLAN_PRICES[p.plan] || 0), 0);
    const arr = mrr * 12;

    const pendingInvoices = allInvoices.filter(i => i.status === "pending" || i.status === "overdue");
    const paidInvoices = allInvoices.filter(i => i.status === "paid");
    const overdueInvoices = allInvoices.filter(i => i.status === "overdue");

    const totalRevenue = paidInvoices.reduce((sum, i) => sum + parseFloat(i.paidAmount || i.amount), 0);
    const pendingRevenue = pendingInvoices.reduce((sum, i) => sum + parseFloat(i.amount), 0);
    const overdueRevenue = overdueInvoices.reduce((sum, i) => sum + parseFloat(i.amount), 0);

    const planDistribution: Record<string, number> = {};
    for (const p of allProviders) {
      planDistribution[p.plan] = (planDistribution[p.plan] || 0) + 1;
    }

    const now = new Date();
    const last6Months: { period: string; revenue: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const periodPaid = allInvoices.filter(inv => inv.period === period && inv.status === "paid");
      const revenue = periodPaid.reduce((sum, inv) => sum + parseFloat(inv.paidAmount || inv.amount), 0);
      last6Months.push({ period, revenue });
    }

    return {
      mrr, arr,
      totalRevenue, pendingRevenue, overdueRevenue,
      totalInvoices: allInvoices.length,
      pendingCount: pendingInvoices.length,
      paidCount: paidInvoices.length,
      overdueCount: overdueInvoices.length,
      planDistribution,
      last6Months,
      activeProviders: activeProviders.length,
      totalProviders: allProviders.length,
    };
  }

  async getAllCreditOrders(providerId?: number): Promise<CreditOrder[]> {
    if (providerId) {
      return db.select().from(creditOrders).where(eq(creditOrders.providerId, providerId)).orderBy(desc(creditOrders.createdAt));
    }
    return db.select().from(creditOrders).orderBy(desc(creditOrders.createdAt));
  }

  async getCreditOrder(id: number): Promise<CreditOrder | undefined> {
    const [order] = await db.select().from(creditOrders).where(eq(creditOrders.id, id));
    return order;
  }

  async createCreditOrder(order: InsertCreditOrder): Promise<CreditOrder> {
    const [created] = await db.insert(creditOrders).values(order).returning();
    return created;
  }

  async updateCreditOrder(id: number, data: Partial<CreditOrder>): Promise<CreditOrder> {
    const [updated] = await db.update(creditOrders).set(data as any).where(eq(creditOrders.id, id)).returning();
    return updated;
  }

  /**
   * Credita o pedido pago. Transacional e idempotente.
   *
   * O Asaas REENTREGA webhook (retentativa, ou o mesmo evento por dois
   * caminhos). A versao anterior lia o status, creditava e so depois gravava
   * "paid" em tres comandos soltos: duas entregas em paralelo liam "pending"
   * juntas e o provedor ganhava o dobro dos creditos, com duas linhas em
   * plan_changes e duas NFS-e.
   *
   * A trava e o proprio UPDATE condicional (`status <> 'paid'`), dentro da
   * transacao: quem chega em segundo lugar espera o lock da linha, reavalia o
   * WHERE contra o valor ja gravado, casa com zero linhas e sai sem creditar.
   * Nao lanca erro — reentrega e evento normal, nao falha.
   */
  async releaseCreditOrder(id: number): Promise<ResultadoLiberacao> {
    const resultado = await db.transaction(async (tx): Promise<ResultadoLiberacao> => {
      const [reivindicado] = await tx.update(creditOrders)
        .set({ status: "paid", creditedAt: new Date() })
        .where(and(eq(creditOrders.id, id), ne(creditOrders.status, "paid")))
        .returning();

      if (!reivindicado) {
        const [existente] = await tx.select().from(creditOrders).where(eq(creditOrders.id, id));
        if (!existente) throw new Error("Pedido nao encontrado");
        return { pedido: existente, liberadoAgora: false };
      }

      await tx.execute(sql`UPDATE providers SET isp_credits = isp_credits + ${reivindicado.ispCredits}, spc_credits = spc_credits + ${reivindicado.spcCredits}, bigdata_credits = bigdata_credits + ${reivindicado.bigdataCredits ?? 0} WHERE id = ${reivindicado.providerId}`);
      await tx.insert(planChanges).values({
        providerId: reivindicado.providerId,
        ispCreditsAdded: reivindicado.ispCredits,
        spcCreditsAdded: reivindicado.spcCredits,
        bigdataCreditsAdded: reivindicado.bigdataCredits ?? 0,
        notes: `Creditos liberados via pedido ${reivindicado.orderNumber} (${reivindicado.packageName})`,
      });

      return { pedido: reivindicado, liberadoAgora: true };
    });

    // Fora da transacao e so quando algo foi de fato creditado: a NFS-e e uma
    // chamada externa, nao pode segurar a transacao nem sair duas vezes para o
    // mesmo pedido numa reentrega.
    if (resultado.liberadoAgora) {
      try {
        const { emitirNfseParaCompra } = await import("../services/nfse-auto");
        emitirNfseParaCompra(resultado.pedido.providerId, resultado.pedido).catch((err: any) =>
          logger.warn({ pedido: resultado.pedido.orderNumber, err: err?.message }, "NFS-e nao emitida para o pedido")
        );
      } catch {}
    }

    return resultado;
  }

  async getNextOrderNumber(): Promise<string> {
    const num = await proximoNumero("credit_orders_numero_seq");
    const today = new Date();
    const yyyymm = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}`;
    return `CR-${yyyymm}-${String(num).padStart(4, "0")}`;
  }

  async getProviderPartners(providerId: number): Promise<ProviderPartner[]> {
    return db.select().from(providerPartners).where(eq(providerPartners.providerId, providerId)).orderBy(providerPartners.createdAt);
  }

  async createProviderPartner(partner: InsertProviderPartner): Promise<ProviderPartner> {
    const [created] = await db.insert(providerPartners).values(partner).returning();
    return created;
  }

  async updateProviderPartner(id: number, providerId: number, data: Partial<ProviderPartner>): Promise<ProviderPartner> {
    const [updated] = await db.update(providerPartners).set(data as any).where(and(eq(providerPartners.id, id), eq(providerPartners.providerId, providerId))).returning();
    return updated;
  }

  async deleteProviderPartner(id: number, providerId: number): Promise<void> {
    await db.delete(providerPartners).where(and(eq(providerPartners.id, id), eq(providerPartners.providerId, providerId)));
  }

  async getProviderDocuments(providerId: number): Promise<ProviderDocument[]> {
    return db.select().from(providerDocuments).where(eq(providerDocuments.providerId, providerId)).orderBy(desc(providerDocuments.uploadedAt));
  }

  async getProviderDocument(id: number): Promise<ProviderDocument | undefined> {
    const [doc] = await db.select().from(providerDocuments).where(eq(providerDocuments.id, id));
    return doc;
  }

  async createProviderDocument(doc: InsertProviderDocument): Promise<ProviderDocument> {
    const [created] = await db.insert(providerDocuments).values(doc).returning();
    return created;
  }

  async deleteProviderDocument(id: number, providerId: number): Promise<void> {
    await db.delete(providerDocuments).where(and(eq(providerDocuments.id, id), eq(providerDocuments.providerId, providerId)));
  }

  async updateProviderDocumentStatus(id: number, status: string, reviewedById: number, reviewerName: string, rejectionReason?: string): Promise<ProviderDocument> {
    const [updated] = await db.update(providerDocuments).set({ status, reviewedById, reviewerName, rejectionReason: rejectionReason || null, reviewedAt: new Date() }).where(eq(providerDocuments.id, id)).returning();
    return updated;
  }
}
