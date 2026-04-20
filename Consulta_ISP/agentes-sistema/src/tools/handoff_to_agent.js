// Tool: handoff_to_agent
// Transfere o lead pra outro agente (Carlos->Lucas, Lucas->Rafael, qualquer->Sofia nurturing).
// Atualiza agente_atual, etapa_funil apropriada, registra em handoffs.

const { getDb } = require('../models/database');
const logger = require('../utils/logger');

const ETAPA_POR_AGENTE = {
  sofia: 'nurturing',
  leo: null, // Leo nao e etapa de funil, so produz copy
  carlos: 'qualificacao',
  lucas: 'negociacao',
  rafael: 'fechamento',
  marcos: null,
  iani: null
};

module.exports = {
  name: 'handoff_to_agent',
  description:
    'Transfere o lead pra outro agente. Use quando: qualificou BANT -> lucas. Lucas apresentou proposta -> rafael para fechar. Lead frio/timing errado -> sofia para nurturing. IMPORTANTE: o context_summary deve incluir TODOS os dados relevantes ja descobertos — nome do decisor, cargo, CNPJ/razao social (se enriquecido), porte/num_clientes, ERP usado, principais dores, objecoes ja levantadas, proxima acao. O proximo agente vai LER esse resumo antes de responder — se faltar dado, ele repete pergunta e perde credibilidade.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' },
      to: {
        type: 'string',
        enum: ['sofia', 'leo', 'carlos', 'lucas', 'rafael', 'marcos', 'iani']
      },
      reason: { type: 'string', description: 'Motivo curto do handoff (ex: "BANT qualificado, score 72")' },
      context_summary: {
        type: 'string',
        description:
          'Resumo DENSO pro proximo agente. Template sugerido: "Decisor: {nome/cargo}. CNPJ: {cnpj} ({razao social}). Porte: {num_clientes} clientes. ERP: {erp}. Dor principal: {...}. Budget: {...}. Objecoes ja respondidas: {...}. Proxima acao sugerida: {...}". Evite frases tipo "fale com ele" — o proximo agente precisa de FATOS pra nao repetir pergunta.'
      }
    },
    required: ['lead_id', 'to', 'reason']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(input.lead_id);
    if (!lead) return { ok: false, reason: 'lead_not_found' };

    const from = ctx.agente || lead.agente_atual;
    if (from === input.to) {
      return { ok: false, reason: 'same_agent', detail: `Lead ja esta com ${input.to}` };
    }

    const novaEtapa = ETAPA_POR_AGENTE[input.to];

    db.prepare(
      `UPDATE leads SET
         agente_atual = ?,
         etapa_funil = COALESCE(?, etapa_funil),
         observacoes = COALESCE(observacoes || char(10), '') || ?,
         atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      input.to,
      novaEtapa,
      `HANDOFF ${from}->${input.to}: ${input.reason}${input.context_summary ? ' | ' + input.context_summary : ''}`,
      input.lead_id
    );

    db.prepare(
      `INSERT INTO handoffs (lead_id, de_agente, para_agente, motivo, score_no_momento)
       VALUES (?, ?, ?, ?, ?)`
    ).run(input.lead_id, from, input.to, input.reason, lead.score_total || 0);

    db.prepare(
      `INSERT INTO tarefas (lead_id, agente, tipo, descricao, status)
       VALUES (?, ?, 'handoff', ?, 'concluida')`
    ).run(
      input.lead_id,
      input.to,
      `Recebido de ${from}: ${input.reason}${input.context_summary ? ' | ' + input.context_summary : ''}`
    );

    db.prepare(
      `INSERT INTO atividades_agentes (agente, tipo, descricao, lead_id, decisao)
       VALUES (?, 'handoff_enviado', ?, ?, ?)`
    ).run(from, `Lead transferido para ${input.to}: ${input.reason}`, input.lead_id, input.to);

    logger.info(
      { lead_id: input.lead_id, from, to: input.to, reason: input.reason },
      '[TOOL handoff_to_agent]'
    );

    return { ok: true, from, to: input.to, new_etapa: novaEtapa || lead.etapa_funil };
  }
};
