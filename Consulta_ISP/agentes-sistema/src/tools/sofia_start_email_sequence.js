// Tool: sofia_start_email_sequence
// Sofia inicia sequencia de nurturing/reengagement por email pra lead frio.
// Pre-requisito: lead.email preenchido + RESEND_API_KEY configurado.

const { startSequence, SEQUENCES } = require('../services/email-sequences');
const { getDb } = require('../models/database');
const logger = require('../utils/logger');

module.exports = {
  name: 'sofia_start_email_sequence',
  description:
    'Inicia sequencia de emails automaticos pra lead. Tipos: "nurturing" (5 emails em 45d — frios que pediram retorno), "reengagement" (3 emails em 21d — mornos que esfriaram). Primeiro email sai imediato, restante cadenciado. Pre-req: lead.email preenchido.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' },
      type: {
        type: 'string',
        enum: ['nurturing', 'reengagement'],
        description: 'Default nurturing'
      }
    },
    required: ['lead_id']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const lead = db.prepare('SELECT id, email, nome FROM leads WHERE id = ?').get(input.lead_id);
    if (!lead) return { ok: false, error: 'lead_not_found' };
    if (!lead.email || !lead.email.includes('@')) {
      return { ok: false, error: 'lead_sem_email', note: 'Rode enrichment ou Carla pergunte o email antes.' };
    }

    const type = input.type || 'nurturing';
    if (!SEQUENCES[type]) return { ok: false, error: 'tipo_invalido' };

    try {
      const result = startSequence({ leadId: lead.id, type });
      if (result.already_active) {
        return { ok: true, already_active: true, sequence_id: result.sequence_id };
      }

      // Registra atividade
      db.prepare(
        `INSERT INTO atividades_agentes (agente, tipo, descricao, lead_id)
         VALUES (?, 'email_sequence_started', ?, ?)`
      ).run(ctx.agente || 'sofia', `Sequence ${type} iniciada (${result.steps} emails)`, lead.id);

      logger.info(
        { sequence_id: result.sequence_id, type, lead_id: lead.id, steps: result.steps },
        '[TOOL sofia_start_email_sequence]'
      );

      return {
        ok: true,
        sequence_id: result.sequence_id,
        type,
        steps: result.steps,
        note: 'Primeiro email sai no proximo tick do email-sequence worker (dentro de 15min).'
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
};
