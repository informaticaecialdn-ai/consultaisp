// Tool: lucas_send_proposal
// Gera PDF de proposta comercial, registra em `proposals`, envia via Z-API
// como documento. Substitui o antigo create_proposal que so gravava tarefa.

const { getDb } = require('../models/database');
const { generateProposalPdf } = require('../services/proposal-pdf');
const zapi = require('../services/zapi');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

module.exports = {
  name: 'lucas_send_proposal',
  description:
    'Gera PDF da proposta comercial + registra em proposals + ENVIA via Z-API como documento pro WhatsApp do lead. Use apos qualificacao, lead aceitou em principio e quer ver numeros. PDF e gerado em /data/proposals/PR-YYYY-NNNNNN.pdf. Retorna { proposal_id, pdf_path, valor_final, sent }.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' },
      plano: {
        type: 'string',
        enum: ['gratuito', 'basico', 'profissional', 'enterprise']
      },
      valor_customizado: {
        type: 'number',
        description: 'Opcional. Valor mensal com desconto. Default: valor padrao do plano.'
      },
      roi_resumo: {
        type: 'string',
        description: 'Justificativa ROI em 2-3 frases, personalizada para esse lead.'
      },
      validade_dias: {
        type: 'integer',
        description: 'Dias de validade da proposta. Default 7.',
        default: 7
      },
      message: {
        type: 'string',
        description: 'Texto curto pra acompanhar o PDF no WhatsApp. Max 3 frases. Default: gera automaticamente.'
      },
      auto_send: {
        type: 'boolean',
        description: 'Se false, gera PDF mas NAO envia (operador revisa). Default: env AUTO_SEND_PROPOSAL (fallback false).',
        default: false
      }
    },
    required: ['lead_id', 'plano', 'roi_resumo']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(input.lead_id);
    if (!lead) return { ok: false, error: 'lead_not_found' };

    const autoSend = input.auto_send !== undefined
      ? input.auto_send
      : (String(process.env.AUTO_SEND_PROPOSAL || 'false').toLowerCase() === 'true');

    try {
      const pdfResult = await generateProposalPdf({
        leadId: lead.id,
        lead,
        plano: input.plano,
        valorCustomizado: input.valor_customizado,
        roiResumo: input.roi_resumo,
        validadeDias: input.validade_dias || 7
      });

      const validadeAte = new Date(Date.now() + (input.validade_dias || 7) * 86400_000).toISOString();

      const insertResult = db.prepare(
        `INSERT INTO proposals (lead_id, plano, valor_mensal, valor_customizado, roi_resumo,
           validade_ate, pdf_path, criada_por_agente, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'enviada')`
      ).run(
        lead.id,
        input.plano,
        pdfResult.valorFinal,
        input.valor_customizado || null,
        input.roi_resumo,
        validadeAte,
        pdfResult.path,
        ctx.agente || 'lucas'
      );
      const proposalId = insertResult.lastInsertRowid;

      // Atualiza lead
      db.prepare(
        `UPDATE leads SET
           etapa_funil = 'proposta_enviada',
           valor_estimado = ?,
           observacoes = COALESCE(observacoes || char(10), '') || ?,
           atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        pdfResult.valorFinal,
        `PROPOSTA ${pdfResult.numero}: ${input.plano} R$${pdfResult.valorFinal}/mes — ${input.roi_resumo.slice(0, 140)}`,
        lead.id
      );

      let sent = false;
      let sendError = null;

      if (autoSend) {
        try {
          const defaultMsg =
            `Oi! Seguindo nossa conversa, mandei sua proposta em PDF em anexo. ` +
            `Plano ${input.plano} por R$${pdfResult.valorFinal.toFixed(2).replace('.', ',')}/mes. ` +
            `Qualquer duvida, e so me chamar.`;
          const texto = input.message || defaultMsg;

          // Primeiro texto
          await zapi.sendText(lead.telefone, texto);
          // Depois documento — precisa URL publica OU base64. Como nao temos
          // servico de hosting, vamos enviar como base64 via sendDocument.
          // zapi.sendDocument ja aceita base64 data URI se configurado.
          const pdfBase64 = fs.readFileSync(pdfResult.path).toString('base64');
          await zapi.sendDocument(
            lead.telefone,
            `data:application/pdf;base64,${pdfBase64}`,
            pdfResult.filename
          );

          db.prepare(
            `INSERT INTO conversas (lead_id, agente, direcao, mensagem, tipo, canal, metadata)
             VALUES (?, ?, 'enviada', ?, 'documento', 'whatsapp', ?)`
          ).run(
            lead.id,
            ctx.agente || 'lucas',
            `[PROPOSTA ${pdfResult.numero}] ${texto}`,
            JSON.stringify({ proposal_id: proposalId, pdf_filename: pdfResult.filename })
          );
          sent = true;
        } catch (err) {
          sendError = err.message;
          logger.warn({ lead_id: lead.id, err: err.message }, '[TOOL lucas_send_proposal] envio Z-API falhou');
        }
      }

      db.prepare(
        `INSERT INTO tarefas (lead_id, agente, tipo, descricao, status, prioridade, dados)
         VALUES (?, ?, 'proposta', ?, ?, 'alta', ?)`
      ).run(
        lead.id,
        ctx.agente || 'lucas',
        `Proposta ${pdfResult.numero}: ${input.plano} R$${pdfResult.valorFinal}`,
        sent ? 'concluida' : 'pendente',
        JSON.stringify({ proposal_id: proposalId, pdf_path: pdfResult.path, sent, sendError })
      );

      logger.info(
        { lead_id: lead.id, proposal_id: proposalId, sent, agente: ctx.agente },
        '[TOOL lucas_send_proposal]'
      );

      return {
        ok: true,
        proposal_id: proposalId,
        numero: pdfResult.numero,
        pdf_path: pdfResult.path,
        valor_final: pdfResult.valorFinal,
        sent,
        send_error: sendError,
        note: sent
          ? 'PDF gerado e enviado via WhatsApp'
          : autoSend
            ? `PDF gerado mas envio falhou: ${sendError}`
            : 'PDF gerado — envio desativado (AUTO_SEND_PROPOSAL=false). Revise antes.'
      };
    } catch (err) {
      logger.error({ lead_id: lead.id, err: err.message }, '[TOOL lucas_send_proposal] falha');
      return { ok: false, error: err.message };
    }
  }
};
