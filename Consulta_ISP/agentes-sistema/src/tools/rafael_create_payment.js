// Tool: rafael_create_payment
// Cria cobranca Asaas (PIX ou Boleto) vinculada a contract. Envia PIX QR ou
// link do boleto via WhatsApp pro cliente pagar.

const { getDb } = require('../models/database');
const asaas = require('../services/asaas');
const zapi = require('../services/zapi');
const logger = require('../utils/logger');

function plusDays(baseDate, days) {
  const d = new Date(baseDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  name: 'rafael_create_payment',
  description:
    'Cria cobranca Asaas (PIX ou Boleto) pro lead pagar a primeira mensalidade. Registra em payments. Envia PIX copia-e-cola ou link boleto via WhatsApp. Use APOS rafael_create_contract. Pre-requisito: ASAAS_API_KEY no .env.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' },
      contract_id: { type: 'integer' },
      valor: { type: 'number', description: 'Valor da mensalidade em R$.' },
      forma: {
        type: 'string',
        enum: ['PIX', 'BOLETO'],
        description: 'PIX recomendado (rapido). BOLETO pra quem prefere.',
        default: 'PIX'
      },
      due_date_days_from_now: {
        type: 'integer',
        description: 'Quantos dias a partir de hoje pro vencimento. Default 3 pra PIX, 7 pra boleto.'
      },
      due_date: {
        type: 'string',
        description: 'Opcional. Data de vencimento explicita (YYYY-MM-DD). Sobrepoe due_date_days_from_now.'
      },
      cpf_cnpj: {
        type: 'string',
        description: 'CPF ou CNPJ do pagador. Se nao fornecido, usa lead.cnpj (obrigatorio pra Asaas).'
      },
      auto_send: {
        type: 'boolean',
        description: 'Se true, envia link/PIX via WhatsApp imediatamente. Default env AUTO_SEND_PAYMENT ou true.',
        default: true
      }
    },
    required: ['lead_id', 'valor']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(input.lead_id);
    if (!lead) return { ok: false, error: 'lead_not_found' };

    if (!asaas.isConfigured()) {
      return { ok: false, error: 'asaas_not_configured', note: 'Setar ASAAS_API_KEY no .env' };
    }

    const cpfCnpj = input.cpf_cnpj || lead.cnpj;
    if (!cpfCnpj) {
      return {
        ok: false,
        error: 'missing_cpf_cnpj',
        note: 'Asaas exige CPF/CNPJ. Rode lookup_cnpj ou pergunte ao lead antes.'
      };
    }

    const forma = (input.forma || 'PIX').toUpperCase();
    const defaultDays = forma === 'PIX' ? 3 : 7;
    const dueDate = input.due_date || plusDays(new Date().toISOString().slice(0, 10), input.due_date_days_from_now || defaultDays);
    const autoSend = input.auto_send !== false && String(process.env.AUTO_SEND_PAYMENT || 'true').toLowerCase() !== 'false';

    try {
      // 1. Find or create customer no Asaas
      const customer = await asaas.findOrCreateCustomer({
        name: lead.razao_social || lead.nome || lead.provedor || 'Cliente',
        cpfCnpj,
        email: lead.email || undefined,
        phone: lead.telefone || undefined
      });

      // 2. Cria cobranca
      let paymentResult;
      const commonParams = {
        customerId: customer.id,
        value: input.valor,
        dueDate,
        description: `Consulta ISP — ${lead.razao_social || lead.provedor || 'Mensalidade'}`,
        externalReference: `lead-${lead.id}${input.contract_id ? '-contract-' + input.contract_id : ''}`
      };

      if (forma === 'PIX') {
        paymentResult = await asaas.createPixPayment(commonParams);
      } else {
        paymentResult = await asaas.createBoletoPayment(commonParams);
      }

      // 3. Persiste
      const insertResult = db.prepare(
        `INSERT INTO payments
           (lead_id, contract_id, asaas_id, asaas_invoice_url, asaas_pix_payload,
            valor, due_date, forma, status, criada_por_agente)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      ).run(
        lead.id,
        input.contract_id || null,
        paymentResult.id,
        paymentResult.invoiceUrl || paymentResult.bankSlipUrl || null,
        paymentResult.pixPayload || null,
        input.valor,
        dueDate,
        forma,
        ctx.agente || 'rafael'
      );
      const paymentDbId = insertResult.lastInsertRowid;

      // 4. Envia pro WhatsApp
      let sent = false;
      let sendError = null;
      if (autoSend) {
        try {
          let texto;
          if (forma === 'PIX' && paymentResult.pixPayload) {
            texto =
              `Fechamos! Segue o PIX pra primeira mensalidade R$${Number(input.valor).toFixed(2).replace('.', ',')} ` +
              `(vence ${dueDate}):\n\n` +
              `${paymentResult.pixPayload}\n\n` +
              `Ou se preferir boleto, so me avisar. Assim que confirmar o pagamento o sistema ja libera seu acesso.`;
          } else {
            texto =
              `Fechamos! Segue o link do boleto pra primeira mensalidade R$${Number(input.valor).toFixed(2).replace('.', ',')} ` +
              `(vence ${dueDate}):\n\n` +
              `${paymentResult.invoiceUrl || paymentResult.bankSlipUrl}\n\n` +
              `Assim que compensar, libero seu acesso automaticamente.`;
          }

          await zapi.sendText(lead.telefone, texto);

          db.prepare(
            `INSERT INTO conversas (lead_id, agente, direcao, mensagem, tipo, canal, metadata)
             VALUES (?, ?, 'enviada', ?, 'pagamento', 'whatsapp', ?)`
          ).run(
            lead.id,
            ctx.agente || 'rafael',
            texto.slice(0, 500),
            JSON.stringify({ payment_id: paymentDbId, asaas_id: paymentResult.id, forma })
          );
          sent = true;
        } catch (err) {
          sendError = err.message;
          logger.warn({ lead_id: lead.id, err: err.message }, '[TOOL rafael_create_payment] envio falhou');
        }
      }

      logger.info(
        { lead_id: lead.id, payment_db_id: paymentDbId, asaas_id: paymentResult.id, forma, sent },
        '[TOOL rafael_create_payment]'
      );

      return {
        ok: true,
        payment_db_id: paymentDbId,
        asaas_id: paymentResult.id,
        forma,
        valor: input.valor,
        due_date: dueDate,
        invoice_url: paymentResult.invoiceUrl || paymentResult.bankSlipUrl,
        pix_payload: paymentResult.pixPayload,
        sent,
        send_error: sendError
      };
    } catch (err) {
      logger.error(
        { lead_id: lead.id, err: err.message, asaas_body: err.body },
        '[TOOL rafael_create_payment] falha'
      );
      return { ok: false, error: err.message, asaas_response: err.body };
    }
  }
};
