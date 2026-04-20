// Tool: mark_closed_lost (Milestone 2 / E3).
// Rafael registra perda do deal.

const { getDb } = require('../models/database');
const logger = require('../utils/logger');

module.exports = {
  name: 'mark_closed_lost',
  description:
    'Marca lead como CLOSED LOST (perdeu). Registra motivo e detalhes. Atualiza etapa_funil=perdido. Util tambem pra alimentar training.js (aprendizado de objecoes).',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' },
      motivo: {
        type: 'string',
        enum: ['preco', 'concorrente', 'timing', 'nao_prioridade', 'sem_contato', 'funcionalidade', 'outro']
      },
      detalhes: { type: 'string' },
      concorrente_ganhador: { type: 'string', description: 'Nome do concorrente se motivo=concorrente' }
    },
    required: ['lead_id', 'motivo']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(input.lead_id);
    if (!lead) return { ok: false, reason: 'lead_not_found' };

    db.prepare(
      `UPDATE leads SET
         etapa_funil = 'perdido',
         motivo_perda = ?,
         observacoes = COALESCE(observacoes || char(10), '') || ?,
         atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      input.motivo,
      `CLOSED LOST (${input.motivo}): ${input.detalhes || '-'}${input.concorrente_ganhador ? ' concorrente: ' + input.concorrente_ganhador : ''}`,
      input.lead_id
    );

    db.prepare(
      `INSERT INTO atividades_agentes (agente, tipo, descricao, lead_id, decisao)
       VALUES (?, 'closed_lost', ?, ?, ?)`
    ).run(
      ctx.agente || lead.agente_atual,
      `CLOSED LOST (${input.motivo})${input.detalhes ? ': ' + input.detalhes : ''}`,
      input.lead_id,
      input.motivo
    );

    const hoje = new Date().toISOString().split('T')[0];
    const ag = ctx.agente || lead.agente_atual;
    db.prepare(
      'INSERT OR IGNORE INTO metricas_diarias (data, agente) VALUES (?, ?)'
    ).run(hoje, ag);
    db.prepare(
      'UPDATE metricas_diarias SET leads_perdidos = leads_perdidos + 1 WHERE data = ? AND agente = ?'
    ).run(hoje, ag);

    logger.info(
      { lead_id: input.lead_id, motivo: input.motivo, agente: ag },
      '[TOOL mark_closed_lost]'
    );

    return { ok: true, motivo: input.motivo };
  }
};
