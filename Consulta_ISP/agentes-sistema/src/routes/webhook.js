const express = require('express');
const router = express.Router();
const orchestrator = require('../services/orchestrator');
const { getDb } = require('../models/database');
const consent = require('../services/consent');
const campanhasService = require('../services/campanhas');
const followup = require('../services/followup');
const zapi = require('../services/zapi');
const logger = require('../utils/logger');
const { maskPhone, maskMessage } = require('../utils/pii');

// Sprint 2 / T2: validacao de token Z-API via header x-z-api-token
function validateZapiToken(req, res) {
  const expected = process.env.ZAPI_WEBHOOK_TOKEN;
  const enforce = process.env.ZAPI_WEBHOOK_ENFORCE === 'true';
  const provided = req.get('x-z-api-token') || req.get('X-Z-API-Token') || '';

  if (!expected) {
    if (enforce) {
      logger.error('[WEBHOOK-HMAC] enforce=true mas ZAPI_WEBHOOK_TOKEN ausente no .env');
      res.status(401).json({ error: 'webhook_token_not_configured' });
      return false;
    }
    return true;
  }

  if (!provided) {
    if (enforce) {
      res.status(401).json({ error: 'webhook_token_missing' });
      return false;
    }
    logger.warn('[WEBHOOK-HMAC] token ausente (modo log-only, enforce=false)');
    return true;
  }

  if (provided !== expected) {
    if (enforce) {
      res.status(401).json({ error: 'webhook_token_invalid' });
      return false;
    }
    logger.warn('[WEBHOOK-HMAC] token divergente (modo log-only, enforce=false)');
    return true;
  }
  return true;
}

