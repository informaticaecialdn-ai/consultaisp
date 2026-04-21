// Tool: sofia_adjust_icp
// Sofia analisa performance regional e ajusta config do prospector:
// ativa novas mesorregioes promissoras, pausa mesorregioes com baixa
// conversao, ajusta min_rating/min_reviews se qualidade do lead caiu.

const { getDb } = require('../models/database');
const logger = require('../utils/logger');

module.exports = {
  name: 'sofia_adjust_icp',
  description:
    'Sofia ajusta config do prospector baseado em performance regional. Pode ADICIONAR mesorregiao promissora (ja tem leads quentes organicos) ou REMOVER mesorregiao improdutiva (>30 leads, 0 qualificados). Muda min_rating/min_reviews se analise indicar. Max 3 mudancas por chamada (evita swing). Registra decisao em atividades_agentes.',
  input_schema: {
    type: 'object',
    properties: {
      add_mesorregioes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            uf: { type: 'string' },
            slug: { type: 'string' },
            nome: { type: 'string' }
          },
          required: ['uf', 'slug', 'nome']
        },
        description: 'Mesorregioes pra incluir no prospector. Max 3.'
      },
      remove_mesorregioes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            uf: { type: 'string' },
            slug: { type: 'string' }
          },
          required: ['uf', 'slug']
        },
        description: 'Mesorregioes pra remover do prospector. Max 3.'
      },
      min_rating: {
        type: 'number',
        description: 'Opcional. Min rating Google novo (0-5). So mude se tem evidencia forte.'
      },
      min_reviews: {
        type: 'integer',
        description: 'Opcional. Min reviews novo. So mude se tem evidencia forte.'
      },
      rationale: {
        type: 'string',
        description: 'Justificativa da decisao (obrigatorio).'
      }
    },
    required: ['rationale']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const cfg = db.prepare('SELECT * FROM prospector_config WHERE id = 1').get();
    if (!cfg) return { ok: false, error: 'prospector_config_nao_existe' };

    let mesorregioes;
    try {
      mesorregioes = JSON.parse(cfg.mesorregioes || '[]');
    } catch {
      mesorregioes = [];
    }

    const changes = [];

    // Add (max 3)
    const toAdd = (input.add_mesorregioes || []).slice(0, 3);
    for (const m of toAdd) {
      const existe = mesorregioes.some((x) => x.uf === m.uf && x.slug === m.slug);
      if (!existe) {
        mesorregioes.push({ uf: m.uf, slug: m.slug, nome: m.nome });
        changes.push(`+ ${m.nome} (${m.uf})`);
      }
    }

    // Remove (max 3)
    const toRemove = (input.remove_mesorregioes || []).slice(0, 3);
    for (const m of toRemove) {
      const antes = mesorregioes.length;
      mesorregioes = mesorregioes.filter((x) => !(x.uf === m.uf && x.slug === m.slug));
      if (mesorregioes.length < antes) {
        changes.push(`- ${m.slug} (${m.uf})`);
      }
    }

    const updates = {
      mesorregioes: JSON.stringify(mesorregioes),
      min_rating: input.min_rating !== undefined ? Number(input.min_rating) : cfg.min_rating,
      min_reviews: input.min_reviews !== undefined ? Number(input.min_reviews) : cfg.min_reviews
    };

    if (input.min_rating !== undefined && input.min_rating !== cfg.min_rating) {
      changes.push(`min_rating: ${cfg.min_rating} → ${input.min_rating}`);
    }
    if (input.min_reviews !== undefined && input.min_reviews !== cfg.min_reviews) {
      changes.push(`min_reviews: ${cfg.min_reviews} → ${input.min_reviews}`);
    }

    if (changes.length === 0) {
      return { ok: true, no_changes: true, note: 'Nenhuma mudanca aplicada (nada a fazer).' };
    }

    db.prepare(
      `UPDATE prospector_config SET
         mesorregioes = ?, min_rating = ?, min_reviews = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = 1`
    ).run(updates.mesorregioes, updates.min_rating, updates.min_reviews);

    db.prepare(
      `INSERT INTO atividades_agentes (agente, tipo, descricao, decisao)
       VALUES (?, 'icp_adjust', ?, ?)`
    ).run(ctx.agente || 'sofia', `ICP adjust: ${changes.join('; ')}`, input.rationale);

    logger.info(
      { changes, rationale: input.rationale, agente: ctx.agente },
      '[TOOL sofia_adjust_icp]'
    );

    return {
      ok: true,
      changes,
      new_config: {
        mesorregioes_count: mesorregioes.length,
        min_rating: updates.min_rating,
        min_reviews: updates.min_reviews
      },
      rationale: input.rationale
    };
  }
};
