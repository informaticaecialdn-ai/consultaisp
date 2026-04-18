// Consent service (Sprint 2 / T3 + Sprint 4 / T3).
// Tabela lead_opt_out agora e bidirecional (status = 'optout' | 'ativo').
// Nome mantido para compat com Sprint 5.

const { getDb } = require('../models/database');

// Regex ESTRITA: match apenas se a mensagem for EXATAMENTE uma dessas palavras-chave.
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
    const row = db.prepare('SELECT * FROM lead_opt_out WHERE telefone = ?').get(telefone);
    if (row && row.status === 'optout') {
      return { allowed: false, reason: `opt-out registrado em ${row.criado_em}`, record: row };
    }
  } catch { /* tabela pode nao existir em ambiente legado */ }
  return { allowed: true };
}

function markOptOut(phone, motivo = 'manual', canal = 'whatsapp') {
  const telefone = normalizePhone(phone);
  if (!telefone) return false;
  const db = getDb();
  db.prepare(`
    INSERT INTO lead_opt_out (telefone, motivo, canal, status, atualizado_em)
    VALUES (?, ?, ?, 'optout', CURRENT_TIMESTAMP)
    ON CONFLICT(telefone) DO UPDATE SET
      motivo = excluded.motivo,
      canal = excluded.canal,
      status = 'optout',
      atualizado_em = CURRENT_TIMESTAMP
  `).run(telefone, motivo, canal);
  return true;
}

// Sprint 4 / T3: opt-in automatico ao receber inbound organico.
// NAO sobrescreve se ja houver opt-out registrado — opt-out tem precedencia LGPD.
function markOptIn(phone, origem = 'inbound_organico') {
  const telefone = normalizePhone(phone);
  if (!telefone) return false;
  try {
    const db = getDb();
    const existing = db.prepare('SELECT status FROM lead_opt_out WHERE telefone = ?').get(telefone);
    if (existing && existing.status === 'optout') return false;
    db.prepare(`
      INSERT INTO lead_opt_out (telefone, status, optin_em, optin_origem, canal, atualizado_em)
      VALUES (?, 'ativo', CURRENT_TIMESTAMP, ?, 'whatsapp', CURRENT_TIMESTAMP)
      ON CONFLICT(telefone) DO UPDATE SET
        status = 'ativo',
        optin_em = COALESCE(lead_opt_out.optin_em, CURRENT_TIMESTAMP),
        optin_origem = COALESCE(lead_opt_out.optin_origem, excluded.optin_origem),
        atualizado_em = CURRENT_TIMESTAMP
      WHERE lead_opt_out.status != 'optout'
    `).run(telefone, origem);
    return true;
  } catch {
    return false;
  }
}

function clearOptOut(phone) {
  const telefone = normalizePhone(phone);
  if (!telefone) return false;
  const db = getDb();
  const res = db.prepare('DELETE FROM lead_opt_out WHERE telefone = ?').run(telefone);
  return res.changes > 0;
}

function detectOptOutFromMessage(text) {
  if (!text) return false;
  const normalized = String(text).trim();
  if (!normalized) return false;
  return OPT_OUT_REGEX.test(normalized);
}

function listOptOuts({ limit = 100, offset = 0, status } = {}) {
  const db = getDb();
  if (status) {
    return db.prepare(
      'SELECT * FROM lead_opt_out WHERE status = ? ORDER BY criado_em DESC LIMIT ? OFFSET ?'
    ).all(status, parseInt(limit), parseInt(offset));
  }
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

// Retorna status detalhado (usado em /api/leads/:id/can-send).
function getStatus(phone) {
  const row = getOptOut(phone);
  if (!row) return { status: 'desconhecido', has_record: false };
  return {
    status: row.status || (row ? 'optout' : 'desconhecido'),
    has_record: true,
    optin_em: row.optin_em || null,
    optin_origem: row.optin_origem || null,
    optout_em: row.status === 'optout' ? row.criado_em : null,
    motivo: row.motivo || null,
  };
}

module.exports = {
  canSendTo,
  markOptOut,
  markOptIn,
  clearOptOut,
  detectOptOutFromMessage,
  listOptOuts,
  getOptOut,
  getStatus,
  normalizePhone,
};
