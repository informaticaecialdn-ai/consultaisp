// Tool: create_proposal (Milestone 2 / D2).
// Lucas gera uma proposta estruturada pro lead e registra em tarefas.
// Por seguranca, NAO envia PDF nem dispara boleto automaticamente.
// Flag AUTO_SEND_PROPOSAL=true habilita envio via PDF em futuro.

const { getDb } = require('../models/database');
const logger = require('../utils/logger');

const PLANOS = {
  gratuito: { nome: 'Gratuito', valor_mensal: 0, creditos_isp: 30, creditos_spc: 0 },
  basico: { nome: 'Basico', valor_mensal: 149, creditos_isp: 200, creditos_spc: 50 },
  profissional: { nome: 'Profissional', valor_mensal: 349, creditos_isp: 500, creditos_spc: 150 },
  enterprise: { nome: 'Enterprise', valor_mensal: 690, creditos_isp: 1500, creditos_spc: 500 }
};

module.exports = {
  name: 'create_proposal',
  description:
    'Cria uma proposta comercial estruturada para o lead e registra como tarefa pendente. A proposta inclui plano recomendado (gratuito|basico|profissional|enterprise), valor mensal, creditos inclusos e resumo do ROI calculado. NAO envia PDF automaticamente (operador valida antes). Atualiza etapa_funil=proposta_enviada.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' },
      plano: {
        type: 'string',
        enum: ['gratuito', 'basico', 'profissional', 'enterprise'],
        description:
          'Plano recomendado. Use basico pra ISPs <500 clientes, profissional pra 500-2000, enterprise pra 2000+.'
      },
      valor_customizado: {
        type: 'number',
        description: 'Override de valor_mensal se negociou desconto. Default: valor padrao do plano.'
      },
      roi_resumo: {
        type: 'string',
        description:
          'Justificativa de ROI em 2-3 frases (ex: "Perde R$5k/mes com inadimplencia. Plano profissional R$349 se paga em 15 dias").'
      },
      validade_dias: {
        type: 'integer',
        description: 'Dias de validade da proposta. Default 7.',
        default: 7
      }
    },
    required: ['lead_id', 'plano', 'roi_resumo']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(input.lead_id);
    if (!lead) return { ok: false, reason: 'lead_not_found' };

    const planoConfig = PLANOS[input.plano];
    if (!planoConfig) return { ok: false, reason: 'plano_invalido' };

    const valor = Number(input.valor_customizado) || planoConfig.valor_mensal;
    const validade = Math.max(1, Math.min(Number(input.validade_dias) || 7, 30));
    const validadeAte = new Date(Date.now() + validade * 86400_000).toISOString();

    const proposta = {
      plano: planoConfig.nome,
      valor_mensal: valor,
      creditos_isp: planoConfig.creditos_isp,
      creditos_spc: planoConfig.creditos_spc,
      roi_resumo: input.roi_resumo,
      validade_ate: validadeAte,
      gerada_por: ctx.agente || lead.agente_atual
    };

    db.prepare(
      `INSERT INTO tarefas (lead_id, agente, tipo, descricao, status, prioridade, dados)
       VALUES (?, ?, 'proposta', ?, 'pendente', 'alta', ?)`
    ).run(
      input.lead_id,
      ctx.agente || lead.agente_atual,
      `Proposta ${planoConfig.nome} R$${valor}/mes — ${input.roi_resumo.slice(0, 140)}`,
      JSON.stringify(proposta)
    );

    db.prepare(
      `UPDATE leads SET
         etapa_funil = 'proposta_enviada',
         valor_estimado = ?,
         observacoes = COALESCE(observacoes || char(10), '') || ?,
         atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      valor,
      `PROPOSTA: ${planoConfig.nome} R$${valor}/mes validade ${validade}d — ${input.roi_resumo}`,
      input.lead_id
    );

    db.prepare(
      `INSERT INTO atividades_agentes (agente, tipo, descricao, lead_id, decisao)
       VALUES (?, 'proposta_enviada', ?, ?, ?)`
    ).run(
      ctx.agente || lead.agente_atual,
      `Proposta ${planoConfig.nome} R$${valor}`,
      input.lead_id,
      input.plano
    );

    logger.info(
      { lead_id: input.lead_id, plano: input.plano, valor, agente: ctx.agente },
      '[TOOL create_proposal]'
    );

    return {
      ok: true,
      proposta,
      requires_approval: String(process.env.AUTO_SEND_PROPOSAL || 'false').toLowerCase() !== 'true'
    };
  }
};
