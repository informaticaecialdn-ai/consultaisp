// Tool: query_leads
// Filtra leads por criterios (etapa, classificacao, agente, dias_sem_responder).

const { getDb } = require('../models/database');

module.exports = {
  name: 'query_leads',
  description:
    'Lista leads filtrados. Util para encontrar leads por etapa do funil, classificacao, agente responsavel, ou leads parados sem resposta. Retorna no maximo 50 linhas. Campos: id, telefone, nome, provedor, cidade, score_total, classificacao, etapa_funil, agente_atual, ultimo_contato.',
  input_schema: {
    type: 'object',
    properties: {
      etapa_funil: {
        type: 'string',
        description:
          'Filtrar por etapa (novo, qualificacao, negociacao, demo_agendada, proposta_enviada, fechamento, ganho, perdido, nurturing, prospeccao)'
      },
      classificacao: {
        type: 'string',
        enum: ['frio', 'morno', 'quente', 'ultra_quente']
      },
      agente_atual: {
        type: 'string',
        enum: ['sofia', 'leo', 'carlos', 'lucas', 'rafael', 'marcos', 'iani']
      },
      dias_sem_resposta: {
        type: 'integer',
        description:
          'Filtrar leads com sem mensagem enviada/recebida ha N dias (ex: 7 = parados ha 7 dias)'
      },
      origem: {
        type: 'string',
        description: 'Filtrar por origem (whatsapp, outbound, apify, prospector_auto, import)'
      },
      limit: {
        type: 'integer',
        description: 'Max resultados (default 20, max 50)',
        default: 20
      }
    }
  },
  async handler(input) {
    const db = getDb();
    const clauses = [];
    const params = [];
    if (input.etapa_funil) {
      clauses.push('l.etapa_funil = ?');
      params.push(input.etapa_funil);
    }
    if (input.classificacao) {
      clauses.push('l.classificacao = ?');
      params.push(input.classificacao);
    }
    if (input.agente_atual) {
      clauses.push('l.agente_atual = ?');
      params.push(input.agente_atual);
    }
    if (input.origem) {
      clauses.push('l.origem = ?');
      params.push(input.origem);
    }
    if (input.dias_sem_resposta) {
      clauses.push(
        `NOT EXISTS (
          SELECT 1 FROM conversas c
          WHERE c.lead_id = l.id AND c.criado_em > datetime('now', ?)
        )`
      );
      params.push(`-${Number(input.dias_sem_resposta)} days`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(Number(input.limit) || 20, 50);

    const rows = db
      .prepare(
        `SELECT
           l.id, l.telefone, l.nome, l.provedor, l.cidade, l.estado, l.porte, l.erp,
           l.score_total, l.classificacao, l.etapa_funil, l.agente_atual, l.origem,
           (SELECT MAX(criado_em) FROM conversas WHERE lead_id = l.id) as ultimo_contato
         FROM leads l
         ${where}
         ORDER BY l.score_total DESC, l.atualizado_em DESC
         LIMIT ?`
      )
      .all(...params, limit);

    return { count: rows.length, leads: rows };
  }
};
