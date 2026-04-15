import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM_EMAIL = process.env.EMAIL_FROM || "onboarding@resend.dev";

function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  return `http://localhost:5000`;
}

const APP_URL = getAppUrl();

// ── Design System Colors (match index.css) ──────────────────────────────────
const BRAND = "#C96442";     // Terracotta — primary brand
const BRAND_DARK = "#A84E30"; // Darker terracotta for hover
const INK = "#141413";        // Near-black text
const MUTED = "#5E5D59";      // Olive gray secondary text
const GOLD = "#B8860B";       // Warning gold
const GOLD_BG = "#F5EDD4";    // Warning background
const DANGER = "#B53333";     // Error red
const SUCCESS = "#4A6B3E";    // Success green
const BG = "#FAF9F5";         // Warm ivory background
const SURFACE = "#FFFFFF";    // Card surface
const BORDER = "#E8E5DE";     // Warm border

// ── Shared Email Template ────────────────────────────────────────────────────
function emailTemplate(content: string, preheader?: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Consulta ISP</title>
  ${preheader ? `<span style="display:none;max-height:0;overflow:hidden;">${preheader}</span>` : ""}
</head>
<body style="margin:0;padding:0;background-color:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:${SURFACE};border-radius:8px;overflow:hidden;border:1px solid ${BORDER};">

          <!-- Header -->
          <tr>
            <td style="background:${BRAND};padding:28px 36px;">
              <table cellpadding="0" cellspacing="0"><tr>
                <td style="width:32px;height:32px;background:rgba(255,255,255,0.2);border-radius:6px;text-align:center;vertical-align:middle;">
                  <span style="color:#fff;font-size:16px;font-weight:800;">C</span>
                </td>
                <td style="padding-left:12px;">
                  <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Consulta ISP</span>
                  <br/><span style="color:rgba(255,255,255,0.7);font-size:11px;letter-spacing:0.5px;">ANALISE DE CREDITO PARA PROVEDORES</span>
                </td>
              </tr></table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:32px 36px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${BG};padding:20px 36px;border-top:1px solid ${BORDER};">
              <p style="color:${MUTED};font-size:11px;margin:0;text-align:center;line-height:1.5;">
                Consulta ISP &mdash; Plataforma de Analise de Credito para Provedores de Internet<br/>
                <a href="${APP_URL}" style="color:${BRAND};text-decoration:none;">consultaisp.com.br</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function btnPrimary(href: string, text: string): string {
  return `<div style="text-align:center;margin:28px 0;">
    <a href="${href}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:13px 36px;border-radius:6px;font-weight:700;font-size:14px;letter-spacing:0.2px;">
      ${text}
    </a>
  </div>`;
}

function alertBox(text: string, type: "warning" | "info" | "danger" = "warning"): string {
  const bg = type === "danger" ? "#F8E7E1" : type === "info" ? "#FBEFE8" : GOLD_BG;
  const border = type === "danger" ? DANGER : type === "info" ? BRAND : GOLD;
  const color = type === "danger" ? DANGER : type === "info" ? BRAND_DARK : "#854d0e";
  return `<div style="background:${bg};border:1px solid ${border}30;border-radius:6px;padding:14px 16px;margin-top:20px;">
    <p style="color:${color};font-size:13px;margin:0;line-height:1.5;">${text}</p>
  </div>`;
}

function linkFallback(url: string): string {
  return `<p style="color:${MUTED};font-size:12px;line-height:1.5;margin:16px 0 0;">
    Se o botao nao funcionar, copie e cole este link:<br/>
    <a href="${url}" style="color:${BRAND};font-size:11px;word-break:break-all;">${url}</a>
  </p>`;
}

// ── Helper ────────────────────────────────────────────────────────────────────
async function send(to: string, subject: string, html: string): Promise<void> {
  if (!resend) {
    const masked = to.split("@")[0].slice(0, 3) + "***@" + to.split("@")[1];
    console.warn(`[email] RESEND_API_KEY nao configurada. Email para ${masked} nao enviado.`);
    return;
  }
  const { data, error } = await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
  if (error) {
    console.error(`[email] Erro ao enviar para ${to}:`, JSON.stringify(error));
    throw new Error(`Falha ao enviar email: ${error.message || JSON.stringify(error)}`);
  }
  const masked = to.split("@")[0].slice(0, 3) + "***@" + to.split("@")[1];
  console.log(`[email] Email enviado para ${masked}, id: ${data?.id}`);
}

// ── Email Functions ──────────────────────────────────────────────────────────

export async function sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
  const verifyUrl = `${APP_URL}/verificar-email?token=${token}`;
  const html = emailTemplate(`
    <h2 style="color:${INK};font-size:20px;font-weight:700;margin:0 0 8px;">Confirme seu email</h2>
    <p style="color:${MUTED};font-size:14px;line-height:1.6;margin:0 0 4px;">
      Ola, <strong style="color:${INK}">${name}</strong>
    </p>
    <p style="color:${MUTED};font-size:14px;line-height:1.6;margin:0 0 24px;">
      Obrigado por criar sua conta no Consulta ISP. Para ativar seu acesso e comecar a proteger seu provedor, confirme seu email:
    </p>
    ${btnPrimary(verifyUrl, "Confirmar Email")}
    ${linkFallback(verifyUrl)}
    ${alertBox("<strong>Este link expira em 24 horas.</strong> Se voce nao criou uma conta no Consulta ISP, ignore este email.")}
  `, "Confirme seu email para ativar o Consulta ISP");
  await send(to, "Confirme seu cadastro — Consulta ISP", html);
}

