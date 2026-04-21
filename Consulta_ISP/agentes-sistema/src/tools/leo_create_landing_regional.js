// Tool: leo_create_landing_regional
// Leo gera landing HTML estatica pra mesorregiao alvo. Salva em
// public/landings/<slug>.html (servido via Express static).
// URL final: /landings/<slug>.html

const { buildLanding } = require('../services/landing-builder');
const { getDb } = require('../models/database');
const regioes = require('../services/regioes');
const logger = require('../utils/logger');

module.exports = {
  name: 'leo_create_landing_regional',
  description:
    'Gera landing page HTML estatica segmentada por mesorregiao. URL publica: /landings/<slug>.html. Usa headline/subheadline/case personalizados ou defaults inteligentes. Ideal pra Marcos apontar campanhas Meta/Google Ads pra URL especifica da regiao (conversao melhora quando landing fala a lingua local).',
  input_schema: {
    type: 'object',
    properties: {
      uf: { type: 'string', description: 'UF (2 letras)' },
      mesorregiao_slug: {
        type: 'string',
        description: 'Slug IBGE (ex: "norte-central-paranaense")'
      },
      headline: {
        type: 'string',
        description: 'Opcional. H1 principal. Default: "Rede colaborativa de credito pra ISPs [mesorregiao]"'
      },
      subheadline: { type: 'string', description: 'Opcional.' },
      case_texto: {
        type: 'string',
        description: 'Opcional. Caso de sucesso exibido destacado. Default: generico.'
      },
      cta_calendly_url: {
        type: 'string',
        description: 'Opcional. Default: env CALENDLY_DEMO_URL'
      },
      cta_whatsapp_url: {
        type: 'string',
        description: 'Opcional. Default: https://wa.me/5535999999999 (ajustar)'
      }
    },
    required: ['uf', 'mesorregiao_slug']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const meso = regioes.getMesorregiao(input.uf, input.mesorregiao_slug);
    if (!meso) {
      return {
        ok: false,
        error: 'mesorregiao_nao_encontrada',
        hint: 'Use GET /api/regioes/:uf/mesorregioes pra listar slugs validos'
      };
    }

    // Conta provedores ja na rede (leads com ganho na mesorregiao)
    const ganhos = db.prepare(
      "SELECT COUNT(*) AS c FROM leads WHERE mesorregiao = ? AND etapa_funil = 'ganho'"
    ).get(input.mesorregiao_slug).c;

    const total = db.prepare(
      "SELECT COUNT(*) AS c FROM leads WHERE mesorregiao = ?"
    ).get(input.mesorregiao_slug).c;

    // Numero a exibir: ganhos se > 0, senao "varios" (nao mente se nao ha cliente)
    const numProvedoresExibir = ganhos > 0 ? String(ganhos) : (total >= 10 ? 'varios' : null);

    try {
      const result = buildLanding({
        mesorregiao_slug: input.mesorregiao_slug,
        mesorregiao_nome: meso.nome,
        uf: input.uf,
        cidades_principais: meso.cidades.slice(0, 6),
        headline: input.headline,
        subheadline: input.subheadline,
        case_texto: input.case_texto,
        num_provedores_regiao: numProvedoresExibir,
        cta_calendly_url: input.cta_calendly_url,
        cta_whatsapp_url: input.cta_whatsapp_url
      });

      // Registra atividade
      db.prepare(
        `INSERT INTO atividades_agentes (agente, tipo, descricao)
         VALUES (?, 'landing_created', ?)`
      ).run(
        ctx.agente || 'leo',
        `Landing ${input.mesorregiao_slug} (${input.uf}) → ${result.publicUrl}`
      );

      logger.info(
        { mesorregiao: input.mesorregiao_slug, uf: input.uf, url: result.publicUrl, bytes: result.bytes },
        '[TOOL leo_create_landing_regional]'
      );

      return {
        ok: true,
        public_url: result.publicUrl,
        filename: result.filename,
        bytes: result.bytes,
        mesorregiao: meso.nome,
        cidades_principais: meso.cidades.slice(0, 6),
        num_provedores_exibidos: numProvedoresExibir,
        note: 'Pagina acessivel em GET /landings/' + result.filename + ' (servido via Express static)'
      };
    } catch (err) {
      logger.error({ err: err.message }, '[TOOL leo_create_landing_regional] falha');
      return { ok: false, error: err.message };
    }
  }
};
