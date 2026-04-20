// Tool: mark_closed_won (Milestone 2 / D2 + E3).
// Rafael fecha o contrato. Exige dados minimos: valor mensal + plano + data_inicio.
// Registra em atividades_agentes + atualiza lead.etapa_funil='ganho' + metrica diaria.

const { getDb } = require('../models/database');
const logger = require('../utils/logger');

module.exports = {
  name: 'mark_closed_won',
  description:
    'Marca lead como CLOSED WON (contrato fechado). EXIGE contract_id (use rafael_create_contract antes) + payment_id (use rafael_create_payment antes). Atualiza etapa_funil=ganho, score=100, incrementa metrica contratos_fechados.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' },
      contract_id: {
        type: 'integer',
        description: 'ID do contrato criado via rafael_create_contract. OBRIGATORIO em producao.'
      },
      payment_id: {
        type: 'integer',
        description: 'ID do payment criado via rafael_create_payment. Recomendado.'
      },
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
        description: 'Opcional. Sobrescreve pdf_path do contract. Use se tem URL publica.'
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

    // Em producao exige contract_id real (via rafael_create_contract)
    let contractRow = null;
    if (input.contract_id) {
      contractRow = db.prepare('SELECT id, numero, pdf_path FROM contracts WHERE id = ? AND lead_id = ?')
        .get(input.contract_id, input.lead_id);
      if (!contractRow) return { ok: false, reason: 'contract_not_found_or_wrong_lead' };
    } else if (!homolog && !input.contrato_pdf_url) {
      return {
        ok: false,
        reason: 'contract_id_or_pdf_url_required_in_prod',
        note: 'Em producao rode rafael_create_contract primeiro e passe contract_id.'
      };
    }

    // Valida payment (opcional mas recomendado)
    let paymentRow = null;
    if (input.payment_id) {
      paymentRow = db.prepare('SELECT id, asaas_id, status FROM payments WHERE id = ? AND lead_id = ?')
        .get(input.payment_id, input.lead_id);
    }

    const dadosJson = JSON.stringify({
      plano: input.plano,
      valor_mensal: input.valor_mensal,
      data_inicio: input.data_inicio,
      contract_id: input.contract_id || null,
      contract_numero: contractRow?.numero || null,
      contrato_pdf_url: input.contrato_pdf_url || contractRow?.pdf_path || null,
      payment_id: input.payment_id || null,
      payment_asaas_id: paymentRow?.asaas_id || null,
      forma_pagamento: input.forma_pagamento || null,
      notas: input.notas || null,
      fechado_por: ctx.agente || lead.agente_atual
    });

    // Se tem contract, atualiza status dele pra 'assinado'
    if (contractRow) {
      db.prepare(
        `UPDATE contracts SET status = 'assinado', signed_at = CURRENT_TIMESTAMP, atualizada_em = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(contractRow.id);
    }

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
