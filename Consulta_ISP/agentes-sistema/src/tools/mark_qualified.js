// Tool: mark_qualified
// Marca o lead como qualificado (BANT completo) e atualiza scoring.

const { getDb } = require('../models/database');
const logger = require('../utils/logger');

module.exports = {
  name: 'mark_qualified',
  description:
    'Marca o lead como qualificado BANT. Use quando voce (Carlos) extraiu: Budget (tem verba), Authority (e decisor), Need (tem dor que resolvemos), Timeline (tem urgencia). Atualiza score_perfil, classificacao e observacoes. NAO faz handoff automatico — para transferir ao Lucas, use handoff_to_agent depois.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' },
      bant: {
        type: 'object',
        properties: {
          budget: { type: 'string', description: 'Capacidade financeira descoberta' },
          authority: { type: 'string', description: 'Nivel de autoridade do contato' },
          need: { type: 'string', description: 'Dor/necessidade identificada' },
          timeline: { type: 'string', description: 'Quando pretendem decidir' }
        }
      },
      resumo: {
        type: 'string',
        description: 'Resumo em 1-2 frases da qualificacao para registrar em observacoes.'
      },
      score_delta: {
        type: 'integer',
        description: 'Quanto adicionar ao score_perfil (0-30). Default 20.',
        default: 20
      }
    },
    required: ['lead_id', 'resumo']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(input.lead_id);
    if (!lead) return { ok: false, reason: 'lead_not_found' };

    const delta = Math.min(Math.max(Number(input.score_delta) || 20, 0), 30);
    const novoPerfil = Math.min(50, (lead.score_perfil || 0) + delta);
    const total = novoPerfil + (lead.score_comportamento || 0);
    let classificacao = lead.classificacao;
    if (total >= 81) classificacao = 'ultra_quente';
    else if (total >= 61) classificacao = 'quente';
    else if (total >= 31) classificacao = 'morno';

    const bantStr = input.bant
      ? `BANT: ${JSON.stringify(input.bant, null, 0)} | ${input.resumo}`
      : input.resumo;

    db.prepare(
      `UPDATE leads SET
         score_perfil = ?, score_total = ?, classificacao = ?,
         etapa_funil = CASE WHEN etapa_funil IN ('novo','prospeccao') THEN 'qualificacao' ELSE etapa_funil END,
         observacoes = COALESCE(observacoes || char(10), '') || ?,
         atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(novoPerfil, total, classificacao, bantStr, input.lead_id);

    db.prepare(
      `INSERT INTO atividades_agentes (agente, tipo, descricao, lead_id, score_antes, score_depois)
       VALUES (?, 'qualificacao', ?, ?, ?, ?)`
    ).run(ctx.agente || 'carlos', input.resumo, input.lead_id, lead.score_total, total);

    logger.info(
      { lead_id: input.lead_id, score_total: total, classificacao, agente: ctx.agente },
      '[TOOL mark_qualified]'
    );

    return { ok: true, score_total: total, classificacao, etapa_funil: 'qualificacao' };
  }
};
