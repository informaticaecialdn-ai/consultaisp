// Tool: mark_unqualified
// Marca lead como desqualificado, devolve pra Sofia (nurturing) ou encerra.

const { getDb } = require('../models/database');
const logger = require('../utils/logger');

module.exports = {
  name: 'mark_unqualified',
  description:
    'Marca lead como nao qualificado. Motivos: sem budget, nao e decisor, sem necessidade, timing errado, perfil fora do ICP. Define classificacao=frio e, se destino=nurturing, transfere pra Sofia para re-engajamento futuro. Se destino=perdido, fecha o lead.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' },
      motivo: {
        type: 'string',
        enum: [
          'sem_budget',
          'nao_decisor',
          'sem_necessidade',
          'timing_errado',
          'fora_icp',
          'concorrente',
          'nao_respondeu',
          'outro'
        ]
      },
      detalhes: {
        type: 'string',
        description: 'Contexto da desqualificacao (ex: "Disse que vai avaliar ano que vem").'
      },
      destino: {
        type: 'string',
        enum: ['nurturing', 'perdido'],
        description:
          'nurturing = Sofia re-engaja em 90 dias. perdido = encerra. Default: nurturing para motivos reversiveis, perdido para outros.'
      }
    },
    required: ['lead_id', 'motivo']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(input.lead_id);
    if (!lead) return { ok: false, reason: 'lead_not_found' };

    const destino =
      input.destino ||
      (['timing_errado', 'nao_respondeu', 'sem_budget'].includes(input.motivo) ? 'nurturing' : 'perdido');

    const etapa = destino === 'nurturing' ? 'nurturing' : 'perdido';
    const classificacao = 'frio';
    const agenteDestino = destino === 'nurturing' ? 'sofia' : lead.agente_atual;

    db.prepare(
      `UPDATE leads SET
         classificacao = ?, etapa_funil = ?, motivo_perda = ?,
         agente_atual = ?,
         observacoes = COALESCE(observacoes || char(10), '') || ?,
         atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      classificacao,
      etapa,
      input.motivo,
      agenteDestino,
      `DESQUALIFICADO (${input.motivo}): ${input.detalhes || '-'}`,
      input.lead_id
    );

    if (destino === 'nurturing' && agenteDestino !== lead.agente_atual) {
      db.prepare(
        `INSERT INTO handoffs (lead_id, de_agente, para_agente, motivo, score_no_momento)
         VALUES (?, ?, 'sofia', ?, ?)`
      ).run(input.lead_id, lead.agente_atual, `Desqualificado: ${input.motivo}`, lead.score_total);
    }

    db.prepare(
      `INSERT INTO atividades_agentes (agente, tipo, descricao, lead_id, decisao)
       VALUES (?, 'desqualificacao', ?, ?, ?)`
    ).run(
      ctx.agente || lead.agente_atual,
      `Desqualificado (${input.motivo}): ${input.detalhes || '-'}`,
      input.lead_id,
      destino
    );

    logger.info(
      { lead_id: input.lead_id, motivo: input.motivo, destino, agente: ctx.agente },
      '[TOOL mark_unqualified]'
    );

    return { ok: true, destino, etapa_funil: etapa, agente_atual: agenteDestino };
  }
};
