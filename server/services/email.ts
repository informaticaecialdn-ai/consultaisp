import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM_EMAIL = process.env.EMAIL_FROM || "onboarding@resend.dev";

function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  return `http://localhost:5000`;
}

const APP_URL = getAppUrl();

export async function sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
  const verifyUrl = `${APP_URL}/verificar-email?token=${token}`;

  const maskedTo = to.split("@")[0].slice(0, 3) + "***@" + to.split("@")[1];
  console.log(`[email] Enviando email de verificacao para ${maskedTo} via ${FROM_EMAIL}`);

  if (!resend) {
    console.warn(`[email] RESEND_API_KEY nao configurada. Email para ${to} nao enviado.`);
    return;
  }

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: "Confirme seu cadastro no Consulta ISP",
    html: `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confirme seu email</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6fa;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#2563eb,#4f46e5);padding:36px 40px;text-align:center;">
              <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:8px;">
                <span style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Consulta ISP</span>
              </div>
              <p style="color:#bfdbfe;margin:0;font-size:13px;">Plataforma de Analise de Credito para Provedores</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="color:#1e293b;font-size:20px;font-weight:700;margin:0 0 8px;">Confirme seu email, ${name}</h2>
              <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 28px;">
                Obrigado por criar sua conta no Consulta ISP. Para ativar seu acesso e comecar a consultar a base colaborativa de inadimplentes, confirme seu endereco de email clicando no botao abaixo.
              </p>

              <div style="text-align:center;margin:0 0 28px;">
                <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#4f46e5);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:600;font-size:15px;letter-spacing:0.2px;">
                  Confirmar Email
                </a>
              </div>

              <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0 0 16px;">
                Se o botao nao funcionar, copie e cole este link no seu navegador:
              </p>
              <div style="background:#f1f5f9;border-radius:6px;padding:12px 16px;word-break:break-all;">
                <a href="${verifyUrl}" style="color:#2563eb;font-size:12px;text-decoration:none;">${verifyUrl}</a>
              </div>

              <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0;" />

              <div style="background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:14px 16px;">
                <p style="color:#854d0e;font-size:13px;margin:0;line-height:1.5;">
                  <strong>Este link expira em 24 horas.</strong> Se voce nao criou uma conta no Consulta ISP, ignore este email com seguranca.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="color:#94a3b8;font-size:12px;margin:0;">
                Consulta ISP &mdash; Sistema de Analise de Credito para Provedores de Internet
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
  });

  if (error) {
    console.error(`[email] Erro ao enviar para ${to}:`, JSON.stringify(error));
    throw new Error(`Falha ao enviar email: ${error.message || JSON.stringify(error)}`);
  }

  console.log(`[email] Email enviado com sucesso para ${to}, id: ${data?.id}`);
}

export async function sendPasswordResetEmail(to: string, name: string, token: string): Promise<void> {
  const resetUrl = `${APP_URL}/login?reset=${token}`;
  const maskedTo = to.split("@")[0].slice(0, 3) + "***@" + to.split("@")[1];
  console.log(`[email] Enviando email de reset de senha para ${maskedTo}`);

  if (!resend) {
    console.warn(`[email] RESEND_API_KEY nao configurada. Email de reset para ${maskedTo} nao enviado.`);
    return;
  }

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: "Redefinicao de senha — Consulta ISP",
    html: `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:#1e3a5f;padding:24px 40px;">
          <h1 style="color:#ffffff;font-size:20px;margin:0;">Consulta ISP</h1>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="color:#0f172a;font-size:16px;margin:0 0 8px;">Ola, <strong>${name}</strong></p>
          <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 24px;">
            Recebemos uma solicitacao para redefinir sua senha. Clique no botao abaixo para criar uma nova senha:
          </p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${resetUrl}" style="display:inline-block;background:#1e3a5f;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:bold;font-size:14px;">
              Redefinir Senha
            </a>
          </div>
          <div style="background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:14px 16px;margin-top:24px;">
            <p style="color:#854d0e;font-size:13px;margin:0;line-height:1.5;">
              <strong>Este link expira em 1 hora.</strong> Se voce nao solicitou a redefinicao, ignore este email.
            </p>
          </div>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
          <p style="color:#94a3b8;font-size:12px;margin:0;">Consulta ISP &mdash; Sistema de Analise de Credito para Provedores</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
    `.trim(),
  });

  if (error) {
    console.error(`[email] Erro ao enviar reset para ${to}:`, JSON.stringify(error));
    throw new Error(`Falha ao enviar email: ${error.message || JSON.stringify(error)}`);
  }
  console.log(`[email] Email de reset enviado para ${to}, id: ${data?.id}`);
}

export async function sendProactiveAlertEmail(
  to: string,
  providerName: string,
  maskedCpf: string,
  maskedCustomerName: string,
): Promise<void> {
  const maskedTo = to.split("@")[0].slice(0, 3) + "***@" + to.split("@")[1];
  console.log(`[email] Enviando alerta proativo para ${maskedTo}`);

  if (!resend) {
    console.warn(`[email] RESEND_API_KEY nao configurada. Alerta proativo para ${maskedTo} nao enviado.`);
    return;
  }

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: "\u26a0\ufe0f Alerta: Seu cliente foi consultado por outro provedor",
    html: `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Alerta Proativo</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6fa;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:36px 40px;text-align:center;">
              <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:8px;">
                <span style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Consulta ISP</span>
              </div>
              <p style="color:#fef3c7;margin:0;font-size:13px;">Alerta de Migracao Potencial</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="color:#1e293b;font-size:20px;font-weight:700;margin:0 0 8px;">Atencao, ${providerName}</h2>
              <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 20px;">
                Identificamos que seu cliente foi consultado por <strong>outro provedor da rede ISP</strong>.
                Isso pode indicar uma possivel migracao.
              </p>

              <div style="background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:16px;margin:0 0 24px;">
                <p style="color:#854d0e;font-size:14px;margin:0;line-height:1.6;">
                  <strong>Cliente:</strong> ${maskedCustomerName}<br/>
                  <strong>CPF:</strong> ${maskedCpf}
                </p>
              </div>

              <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 28px;">
                Recomendamos entrar em contato com o cliente para entender a situacao e,
                se necessario, oferecer condicoes para retencao.
              </p>

              <div style="text-align:center;margin:0 0 28px;">
                <a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:600;font-size:15px;letter-spacing:0.2px;">
                  Acessar Consulta ISP
                </a>
              </div>

              <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0;" />

              <p style="color:#94a3b8;font-size:12px;margin:0;line-height:1.5;">
                Este alerta foi gerado automaticamente pelo sistema Consulta ISP.
                A identidade do provedor que realizou a consulta e mantida em sigilo.
                Voce pode configurar suas preferencias de alerta no painel do provedor.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="color:#94a3b8;font-size:12px;margin:0;">
                Consulta ISP &mdash; Sistema de Analise de Credito para Provedores de Internet
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
  });

  if (error) {
    console.error(`[email] Erro ao enviar alerta proativo para ${to}:`, JSON.stringify(error));
    throw new Error(`Falha ao enviar email de alerta: ${error.message || JSON.stringify(error)}`);
  }

  console.log(`[email] Alerta proativo enviado para ${to}, id: ${data?.id}`);
}