// Webhook Z-API - recebe mensagens do WhatsApp
router.post('/zapi', async (req, res) => {
  if (!validateZapiToken(req, res)) return;
  try {
    const data = req.body;

    if (!data.phone || !data.text?.message) {
      return res.status(200).json({ status: 'ignored' });
    }

    if (data.fromMe) {
      return res.status(200).json({ status: 'own_message' });
    }

    const phone = data.phone;
    const message = data.text.message;
    const messageData = {
      type: data.type || 'texto',
      messageId: data.messageId,
      timestamp: data.moment
    };

    logger.info({ phone: maskPhone(phone), preview: maskMessage(message) }, '[WEBHOOK] mensagem recebida');

    // Sprint 2 / T3: opt-out automatico com regex ESTRITA antes do orchestrator.
    // Cancela followups, marca opt-out e responde confirmacao. NAO processa mensagem.
    if (consent.detectOptOutFromMessage(message)) {
      consent.markOptOut(phone, 'mensagem_stop', 'webhook');
      try {
        const db = getDb();
        const lead = db.prepare('SELECT id FROM leads WHERE telefone = ?').get(phone);
        if (lead) followup.cancelFollowups(lead.id);
      } catch (err) {
        logger.warn({ err: err.message }, '[WEBHOOK] falha ao cancelar followups no opt-out');
      }
      try {
        await zapi.sendText(phone, 'Voce foi removido da nossa lista. Nao recebera mais mensagens. Obrigado!');
      } catch (err) {
        logger.warn({ err: err.message }, '[WEBHOOK] falha ao enviar confirmacao de opt-out');
      }
      logger.info({ phone: maskPhone(phone) }, '[WEBHOOK] opt-out registrado via mensagem STOP');
      return res.status(200).json({ ok: true, action: 'optout' });
    }

    // Marca resposta no campanha_envios se lead recebeu broadcast recente
    try {
      const db = getDb();
      const lead = db.prepare('SELECT id FROM leads WHERE telefone = ?').get(phone);
      if (lead) {
        const envio = db.prepare(`
          SELECT id, campanha_id FROM campanha_envios
          WHERE lead_id = ? AND status IN ('enviado','entregue','lido')
          ORDER BY enviado_em DESC LIMIT 1
        `).get(lead.id);
        if (envio) {
          db.prepare(`
            UPDATE campanha_envios
            SET status = 'respondido', respondido_em = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(envio.id);
          campanhasService.incrementCounter(envio.campanha_id, 'respondidos_count');
        }
      }
    } catch (err) {
      logger.warn({ err: err.message }, '[WEBHOOK] falha ao atualizar campanha_envios');
    }

    const result = await orchestrator.processIncoming(phone, message, messageData);

    res.status(200).json({
      status: 'processed',
      lead_id: result.lead_id,
      agente: result.agente,
      acao: result.acao
    });

  } catch (error) {
    logger.error({ err: error.message }, '[WEBHOOK] erro');
    res.status(200).json({ status: 'error', message: error.message });
  }
});

// Feature 4: Webhook Z-API - status de entrega/leitura
router.post('/zapi/status', (req, res) => {
  if (!validateZapiToken(req, res)) return;
  try {
    const data = req.body;
    const messageId = data.id || data.messageId || data.ids?.[0];
    const status = data.status || data.type;
    const phone = data.phone;

    if (!messageId && !phone) {
      return res.status(200).json({ received: true });
    }

    // Mapear status Z-API para nosso formato
    let statusEntrega = null;
    if (['DELIVERY_ACK', 'delivered', 'RECEIVED'].includes(status)) {
      statusEntrega = 'entregue';
    } else if (['READ', 'read', 'PLAYED'].includes(status)) {
      statusEntrega = 'lido';
    }

    if (statusEntrega) {
      const db = getDb();
      // Atualizar pela mensagem mais recente enviada pro telefone
      if (phone) {
        const lead = db.prepare('SELECT id FROM leads WHERE telefone = ?').get(phone);
        if (lead) {
          db.prepare(`
            UPDATE conversas SET status_entrega = ?
            WHERE lead_id = ? AND direcao = 'enviada' AND status_entrega != 'lido'
            ORDER BY criado_em DESC LIMIT 1
          `).run(statusEntrega, lead.id);
        }
      }

      // Sprint 5 / T3: linka webhook delivery -> campanha_envios via zapi_message_id
      if (messageId) {
        try {
          const envio = db.prepare(
            'SELECT id, campanha_id FROM campanha_envios WHERE zapi_message_id = ?'
          ).get(messageId);
          if (envio) {
            if (statusEntrega === 'entregue') {
              const res = db.prepare(`
                UPDATE campanha_envios
                SET status = 'entregue', entregue_em = CURRENT_TIMESTAMP
                WHERE id = ? AND status IN ('enviado','processando')
              `).run(envio.id);
              if (res.changes > 0) {
                campanhasService.incrementCounter(envio.campanha_id, 'entregues_count');
              }
            } else if (statusEntrega === 'lido') {
              const res = db.prepare(`
                UPDATE campanha_envios
                SET status = 'lido', lido_em = CURRENT_TIMESTAMP,
                    entregue_em = COALESCE(entregue_em, CURRENT_TIMESTAMP)
                WHERE id = ? AND status IN ('enviado','entregue','processando')
              `).run(envio.id);
              if (res.changes > 0) {
                campanhasService.incrementCounter(envio.campanha_id, 'lidos_count');
              }
            }
          }
        } catch (err) {
          logger.warn({ err: err.message }, '[WEBHOOK] falha campanha_envios delivery');
        }
      }

      logger.info({ status: statusEntrega, phone: phone ? maskPhone(phone) : undefined, messageId }, '[WEBHOOK] status entrega');
    }

    res.status(200).json({ received: true, status: statusEntrega });
  } catch (error) {
    logger.error({ err: error.message }, '[WEBHOOK] erro status');
    res.status(200).json({ received: true });
  }
});

// Feature 2: Webhook Instagram DM
router.get('/instagram', (req, res) => {
  // Verificacao de webhook do Meta (challenge)
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

router.post('/instagram', async (req, res) => {
  try {
    const data = req.body;

    // Processar mensagens do Instagram
    if (data.object === 'instagram' || data.object === 'page') {
      for (const entry of (data.entry || [])) {
        for (const msg of (entry.messaging || [])) {
          if (msg.message?.text && msg.sender?.id) {
            const senderId = msg.sender.id;
            const message = msg.message.text;

            logger.info({ senderId, preview: maskMessage(message) }, '[INSTAGRAM] DM recebido');

            // Processar pelo orchestrator (usa senderId como "telefone")
            const result = await orchestrator.processIncoming(
              `ig_${senderId}`, message, { type: 'texto', canal: 'instagram' }
            );

            // Responder via Instagram DM
            const instagram = require('../services/instagram');
            if (instagram.isConfigured()) {
              await instagram.sendDM(senderId, result.resposta);
            }
          }
        }
      }
    }

    res.status(200).json({ status: 'processed' });
  } catch (error) {
    logger.error({ err: error.message }, '[INSTAGRAM] erro webhook');
    res.status(200).json({ status: 'error' });
  }
});

module.exports = router;
