/**
 * E-mails transacionais.
 *
 * ── WHITE LABEL ────────────────────────────────────────────────────────────
 * Todo e-mail sai com a marca de quem o cliente contratou. Um alerta de fraude
 * que chega assinado "Consulta ISP" para quem comprou da "CredNet" entrega o
 * revendedor — e e o unico canal do sistema que sai do navegador e vai parar na
 * caixa de entrada, onde nao ha CSS nem host para consertar depois.
 *
 * Toda funcao aceita uma `marca` opcional. Sem ela, e a plataforma — o que
 * mantem compativel quem ainda nao passa o parametro.
 *
 * LIMITE HONESTO DO REMETENTE: o endereco do envelope depende de o dominio
 * estar verificado no Resend. Enquanto o revendedor nao verificar o dele, o
 * e-mail sai do dominio da plataforma com o NOME de exibicao da marca — e isso
 * aparece no cabecalho para quem recebe. O campo `emailRemetente` existe para
 * quando ele verificar.
 */
import { Resend } from "resend";
import { MARCA_PLATAFORMA, urlDaMarca, type MarcaResolvida } from "./marca.service";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM_EMAIL = process.env.EMAIL_FROM || "onboarding@resend.dev";

// ── Paleta ───────────────────────────────────────────────────────────────────
// Os fixos vem de client/src/index.css. Antes daqui saia a paleta terracota
// (#C96442) do design v3.0, que foi abandonado — o e-mail chegava com a cara de
// um sistema que nao existe mais, sob um comentario dizendo "match index.css".
const INK = "#1F1D29";
const MUTED = "#6B6878";
const BG = "#F6F6F9";
const SURFACE = "#FFFFFF";
const BORDER = "#EAEAF0";
const GOLD = "#A9741B";
const GOLD_BG = "#FBF1DF";
const DANGER = "#B3261E";
const DANGER_BG = "#FBE7E5";
const INFO_BG = "#E9EFF5";

/** A cor de acento e o texto sobre ela, para esta marca. */
function acento(marca: MarcaResolvida): { brand: string; hover: string; sobre: string; suave: string } {
  const c = marca.cores?.claro;
  return {
    brand: c?.brand ?? "#4A4670",
    hover: c?.hover ?? "#3C3860",
    sobre: c?.textOnBrand ?? "#FFFFFF",
    suave: c?.soft ?? "#EDECF3",
  };
}

