/**
 * LGPD Titular Request Automated Processor
 *
 * Runs every hour to auto-process pending titular requests:
 * - acesso: builds JSON report of all data found for the CPF
 * - exclusao: anonymizes all records for the CPF
 * - portabilidade: exports all raw data for the CPF
 * - correcao/revogacao: left for manual admin action
 *
 * LGPD Art. 18 compliance — 15 business day deadline.
 */

import { db } from "../db";
import { titularRequests, ispConsultations, spcConsultations } from "@shared/schema";
import { eq, sql, and, inArray } from "drizzle-orm";
import { logger } from "../logger";
import { sendCompletionEmail, sendSlaAlertEmail } from "./lgpd-email.service";

const PROCESS_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const AUTO_PROCESSABLE_TYPES = ["acesso", "exclusao", "portabilidade"];

/**
 * Calculate approximate business days between two dates.
 */
function businessDaysBetween(start: Date, end: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const totalDays = Math.floor((end.getTime() - start.getTime()) / msPerDay);
  return Math.floor(totalDays * 5 / 7);
}

/**
 * Process a single "acesso" request — build JSON report of all data.
 */
async function processAcesso(cpf: string): Promise<Record<string, any>> {
  const ispRecords = await db.select({
    id: ispConsultations.id,
    providerId: ispConsultations.providerId,
    searchType: ispConsultations.searchType,
    score: ispConsultations.score,
    decisionReco: ispConsultations.decisionReco,
    createdAt: ispConsultations.createdAt,
  }).from(ispConsultations).where(eq(ispConsultations.cpfCnpj, cpf));

  const spcRecords = await db.select({
    id: spcConsultations.id,
    providerId: spcConsultations.providerId,
    score: spcConsultations.score,
    createdAt: spcConsultations.createdAt,
  }).from(spcConsultations).where(eq(spcConsultations.cpfCnpj, cpf));

  return {
    action: "acesso",
    cpf,
    exportDate: new Date().toISOString(),
    totalIspConsultations: ispRecords.length,
    totalSpcConsultations: spcRecords.length,
    ispConsultations: ispRecords.map(r => ({
      id: r.id,
      providerId: r.providerId,
      searchType: r.searchType,
      score: r.score,
      decision: r.decisionReco,
      date: r.createdAt?.toISOString(),
    })),
    spcConsultations: spcRecords.map(r => ({
      id: r.id,
      providerId: r.providerId,
      score: r.score,
      date: r.createdAt?.toISOString(),
    })),
  };
}

/**
 * Process "exclusao" — anonymize all records for the CPF.
 * Follows the same pattern as lgpd-retention.ts.
 */
async function processExclusao(cpf: string, protocolo: string): Promise<Record<string, any>> {
  const ispResult = await db.update(ispConsultations)
    .set({
      cpfCnpj: "ANONIMIZADO",
      cpfCnpjHash: null,
      result: sql`jsonb_build_object('anonimizado', true, 'motivo', 'LGPD Art. 18 - exclusao titular', 'protocolo', ${protocolo}, 'retentionDate', ${new Date().toISOString()})`,
    })
    .where(sql`${ispConsultations.cpfCnpj} = ${cpf} AND ${ispConsultations.cpfCnpj} != 'ANONIMIZADO'`)
    .returning({ id: ispConsultations.id });

  const spcResult = await db.update(spcConsultations)
    .set({
      cpfCnpj: "ANONIMIZADO",
      result: sql`jsonb_build_object('anonimizado', true, 'motivo', 'LGPD Art. 18 - exclusao titular', 'protocolo', ${protocolo}, 'retentionDate', ${new Date().toISOString()})`,
    })
    .where(sql`${spcConsultations.cpfCnpj} = ${cpf} AND ${spcConsultations.cpfCnpj} != 'ANONIMIZADO'`)
    .returning({ id: spcConsultations.id });

  return {
    action: "exclusao",
    cpfAnonymized: cpf,
    ispRecordsAnonymized: ispResult.length,
    spcRecordsAnonymized: spcResult.length,
    processedAt: new Date().toISOString(),
  };
}

/**
 * Process "portabilidade" — export all raw data for the CPF.
 */
async function processPortabilidade(cpf: string): Promise<Record<string, any>> {
  const ispRecords = await db.select().from(ispConsultations).where(eq(ispConsultations.cpfCnpj, cpf));
  const spcRecords = await db.select().from(spcConsultations).where(eq(spcConsultations.cpfCnpj, cpf));

  return {
    action: "portabilidade",
    cpf,
    exportDate: new Date().toISOString(),
    format: "JSON",
    totalRecords: ispRecords.length + spcRecords.length,
    ispConsultations: ispRecords.map(r => ({
      id: r.id,
      providerId: r.providerId,
      searchType: r.searchType,
      result: r.result,
      score: r.score,
      decisionReco: r.decisionReco,
      cost: r.cost,
      createdAt: r.createdAt?.toISOString(),
    })),
    spcConsultations: spcRecords.map(r => ({
      id: r.id,
      providerId: r.providerId,
      result: r.result,
      score: r.score,
      createdAt: r.createdAt?.toISOString(),
    })),
  };
}

