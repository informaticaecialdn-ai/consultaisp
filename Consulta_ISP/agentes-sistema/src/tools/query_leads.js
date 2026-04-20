// Tool: query_leads
// Filtra leads por criterios (etapa, classificacao, agente, mesorregiao, erp, enriquecido).

const { getDb } = require('../models/database');

module.exports = {
  name: 'query_leads',
  description:
    'Lista leads filtrados. Filtros disponiveis: etapa_funil, classificacao, agente_atual, dias_sem_resposta, origem, mesorregiao, erp, tem_cnpj, tem_email. Retorna no maximo 50 linhas com campos: id, telefone, nome, provedor, cnpj, razao_social, cidade, estado, mesorregiao_nome, porte, erp, num_clientes, decisor, score_total, classificacao, etapa_funil, agente_atual, origem, ultimo_contato, enriched_at.',
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
      mesorregiao: {
        type: 'string',
        description:
          'Filtrar por slug de mesorregiao IBGE. Ex: "norte-central-paranaense", "sul-sudoeste-de-minas". Util pra Sofia/Iani analisarem conquista regional.'
      },
      estado: {
        type: 'string',
        description: 'Filtrar por UF (2 letras). Ex: "PR", "SP".'
      },
      erp: {
        type: 'string',
        enum: ['ixc', 'mk', 'sgp', 'hubsoft', 'voalle', 'rbx', 'topsapp', 'radiusnet', 'gere', 'outro'],
        description: 'Filtrar por ERP usado. Util pra segmentar campanhas ou pitch de integracao nativa.'
      },
      tem_cnpj: {
        type: 'boolean',
        description: 'Se true, so leads com CNPJ preenchido (enriquecidos via Receita).'
      },
      tem_email: {
        type: 'boolean',
        description: 'Se true, so leads com email preenchido (permite outbound por email).'
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
    if (input.mesorregiao) {
      clauses.push('l.mesorregiao = ?');
      params.push(input.mesorregiao);
    }
    if (input.estado) {
      clauses.push('l.estado = ?');
      params.push(String(input.estado).toUpperCase());
    }
    if (input.erp) {
      clauses.push('l.erp = ?');
      params.push(input.erp);
    }
    if (input.tem_cnpj) {
      clauses.push("l.cnpj IS NOT NULL AND l.cnpj != ''");
    }
    if (input.tem_email) {
      clauses.push("l.email IS NOT NULL AND l.email != ''");
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
           l.id, l.telefone, l.nome, l.provedor,
           l.cnpj, l.razao_social, l.situacao_receita,
           l.cidade, l.estado, l.mesorregiao, l.mesorregiao_nome,
           l.porte, l.erp, l.num_clientes, l.decisor, l.email,
           l.score_total, l.classificacao, l.etapa_funil, l.agente_atual, l.origem,
           l.enriched_at,
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
