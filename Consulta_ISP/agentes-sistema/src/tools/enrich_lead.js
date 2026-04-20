// Tool: enrich_lead
// Permite ao agente persistir dados extraidos da conversa (nome, provedor, cidade, etc).
// E um UPDATE estruturado — nao faz scraping externo aqui (isso e outra frente).

const { getDb } = require('../models/database');
const logger = require('../utils/logger');

const ALLOWED_FIELDS = [
  'nome',
  'provedor',
  'cidade',
  'estado',
  'regiao',
  'porte',
  'erp',
  'num_clientes',
  'decisor',
  'email',
  'cargo',
  'site',
  'valor_estimado',
  'cnpj',
  'razao_social'
];

module.exports = {
  name: 'enrich_lead',
  description:
    'Atualiza dados do lead com informacoes extraidas da conversa (nome do decisor, provedor, cidade, porte, ERP, numero de clientes, email, cargo, site). So aplica campos que voce tem certeza — campos vazios/null sao ignorados. Use APOS extrair a informacao na conversa.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' },
      dados: {
        type: 'object',
        description: 'Objeto com campos a atualizar. Use so os campos que voce descobriu.',
        properties: {
          nome: { type: 'string' },
          provedor: { type: 'string' },
          cidade: { type: 'string' },
          estado: { type: 'string', description: 'UF 2 letras' },
          regiao: { type: 'string' },
          porte: {
            type: 'string',
            enum: ['pequeno', 'medio', 'grande', 'enterprise', 'desconhecido']
          },
          erp: { type: 'string', description: 'ixc, mk, sgp, hubsoft, voalle, rbx, outro' },
          num_clientes: { type: 'integer' },
          decisor: { type: 'string', description: 'Nome ou cargo do decisor' },
          email: { type: 'string' },
          cargo: { type: 'string' },
          site: { type: 'string' },
          valor_estimado: { type: 'number', description: 'Ticket medio mensal estimado em R$' },
          cnpj: { type: 'string', description: 'CNPJ (14 digitos ou formatado). Depois de salvar, use lookup_cnpj pra enriquecer o resto.' },
          razao_social: { type: 'string', description: 'Razao social vinda da Receita Federal' }
        }
      }
    },
    required: ['lead_id', 'dados']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(input.lead_id);
    if (!lead) return { ok: false, reason: 'lead_not_found' };

    const dados = input.dados || {};
    const fields = [];
    const values = [];

    for (const [key, val] of Object.entries(dados)) {
      if (!ALLOWED_FIELDS.includes(key)) continue;
      if (val === null || val === undefined || val === '' || val === 'null') continue;
      fields.push(`${key} = ?`);
      values.push(val);
    }

    if (fields.length === 0) return { ok: true, updated: [], message: 'nenhum campo novo' };

    fields.push('atualizado_em = CURRENT_TIMESTAMP');
    values.push(input.lead_id);

    db.prepare(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    logger.info(
      { lead_id: input.lead_id, campos: Object.keys(dados), agente: ctx.agente },
      '[TOOL enrich_lead]'
    );

    return { ok: true, updated: Object.keys(dados) };
  }
};
