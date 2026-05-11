/**
 * Spec 004 — Action types Bruno / Sofia para audit_logs.
 *
 * Cada action carrega seu `legalBasis` + `legalReferences` default.
 * Use `auditAction(name)` para obter o template e mergear com payload específico.
 *
 * Centraliza para evitar typos e divergência semântica entre rastros do mesmo evento.
 */

import { LEGAL_BASES, LEGAL_REFS, type LegalBasis, type LegalRef } from "./legal-references";

export interface AuditActionTemplate {
  action: string;
  legalBasis: LegalBasis;
  legalReferences: LegalRef[];
  /** Resource padrão (geralmente "customer"). */
  resource: string;
}

/** Bruno (preventivo) — ações outbound antes do vencimento. */
export const BRUNO_AUDIT_ACTIONS = {
  // Pix dinâmico gerado/recuperado pelo agente.
  bruno_generate_pix: {
    action: "bruno_generate_pix",
    legalBasis: LEGAL_BASES.EXECUCAO_CONTRATO,
    legalReferences: [LEGAL_REFS.CDC_71],
    resource: "customer",
  },
  // Template enviado com sucesso ao cliente via Meta.
  bruno_send_message: {
    action: "bruno_send_message",
    legalBasis: LEGAL_BASES.EXECUCAO_CONTRATO,
    legalReferences: [LEGAL_REFS.CDC_71, LEGAL_REFS.LGPD_7],
    resource: "customer",
  },
  // Cliente em opt-out de WhatsApp; envio bloqueado.
  bruno_skipped_optout: {
    action: "bruno_skipped_optout",
    legalBasis: LEGAL_BASES.CONSENTIMENTO,
    legalReferences: [LEGAL_REFS.LGPD_7],
    resource: "customer",
  },
  // Fora da janela horária do tenant; reagendado.
  bruno_skipped_window: {
    action: "bruno_skipped_window",
    legalBasis: LEGAL_BASES.EXECUCAO_CONTRATO,
    legalReferences: [LEGAL_REFS.ANATEL_765, LEGAL_REFS.CDC_71],
    resource: "customer",
  },
  // Fatura já paga; não envia nada.
  bruno_skipped_paid: {
    action: "bruno_skipped_paid",
    legalBasis: LEGAL_BASES.EXECUCAO_CONTRATO,
    legalReferences: [LEGAL_REFS.CDC_71],
    resource: "customer",
  },
  // Falha no envio (Meta, Asaas, LLM).
  bruno_failed_send: {
    action: "bruno_failed_send",
    legalBasis: LEGAL_BASES.EXECUCAO_CONTRATO,
    legalReferences: [LEGAL_REFS.CDC_71],
    resource: "customer",
  },
} as const satisfies Record<string, AuditActionTemplate>;

/** Sofia (agradecimento) — Spec 004 Phase 4. */
export const SOFIA_AUDIT_ACTIONS = {
  sofia_send_thanks: {
    action: "sofia_send_thanks",
    legalBasis: LEGAL_BASES.EXECUCAO_CONTRATO,
    legalReferences: [LEGAL_REFS.CDC_71],
    resource: "customer",
  },
  sofia_skipped_optout: {
    action: "sofia_skipped_optout",
    legalBasis: LEGAL_BASES.CONSENTIMENTO,
    legalReferences: [LEGAL_REFS.LGPD_7],
    resource: "customer",
  },
  sofia_skipped_window: {
    action: "sofia_skipped_window",
    legalBasis: LEGAL_BASES.EXECUCAO_CONTRATO,
    legalReferences: [LEGAL_REFS.ANATEL_765, LEGAL_REFS.CDC_71],
    resource: "customer",
  },
  sofia_blocked_julia: {
    action: "sofia_blocked_julia",
    legalBasis: LEGAL_BASES.EXECUCAO_CONTRATO,
    legalReferences: [LEGAL_REFS.CDC_71],
    resource: "customer",
  },
} as const satisfies Record<string, AuditActionTemplate>;

/** Webhook Asaas — eventos infraestruturais. */
export const WEBHOOK_AUDIT_ACTIONS = {
  webhook_processed: {
    action: "webhook_processed",
    legalBasis: LEGAL_BASES.EXECUCAO_CONTRATO,
    legalReferences: [LEGAL_REFS.LGPD_7],
    resource: "provider",
  },
  webhook_duplicate: {
    action: "webhook_duplicate",
    legalBasis: LEGAL_BASES.EXECUCAO_CONTRATO,
    legalReferences: [LEGAL_REFS.LGPD_7],
    resource: "provider",
  },
  webhook_auth_failed: {
    action: "webhook_auth_failed",
    legalBasis: LEGAL_BASES.CUMPRIMENTO_LEGAL,
    legalReferences: [LEGAL_REFS.LGPD_7],
    resource: "provider",
  },
} as const satisfies Record<string, AuditActionTemplate>;

/** Retry/escalonamento operacional. */
export const OUTBOUND_RETRY_AUDIT_ACTIONS = {
  outbound_needs_review: {
    action: "outbound_needs_review",
    legalBasis: LEGAL_BASES.EXECUCAO_CONTRATO,
    legalReferences: [LEGAL_REFS.CDC_71],
    resource: "customer",
  },
} as const satisfies Record<string, AuditActionTemplate>;

export type BrunoAuditAction = keyof typeof BRUNO_AUDIT_ACTIONS;
export type SofiaAuditAction = keyof typeof SOFIA_AUDIT_ACTIONS;
export type WebhookAuditAction = keyof typeof WEBHOOK_AUDIT_ACTIONS;
export type OutboundRetryAuditAction = keyof typeof OUTBOUND_RETRY_AUDIT_ACTIONS;

export type Spec004AuditAction =
  | BrunoAuditAction
  | SofiaAuditAction
  | WebhookAuditAction
  | OutboundRetryAuditAction;

const ALL_ACTIONS: Record<string, AuditActionTemplate> = {
  ...BRUNO_AUDIT_ACTIONS,
  ...SOFIA_AUDIT_ACTIONS,
  ...WEBHOOK_AUDIT_ACTIONS,
  ...OUTBOUND_RETRY_AUDIT_ACTIONS,
};

/**
 * Retorna template para uso direto em `auditStorage.registrarAcao(providerId, { ...template, resourceId, actorType, actorId, payload })`.
 *
 * Exemplo:
 *   const tpl = auditAction("bruno_send_message");
 *   await audit.registrarAcao(providerId, {
 *     ...tpl,
 *     resourceId: String(customerId),
 *     actorType: "agent",
 *     actorId: BRUNO_AGENT_ID,
 *     actorName: "Bruno",
 *     payload: { ... },
 *   });
 */
export function auditAction(name: Spec004AuditAction): AuditActionTemplate {
  const tpl = ALL_ACTIONS[name];
  if (!tpl) throw new Error(`Action desconhecida: ${name}`);
  return tpl;
}
