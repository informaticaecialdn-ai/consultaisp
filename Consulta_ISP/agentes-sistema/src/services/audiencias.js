// Service de audiencias (stub minimal para Sprint 5).
// Sprint 4 / T1 + T4 substituira com CRUD completo + filtros dinamicos.

const { getDb } = require('../models/database');

function getById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM audiencias WHERE id = ?').get(id) || null;
}

function list({ limit = 100, offset = 0 } = {}) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM audiencias ORDER BY id DESC LIMIT ? OFFSET ?'
  ).all(parseInt(limit), parseInt(offset));
}

function create({ nome, descricao = null, tipo = 'estatica', filtros = null }) {
  const db = getDb();
  const filtrosJson = filtros == null ? null :
    (typeof filtros === 'string' ? filtros : JSON.stringify(filtros));
  const result = db.prepare(`
    INSERT INTO audiencias (nome, descricao, tipo, filtros)
    VALUES (?, ?, ?, ?)
  `).run(nome, descricao, tipo, filtrosJson);
  return getById(result.lastInsertRowid);
}

function remove(id) {
  const db = getDb();
  return db.prepare('DELETE FROM audiencias WHERE id = ?').run(id);
}

function addLeads(audienciaId, leadIds) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO audiencia_leads (audiencia_id, lead_id) VALUES (?, ?)'
  );
  let added = 0;
  const tx = db.transaction(() => {
    for (const leadId of leadIds) {
      const res = stmt.run(audienciaId, leadId);
      if (res.changes > 0) added++;
    }
    refreshTotal(audienciaId);
  });
  tx();
  return added;
}

function refreshTotal(audienciaId) {
  const db = getDb();
  const aud = getById(audienciaId);
  if (!aud) return 0;
  let total = 0;
  if (aud.tipo === 'estatica') {
    total = db.prepare(
      'SELECT COUNT(*) AS c FROM audiencia_leads WHERE audiencia_id = ?'
    ).get(audienciaId).c;
  } else {
    total = resolveDynamic(aud).length;
  }
  db.prepare(
    'UPDATE audiencias SET total_leads = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(total, audienciaId);
  return total;
}

function resolveDynamic(aud) {
  const db = getDb();
  let filters = {};
  try { filters = aud.filtros ? JSON.parse(aud.filtros) : {}; } catch { filters = {}; }
  const where = [];
  const params = [];
  if (filters.classificacao) { where.push('classificacao = ?'); params.push(filters.classificacao); }
  if (filters.etapa_funil) { where.push('etapa_funil = ?'); params.push(filters.etapa_funil); }
  if (filters.estado) { where.push('estado = ?'); params.push(filters.estado); }
  if (filters.regiao) { where.push('regiao = ?'); params.push(filters.regiao); }
  if (filters.agente_atual) { where.push('agente_atual = ?'); params.push(filters.agente_atual); }
  const sql = `SELECT * FROM leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  return db.prepare(sql).all(...params);
}

function getLeads(audienciaId, { limit = 100000 } = {}) {
  const db = getDb();
  const aud = getById(audienciaId);
  if (!aud) return [];
  if (aud.tipo === 'dinamica') {
    return resolveDynamic(aud).slice(0, limit);
  }
  return db.prepare(`
    SELECT l.*
    FROM leads l
    INNER JOIN audiencia_leads al ON al.lead_id = l.id
    WHERE al.audiencia_id = ?
    LIMIT ?
  `).all(audienciaId, parseInt(limit));
}

module.exports = { getById, list, create, remove, addLeads, refreshTotal, getLeads };
