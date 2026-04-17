// Opt-in/opt-out tracking (stub minimal para Sprint 5).
// Sprint 4 / T3 estende com gatilhos de palavras-chave (STOP, SAIR, PARAR).

const { getDb } = require('../models/database');

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
      return { allowed: false, reason: `opt-out registrado em ${row.criado_em}` };
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

module.exports = { canSendTo, markOptOut, clearOptOut, normalizePhone };
