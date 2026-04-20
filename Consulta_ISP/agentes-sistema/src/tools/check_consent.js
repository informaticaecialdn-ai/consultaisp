// Tool: check_consent
// Verifica se podemos enviar pra esse lead/telefone (opt-in ativo, sem opt-out).

const consent = require('../services/consent');
const { getDb } = require('../models/database');

module.exports = {
  name: 'check_consent',
  description:
    'Verifica se um lead ou telefone tem consentimento LGPD para receber mensagens. Retorna { allowed, reason, status }. Consulte ANTES de qualquer outbound cold ou broadcast. Para respostas dentro de uma conversa ja iniciada pelo lead, send_whatsapp ja valida internamente.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' },
      phone: { type: 'string' }
    }
  },
  async handler(input) {
    const db = getDb();
    let phone = input.phone;
    if (!phone && input.lead_id) {
      const lead = db.prepare('SELECT telefone FROM leads WHERE id = ?').get(input.lead_id);
      if (!lead) return { allowed: false, reason: 'lead_not_found' };
      phone = lead.telefone;
    }
    if (!phone) return { allowed: false, reason: 'missing_phone_or_lead_id' };

    const check = consent.canSendTo(phone);
    const status = consent.getStatus(phone);
    return {
      allowed: check.allowed,
      reason: check.reason || null,
      status: status.status,
      optin_em: status.optin_em,
      optin_origem: status.optin_origem,
      optout_em: status.optout_em
    };
  }
};
