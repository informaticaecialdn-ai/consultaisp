/**
 * Spec 004 US3 — Dossier builder (T044).
 *
 * Gera dossiê de auditoria de um cliente (defesa Procon/Anatel/Justiça).
 * 6 SELECTs paralelos por (provider, customer, dateRange). Renderiza PDF via pdfkit.
 *
 * Performance alvo SC-006: <30s p95 para to-from ≤ 12 meses.
 */

import { and, asc, eq, gte, lte, inArray } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { db } from "../db";
import {
  customers, providers,
  communications, complianceChecks, auditLogs,
  pixCharges, paymentEvents, outboundAttempts,
} from "@shared/schema";

export interface DossieParams {
  providerId: number;
  customerId: number;
  from: Date;
  to: Date;
}

export interface DossieData {
  customer: {
    id: number;
    name: string;
    cpfCnpj: string;
    cpfCnpjMasked: string;
    phone: string | null;
    phoneMasked: string | null;
    email: string | null;
  };
  provider: { id: number; name: string; tradeName: string | null; cnpj: string | null };
  period: { from: string; to: string };
  communications: Array<{
    id: number;
    channel: string;
    direction: string;
    agentId: string | null;
    templateName: string | null;
    content: string;
    status: string;
    sentAt: Date | null;
    externalMessageId: string | null;
    createdAt: Date | null;
  }>;
  complianceChecks: Array<{
    id: string;
    agentId: string | null;
    actionType: string;
    decision: string;
    legalBasis: string | null;
    legalReferences: string[];
    blockingReasons: string[] | null;
    createdAt: Date | null;
  }>;
  pixCharges: Array<{
    id: number;
    asaasPaymentId: string;
    value: string;
    dueDate: string | Date;
    status: string;
    paidAt: Date | null;
    cancelledAt: Date | null;
    createdAt: Date | null;
  }>;
  paymentEvents: Array<{
    eventType: string;
    asaasPaymentId: string;
    processingStatus: string;
    receivedAt: Date;
  }>;
  outboundAttempts: Array<{
    id: number;
    agentId: string;
    step: string;
    status: string;
    scheduledFor: Date;
    failureReason: string | null;
    attemptCount: number;
  }>;
  auditLogs: Array<{
    action: string;
    resource: string;
    resourceId: string;
    actorType: string;
    actorId: string | null;
    actorName: string | null;
    legalBasis: string | null;
    occurredAt: Date;
  }>;
  summary: {
    totalCommunications: number;
    totalApprovedByCompliance: number;
    totalVetoedByCompliance: number;
    totalPaymentsConfirmed: number;
    totalPixGenerated: number;
  };
  generatedAt: Date;
}

/**
 * Wrap query que pode falhar se a tabela não existir (DBs antigos sem
 * migrate Spec 003/004). Retorna [] em vez de quebrar o dossiê inteiro.
 * Erros que não são "tabela ausente" propagam normalmente.
 */
async function safeArrayQuery<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("does not exist") || msg.includes("relation")) {
      return [];
    }
    throw err;
  }
}

function maskCpf(cpfCnpj: string): string {
  if (!cpfCnpj) return "";
  const clean = cpfCnpj.replace(/\D/g, "");
  if (clean.length === 11) return `***.***.${clean.slice(6, 9)}-${clean.slice(9)}`;
  if (clean.length === 14) return `**.***.***/${clean.slice(8, 12)}-${clean.slice(12)}`;
  return "***";
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.replace(/(\d{4})(\d{4})$/, "****-$2");
}

/**
 * Carrega dossiê completo em paralelo. Multi-tenant gate aplicado em todas queries.
 * Lança erro se customer não pertence ao providerId.
 */
