/**
 * Os e-mails que o TITULAR do dado recebe ao exercer um direito da LGPD.
 *
 * Destinatario diferente de todo o resto do modulo: nao e um provedor, e a
 * pessoa cujo CPF passou por aqui. Ela nao tem conta, nao tem painel e talvez
 * nunca tenha ouvido falar do produto — o unico contato dela com o sistema e
 * esta mensagem.
 *
 * ── O que estava errado ────────────────────────────────────────────────────
 *
 * 1. INJECAO. `protocolo`, `tipo` e `resultSummary` entravam no HTML sem
 *    escape. O `resultSummary` e montado a partir do corpo de uma requisicao do
 *    admin (`admin.routes.ts`, PATCH da solicitacao) e o `tipo` vem do
 *    formulario publico. A validacao de hoje na borda fecha o buraco por
 *    acidente, nao por desenho: basta um tipo novo aceito, ou um resumo
 *    montado com texto livre, para a tag voltar. Escape aqui e a barreira que
 *    nao depende de quem chama.
 * 2. OUTRO PRODUTO. O template era um segundo sistema visual — paleta do
 *    Tailwind (#2563eb, #f4f6fa, #1e293b), `box-shadow`, raio de 12px, fonte
 *    'Segoe UI'. Tudo isso e proibido em duas linhas separadas do
 *    DESIGN_SYSTEM, e o titular recebia um e-mail que nao parecia do mesmo
 *    lugar onde ele abriu a solicitacao.
 * 3. REMETENTE SEM MARCA. Saia do `EMAIL_FROM` cru, ignorando a marca que a
 *    propria funcao ja recebia. A tela onde ele abriu a solicitacao diz que o
 *    controlador e o revendedor; o e-mail chegava assinado por outra empresa,
 *    contradizendo exatamente a informacao que a LGPD exige que ele tenha.
 *
 * O TEXTO nao mudou de conteudo: diz o mesmo que dizia, agora acentuado e
 * dentro do envelope do produto. O rodape e o unico ponto em que o envelope
 * precisou de ajuste — o padrao dele fala de "conta de provedor", e o titular
 * nao tem uma.
 */

import { logger } from "../logger";
import { MARCA_PLATAFORMA, type MarcaResolvida } from "./marca.service";
import { enviarEmail } from "./email";
import { alerta, blocoDeDados, envelope, esc, kicker, paragrafo, titulo, DANGER, type LinhaDeDado } from "./email-ui";

const ADMIN_EMAIL = process.env.LGPD_ADMIN_EMAIL || "";

const TIPO_LABELS: Record<string, string> = {
  acesso: "Acesso aos Dados",
  correcao: "Correção de Dados",
  exclusao: "Exclusão de Dados",
  portabilidade: "Portabilidade de Dados",
  revogacao: "Revogação de Consentimento",
};

/** Tipo desconhecido sai como veio — e por isso passa por `esc` em todo uso. */
function tipoLabel(tipo: string): string {
  return TIPO_LABELS[tipo] || String(tipo ?? "");
}

/** Por que esta mensagem chegou. O padrao do envelope fala de provedor. */
const MOTIVO_TITULAR =
  "Você recebeu esta mensagem porque abriu uma solicitação de direitos do titular (LGPD). É um aviso do sistema, não uma oferta.";

/**
 * Envio que registra e nunca propaga.
 *
 * Um e-mail de LGPD que falha nao pode desfazer a solicitacao ja gravada nem
 * derrubar o processamento automatico que o disparou — a mesma regra de
 * `email-destinatario.ts`, aplicada ao outro destinatario.
 */
async function safeSend(to: string, subject: string, html: string, marca: MarcaResolvida): Promise<void> {
  try {
    await enviarEmail(to, subject, html, marca);
  } catch (err) {
    logger.error({ err, to: to.slice(0, 3) + "***" }, "[LGPD-EMAIL] Falha ao enviar email");
  }
}

