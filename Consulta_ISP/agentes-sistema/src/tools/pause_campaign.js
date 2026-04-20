// Tool: pause_campaign / resume_campaign (Milestone 3 / F1).

const { getDb } = require('../models/database');
const logger = require('../utils/logger');

const pause = {
  name: 'pause_campaign',
  description:
    'Pausa uma campanha de broadcast em andamento. Use quando taxa de falha > threshold ou quando Diana detecta que e hora de parar.',
  input_schema: {
    type: 'object',
    properties: {
      campaign_id: { type: 'integer' },
      motivo: { type: 'string' }
    },
    required: ['campaign_id', 'motivo']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    try {
      const r = db
        .prepare("UPDATE campanhas SET status = 'pausada', atualizado_em = CURRENT_TIMESTAMP WHERE id = ?")
        .run(input.campaign_id);
      logger.info({ campaign_id: input.campaign_id, motivo: input.motivo, agente: ctx.agente }, '[TOOL pause_campaign]');
      return { ok: r.changes > 0, motivo: input.motivo };
    } catch (err) {
      return { ok: false, reason: 'campanhas_table_missing', error: err.message };
    }
  }
};

const resume = {
  name: 'resume_campaign',
  description: 'Reativa uma campanha anteriormente pausada.',
  input_schema: {
    type: 'object',
    properties: {
      campaign_id: { type: 'integer' }
    },
    required: ['campaign_id']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    try {
      const r = db
        .prepare("UPDATE campanhas SET status = 'ativa', atualizado_em = CURRENT_TIMESTAMP WHERE id = ?")
        .run(input.campaign_id);
      logger.info({ campaign_id: input.campaign_id, agente: ctx.agente }, '[TOOL resume_campaign]');
      return { ok: r.changes > 0 };
    } catch (err) {
      return { ok: false, reason: 'campanhas_table_missing', error: err.message };
    }
  }
};

module.exports = { pause, resume };
