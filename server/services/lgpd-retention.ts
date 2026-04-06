/**
 * LGPD Data Retention Service
 *
 * Anonymizes consultation records older than 5 years (CDC Art. 43, §1).
 * Replaces PII with hashes, strips result JSONB of personal data.
 * Runs daily via scheduled interval.
 */

import { db } from "../db";
import { ispConsultations, spcConsultations } from "@shared/schema";
import { sql, lt } from "drizzle-orm";
import { logger } from "../logger";

const RETENTION_YEARS = 5;
const RETENTION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Anonymize ISP consultations older than retention period.
 * Replaces cpfCnpj with "ANONIMIZADO", clears result JSONB of PII.
 */
async function anonymizeOldConsultations(): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - RETENTION_YEARS);

  // Anonymize ISP consultations
  const ispResult = await db.update(ispConsultations)
    .set({
      cpfCnpj: "ANONIMIZADO",
      cpfCnpjHash: null,
      result: sql`jsonb_build_object('anonimizado', true, 'score', ${ispConsultations.score}, 'decisionReco', ${ispConsultations.decisionReco}, 'retentionDate', ${new Date().toISOString()})`,
    })
    .where(sql`${ispConsultations.createdAt} < ${cutoffDate} AND ${ispConsultations.cpfCnpj} != 'ANONIMIZADO'`)
    .returning({ id: ispConsultations.id });

  // Anonymize SPC consultations
  const spcResult = await db.update(spcConsultations)
    .set({
      cpfCnpj: "ANONIMIZADO",
      result: sql`jsonb_build_object('anonimizado', true, 'retentionDate', ${new Date().toISOString()})`,
    })
    .where(sql`${spcConsultations.createdAt} < ${cutoffDate} AND ${spcConsultations.cpfCnpj} != 'ANONIMIZADO'`)
    .returning({ id: spcConsultations.id });

  return ispResult.length + spcResult.length;
}

let retentionInterval: ReturnType<typeof setInterval> | null = null;

export function startRetentionScheduler() {
  // Run once on startup (delayed 30s to not block boot)
  setTimeout(async () => {
    try {
      const count = await anonymizeOldConsultations();
      if (count > 0) {
        logger.info({ count }, "[LGPD-RETENTION] Anonymized old consultations");
      }
    } catch (err) {
      logger.error({ err }, "[LGPD-RETENTION] Error during anonymization");
    }
  }, 30_000);

  // Then run every 24h
  retentionInterval = setInterval(async () => {
    try {
      const count = await anonymizeOldConsultations();
      if (count > 0) {
        logger.info({ count }, "[LGPD-RETENTION] Anonymized old consultations");
      }
    } catch (err) {
      logger.error({ err }, "[LGPD-RETENTION] Error during anonymization");
    }
  }, RETENTION_CHECK_INTERVAL_MS);

  retentionInterval.unref();
  logger.info("[LGPD-RETENTION] Scheduler started (check every 24h, retention: 5 years)");
}
