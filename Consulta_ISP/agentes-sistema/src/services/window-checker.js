// Window checker WhatsApp (stub minimal para Sprint 5).
// Regra Meta: freeform so permitido se o contato trocou mensagem nos ultimos 24h.
// Sprint 4 / T3 estende com tracking de janela via webhooks inbound.

const { getDb } = require('../models/database');

const WINDOW_MS = 24 * 60 * 60 * 1000;

async function canSendFreeForm(leadId) {
  if (!leadId) return { allowed: false, reason: 'lead_id ausente' };
  try {
    const db = getDb();
    const lastInbound = db.prepare(`
      SELECT criado_em FROM conversas
      WHERE lead_id = ? AND direcao = 'recebida'
      ORDER BY criado_em DESC
      LIMIT 1
    `).get(leadId);

    if (!lastInbound) {
      return { allowed: false, reason: 'sem mensagem recebida registrada' };
    }

    const last = new Date(lastInbound.criado_em).getTime();
    const now = Date.now();
    const ageMs = now - last;

    if (ageMs > WINDOW_MS) {
      const horas = Math.floor(ageMs / (60 * 60 * 1000));
      return { allowed: false, reason: `janela 24h expirada (${horas}h)` };
    }
    return { allowed: true };
  } catch (err) {
    // Falha aberta para nao travar primeira campanha em ambiente sem historico
    return { allowed: true, reason: 'check fallback' };
  }
}

module.exports = { canSendFreeForm, WINDOW_MS };
