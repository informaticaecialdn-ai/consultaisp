// Tool: check_window_24h
// Verifica se a janela de 24h do WhatsApp esta aberta (lead enviou algo nas ultimas 24h).
// Se fechada, so pode enviar template HSM aprovado.

const windowChecker = require('../services/window-checker');

module.exports = {
  name: 'check_window_24h',
  description:
    'Verifica se a janela de 24h do WhatsApp Business ainda esta aberta para esse lead. Retorna { allowed, hoursSince, hoursRemaining, reason }. Se allowed=false voce so pode usar template HSM aprovado (send_whatsapp com is_template=true). Se allowed=true pode mandar mensagem livre (freeform).',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer', description: 'ID do lead' }
    },
    required: ['lead_id']
  },
  async handler(input) {
    const result = await windowChecker.canSendFreeForm(input.lead_id);
    return {
      allowed: result.allowed,
      reason: result.reason,
      hoursSince: result.hoursSince,
      hoursRemaining: result.hoursRemaining,
      recommendation: result.recommendation || null
    };
  }
};
