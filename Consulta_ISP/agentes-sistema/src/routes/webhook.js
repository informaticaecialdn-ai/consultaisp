const express = require('express');
const router = express.Router();
const orchestrator = require('../services/orchestrator');
const { getDb } = require('../models/database');

// Webhook Z-API - recebe mensagens do WhatsApp
router.post('/zapi', async (req, res) => {
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

    console.log(`[WEBHOOK] Mensagem de ${phone}: ${message.substring(0, 80)}...`);

    const result = await orchestrator.processIncoming(phone, message, messageData);

    res.status(200).json({
      status: 'processed',
      lead_id: result.lead_id,
      agente: result.agente,
      acao: result.acao
    });

  } catch (error) {
    console.error('[WEBHOOK] Erro:', error.message);
    res.status(200).json({ status: 'error', message: error.message });
  }
});

// Feature 4: Webhook Z-API - status de entrega/leitura
router.post('/zapi/status', (req, res) => {
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
      console.log(`[WEBHOOK] Status ${statusEntrega} para ${phone || messageId}`);
    }

    res.status(200).json({ received: true, status: statusEntrega });
  } catch (error) {
    console.error('[WEBHOOK] Erro status:', error.message);
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

            console.log(`[INSTAGRAM] DM de ${senderId}: ${message.substring(0, 80)}...`);

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
    console.error('[INSTAGRAM] Erro webhook:', error.message);
    res.status(200).json({ status: 'error' });
  }
});

module.exports = router;
