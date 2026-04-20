// Tool: schedule_followup
// Agenda um followup futuro para o lead (usa tabela followups existente).

const { getDb } = require('../models/database');
const logger = require('../utils/logger');

module.exports = {
  name: 'schedule_followup',
  description:
    'Agenda um followup futuro com esse lead. Use quando o lead pediu pra retornar depois, ou quando esta quente mas ocupado. Nao envia nada agora — um worker cron vai pegar quando chegar a hora. A mensagem sera re-gerada pelo agente no momento do envio com base no contexto atualizado.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' },
      em_horas: {
        type: 'number',
        description: 'Quantas horas no futuro (ex: 24 para amanha, 168 para 1 semana). Min 1, max 720.'
      },
      motivo: {
        type: 'string',
        description: 'Por que o followup (ex: "Lead pediu pra retornar na segunda").'
      }
    },
    required: ['lead_id', 'em_horas', 'motivo']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const lead = db.prepare('SELECT id, agente_atual FROM leads WHERE id = ?').get(input.lead_id);
    if (!lead) return { ok: false, reason: 'lead_not_found' };

    const horas = Math.min(Math.max(Number(input.em_horas) || 24, 1), 720);
    const proximoEnvio = new Date(Date.now() + horas * 3600_000).toISOString();

    const row = db
      .prepare(
        `INSERT INTO followups (lead_id, agente, mensagem_original, proximo_envio, status)
         VALUES (?, ?, ?, ?, 'pendente')`
      )
      .run(input.lead_id, ctx.agente || lead.agente_atual, input.motivo, proximoEnvio);

    logger.info(
      { lead_id: input.lead_id, proximoEnvio, horas, agente: ctx.agente },
      '[TOOL schedule_followup]'
    );

    return {
      ok: true,
      followup_id: row.lastInsertRowid,
      proximo_envio: proximoEnvio,
      em_horas: horas
    };
  }
};
