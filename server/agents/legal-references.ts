/**
 * Legal references shared by Júlia (Compliance) and downstream auditing.
 * Source-of-truth for legalBasis / legalReferences fields in audit_logs and
 * compliance_checks.
 */

export const LEGAL_BASES = {
  EXECUCAO_CONTRATO: "Execução de contrato (LGPD art. 7º V)",
  LEGITIMO_INTERESSE: "Legítimo interesse (LGPD art. 7º IX)",
  CONSENTIMENTO: "Consentimento (LGPD art. 7º I)",
  CUMPRIMENTO_LEGAL: "Cumprimento legal (LGPD art. 7º II)",
} as const;

/** Dias mínimos entre cada estágio do timeline Anatel 765/2023. */
export const ANATEL_TIMELINE = {
  SUSPENSAO_PARCIAL: 15,
  SUSPENSAO_TOTAL: 30,
  RESCISAO: 60,
} as const;

export const CDC_ART_71 = "CDC art. 71 - cobrança sem constrangimento";

export const LEGAL_REFS = {
  ANATEL_765: "Anatel Resolução 765/2023",
  CDC_42: "CDC art. 42 - cobrança vexatória",
  CDC_43: "CDC art. 43 - cadastros e SCPC",
  CDC_43_2: "CDC art. 43 §2 - notificação pré-negativação",
  CDC_71: CDC_ART_71,
  LGPD_7: "LGPD art. 7º - bases legais",
  LEI_14181: "Lei 14.181/2021 - superendividamento",
  SUMULA_385_STJ: "Súmula 385 STJ - negativação preexistente",
} as const;

export type LegalBasis = (typeof LEGAL_BASES)[keyof typeof LEGAL_BASES];
export type LegalRef = (typeof LEGAL_REFS)[keyof typeof LEGAL_REFS];