export async function buildDossie(params: DossieParams): Promise<DossieData> {
  const { providerId, customerId, from, to } = params;

  // 1. Multi-tenant gate: customer pertence ao provider?
  const [cust] = await db.select().from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.providerId, providerId)))
    .limit(1);
  if (!cust) {
    throw new Error("customer_not_found");
  }

  // 2. Provider para cabeçalho
  const [prov] = await db.select().from(providers).where(eq(providers.id, providerId)).limit(1);
  if (!prov) throw new Error("provider_not_found");

  // 3. 6 SELECTs paralelos — cada um tolera tabela faltando (DB sem
  // migrate Spec 003/004 retorna [] em vez de quebrar o dossiê inteiro)
  const [
    commsRows,
    complianceRows,
    pixRows,
    auditRows,
    attemptsRows,
  ] = await Promise.all([
    safeArrayQuery(() => db.select().from(communications)
      .where(and(
        eq(communications.providerId, providerId),
        eq(communications.customerId, customerId),
        gte(communications.createdAt, from),
        lte(communications.createdAt, to),
      ))
      .orderBy(asc(communications.createdAt))),

    safeArrayQuery(() => db.select().from(complianceChecks)
      .where(and(
        eq(complianceChecks.providerId, providerId),
        eq(complianceChecks.customerId, customerId),
        gte(complianceChecks.createdAt, from),
        lte(complianceChecks.createdAt, to),
      ))
      .orderBy(asc(complianceChecks.createdAt))),

    safeArrayQuery(() => db.select().from(pixCharges)
      .where(and(
        eq(pixCharges.providerId, providerId),
        eq(pixCharges.customerId, customerId),
        gte(pixCharges.createdAt, from),
        lte(pixCharges.createdAt, to),
      ))
      .orderBy(asc(pixCharges.createdAt))),

    safeArrayQuery(() => db.select().from(auditLogs)
      .where(and(
        eq(auditLogs.providerId, providerId),
        eq(auditLogs.resource, "customer"),
        eq(auditLogs.resourceId, String(customerId)),
        gte(auditLogs.occurredAt, from),
        lte(auditLogs.occurredAt, to),
      ))
      .orderBy(asc(auditLogs.occurredAt))),

    safeArrayQuery(() => db.select().from(outboundAttempts)
      .where(and(
        eq(outboundAttempts.providerId, providerId),
        eq(outboundAttempts.customerId, customerId),
        gte(outboundAttempts.scheduledFor, from),
        lte(outboundAttempts.scheduledFor, to),
      ))
      .orderBy(asc(outboundAttempts.scheduledFor))),
  ]);

  // 4. Payment events derivados dos pix charges (escopo do mesmo período)
  const pixIds = pixRows.map(p => p.asaasPaymentId);
  const paymentEventsRows = pixIds.length > 0
    ? await safeArrayQuery(() => db.select().from(paymentEvents)
        .where(and(
          eq(paymentEvents.providerId, providerId),
          inArray(paymentEvents.asaasPaymentId, pixIds),
        ))
        .orderBy(asc(paymentEvents.receivedAt)))
    : [];

  // 5. Summary
  const totalApproved = complianceRows.filter(c => c.decision === "APPROVED" || c.decision === "APPROVED_WITH_ADJUSTMENT").length;
  const totalVetoed = complianceRows.filter(c => c.decision === "BLOCKED").length;
  const totalPaid = paymentEventsRows.filter(e => e.eventType === "PAYMENT_RECEIVED" || e.eventType === "PAYMENT_CONFIRMED").length;

  return {
    customer: {
      id: cust.id,
      name: cust.name,
      cpfCnpj: cust.cpfCnpj ?? "",
      cpfCnpjMasked: maskCpf(cust.cpfCnpj ?? ""),
      phone: cust.phone,
      phoneMasked: maskPhone(cust.phone),
      email: cust.email,
    },
    provider: {
      id: prov.id,
      name: prov.name,
      tradeName: prov.tradeName,
      cnpj: prov.cnpj,
    },
    period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    communications: commsRows.map(c => ({
      id: c.id,
      channel: c.channel,
      direction: c.direction,
      agentId: c.agentId,
      templateName: c.templateName,
      content: c.content,
      status: c.status,
      sentAt: c.sentAt,
      externalMessageId: c.externalMessageId,
      createdAt: c.createdAt,
    })),
    complianceChecks: complianceRows.map(c => ({
      id: c.id,
      agentId: c.agentId,
      actionType: (c.proposedAction as any)?.actionType ?? "unknown",
      decision: c.decision,
      legalBasis: c.legalBasis,
      legalReferences: (c.legalReferences as string[]) ?? [],
      blockingReasons: c.blockingReasons as string[] | null,
      createdAt: c.createdAt,
    })),
    pixCharges: pixRows.map(p => ({
      id: p.id,
      asaasPaymentId: p.asaasPaymentId,
      value: String(p.value),
      dueDate: p.dueDate,
      status: p.status,
      paidAt: p.paidAt,
      cancelledAt: p.cancelledAt,
      createdAt: p.createdAt,
    })),
    paymentEvents: paymentEventsRows.map(e => ({
      eventType: e.eventType,
      asaasPaymentId: e.asaasPaymentId,
      processingStatus: e.processingStatus,
      receivedAt: e.receivedAt,
    })),
    outboundAttempts: attemptsRows.map(a => ({
      id: a.id,
      agentId: a.agentId,
      step: a.step,
      status: a.status,
      scheduledFor: a.scheduledFor,
      failureReason: a.failureReason,
      attemptCount: a.attemptCount,
    })),
    auditLogs: auditRows.map(a => ({
      action: a.action,
      resource: a.resource,
      resourceId: a.resourceId,
      actorType: a.actorType,
      actorId: a.actorId,
      actorName: a.actorName,
      legalBasis: a.legalBasis,
      occurredAt: a.occurredAt,
    })),
    summary: {
      totalCommunications: commsRows.length,
      totalApprovedByCompliance: totalApproved,
      totalVetoedByCompliance: totalVetoed,
      totalPaymentsConfirmed: totalPaid,
      totalPixGenerated: pixRows.length,
    },
    generatedAt: new Date(),
  };
}