/** O casco de todo e-mail de LGPD: o envelope do produto, com o rodape certo. */
function corpo(titleTexto: string, conteudo: string, preheader: string, marca: MarcaResolvida): string {
  return envelope(`
    ${kicker("lgpd · direitos do titular")}
    ${titulo(esc(titleTexto))}
    ${conteudo}
  `, preheader, marca, MOTIVO_TITULAR);
}

/**
 * Enviado quando a solicitacao do titular e registrada.
 */
export async function sendConfirmationEmail(
  to: string, protocolo: string, tipo: string, marca: MarcaResolvida = MARCA_PLATAFORMA,
): Promise<void> {
  const html = corpo("Solicitação registrada", `
    ${paragrafo(`Sua solicitação de <strong>${esc(tipoLabel(tipo))}</strong> foi registrada com sucesso.`)}
    ${blocoDeDados([
      { rotulo: "protocolo", valor: esc(protocolo), mono: true },
      { rotulo: "prazo de resposta", valor: "15 dias úteis (LGPD Art. 18, §5º)", mono: true },
    ])}
    ${paragrafo("Você receberá uma notificação por e-mail quando sua solicitação for processada.", 0)}
  `, `Protocolo ${protocolo} registrado — resposta em até 15 dias úteis`, marca);

  await safeSend(to, `Solicitação LGPD registrada — ${protocolo}`, html, marca);
}

/**
 * Enviado quando a solicitacao do titular e concluida.
 *
 * `resultSummary` e o unico campo aqui montado a partir de dado de uma
 * requisicao. Sai escapado.
 */
export async function sendCompletionEmail(
  to: string, protocolo: string, tipo: string, resultSummary: string,
  marca: MarcaResolvida = MARCA_PLATAFORMA,
): Promise<void> {
  const html = corpo("Solicitação concluída", `
    ${paragrafo(`Sua solicitação de <strong>${esc(tipoLabel(tipo))}</strong> foi concluída.`)}
    ${blocoDeDados([
      { rotulo: "protocolo", valor: esc(protocolo), mono: true },
      { rotulo: "resultado", valor: esc(resultSummary) },
    ])}
    ${paragrafo("Caso tenha dúvidas, entre em contato pelo canal de atendimento LGPD.", 0)}
  `, `Protocolo ${protocolo} concluído`, marca);

  await safeSend(to, `Solicitação LGPD concluída — ${protocolo}`, html, marca);
}

/**
 * Enviado ao administrador da PLATAFORMA quando solicitacoes se aproximam do
 * prazo de 15 dias uteis. Aqui o destinatario nao e titular nem provedor: e
 * quem opera o atendimento, e a marca certa e a da casa.
 */
export async function sendSlaAlertEmail(
  requests: Array<{ protocolo: string; nome: string; tipoSolicitacao: string; businessDays: number }>,
): Promise<void> {
  if (!ADMIN_EMAIL) {
    logger.warn("[LGPD-EMAIL] LGPD_ADMIN_EMAIL nao configurado — alerta SLA nao enviado");
    return;
  }

  const linhas: LinhaDeDado[] = requests.map(r => ({
    rotulo: esc(r.protocolo),
    valor: `${esc(tipoLabel(r.tipoSolicitacao))} <span style="color:${DANGER};">· ${esc(String(r.businessDays))}/15 dias úteis</span>`,
    mono: true,
  }));

  const html = envelope(`
    ${kicker("lgpd · prazo", DANGER)}
    ${titulo("Solicitações perto do prazo")}
    ${alerta(`<strong>${requests.length} solicitação(ões) LGPD</strong> estão próximas do prazo limite de 15 dias úteis.`, "perigo")}
    ${blocoDeDados(linhas)}
    ${paragrafo("Acesse o painel administrativo para tratar essas solicitações antes do vencimento.", 0)}
  `,
    `${requests.length} solicitação(ões) LGPD perto do prazo de 15 dias úteis`,
    MARCA_PLATAFORMA,
    "Você recebeu esta mensagem porque é o contato administrativo de LGPD da plataforma.",
  );

  await safeSend(
    ADMIN_EMAIL,
    `ALERTA SLA LGPD — ${requests.length} solicitação(ões) próxima(s) do prazo`,
    html,
    MARCA_PLATAFORMA,
  );
}
