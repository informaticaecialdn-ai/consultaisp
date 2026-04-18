// Opt-in/opt-out tracking (Sprint 2 / T3).
// Usa tabela lead_opt_out (migration 008-sprint4-stubs.sql).

const { getDb } = require('../models/database');

// Regex ESTRITA: match apenas se a mensagem for EXATAMENTE uma dessas palavras-chave.
// Evita falso-positivo tipo "vou parar de fumar" marcando opt-out.
const OPT_OUT_REGEX = /^(STOP|SAIR|PARAR|CANCELAR|UNSUBSCRIBE|SAIA|REMOVA|REMOVER|NAO QUERO MAIS|CANCELE|DESCADASTRAR)\.?\s*$/i;

function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
}

function canSendTo(phone) {
  const telefone = normalizePhone(phone);
  if (!telefone) return { allowed: false, reason: 'telefone invalido' };
  try {
    const db = getDb();
    const row = db.prepare(
      'SELECT * FROM lead_opt_out WHERE telefone = ?'
    ).get(telefone);
    if (row) {
      return { allowed: false, reason: `opt-out registrado em ${row.criado_em}`, record: row };
    }
  } catch (err) {
    // tabela pode nao existir em ambiente legado
  }
  return { allowed: true };
}

function markOptOut(phone, motivo = 'manual', canal = 'whatsapp') {
  const telefone = normalizePhone(phone);
  if (!telefone) return false;
  const db = getDb();
  db.prepare(`
    INSERT INTO lead_opt_out (telefone, motivo, canal)
    VALUES (?, ?, ?)
    ON CONFLICT(telefone) DO UPDATE SET motivo = excluded.motivo, canal = excluded.canal
  `).run(telefone, motivo, canal);
  return true;
}

function clearOptOut(phone) {
  const telefone = normalizePhone(phone);
  if (!telefone) return false;
  const db = getDb();
  const res = db.prepare('DELETE FROM lead_opt_out WHERE telefone = ?').run(telefone);
  return res.changes > 0;
}

// Sprint 2 / T3: detecta mensagem de opt-out com regex estrita (match exato).
function detectOptOutFromMessage(text) {
  if (!text) return false;
  const normalized = String(text).trim();
  if (!normalized) return false;
  return OPT_OUT_REGEX.test(normalized);
}

function listOptOuts({ limit = 100, offset = 0 } = {}) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM lead_opt_out ORDER BY criado_em DESC LIMIT ? OFFSET ?'
  ).all(parseInt(limit), parseInt(offset));
}

function getOptOut(phone) {
  const telefone = normalizePhone(phone);
  if (!telefone) return null;
  const db = getDb();
  return db.prepare('SELECT * FROM lead_opt_out WHERE telefone = ?').get(telefone) || null;
}

module.exports = {
  canSendTo,
  markOptOut,
  clearOptOut,
  detectOptOutFromMessage,
  listOptOuts,
  getOptOut,
  normalizePhone,
};
