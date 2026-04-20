// Tool: leo_generate_ad_creative
// Leo gera headlines + descriptions + body + CTA para uma campanha.
// Retorna arrays prontos pra plugar em Meta Ads / Google Ads.
//
// Uso tipico: Marcos precisa criar campanha → chama leo_generate_ad_creative
// → pega headlines/descriptions → chama ads_create_campaign com essas copys.

const { getDb } = require('../models/database');
const claudeWrapper = require('../utils/claude-client');
const logger = require('../utils/logger');

// Helpers: limites por plataforma
const LIMITS = {
  google: { headline: 30, description: 90, num_headlines: 5, num_descriptions: 4 },
  meta: { headline: 40, primary_text: 125, description: 30, num_headlines: 3, num_descriptions: 2 }
};

const CTA_OPTIONS = {
  meta: ['LEARN_MORE', 'SIGN_UP', 'GET_QUOTE', 'CONTACT_US', 'APPLY_NOW', 'SEE_MORE'],
  google: ['LEARN_MORE', 'GET_STARTED', 'SIGN_UP', 'CONTACT_US']
};

module.exports = {
  name: 'leo_generate_ad_creative',
  description:
    'Leo gera copy para campanha de ads (Meta ou Google) segmentada por mesorregiao. Retorna headlines, descriptions, primary_text (Meta), CTA recomendado + variant_id pra A/B test. Respeita limites de caracteres da plataforma. Pode ser chamada pelo Marcos antes de ads_create_campaign. Persiste em ad_creatives pra reuso e tracking.',
  input_schema: {
    type: 'object',
    properties: {
      platform: { type: 'string', enum: ['meta', 'google'] },
      mesorregiao: {
        type: 'string',
        description: 'Nome legivel da mesorregiao alvo (ex: "Norte Central Paranaense")'
      },
      estado: { type: 'string', description: 'UF (2 letras)' },
      cidades_exemplo: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ate 3 cidades pra usar como referencia regional nas copys'
      },
      objetivo: {
        type: 'string',
        enum: ['leads', 'awareness', 'conversao'],
        description: 'Default: leads'
      },
      tom: {
        type: 'string',
        enum: ['consultivo', 'urgencia', 'social_proof', 'beneficio_claro'],
        description: 'Direcao criativa. Default: beneficio_claro'
      },
      variant_id: {
        type: 'string',
        description: 'Identificador da variante pra A/B test (A, B, C). Default: A'
      },
      ads_campaign_id: {
        type: 'integer',
        description: 'Opcional. Se fornecido, vincula o creative a essa campanha.'
      }
    },
    required: ['platform', 'mesorregiao']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const limits = LIMITS[input.platform];
    const objetivo = input.objetivo || 'leads';
    const tom = input.tom || 'beneficio_claro';
    const variantId = input.variant_id || 'A';

    const cidadesStr = (input.cidades_exemplo || []).slice(0, 3).join(', ') || input.mesorregiao;

    // Prompt pro Claude gerar a copy
    const systemPrompt = `Voce e Leo, copywriter do Consulta ISP (SaaS de analise de credito colaborativa entre provedores de internet). Produto: base colaborativa REGIONAL — quanto mais ISPs da mesma regiao participam, mais eficaz detecta calote.

TARGET: Donos de ISPs regionais (50-2000 clientes). Dor: perdem R$500-1500 por calote. Medo: migracao serial (cliente calote em A, vai pra B, nao paga, vai pra C).

REGRAS DE COPY:
- Sem markdown
- Portugues Brasileiro (voces, a gente)
- NAO usar superlatives vazios ("melhor do mercado")
- Concreto > abstrato (sempre incluir numero ou regiao especifica)
- Tom ${tom}:
  * consultivo: "vamos entender juntos..."
  * urgencia: "enquanto voce le isso, um calote esta acontecendo..."
  * social_proof: "N provedores em {regiao} ja usam"
  * beneficio_claro: "reduza 40% do calote em 60 dias"

LIMITES DE CARACTERES:
- Headline: max ${limits.headline} chars
- Description: max ${limits.description} chars${input.platform === 'meta' ? ' / Primary text: max 125 chars' : ''}

Responda APENAS com JSON valido no formato:
{
  "headlines": ["...", "...", "..."],
  "descriptions": ["...", "..."],
  ${input.platform === 'meta' ? '"primary_text": "...",\n  ' : ''}"cta": "LEARN_MORE | SIGN_UP | GET_QUOTE | ...",
  "rationale": "1 frase explicando a estrategia desta variante"
}`;

    const userPrompt = `Gere creative ${variantId} pra campanha ${input.platform.toUpperCase()} alvo: ${input.mesorregiao} (${input.estado || 'BR'}). Cidades de referencia: ${cidadesStr}. Objetivo: ${objetivo}. Tom: ${tom}.

Preciso de ${limits.num_headlines} headlines e ${limits.num_descriptions} descriptions.${input.platform === 'meta' ? ' Mais 1 primary_text (Meta body).' : ''}`;

    try {
      const response = await claudeWrapper.messages.create(
        {
          model: 'claude-opus-4-7',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        },
        {
          agente: ctx.agente || 'leo',
          lead_id: null,
          contexto: 'generate_ad_creative',
          correlation_id: ctx.correlationId || null
        }
      );

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { ok: false, error: 'claude_response_no_json', raw: text.slice(0, 300) };
      }

      const creative = JSON.parse(jsonMatch[0]);

      // Valida limites
      const overflows = [];
      (creative.headlines || []).forEach((h, i) => {
        if (h.length > limits.headline) overflows.push(`headline[${i}] ${h.length}>${limits.headline}`);
      });
      (creative.descriptions || []).forEach((d, i) => {
        if (d.length > limits.description) overflows.push(`description[${i}] ${d.length}>${limits.description}`);
      });
      if (input.platform === 'meta' && creative.primary_text && creative.primary_text.length > 125) {
        overflows.push(`primary_text ${creative.primary_text.length}>125`);
      }

      // Valida CTA
      const ctaOk = CTA_OPTIONS[input.platform].includes(creative.cta);
      if (!ctaOk) creative.cta = 'LEARN_MORE';

      // Persiste
      const insertResult = db.prepare(
        `INSERT INTO ad_creatives
           (ads_campaign_id, platform, mesorregiao, objetivo,
            headlines, descriptions, body_long, cta, variant_id, criada_por_agente)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.ads_campaign_id || null,
        input.platform,
        input.mesorregiao || null,
        objetivo,
        JSON.stringify(creative.headlines || []),
        JSON.stringify(creative.descriptions || []),
        creative.primary_text || null,
        creative.cta || 'LEARN_MORE',
        variantId,
        ctx.agente || 'leo'
      );

      logger.info(
        {
          creative_id: insertResult.lastInsertRowid,
          platform: input.platform,
          mesorregiao: input.mesorregiao,
          variant: variantId,
          overflows: overflows.length
        },
        '[TOOL leo_generate_ad_creative]'
      );

      return {
        ok: true,
        creative_id: insertResult.lastInsertRowid,
        variant_id: variantId,
        platform: input.platform,
        headlines: creative.headlines,
        descriptions: creative.descriptions,
        primary_text: creative.primary_text,
        cta: creative.cta,
        rationale: creative.rationale,
        overflows: overflows.length ? overflows : null,
        warning: overflows.length
          ? 'Algumas copys estouraram o limite — truncar antes de usar'
          : null
      };
    } catch (err) {
      logger.error({ err: err.message }, '[TOOL leo_generate_ad_creative] falha');
      return { ok: false, error: err.message };
    }
  }
};
