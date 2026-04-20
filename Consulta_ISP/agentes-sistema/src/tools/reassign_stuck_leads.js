// Tool: reassign_stuck_leads (Milestone 3 / F1).
// Diana realoca leads parados. Usada por src/workers/supervisor.js.

const { getDb } = require('../models/database');
const logger = require('../utils/logger');

module.exports = {
  name: 'reassign_stuck_leads',
  description:
    'Reatribui leads parados (sem resposta ha N dias) de volta pra Sofia (nurturing). Util pra Diana liberar slots do time comercial. Retorna contagem de reatribuidos por agente origem.',
  input_schema: {
    type: 'object',
    properties: {
      dias_parado: {
        type: 'integer',
        description: 'Leads sem conversa ha esse numero de dias. Default 7.',
        default: 7
      },
      so_agentes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Limita a esses agentes (ex: ["carlos","lucas"]). Default: todos exceto sofia/diana.'
      },
      max_reassign: {
        type: 'integer',
        description: 'Max leads reatribuidos por chamada. Default 50.',
        default: 50
      },
      dry_run: {
        type: 'boolean',
        description: 'Se true, so lista sem reatribuir. Default false.',
        default: false
      }
    }
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const dias = Math.max(1, Math.min(Number(input.dias_parado) || 7, 30));
    const max = Math.max(1, Math.min(Number(input.max_reassign) || 50, 200));
    const agentes = Array.isArray(input.so_agentes) && input.so_agentes.length > 0
      ? input.so_agentes
      : ['carlos', 'lucas', 'rafael'];

    const placeholders = agentes.map(() => '?').join(',');
    const stuck = db
      .prepare(
        `SELECT l.id, l.nome, l.agente_atual, l.etapa_funil,
                (SELECT MAX(criado_em) FROM conversas WHERE lead_id = l.id) AS ultimo
         FROM leads l
         WHERE l.agente_atual IN (${placeholders})
           AND l.etapa_funil NOT IN ('ganho','perdido','nurturing')
           AND NOT EXISTS (
             SELECT 1 FROM conversas c
             WHERE c.lead_id = l.id AND c.criado_em > DATETIME('now','-' || ? || ' days')
           )
         ORDER BY l.atualizado_em ASC
         LIMIT ?`
      )
      .all(...agentes, String(dias), max);

    if (input.dry_run) {
      return { dry_run: true, count: stuck.length, leads: stuck };
    }

    const stats = { reassigned: 0, by_from: {} };
    const tx = db.transaction(() => {
      for (const lead of stuck) {
        db.prepare(
          `UPDATE leads SET
             agente_atual = 'sofia',
             etapa_funil = 'nurturing',
             observacoes = COALESCE(observacoes || char(10), '') || ?,
             atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(
          `REASSIGN (Diana): parado ${dias}d em ${lead.agente_atual} -> sofia nurturing`,
          lead.id
        );
        db.prepare(
          `INSERT INTO handoffs (lead_id, de_agente, para_agente, motivo)
           VALUES (?, ?, 'sofia', ?)`
        ).run(lead.id, lead.agente_atual, `Diana realocou: parado ${dias}d`);
        stats.reassigned++;
        stats.by_from[lead.agente_atual] = (stats.by_from[lead.agente_atual] || 0) + 1;
      }
    });
    tx();

    logger.info(
      { ...stats, agente: ctx.agente || 'diana' },
      '[TOOL reassign_stuck_leads]'
    );

    return { ok: true, ...stats, dias_parado: dias };
  }
};
