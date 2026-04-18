// Window checker WhatsApp (Sprint 4 / T3 - implementacao completa).
// Regra Meta: freeform so permitido se o contato enviou mensagem nos ultimos 24h.
// Fora da janela, apenas template (HSM) aprovado pode ser enviado.

const { getDb } = require('../models/database');
const consent = require('./consent');

const WINDOW_MS = 24 * 60 * 60 * 1000;
const WINDOW_H = 24;

function ageFromTs(ts) {
  if (!ts) return null;
  const last = new Date(ts).getTime();
  if (Number.isNaN(last)) return null;
  return Date.now() - last;
}

function fmt(ageMs) {
  if (ageMs == null) return { hoursSince: null, hoursRemaining: null };
  const hoursSince = Math.round(ageMs / 3600_000 * 100) / 100;
  const hoursRemaining = Math.max(0, Math.round((WINDOW_MS - ageMs) / 3600_000 * 100) / 100);
  return { hoursSince, hoursRemaining };
}

async function canSendFreeForm(leadId) {
  if (!leadId) return {
    allowed: false,
    reason: 'lead_id ausente',
    recommendation: 'precisa de leadId valido',
    hoursSince: null,
    hoursRemaining: null,
  };
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT criado_em FROM conversas
      WHERE lead_id = ? AND direcao = 'recebida'
      ORDER BY criado_em DESC LIMIT 1
    `).get(parseInt(leadId));

    if (!row) {
      return {
        allowed: false,
        reason: 'sem_mensagem_inbound',
        recommendation: 'use template HSM aprovado para iniciar conversa',
        hoursSince: null,
        hoursRemaining: null,
      };
    }

    const ageMs = ageFromTs(row.criado_em);
    const { hoursSince, hoursRemaining } = fmt(ageMs);

    if (ageMs > WINDOW_MS) {
      return {
        allowed: false,
        reason: `janela_${WINDOW_H}h_expirada`,
        recommendation: 'use template HSM aprovado (janela fechou)',
        hoursSince,
        hoursRemaining: 0,
      };
    }
    return {
      allowed: true,
      reason: 'dentro_da_janela',
      recommendation: null,
      hoursSince,
      hoursRemaining,
    };
  } catch (err) {
    // Fail-open para nao bloquear ambientes novos sem historico
    return { allowed: true, reason: 'check_fallback', error: err.message, hoursSince: null, hoursRemaining: null };
  }
}

// Combina janela de 24h + consentimento LGPD.
async function canReceiveAnyOutbound(leadId) {
  const db = getDb();
  const lead = db.prepare('SELECT telefone FROM leads WHERE id = ?').get(parseInt(leadId));
  if (!lead) return { allowed: false, reason: 'lead_nao_encontrado' };

  const consentCheck = consent.canSendTo(lead.telefone);
  if (!consentCheck.allowed) {
    return { allowed: false, reason: 'optout', detail: consentCheck.reason };
  }

  const windowCheck = await canSendFreeForm(leadId);
  return {
    allowed: true, // outbound de template HSM sempre permitido se nao ha optout
    freeform: windowCheck,
    consent: consentCheck,
  };
}

// Otimizado: 1 query para N leads. Retorna Map<leadId, { allowed, hoursSince, hoursRemaining }>
function batchCheckWindow(leadIds = []) {
  const ids = (leadIds || []).filter(Number.isFinite).map(Number);
  const result = new Map();
  if (ids.length === 0) return result;

  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT lead_id, MAX(criado_em) AS last_inbound
    FROM conversas
    WHERE lead_id IN (${placeholders}) AND direcao = 'recebida'
    GROUP BY lead_id
  `).all(...ids);

  const lastByLead = new Map(rows.map(r => [r.lead_id, r.last_inbound]));

  for (const id of ids) {
    const ts = lastByLead.get(id);
    if (!ts) {
      result.set(id, { allowed: false, reason: 'sem_mensagem_inbound', hoursSince: null, hoursRemaining: null });
      continue;
    }
    const ageMs = ageFromTs(ts);
    const { hoursSince, hoursRemaining } = fmt(ageMs);
    result.set(id, {
      allowed: ageMs <= WINDOW_MS,
      reason: ageMs <= WINDOW_MS ? 'dentro_da_janela' : `janela_${WINDOW_H}h_expirada`,
      hoursSince,
      hoursRemaining,
    });
  }
  return result;
}

module.exports = {
  canSendFreeForm,
  canReceiveAnyOutbound,
  batchCheckWindow,
  WINDOW_MS,
  WINDOW_H,
};
