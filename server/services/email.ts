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
