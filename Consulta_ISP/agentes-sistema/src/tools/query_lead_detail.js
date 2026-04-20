// Tool: query_lead_detail
// Retorna ficha completa de um lead + ultimas 10 mensagens pra dar contexto ao agente.

const { getDb } = require('../models/database');

module.exports = {
  name: 'query_lead_detail',
  description:
    'Retorna dados completos de um lead (nome, provedor, cidade, porte, ERP, score, etapa, agente responsavel) + as ultimas 10 mensagens da conversa. Use para se orientar antes de decidir resposta/acao. Retorna null se nao encontrar.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' }
    },
    required: ['lead_id']
  },
  async handler(input) {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(input.lead_id);
    if (!lead) return null;

    const historico = db
      .prepare(
        `SELECT direcao, mensagem, canal, criado_em
         FROM conversas WHERE lead_id = ?
         ORDER BY criado_em DESC LIMIT 10`
      )
      .all(input.lead_id)
      .reverse();

    const handoffs = db
      .prepare(
        'SELECT de_agente, para_agente, motivo, criado_em FROM handoffs WHERE lead_id = ? ORDER BY criado_em DESC'
      )
      .all(input.lead_id);

    return {
      lead: {
        id: lead.id,
        telefone: lead.telefone,
        nome: lead.nome,
        provedor: lead.provedor,
        cidade: lead.cidade,
        estado: lead.estado,
        porte: lead.porte,
        erp: lead.erp,
        num_clientes: lead.num_clientes,
        decisor: lead.decisor,
        email: lead.email,
        cargo: lead.cargo,
        score_total: lead.score_total,
        classificacao: lead.classificacao,
        etapa_funil: lead.etapa_funil,
        agente_atual: lead.agente_atual,
        origem: lead.origem,
        valor_estimado: lead.valor_estimado,
        observacoes: lead.observacoes
      },
      historico,
      handoffs
    };
  }
};