/** Escapa o que vem de cadastro antes de entrar no HTML do e-mail. */
function esc(v: string | null | undefined): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── Template ─────────────────────────────────────────────────────────────────
function emailTemplate(content: string, preheader: string | undefined, marca: MarcaResolvida): string {
  const cor = acento(marca);
  const nome = esc(marca.nomeProduto);
  const url = urlDaMarca(marca);
  const inicial = esc(marca.nomeProduto.trim().charAt(0).toUpperCase() || "C");
  const assinatura = esc(marca.assinatura || "Analise de credito para provedores de internet");
  // Cliente de e-mail costuma bloquear imagem; o quadrado com a inicial e a
  // versao que sempre aparece, e o logo entra por cima quando carrega.
  const logo = marca.logoUrl
    ? `<img src="${esc(url)}${esc(marca.logoUrl)}" alt="${nome}" height="32" style="height:32px;width:auto;display:block;border:0;" />`
    : `<div style="width:32px;height:32px;background:rgba(255,255,255,0.2);border-radius:6px;text-align:center;line-height:32px;">
         <span style="color:${cor.sobre};font-size:16px;font-weight:800;">${inicial}</span>
       </div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${nome}</title>
  ${preheader ? `<span style="display:none;max-height:0;overflow:hidden;">${esc(preheader)}</span>` : ""}
</head>
<body style="margin:0;padding:0;background-color:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:${SURFACE};border-radius:8px;overflow:hidden;border:1px solid ${BORDER};">

          <!-- Header -->
          <tr>
            <td style="background:${cor.brand};padding:28px 36px;">
              <table cellpadding="0" cellspacing="0"><tr>
                <td style="vertical-align:middle;">${logo}</td>
                <td style="padding-left:12px;">
                  <span style="color:${cor.sobre};font-size:18px;font-weight:700;letter-spacing:-0.3px;">${nome}</span>
                  <br/><span style="color:${cor.sobre};opacity:0.75;font-size:11px;letter-spacing:0.5px;">${assinatura.toUpperCase()}</span>
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
                ${nome} &mdash; ${assinatura}<br/>
                <a href="${esc(url)}" style="color:${cor.brand};text-decoration:none;">${esc(url.replace(/^https?:\/\//, ""))}</a>
                ${marca.suporteEmail ? `<br/>Suporte: <a href="mailto:${esc(marca.suporteEmail)}" style="color:${cor.brand};text-decoration:none;">${esc(marca.suporteEmail)}</a>` : ""}
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

function btnPrimary(href: string, text: string, marca: MarcaResolvida): string {
  const cor = acento(marca);
  // `href` carrega o dominio da marca, que e texto de cadastro. Sem escape, uma
  // aspa nele fecha o atributo e o resto vira marcacao dentro do e-mail.
  return `<div style="text-align:center;margin:28px 0;">
    <a href="${esc(href)}" style="display:inline-block;background:${cor.brand};color:${cor.sobre};text-decoration:none;padding:13px 36px;border-radius:6px;font-weight:700;font-size:14px;letter-spacing:0.2px;">
      ${text}
    </a>
  </div>`;
}

function alertBox(text: string, marca: MarcaResolvida, type: "warning" | "info" | "danger" = "warning"): string {
  const cor = acento(marca);
  const bg = type === "danger" ? DANGER_BG : type === "info" ? INFO_BG : GOLD_BG;
  const border = type === "danger" ? DANGER : type === "info" ? cor.brand : GOLD;
  const texto = type === "danger" ? DANGER : type === "info" ? cor.hover : "#854d0e";
  return `<div style="background:${bg};border:1px solid ${border}30;border-radius:6px;padding:14px 16px;margin-top:20px;">
    <p style="color:${texto};font-size:13px;margin:0;line-height:1.5;">${text}</p>
  </div>`;
}

function linkFallback(url: string, marca: MarcaResolvida): string {
  return `<p style="color:${MUTED};font-size:12px;line-height:1.5;margin:16px 0 0;">
    Se o botao nao funcionar, copie e cole este link:<br/>
    <a href="${esc(url)}" style="color:${acento(marca).brand};font-size:11px;word-break:break-all;">${esc(url)}</a>
  </p>`;
}

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Monta o remetente. Ver o limite honesto no topo do arquivo: sem dominio
 * verificado no Resend, so o NOME de exibicao e da marca.
 */
function remetente(marca: MarcaResolvida): string {
  const endereco = marca.emailRemetente || FROM_EMAIL;
  const nome = marca.emailNomeExibicao || marca.nomeProduto;
  // Aspas e sinais quebrariam o cabecalho; nome de marca nao precisa deles.
  const nomeLimpo = nome.replace(/["<>\r\n]/g, "").trim();
  return nomeLimpo ? `${nomeLimpo} <${endereco}>` : endereco;
}

async function send(to: string, subject: string, html: string, marca: MarcaResolvida): Promise<void> {
  if (!resend) {
    const masked = to.split("@")[0].slice(0, 3) + "***@" + to.split("@")[1];
    console.warn(`[email] RESEND_API_KEY nao configurada. Email para ${masked} nao enviado.`);
    return;
  }
  const { data, error } = await resend.emails.send({ from: remetente(marca), to, subject, html });
  if (error) {
    console.error(`[email] Erro ao enviar para ${to}:`, JSON.stringify(error));
    throw new Error(`Falha ao enviar email: ${error.message || JSON.stringify(error)}`);
  }
  const masked = to.split("@")[0].slice(0, 3) + "***@" + to.split("@")[1];
  console.log(`[email] Email enviado para ${masked}, id: ${data?.id}`);
}

// ── Email Functions ──────────────────────────────────────────────────────────

export async function sendVerificationEmail(
  to: string, name: string, token: string, marca: MarcaResolvida = MARCA_PLATAFORMA,
): Promise<void> {
  const nomeProduto = esc(marca.nomeProduto);
  const verifyUrl = `${urlDaMarca(marca)}/verificar-email?token=${token}`;
  const html = emailTemplate(`
    <h2 style="color:${INK};font-size:20px;font-weight:700;margin:0 0 8px;">Confirme seu email</h2>
    <p style="color:${MUTED};font-size:14px;line-height:1.6;margin:0 0 4px;">
      Ola, <strong style="color:${INK}">${esc(name)}</strong>
    </p>
    <p style="color:${MUTED};font-size:14px;line-height:1.6;margin:0 0 24px;">
      Obrigado por criar sua conta no ${nomeProduto}. Para ativar seu acesso e comecar a proteger seu provedor, confirme seu email:
    </p>
    ${btnPrimary(verifyUrl, "Confirmar Email", marca)}
    ${linkFallback(verifyUrl, marca)}
    ${alertBox(`<strong>Este link expira em 24 horas.</strong> Se voce nao criou uma conta no ${nomeProduto}, ignore este email.`, marca)}
  `, `Confirme seu email para ativar o ${marca.nomeProduto}`, marca);
  await send(to, `Confirme seu cadastro — ${marca.nomeProduto}`, html, marca);
}

export async function sendPasswordResetEmail(
  to: string, name: string, token: string, marca: MarcaResolvida = MARCA_PLATAFORMA,
): Promise<void> {
  const resetUrl = `${urlDaMarca(marca)}/login?reset=${token}`;
  const html = emailTemplate(`
    <h2 style="color:${INK};font-size:20px;font-weight:700;margin:0 0 8px;">Redefinir senha</h2>
    <p style="color:${MUTED};font-size:14px;line-height:1.6;margin:0 0 4px;">
      Ola, <strong style="color:${INK}">${esc(name)}</strong>
    </p>
    <p style="color:${MUTED};font-size:14px;line-height:1.6;margin:0 0 24px;">
      Recebemos uma solicitacao para redefinir sua senha. Clique no botao abaixo para criar uma nova:
    </p>
    ${btnPrimary(resetUrl, "Redefinir Senha", marca)}
    ${linkFallback(resetUrl, marca)}
    ${alertBox("<strong>Este link expira em 1 hora.</strong> Se voce nao solicitou a redefinicao, ignore este email.", marca)}
  `, `Redefina sua senha no ${marca.nomeProduto}`, marca);
  await send(to, `Redefinicao de senha — ${marca.nomeProduto}`, html, marca);
}

export async function sendProactiveAlertEmail(
  to: string,
  providerName: string,
  maskedCpf: string,
  maskedCustomerName: string,
  marca: MarcaResolvida = MARCA_PLATAFORMA,
): Promise<void> {
  const html = emailTemplate(`
    <div style="background:${GOLD_BG};border:1px solid ${GOLD}30;border-radius:6px;padding:16px;margin:0 0 20px;">
      <p style="color:${GOLD};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">
        Alerta Anti-Fraude
      </p>
      <p style="color:${INK};font-size:14px;margin:0;line-height:1.6;">
        Seu cliente <strong>${esc(maskedCustomerName)}</strong> (CPF: ${esc(maskedCpf)}) foi consultado por <strong>outro provedor</strong> da rede.
      </p>
    </div>
    <p style="color:${MUTED};font-size:14px;line-height:1.6;margin:0 0 8px;">
      Ola, <strong style="color:${INK}">${esc(providerName)}</strong>
    </p>
    <p style="color:${MUTED};font-size:14px;line-height:1.6;margin:0 0 24px;">
      Isso pode indicar uma possivel migracao. Recomendamos entrar em contato com o cliente para entender a situacao e, se necessario, negociar a retencao.
    </p>
    ${btnPrimary(urlDaMarca(marca), "Acessar Painel", marca)}
    <p style="color:${MUTED};font-size:12px;margin:20px 0 0;line-height:1.5;">
      A identidade do provedor que realizou a consulta e mantida em sigilo. Voce pode configurar suas preferencias de alerta no painel do provedor.
    </p>
  `, "Alerta: seu cliente foi consultado por outro provedor", marca);
  await send(to, `Alerta: cliente consultado por outro provedor — ${marca.nomeProduto}`, html, marca);
}
