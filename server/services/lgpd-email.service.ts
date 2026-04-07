/**
 * LGPD Email Notification Service
 *
 * Sends transactional emails for LGPD titular data subject requests
 * using Resend. Gracefully degrades if RESEND_API_KEY is not set.
 */

import { Resend } from "resend";
import { logger } from "../logger";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.EMAIL_FROM || "onboarding@resend.dev";
const ADMIN_EMAIL = process.env.LGPD_ADMIN_EMAIL || "";

const TIPO_LABELS: Record<string, string> = {
  acesso: "Acesso aos Dados",
  correcao: "Correcao de Dados",
  exclusao: "Exclusao de Dados",
  portabilidade: "Portabilidade de Dados",
  revogacao: "Revogacao de Consentimento",
};

function tipoLabel(tipo: string): string {
  return TIPO_LABELS[tipo] || tipo;
}

function warnNoResend(): void {
  logger.warn("[LGPD-EMAIL] RESEND_API_KEY nao configurada — email nao enviado");
}

/**
 * Email wrapper that catches errors and logs them without crashing.
 */
async function safeSend(to: string, subject: string, html: string): Promise<void> {
  if (!resend) {
    warnNoResend();
    return;
  }

  try {
    const { error } = await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
    if (error) {
      logger.error({ error, to: to.slice(0, 3) + "***" }, "[LGPD-EMAIL] Erro ao enviar email");
    } else {
      logger.info({ to: to.slice(0, 3) + "***" }, "[LGPD-EMAIL] Email enviado");
    }
  } catch (err) {
    logger.error({ err }, "[LGPD-EMAIL] Falha ao enviar email");
  }
}

function emailTemplate(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f6fa;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
<tr><td style="background:linear-gradient(135deg,#2563eb,#4f46e5);padding:28px 40px;text-align:center;">
  <span style="color:#fff;font-size:22px;font-weight:700;">Consulta ISP</span>
  <p style="color:#bfdbfe;margin:4px 0 0;font-size:12px;">LGPD — Direitos do Titular</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <h2 style="color:#1e293b;font-size:18px;font-weight:700;margin:0 0 16px;">${title}</h2>
  ${body}
</td></tr>
<tr><td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Consulta ISP — Em conformidade com a LGPD (Lei 13.709/2018)</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Sent when a titular request is created.
 */
export async function sendConfirmationEmail(to: string, protocolo: string, tipo: string): Promise<void> {
  const body = `
  <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 20px;">
    Sua solicitacao de <strong>${tipoLabel(tipo)}</strong> foi registrada com sucesso.
  </p>
  <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:0 0 20px;">
    <p style="margin:0 0 6px;color:#475569;font-size:13px;"><strong>Protocolo:</strong> ${protocolo}</p>
    <p style="margin:0;color:#475569;font-size:13px;"><strong>Prazo de resposta:</strong> 15 dias uteis (LGPD Art. 18, §5)</p>
  </div>
  <p style="color:#64748b;font-size:13px;line-height:1.5;margin:0;">
    Voce recebera uma notificacao por email quando sua solicitacao for processada.
  </p>`;

  await safeSend(to, `Solicitacao LGPD registrada — ${protocolo}`, emailTemplate("Solicitacao Registrada", body));
}

/**
 * Sent when a titular request is completed.
 */
export async function sendCompletionEmail(to: string, protocolo: string, tipo: string, resultSummary: string): Promise<void> {
  const body = `
  <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 20px;">
    Sua solicitacao de <strong>${tipoLabel(tipo)}</strong> foi concluida.
  </p>
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:0 0 20px;">
    <p style="margin:0 0 6px;color:#166534;font-size:13px;"><strong>Protocolo:</strong> ${protocolo}</p>
    <p style="margin:0;color:#166534;font-size:13px;"><strong>Resultado:</strong> ${resultSummary}</p>
  </div>
  <p style="color:#64748b;font-size:13px;line-height:1.5;margin:0;">
    Caso tenha duvidas, entre em contato pelo canal de atendimento LGPD.
  </p>`;

  await safeSend(to, `Solicitacao LGPD concluida — ${protocolo}`, emailTemplate("Solicitacao Concluida", body));
}

/**
 * Sent to admin when requests approach the 15 business day SLA deadline.
 */
export async function sendSlaAlertEmail(requests: Array<{ protocolo: string; nome: string; tipoSolicitacao: string; businessDays: number }>): Promise<void> {
  if (!ADMIN_EMAIL) {
    logger.warn("[LGPD-EMAIL] LGPD_ADMIN_EMAIL nao configurado — alerta SLA nao enviado");
    return;
  }

  const rows = requests.map(r =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;">${r.protocolo}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;">${tipoLabel(r.tipoSolicitacao)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#dc2626;font-weight:600;">${r.businessDays}/15 dias</td>
    </tr>`
  ).join("");

  const body = `
  <p style="color:#dc2626;font-size:14px;font-weight:600;margin:0 0 16px;">
    ${requests.length} solicitacao(oes) LGPD estao proximas do prazo limite de 15 dias uteis.
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:0 0 20px;">
    <tr style="background:#f8fafc;">
      <th style="padding:10px 12px;text-align:left;font-size:12px;color:#475569;">Protocolo</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;color:#475569;">Tipo</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;color:#475569;">Dias Uteis</th>
    </tr>
    ${rows}
  </table>
  <p style="color:#64748b;font-size:13px;margin:0;">
    Acesse o painel administrativo para tratar essas solicitacoes antes do vencimento.
  </p>`;

  await safeSend(ADMIN_EMAIL, `ALERTA SLA LGPD — ${requests.length} solicitacao(oes) proximo(s) do prazo`, emailTemplate("Alerta de Prazo LGPD", body));
}
