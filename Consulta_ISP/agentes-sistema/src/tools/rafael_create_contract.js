// Tool: rafael_create_contract
// Gera PDF do contrato apos lead aceitar proposta. Retorna contract_id usado
// em mark_closed_won. Envia PDF via WhatsApp se auto_send.

const { getDb } = require('../models/database');
const { generateContractPdf, generateContractNumber } = require('../services/contract-pdf');
const zapi = require('../services/zapi');
const logger = require('../utils/logger');
const fs = require('fs');

module.exports = {
  name: 'rafael_create_contract',
  description:
    'Gera PDF do contrato de prestacao de servicos + registra em contracts + envia via WhatsApp. Use apos lead aceitar proposta e estar pronto pra fechar. Retorna { contract_id, numero, pdf_path }. Use o contract_id retornado como parametro em mark_closed_won.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' },
      proposal_id: {
        type: 'integer',
        description: 'ID da proposta aceita (da tool lucas_send_proposal).'
      },
      plano: {
        type: 'string',
        enum: ['basico', 'profissional', 'enterprise'],
        description: 'Plano contratado (gratuito nao tem contrato).'
      },
      valor_mensal: { type: 'number' },
      data_inicio: {
        type: 'string',
        description: 'Data inicio vigencia (YYYY-MM-DD).'
      },
      forma_pagamento: {
        type: 'string',
        enum: ['pix', 'boleto', 'cartao'],
        description: 'Default: pix.',
        default: 'pix'
      },
      auto_send: {
        type: 'boolean',
        description: 'Se false, gera mas nao envia. Default env AUTO_SEND_CONTRACT ou false.',
        default: false
      }
    },
    required: ['lead_id', 'plano', 'valor_mensal', 'data_inicio']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(input.lead_id);
    if (!lead) return { ok: false, error: 'lead_not_found' };

    const numero = generateContractNumber(lead.id);
    const formaPagamento = input.forma_pagamento || 'pix';
    const autoSend = input.auto_send !== undefined
      ? input.auto_send
      : (String(process.env.AUTO_SEND_CONTRACT || 'false').toLowerCase() === 'true');

    try {
      const pdfResult = await generateContractPdf({
        leadId: lead.id,
        lead,
        plano: input.plano,
        valorMensal: input.valor_mensal,
        dataInicio: input.data_inicio,
        numero,
        formaPagamento: formaPagamento.toUpperCase()
      });

      const insertResult = db.prepare(
        `INSERT INTO contracts
           (lead_id, proposal_id, numero, plano, valor_mensal, data_inicio,
            pdf_path, status, forma_pagamento, criada_por_agente)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'gerado', ?, ?)`
      ).run(
        lead.id,
        input.proposal_id || null,
        numero,
        input.plano,
        input.valor_mensal,
        input.data_inicio,
        pdfResult.path,
        formaPagamento,
        ctx.agente || 'rafael'
      );
      const contractId = insertResult.lastInsertRowid;

      let sent = false;
      let sendError = null;

      if (autoSend) {
        try {
          const texto =
            `Oi! Segue o contrato em anexo (${numero}). ` +
            `Plano ${input.plano.toUpperCase()} R$${Number(input.valor_mensal).toFixed(2).replace('.', ',')}/mes, ` +
            `vigencia a partir de ${input.data_inicio}. Confirma pra mim por aqui que esta tudo certo?`;

          await zapi.sendText(lead.telefone, texto);
          const pdfBase64 = fs.readFileSync(pdfResult.path).toString('base64');
          await zapi.sendDocument(
            lead.telefone,
            `data:application/pdf;base64,${pdfBase64}`,
            pdfResult.filename
          );

          db.prepare(
            `UPDATE contracts SET status = 'enviado', atualizada_em = CURRENT_TIMESTAMP WHERE id = ?`
          ).run(contractId);

          db.prepare(
            `INSERT INTO conversas (lead_id, agente, direcao, mensagem, tipo, canal, metadata)
             VALUES (?, ?, 'enviada', ?, 'documento', 'whatsapp', ?)`
          ).run(
            lead.id,
            ctx.agente || 'rafael',
            `[CONTRATO ${numero}] ${texto}`,
            JSON.stringify({ contract_id: contractId, pdf_filename: pdfResult.filename })
          );
          sent = true;
        } catch (err) {
          sendError = err.message;
          logger.warn({ lead_id: lead.id, err: err.message }, '[TOOL rafael_create_contract] envio falhou');
        }
      }

      // Atualiza lead
      db.prepare(
        `UPDATE leads SET
           etapa_funil = 'fechamento',
           observacoes = COALESCE(observacoes || char(10), '') || ?,
           atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        `CONTRATO ${numero}: ${input.plano} R$${input.valor_mensal} — inicio ${input.data_inicio}${sent ? ' (enviado)' : ' (pendente envio)'}`,
        lead.id
      );

      logger.info(
        { lead_id: lead.id, contract_id: contractId, numero, sent, agente: ctx.agente },
        '[TOOL rafael_create_contract]'
      );

      return {
        ok: true,
        contract_id: contractId,
        numero,
        pdf_path: pdfResult.path,
        sent,
        send_error: sendError,
        note: 'Use contract_id em mark_closed_won + contrato_pdf_url.',
        next_step_tools: ['rafael_create_payment', 'mark_closed_won']
      };
    } catch (err) {
      logger.error({ lead_id: lead.id, err: err.message }, '[TOOL rafael_create_contract] falha');
      return { ok: false, error: err.message };
    }
  }
};
