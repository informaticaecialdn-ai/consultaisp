import type { RealtimeQueryResult } from "./realtime-query.service";
import type { InsertAntiFraudAlert } from "@shared/schema";
import { logger } from "../logger.js";

export interface MigratorDetectionInput {
  cpfCnpj: string;
  consultingProviderId: number;
  consultingProviderName: string;
  erpResults: RealtimeQueryResult[];
  recentConsultationsByDistinctProviders: number;
}

export interface MigratorAlert {
  detected: true;
  severity: "high" | "critical";
  message: string;
  riskFactors: string[];
  cancelledAt: {
    providerName: string;
    daysOverdue: number;
    overdueAmount: number;
  };
  consultingProvider: { id: number; name: string };
  recentConsultations: number;
  alertRecord: InsertAntiFraudAlert;
}

const CANCELLED_STATUSES = ["cancelado", "cancelled", "desativado", "inativo", "desconectado"];

/** Materiality thresholds — ignore trivial/recent overdue amounts to reduce false positives */
const MIN_OVERDUE_AMOUNT = 50;  // R$ minimum to consider as material debt
const MIN_OVERDUE_DAYS = 15;    // minimum days overdue to consider as intentional non-payment

function isCancelledStatus(status?: string): boolean {
  if (!status) return false;
  const lower = status.toLowerCase();
  return CANCELLED_STATUSES.some(s => lower.includes(s));
}

function isRecentCancellation(registrationDate?: string): boolean {
  if (!registrationDate) return true; // If no date, assume recent (conservative)
  const regDate = new Date(registrationDate);
  if (isNaN(regDate.getTime())) return true;
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  return regDate >= ninetyDaysAgo;
}

export function buildMigratorAlertRecord(
  input: MigratorDetectionInput,
  cancelledProvider: { providerId: number; providerName: string; daysOverdue: number; overdueAmount: number },
  severity: "high" | "critical",
  riskFactors: string[],
  message: string,
): InsertAntiFraudAlert {
  return {
    providerId: cancelledProvider.providerId,
    consultingProviderId: input.consultingProviderId,
    consultingProviderName: input.consultingProviderName,
    customerName: null,
    customerCpfCnpj: input.cpfCnpj,
    type: "migrador_serial",
    severity,
    message,
    riskScore: severity === "critical" ? 90 : 70,
    riskLevel: severity === "critical" ? "critico" : "alto",
    riskFactors,
    daysOverdue: cancelledProvider.daysOverdue,
    overdueAmount: String(cancelledProvider.overdueAmount),
    recentConsultations: input.recentConsultationsByDistinctProviders,
    resolved: false,
    status: "new",
  };
}

export function detectMigrator(input: MigratorDetectionInput): MigratorAlert | null {
  const { cpfCnpj, consultingProviderId, erpResults, recentConsultationsByDistinctProviders } = input;
  const cleanCpf = cpfCnpj.replace(/\D/g, "");

  // Find cancelled/delinquent records at OTHER providers
  let cancelledRecord: {
    providerId: number;
    providerName: string;
    daysOverdue: number;
    overdueAmount: number;
    registrationDate?: string;
  } | null = null;

  let hasActiveDebt = false;

  for (const erp of erpResults) {
    if (!erp.ok || erp.providerId === consultingProviderId) continue;

    for (const c of erp.customers) {
      if (c.cpfCnpj.replace(/\D/g, "") !== cleanCpf) continue;

      // Check for active debt anywhere — apply materiality threshold to avoid false positives
      if (c.totalOverdueAmount >= MIN_OVERDUE_AMOUNT && c.maxDaysOverdue >= MIN_OVERDUE_DAYS) {
        hasActiveDebt = true;
      } else if (c.totalOverdueAmount > 0) {
        logger.debug(
          { cpfCnpj: cleanCpf.slice(0, 4) + "***", amount: c.totalOverdueAmount, days: c.maxDaysOverdue },
          "MIGRADOR filtered by materiality threshold"
        );
      }

      // Check for cancelled/long-overdue contract
      const isCancelled = isCancelledStatus(c.status) || c.maxDaysOverdue > 90;
      if (isCancelled && isRecentCancellation(c.registrationDate)) {
        if (!cancelledRecord || c.totalOverdueAmount > cancelledRecord.overdueAmount) {
          cancelledRecord = {
            providerId: erp.providerId,
            providerName: erp.providerName,
            daysOverdue: c.maxDaysOverdue,
            overdueAmount: c.totalOverdueAmount,
            registrationDate: c.registrationDate,
          };
        }
      }
    }
  }

  // All three conditions must be true
  if (!cancelledRecord || !hasActiveDebt) return null;

  // Build alert
  const severity: "high" | "critical" = recentConsultationsByDistinctProviders >= 3 ? "critical" : "high";

  const riskFactors: string[] = [
    "contrato_cancelado_recente",
    "divida_ativa",
    "consulta_outro_provedor",
  ];
  if (recentConsultationsByDistinctProviders >= 3) {
    riskFactors.push("multiplas_consultas");
  }

  const message = `MIGRADOR SERIAL: CPF com contrato cancelado em ${cancelledRecord.providerName}, divida ativa de R$ ${cancelledRecord.overdueAmount.toFixed(2)}, e ${recentConsultationsByDistinctProviders} consultas recentes por provedores diferentes`;

  const alertRecord = buildMigratorAlertRecord(
    input,
    cancelledRecord,
    severity,
    riskFactors,
    message,
  );

  return {
    detected: true,
    severity,
    message,
    riskFactors,
    cancelledAt: {
      providerName: cancelledRecord.providerName,
      daysOverdue: cancelledRecord.daysOverdue,
      overdueAmount: cancelledRecord.overdueAmount,
    },
    consultingProvider: { id: input.consultingProviderId, name: input.consultingProviderName },
    recentConsultations: recentConsultationsByDistinctProviders,
    alertRecord,
  };
}
