// Tool: send_whatsapp
// Agente chama com { lead_id, text } ou { phone, text }.
// Respeita consent + window-checker; persiste em conversas.

const zapi = require('../services/zapi');
const consent = require('../services/consent');
const windowChecker = require('../services/window-checker');
const { getDb } = require('../models/database');
const logger = require('../utils/logger');
const { maskPhone } = require('../utils/pii');

module.exports = {
  name: 'send_whatsapp',
  description:
    'Envia mensagem de texto para o lead via WhatsApp (Z-API). Respeita opt-out LGPD e janela de 24h. NUNCA use markdown ou asteriscos — max 4 frases curtas, tom conversacional. Retorna { sent, reason? } e bloqueia automaticamente se o lead pediu opt-out ou se a janela de 24h fechou (em conversas iniciadas a partir de inbound).',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: {
        type: 'integer',
        description: 'ID do lead no banco. Preferir este campo quando disponivel.'
      },
      phone: {
        type: 'string',
        description: 'Telefone do lead em qualquer formato BR. Use quando lead_id nao for conhecido (ex: cold outbound).'
      },
      text: {
        type: 'string',
        description:
          'Texto da mensagem. SEM markdown, SEM asteriscos, max 4 frases curtas, 1-2 emojis no maximo.'
      },
      is_template: {
        type: 'boolean',
        description:
          'true se for template HSM (permite enviar fora da janela 24h). Default false.',
        default: false
      },
      agente: {
        type: 'string',
        description:
          'Nome do agente que esta enviando (carlos, lucas, rafael). Usado para log/metrica.'
      }
    },
    required: ['text']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const agentKey = input.agente || ctx.agente || 'carlos';
    const correlationId = ctx.correlationId || null;

    let lead = null;
    let phone = input.phone;

    if (input.lead_id) {
      lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(input.lead_id);
      if (!lead) return { sent: false, reason: 'lead_not_found', lead_id: input.lead_id };
      phone = lead.telefone;
    }

    if (!phone) return { sent: false, reason: 'missing_phone_or_lead_id' };

    const consentCheck = consent.canSendTo(phone);
    if (!consentCheck.allowed) {
      logger.warn(
        { phone: maskPhone(phone), agente: agentKey, reason: consentCheck.reason, correlationId },
        '[TOOL send_whatsapp] bloqueado por opt-out'
      );
      return { sent: false, reason: 'optout', detail: consentCheck.reason };
    }

    if (!input.is_template && lead?.id) {
      const windowCheck = await windowChecker.canSendFreeForm(lead.id);
      if (!windowCheck.allowed) {
        logger.warn(
          { lead_id: lead.id, agente: agentKey, reason: windowCheck.reason, correlationId },
          '[TOOL send_whatsapp] bloqueado por janela 24h'
        );
        return {
          sent: false,
          reason: 'window_closed',
          detail: windowCheck.reason,
          recommendation: windowCheck.recommendation
        };
      }
    }

    try {
      const result = await zapi.sendText(phone, input.text);
      if (lead?.id) {
        db.prepare(
          `INSERT INTO conversas (lead_id, agente, direcao, mensagem, tipo, canal, metadata)
           VALUES (?, ?, 'enviada', ?, 'texto', 'whatsapp', ?)`
        ).run(
          lead.id,
          agentKey,
          input.text,
          JSON.stringify({ via: 'tool_call', correlation_id: correlationId })
        );
      }
      logger.info(
        { phone: maskPhone(phone), agente: agentKey, correlationId },
        '[TOOL send_whatsapp] enviado'
      );
      return {
        sent: true,
        message_id: result?.messageId || null,
        lead_id: lead?.id || null
      };
    } catch (err) {
      logger.error(
        { phone: maskPhone(phone), agente: agentKey, err: err.message, correlationId },
        '[TOOL send_whatsapp] erro Z-API'
      );
      return { sent: false, reason: 'zapi_error', detail: err.message };
    }
  }
};
