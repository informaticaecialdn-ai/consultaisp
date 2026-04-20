// Tool: lookup_cnpj (enriquecimento via ReceitaWS).
// Agente fornece CNPJ (ou lead_id para buscar CNPJ ja salvo) e recebe:
// razao social, fantasia, situacao, porte, atividade principal, endereco,
// email/telefone oficiais, socios (QSA).
//
// Se lead_id for fornecido, PERSISTE os dados no lead (leads.dados_receita + campos).

const receitaws = require('../services/receitaws');
const { getDb } = require('../models/database');
const logger = require('../utils/logger');

module.exports = {
  name: 'lookup_cnpj',
  description:
    'Consulta Receita Federal (ReceitaWS) por CNPJ e retorna razao social, nome fantasia, situacao (ATIVA/BAIXADA/etc), porte, atividade principal, endereco completo, email/telefone oficiais e socios (QSA). Se lead_id for fornecido, persiste os dados no lead (campo cnpj, razao_social, situacao_receita, dados_receita JSON). Usa cache 24h. Importante pra descobrir: e o decisor? que tamanho tem? ta ativa? quem sao os socios?',
  input_schema: {
    type: 'object',
    properties: {
      cnpj: {
        type: 'string',
        description: 'CNPJ com ou sem formatacao (14 digitos). Ex: "12.345.678/0001-90" ou "12345678000190".'
      },
      lead_id: {
        type: 'integer',
        description:
          'Se fornecido E o lead ja tem cnpj salvo, usa esse. Se fornecido junto com cnpj, persiste o resultado no lead.'
      },
      force_refresh: {
        type: 'boolean',
        description: 'Ignora cache e busca direto na Receita (use com parcimonia — rate limit).',
        default: false
      }
    }
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    let cnpj = input.cnpj;
    let lead = null;

    // Resolve lead + eventual CNPJ salvo
    if (input.lead_id) {
      try {
        lead = db.prepare('SELECT id, cnpj, dados_receita, dados_receita_at FROM leads WHERE id = ?').get(input.lead_id);
        if (!lead) return { ok: false, error: 'lead_not_found' };
        if (!cnpj && lead.cnpj) cnpj = lead.cnpj;
      } catch (err) {
        // Migration 019 pode nao estar aplicada
        logger.warn({ err: err.message }, '[TOOL lookup_cnpj] migration 019 pendente?');
      }
    }

    if (!cnpj) return { ok: false, error: 'cnpj_required', message: 'forneca cnpj ou lead_id com cnpj ja salvo' };

    const normalized = receitaws.normalizeCnpj(cnpj);
    if (!normalized) return { ok: false, error: 'cnpj_invalido' };

    // Se lead ja tem dados recentes (<24h), retornar cache do DB sem chamar API
    if (!input.force_refresh && lead?.dados_receita && lead.dados_receita_at) {
      const age = Date.now() - new Date(lead.dados_receita_at).getTime();
      if (age < 24 * 60 * 60 * 1000) {
        try {
          const raw = JSON.parse(lead.dados_receita);
          return {
            ok: true,
            cached: 'db',
            age_hours: Math.round(age / 3600_000),
            summary: receitaws.summarize(raw),
            cnpj: normalized
          };
        } catch { /* cai pra API */ }
      }
    }

    // Chama API
    const result = await receitaws.lookup(normalized, { useCache: !input.force_refresh });
    if (!result.ok) {
      return { ok: false, ...result };
    }

    const summary = receitaws.summarize(result.data);

    // Persiste no lead se lead_id fornecido
    if (input.lead_id && lead) {
      try {
        db.prepare(
          `UPDATE leads SET
             cnpj = ?,
             razao_social = ?,
             situacao_receita = ?,
             dados_receita = ?,
             dados_receita_at = CURRENT_TIMESTAMP,
             atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(
          normalized,
          summary.razao_social || null,
          summary.situacao || null,
          JSON.stringify(result.data),
          input.lead_id
        );

        // Opcional: enriquecer campos "genericos" que ainda estao vazios
        const leadFull = db.prepare('SELECT nome, email, cidade, estado FROM leads WHERE id = ?').get(input.lead_id);
        const updates = [];
        const vals = [];
        if (!leadFull.nome && summary.fantasia) {
          updates.push('nome = ?');
          vals.push(summary.fantasia);
        }
        if (!leadFull.email && summary.email) {
          updates.push('email = ?');
          vals.push(summary.email);
        }
        if (!leadFull.cidade && summary.municipio) {
          updates.push('cidade = ?');
          vals.push(summary.municipio);
        }
        if (!leadFull.estado && summary.uf) {
          updates.push('estado = ?');
          vals.push(summary.uf);
        }
        if (updates.length) {
          vals.push(input.lead_id);
          db.prepare(`UPDATE leads SET ${updates.join(', ')}, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`).run(...vals);
        }
      } catch (err) {
        logger.warn({ lead_id: input.lead_id, err: err.message }, '[TOOL lookup_cnpj] falha ao persistir');
      }
    }

    logger.info(
      { cnpj: normalized, lead_id: input.lead_id, cached: result.cached, agente: ctx.agente },
      '[TOOL lookup_cnpj]'
    );

    return {
      ok: true,
      cached: result.cached,
      cnpj: normalized,
      summary
    };
  }
};
