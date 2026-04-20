// Tool: notify_operator (Milestone 3 / F1).
// Diana avisa operador humano de anomalia que exige intervencao.
// Loga em errors_log como 'supervisor_alert' e tenta webhook se ERROR_REPORT_WEBHOOK setado.

const { getDb } = require('../models/database');
const logger = require('../utils/logger');

module.exports = {
  name: 'notify_operator',
  description:
    'Registra alerta de Diana pro operador humano (anomalia que o sistema nao sabe resolver sozinho). Grava em errors_log + envia webhook se configurado. Use com parcimonia — so pra coisas que exigem olho humano.',
  input_schema: {
    type: 'object',
    properties: {
      severity: {
        type: 'string',
        enum: ['info', 'warn', 'critical'],
        description: 'Severidade do alerta.'
      },
      titulo: { type: 'string' },
      mensagem: {
        type: 'string',
        description: 'Descricao detalhada do que aconteceu e recomendacao de acao.'
      },
      contexto: {
        type: 'object',
        description: 'Dados extras (lead_id, numeros, etc).'
      }
    },
    required: ['severity', 'titulo', 'mensagem']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const severity = input.severity || 'info';

    try {
      db.prepare(
        `INSERT INTO errors_log (origem, severity, mensagem, contexto, resolvido)
         VALUES ('supervisor', ?, ?, ?, 0)`
      ).run(
        severity,
        `[${input.titulo}] ${input.mensagem}`,
        JSON.stringify({
          supervisor_alert: true,
          from_agent: ctx.agente || 'diana',
          ...(input.contexto || {})
        })
      );
    } catch (err) {
      logger.warn({ err: err.message }, '[TOOL notify_operator] errors_log indisponivel');
    }

    const webhook = process.env.ERROR_REPORT_WEBHOOK;
    let webhookSent = false;
    if (webhook) {
      try {
        const payload = {
          content: `[${severity.toUpperCase()}] ${input.titulo}\n${input.mensagem}${input.contexto ? '\n```\n' + JSON.stringify(input.contexto, null, 2) + '\n```' : ''}`,
          username: 'Diana (Supervisor IA)'
        };
        const r = await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        webhookSent = r.ok;
      } catch (err) {
        logger.warn({ err: err.message }, '[TOOL notify_operator] webhook falhou');
      }
    }

    logger.info(
      { severity, titulo: input.titulo, webhookSent, agente: ctx.agente },
      '[TOOL notify_operator]'
    );

    return { ok: true, severity, webhook_sent: webhookSent };
  }
};