export async function sendPasswordResetEmail(to: string, name: string, token: string): Promise<void> {
  const resetUrl = `${APP_URL}/login?reset=${token}`;
  const html = emailTemplate(`
    <h2 style="color:${INK};font-size:20px;font-weight:700;margin:0 0 8px;">Redefinir senha</h2>
    <p style="color:${MUTED};font-size:14px;line-height:1.6;margin:0 0 4px;">
      Ola, <strong style="color:${INK}">${name}</strong>
    </p>
    <p style="color:${MUTED};font-size:14px;line-height:1.6;margin:0 0 24px;">
      Recebemos uma solicitacao para redefinir sua senha. Clique no botao abaixo para criar uma nova:
    </p>
    ${btnPrimary(resetUrl, "Redefinir Senha")}
    ${linkFallback(resetUrl)}
    ${alertBox("<strong>Este link expira em 1 hora.</strong> Se voce nao solicitou a redefinicao, ignore este email.")}
  `, "Redefina sua senha no Consulta ISP");
  await send(to, "Redefinicao de senha — Consulta ISP", html);
}

export async function sendProactiveAlertEmail(
  to: string,
  providerName: string,
  maskedCpf: string,
  maskedCustomerName: string,
): Promise<void> {
  const html = emailTemplate(`
    <div style="background:${GOLD_BG};border:1px solid ${GOLD}30;border-radius:6px;padding:16px;margin:0 0 20px;">
      <p style="color:${GOLD};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">
        Alerta Anti-Fraude
      </p>
      <p style="color:${INK};font-size:14px;margin:0;line-height:1.6;">
        Seu cliente <strong>${maskedCustomerName}</strong> (CPF: ${maskedCpf}) foi consultado por <strong>outro provedor</strong> da rede.
      </p>
    </div>
    <p style="color:${MUTED};font-size:14px;line-height:1.6;margin:0 0 8px;">
      Ola, <strong style="color:${INK}">${providerName}</strong>
    </p>
    <p style="color:${MUTED};font-size:14px;line-height:1.6;margin:0 0 24px;">
      Isso pode indicar uma possivel migracao. Recomendamos entrar em contato com o cliente para entender a situacao e, se necessario, negociar a retencao.
    </p>
    ${btnPrimary(APP_URL, "Acessar Painel")}
    <p style="color:${MUTED};font-size:12px;margin:20px 0 0;line-height:1.5;">
      A identidade do provedor que realizou a consulta e mantida em sigilo. Voce pode configurar suas preferencias de alerta no painel do provedor.
    </p>
  `, "Alerta: seu cliente foi consultado por outro provedor");
  await send(to, "Alerta: cliente consultado por outro provedor — Consulta ISP", html);
}
