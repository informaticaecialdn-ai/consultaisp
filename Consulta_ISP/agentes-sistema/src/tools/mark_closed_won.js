// Tool: mark_closed_won (Milestone 2 / D2 + E3).
// Rafael fecha o contrato. Exige dados minimos: valor mensal + plano + data_inicio.
// Registra em atividades_agentes + atualiza lead.etapa_funil='ganho' + metrica diaria.

const { getDb } = require('../models/database');
const logger = require('../utils/logger');

module.exports = {
  name: 'mark_closed_won',
  description:
    'Marca lead como CLOSED WON (contrato fechado). Exige: plano, valor_mensal, data_inicio e, se AUTO_SEND_CONTRACT=false, tambem contrato_pdf_url. Atualiza etapa_funil=ganho, score=100, incrementa metrica contratos_fechados.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' },
      plano: {
        type: 'string',
        enum: ['gratuito', 'basico', 'profissional', 'enterprise']
      },
      valor_mensal: { type: 'number' },
      data_inicio: {
        type: 'string',
        description: 'Data de inicio da vigencia (YYYY-MM-DD)'
      },
      contrato_pdf_url: {
        type: 'string',
        description: 'URL do PDF do contrato assinado. Obrigatorio em producao; opcional em homolog.'
      },
      forma_pagamento: {
        type: 'string',
        enum: ['pix', 'boleto', 'cartao', 'outro']
      },
      notas: { type: 'string' }
    },
    required: ['lead_id', 'plano', 'valor_mensal', 'data_inicio']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(input.lead_id);
    if (!lead) return { ok: false, reason: 'lead_not_found' };

    const homolog = String(process.env.NODE_ENV) !== 'production';
    if (!homolog && !input.contrato_pdf_url) {
      return { ok: false, reason: 'contrato_pdf_url_required_in_prod' };
    }

    const dadosJson = JSON.stringify({
      plano: input.plano,
      valor_mensal: input.valor_mensal,
      data_inicio: input.data_inicio,
      contrato_pdf_url: input.contrato_pdf_url || null,
      forma_pagamento: input.forma_pagamento || null,
      notas: input.notas || null,
      fechado_por: ctx.agente || lead.agente_atual
    });

    db.prepare(
      `UPDATE leads SET
         etapa_funil = 'ganho',
         score_total = 100,
         classificacao = 'ultra_quente',
         valor_estimado = ?,
         observacoes = COALESCE(observacoes || char(10), '') || ?,
         atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      input.valor_mensal,
      `CLOSED WON: ${input.plano} R$${input.valor_mensal}/mes inicio ${input.data_inicio}${input.notas ? ' — ' + input.notas : ''}`,
      input.lead_id
    );

    db.prepare(
      `INSERT INTO tarefas (lead_id, agente, tipo, descricao, status, dados)
       VALUES (?, ?, 'contrato_fechado', ?, 'concluida', ?)`
    ).run(
      input.lead_id,
      ctx.agente || lead.agente_atual,
      `Contrato fechado: ${input.plano} R$${input.valor_mensal}`,
      dadosJson
    );

    db.prepare(
      `INSERT INTO atividades_agentes (agente, tipo, descricao, lead_id, decisao)
       VALUES (?, 'closed_won', ?, ?, ?)`
    ).run(
      ctx.agente || lead.agente_atual,
      `CLOSED WON ${input.plano} R$${input.valor_mensal}/mes`,
      input.lead_id,
      'ganho'
    );

    // Incrementa metrica diaria
    const hoje = new Date().toISOString().split('T')[0];
    const ag = ctx.agente || lead.agente_atual;
    db.prepare(
      'INSERT OR IGNORE INTO metricas_diarias (data, agente) VALUES (?, ?)'
    ).run(hoje, ag);
    db.prepare(
      'UPDATE metricas_diarias SET contratos_fechados = contratos_fechados + 1, valor_pipeline = valor_pipeline + ? WHERE data = ? AND agente = ?'
    ).run(Number(input.valor_mensal) * 12, hoje, ag);

    logger.info(
      { lead_id: input.lead_id, plano: input.plano, valor: input.valor_mensal, agente: ag },
      '[TOOL mark_closed_won]'
    );

    return { ok: true, homolog };
  }
};
