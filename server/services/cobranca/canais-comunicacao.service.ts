import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "../../db";
import { decryptField, encryptField } from "../../utils/crypto";
import { ConfiguracaoCanaisSchema, MensagemCobrancaSchema, type ConfiguracaoCanais, type MensagemCobranca, type ResumoCanais, type ResultadoComunicacao } from "@shared/cobranca/canais-comunicacao";

const vazio = (): ConfiguracaoCanais => ({ sms: { ativado: false, accountSid: "", remetente: "" }, email: { ativado: false, remetente: "", nomeRemetente: "", responderPara: "" } });
function decifrar(valor?: string): ConfiguracaoCanais {
  return valor ? ConfiguracaoCanaisSchema.parse(JSON.parse(decryptField(valor) || "{}")) : vazio();
}
function resumo(config: ConfiguracaoCanais): ResumoCanais {
  const { authToken, ...sms } = config.sms;
  const { apiKey, webhookSecret, ...email } = config.email;
  return { sms: { ...sms, configurado: Boolean(authToken && sms.accountSid && sms.remetente), recebimentoConfigurado: Boolean(sms.ativado && authToken && sms.accountSid && sms.remetente && sms.webhookUrl) }, email: { ...email, configurado: Boolean(apiKey && email.remetente), recebimentoConfigurado: Boolean(email.ativado && apiKey && email.remetente && email.receivingDomain && webhookSecret) } };
}
async function ler(providerId: number): Promise<ConfiguracaoCanais> {
  if (!Number.isSafeInteger(providerId) || providerId <= 0) throw new Error("Provedor inválido");
  const r = await pool.query<{ config_cifrada: string }>("SELECT config_cifrada FROM cobranca_canais_config WHERE provider_id = $1", [providerId]);
  return decifrar(r.rows[0]?.config_cifrada);
}
export async function obterConfiguracaoCanais(providerId: number): Promise<ResumoCanais> { return resumo(await ler(providerId)); }
/** Apenas serviços internos; nunca devolver credenciais pela API. */
export const obterConfiguracaoCanaisInterna = ler;
export async function listarProvedoresCanais(): Promise<number[]> {
  const r = await pool.query<{ provider_id: number }>("SELECT c.provider_id FROM cobranca_canais_config c JOIN providers p ON p.id = c.provider_id WHERE p.status = 'active' ORDER BY c.provider_id");
  return r.rows.map(r => r.provider_id);
}
export class ErroConfiguracaoCanais extends Error {}
export async function salvarConfiguracaoCanais(providerId: number, entrada: ConfiguracaoCanais): Promise<ResumoCanais> {
  if (!Number.isSafeInteger(providerId) || providerId <= 0) throw new ErroConfiguracaoCanais("Provedor inválido");
  const novo = ConfiguracaoCanaisSchema.parse(entrada);
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    await conn.query("SELECT pg_advisory_xact_lock(74040, $1)", [providerId]);
    const r = await conn.query<{ config_cifrada: string }>("SELECT config_cifrada FROM cobranca_canais_config WHERE provider_id = $1", [providerId]);
    const anterior = decifrar(r.rows[0]?.config_cifrada);
    novo.sms.authToken ||= anterior.sms.authToken;
    novo.email.apiKey ||= anterior.email.apiKey;
    novo.email.webhookSecret ||= anterior.email.webhookSecret;
    if (novo.sms.webhookUrl && new URL(novo.sms.webhookUrl).pathname !== `/api/webhooks/canais/sms/${providerId}`)
      throw new ErroConfiguracaoCanais("A URL de recebimento SMS deve terminar em /api/webhooks/canais/sms/" + providerId);
    const estado = resumo(novo);
    if ((novo.sms.ativado && !estado.sms.configurado) || (novo.email.ativado && !estado.email.configurado))
      throw new ErroConfiguracaoCanais("Preencha as credenciais e o remetente antes de ativar o canal.");
    await conn.query("INSERT INTO cobranca_canais_config (provider_id, config_cifrada) VALUES ($1, $2) ON CONFLICT (provider_id) DO UPDATE SET config_cifrada = EXCLUDED.config_cifrada, updated_at = now()", [providerId, encryptField(JSON.stringify(novo))]);
    await conn.query("COMMIT");
    return estado;
  } catch (e) { await conn.query("ROLLBACK"); throw e; }
  finally { conn.release(); }
}