function formatBR(d: Date | string | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return `${date.toLocaleDateString("pt-BR")} ${date.toLocaleTimeString("pt-BR")}`;
}

/**
 * Renderiza dossiê como PDF stream. Caller pipe pra res.
 */
export function renderDossiePdf(data: DossieData, stream: NodeJS.WritableStream): void {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    info: {
      Title: `Dossiê de Auditoria — Cliente ${data.customer.id}`,
      Author: data.provider.tradeName ?? data.provider.name,
      Subject: "Dossiê de defesa Procon/Anatel/LGPD",
      CreationDate: data.generatedAt,
    },
  });
  doc.pipe(stream);

  // Cabeçalho
  doc.fontSize(18).fillColor("#000").text(data.provider.tradeName ?? data.provider.name, { align: "left" });
  doc.fontSize(9).fillColor("#666").text(`CNPJ: ${data.provider.cnpj ?? "—"}`);
  doc.moveDown(0.5);
  doc.fontSize(16).fillColor("#000").text("Dossiê de Auditoria — Cobrança", { align: "center" });
  doc.fontSize(10).fillColor("#666").text(`Gerado em ${formatBR(data.generatedAt)}`, { align: "center" });
  doc.moveDown();

  // Cliente
  doc.fontSize(12).fillColor("#000").text("Cliente", { underline: true });
  doc.fontSize(10).fillColor("#000");
  doc.text(`Nome: ${data.customer.name}`);
  doc.text(`CPF/CNPJ: ${data.customer.cpfCnpjMasked}`);
  doc.text(`Telefone: ${data.customer.phoneMasked ?? "—"}`);
  doc.text(`E-mail: ${data.customer.email ?? "—"}`);
  doc.text(`Período auditado: ${data.period.from} a ${data.period.to}`);
  doc.moveDown();

  // Resumo executivo
  doc.fontSize(12).text("Resumo Executivo", { underline: true });
  doc.fontSize(10);
  doc.text(`Comunicações: ${data.summary.totalCommunications}`);
  doc.text(`Aprovadas pelo Compliance (Júlia): ${data.summary.totalApprovedByCompliance}`);
  doc.text(`Vetadas pelo Compliance: ${data.summary.totalVetoedByCompliance}`);
  doc.text(`Pix gerados: ${data.summary.totalPixGenerated}`);
  doc.text(`Pagamentos confirmados: ${data.summary.totalPaymentsConfirmed}`);
  doc.moveDown();

  // Compliance checks (mais importante para defesa)
  if (data.complianceChecks.length > 0) {
    doc.addPage();
    doc.fontSize(12).text("Compliance Checks (validação Júlia)", { underline: true });
    doc.moveDown(0.5);
    for (const c of data.complianceChecks) {
      doc.fontSize(9).fillColor("#000");
      doc.text(`[${formatBR(c.createdAt)}] ${c.actionType} → ${c.decision}`);
      doc.fontSize(8).fillColor("#666");
      doc.text(`Agente: ${c.agentId}`);
      doc.text(`Base legal: ${c.legalBasis ?? "—"}`);
      if (c.legalReferences.length > 0) doc.text(`Referências: ${c.legalReferences.join(", ")}`);
      if (c.blockingReasons && c.blockingReasons.length > 0) {
        doc.fillColor("#a00").text(`Motivos de bloqueio: ${c.blockingReasons.join("; ")}`);
      }
      doc.moveDown(0.3);
    }
  }

  // Comunicações
  if (data.communications.length > 0) {
    doc.addPage();
    doc.fontSize(12).fillColor("#000").text("Comunicações", { underline: true });
    doc.moveDown(0.5);
    for (const com of data.communications) {
      doc.fontSize(9).fillColor("#000");
      doc.text(`[${formatBR(com.sentAt ?? com.createdAt)}] ${com.channel.toUpperCase()} ${com.direction.toUpperCase()}`);
      doc.fontSize(8).fillColor("#666");
      if (com.agentId) doc.text(`Agente: ${com.agentId}`);
      if (com.templateName) doc.text(`Template: ${com.templateName}`);
      doc.text(`Status: ${com.status}`);
      doc.fontSize(9).fillColor("#000").text(`"${com.content}"`, { indent: 20 });
      doc.moveDown(0.3);
    }
  }

  // Pix charges
  if (data.pixCharges.length > 0) {
    doc.addPage();
    doc.fontSize(12).fillColor("#000").text("Cobranças Pix Geradas", { underline: true });
    doc.moveDown(0.5);
    for (const p of data.pixCharges) {
      doc.fontSize(9).fillColor("#000");
      const dueDate = p.dueDate instanceof Date ? p.dueDate.toLocaleDateString("pt-BR") : String(p.dueDate).slice(0, 10);
      doc.text(`Pix ${p.asaasPaymentId} — R$ ${p.value} — venc ${dueDate} — ${p.status}`);
      doc.fontSize(8).fillColor("#666");
      if (p.paidAt) doc.text(`Pago em ${formatBR(p.paidAt)}`);
      if (p.cancelledAt) doc.text(`Cancelado em ${formatBR(p.cancelledAt)}`);
      doc.moveDown(0.2);
    }
  }

  // Audit log (timeline completa)
  if (data.auditLogs.length > 0) {
    doc.addPage();
    doc.fontSize(12).fillColor("#000").text("Timeline de Audit (cronológica)", { underline: true });
    doc.fontSize(8).fillColor("#666").text("Tabela imutável de todas as ações do sistema relacionadas a este cliente.");
    doc.moveDown(0.5);
    for (const a of data.auditLogs) {
      doc.fontSize(8).fillColor("#000");
      doc.text(`[${formatBR(a.occurredAt)}] ${a.action} (${a.actorType}: ${a.actorName ?? a.actorId ?? "—"})`);
      if (a.legalBasis) doc.fillColor("#666").text(`Base legal: ${a.legalBasis}`, { indent: 15 });
      doc.moveDown(0.1);
    }
  }

  // Rodapé legal
  doc.addPage();
  doc.fontSize(10).fillColor("#000").text("Declaração", { underline: true });
  doc.fontSize(9).fillColor("#000").text(
    `Este dossiê foi gerado automaticamente pelo sistema Provedor.ai a partir da tabela imutável ` +
    `audit_logs (com triggers Postgres que impedem UPDATE/DELETE), garantindo integridade dos registros ` +
    `apresentados. Todas as comunicações outbound passaram por validação prévia da agente de Compliance (Júlia) ` +
    `que verifica conformidade com Anatel Resolução 765/2023, CDC arts. 42, 43 e 71, LGPD Lei 13.709/2018 ` +
    `e Lei 14.181/2021 (superendividamento).`
  );
  doc.moveDown();
  doc.fontSize(8).fillColor("#666").text(
    `Para verificação independente, contate o Encarregado de Dados (DPO) em dpo@provedor.ai.`,
    { align: "center" }
  );

  doc.end();
}