/**
 * Build a human-readable summary from execution result.
 */
function buildResultSummary(result: Record<string, any>): string {
  switch (result.action) {
    case "acesso":
      return `Relatorio gerado com ${result.totalIspConsultations} consultas ISP e ${result.totalSpcConsultations} consultas SPC.`;
    case "exclusao":
      return `${result.ispRecordsAnonymized} registros ISP e ${result.spcRecordsAnonymized} registros SPC anonimizados.`;
    case "portabilidade":
      return `Exportados ${result.totalRecords} registros em formato JSON.`;
    default:
      return "Processamento concluido.";
  }
}

/**
 * Process all pending auto-processable titular requests.
 */
async function processPendingRequests(): Promise<number> {
  const pending = await db.select()
    .from(titularRequests)
    .where(
      and(
        eq(titularRequests.status, "pendente"),
        inArray(titularRequests.tipoSolicitacao, AUTO_PROCESSABLE_TYPES),
      )
    );

  if (pending.length === 0) return 0;

  let processed = 0;

  for (const request of pending) {
    try {
      let executionResult: Record<string, any>;

      switch (request.tipoSolicitacao) {
        case "acesso":
          executionResult = await processAcesso(request.cpfCnpj);
          break;
        case "exclusao":
          executionResult = await processExclusao(request.cpfCnpj, request.protocolo);
          break;
        case "portabilidade":
          executionResult = await processPortabilidade(request.cpfCnpj);
          break;
        default:
          continue;
      }

      await db.update(titularRequests)
        .set({
          status: "concluido",
          executionResult,
          updatedAt: new Date(),
        })
        .where(eq(titularRequests.id, request.id));

      // Send completion email to the titular
      const summary = buildResultSummary(executionResult);
      await sendCompletionEmail(request.email, request.protocolo, request.tipoSolicitacao, summary);

      processed++;
      logger.info({ protocolo: request.protocolo, tipo: request.tipoSolicitacao }, "[LGPD-TITULAR] Solicitacao processada automaticamente");
    } catch (err) {
      logger.error({ err, protocolo: request.protocolo }, "[LGPD-TITULAR] Erro ao processar solicitacao");
    }
  }

  return processed;
}

/**
 * Check for requests approaching SLA deadline and send admin alerts.
 */
async function checkSlaAlerts(): Promise<void> {
  const now = new Date();
  const allPending = await db.select()
    .from(titularRequests)
    .where(
      sql`${titularRequests.status} IN ('pendente', 'em_andamento')`
    );

  const atRisk = allPending.filter(r => {
    const created = r.createdAt ? new Date(r.createdAt) : now;
    const bDays = businessDaysBetween(created, now);
    return bDays >= 12; // 3 business days or less remaining
  });

  if (atRisk.length > 0) {
    const alertData = atRisk.map(r => {
      const created = r.createdAt ? new Date(r.createdAt) : now;
      return {
        protocolo: r.protocolo,
        nome: r.nome,
        tipoSolicitacao: r.tipoSolicitacao,
        businessDays: businessDaysBetween(created, now),
      };
    });

    await sendSlaAlertEmail(alertData);
    logger.warn({ count: atRisk.length }, "[LGPD-TITULAR] Solicitacoes proximo do prazo SLA");
  }
}

let processorInterval: ReturnType<typeof setInterval> | null = null;

export function startTitularProcessor(): void {
  // Run once on startup (delayed 60s to not block boot)
  setTimeout(async () => {
    try {
      const count = await processPendingRequests();
      if (count > 0) {
        logger.info({ count }, "[LGPD-TITULAR] Solicitacoes processadas no startup");
      }
      await checkSlaAlerts();
    } catch (err) {
      logger.error({ err }, "[LGPD-TITULAR] Erro no processamento inicial");
    }
  }, 60_000);

  // Then run every hour
  processorInterval = setInterval(async () => {
    try {
      const count = await processPendingRequests();
      if (count > 0) {
        logger.info({ count }, "[LGPD-TITULAR] Solicitacoes processadas");
      }
      await checkSlaAlerts();
    } catch (err) {
      logger.error({ err }, "[LGPD-TITULAR] Erro no processamento agendado");
    }
  }, PROCESS_INTERVAL_MS);

  processorInterval.unref();
  logger.info("[LGPD-TITULAR] Processor agendado (a cada 1h)");
}