/** Uma única tentativa. O ledger do chamador reserva idempotencyKey ANTES da chamada,
 * inclusive para SMS: Twilio não documenta idempotência na criação de Message.
 * Timeout/5xx são incertos e NUNCA autorizam reenvio automático. Enviado = aceito,
 * não entregue; entrega depende do operador/caixa postal do destinatário. */
export async function enviarComunicacaoCobranca(providerId: number, entrada: MensagemCobranca, formato?: { html?: string; replyTo?: string; headers?: Record<string, string> }): Promise<ResultadoComunicacao> {
  const validada = MensagemCobrancaSchema.safeParse(entrada);
  if (!validada.success) return { status: "falhou", motivo: "Mensagem ou destinatário inválido para o canal." };
  if (formato?.replyTo && !z.string().email().safeParse(formato.replyTo).success) return { status: "falhou", motivo: "Endereço de resposta inválido." };
  if (formato?.headers && Object.entries(formato.headers).some(([k,v]) => !/^(In-Reply-To|References)$/i.test(k) || /[\r\n]/.test(v) || v.length > 1000)) return { status: "falhou", motivo: "Cabeçalho de resposta inválido." };
  let config: ConfiguracaoCanais;
  try { config = await ler(providerId); }
  catch { return { status: "falhou", motivo: "Configuração do canal indisponível." }; }
  const msg = validada.data;
  const canal = resumo(config)[msg.canal];
  if (!canal.ativado || !canal.configurado) return { status: "falhou", motivo: "Canal não configurado ou desativado." };
  const sinal = AbortSignal.timeout(15000);
  try {
    let resposta: Response;
    if (msg.canal === "email") {
      const c = config.email;
      resposta = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: sinal, redirect: "error",
        headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `cobranca-${providerId}-${createHash("sha256").update(msg.idempotencyKey).digest("hex")}` },
        body: JSON.stringify({ from: c.nomeRemetente ? `${c.nomeRemetente} <${c.remetente}>` : c.remetente, to: [msg.destinatario], subject: msg.assunto || "Aviso sobre sua fatura", text: msg.texto, ...(formato?.html ? { html: formato.html } : {}), ...((formato?.replyTo || c.responderPara) ? { reply_to: formato?.replyTo || c.responderPara } : {}), ...(formato?.headers ? { headers: formato.headers } : {}) }),
      });
    } else {
      const c = config.sms;
      resposta = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages.json`, {
        method: "POST", signal: sinal, redirect: "error",
        headers: { Authorization: `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: c.remetente, To: msg.destinatario, Body: msg.texto }).toString(),
      });
    }
    if (!resposta.ok) return { status: resposta.status >= 500 || resposta.status === 408 ? "incerto" : "falhou", motivo: `O fornecedor respondeu HTTP ${resposta.status}.` };
    const corpo: unknown = await resposta.json();
    const resultado = msg.canal === "email" ? z.object({ id: z.string().min(1).max(200) }).safeParse(corpo) : z.object({ sid: z.string().regex(/^SM[a-fA-F0-9]{32}$/), status: z.string() }).safeParse(corpo);
    if (!resultado.success) return { status: "incerto", motivo: "O fornecedor não retornou um identificador válido." };
    const dados = resultado.data;
    if ("sid" in dados) return { status: ["failed", "undelivered", "canceled"].includes(dados.status) ? "falhou" : "enviado", providerMessageId: dados.sid };
    return { status: "enviado", providerMessageId: dados.id };
  } catch { return { status: "incerto", motivo: "Sem confirmação do fornecedor. Confira o painel antes de tentar novamente." }; }
}
