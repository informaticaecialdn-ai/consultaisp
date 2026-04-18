// Service de audiencias (Sprint 4 / T1 — implementacao completa).
// Backward compat: API do stub (create/list/getById/addLeads/getLeads/refreshTotal/remove)
// continua funcional para Sprint 5.

const { getDb } = require('../models/database');
const queryBuilder = require('../utils/audiencia-query-builder');

function getById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM audiencias WHERE id = ?').get(id) || null;
}

function list({ ativa, limit = 100, offset = 0, tipo } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (ativa === true || ativa === 1 || ativa === '1' || ativa === 'true') {
    where.push('ativa = 1');
  } else if (ativa === false || ativa === 0 || ativa === '0' || ativa === 'false') {
    where.push('ativa = 0');
  }
  if (tipo === 'estatica' || tipo === 'dinamica') {
    where.push('tipo = ?');
    params.push(tipo);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.push(parseInt(limit), parseInt(offset));
  return db.prepare(
    `SELECT * FROM audiencias ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params);
}

// Create compat (Sprint 5 passa { nome, descricao, tipo, filtros }).
function create({ nome, descricao = null, tipo = 'estatica', filtros = null, criada_por = null } = {}) {
  const db = getDb();
  const filtrosJson = filtros == null ? null :
    (typeof filtros === 'string' ? filtros : JSON.stringify(filtros));
  const result = db.prepare(`
    INSERT INTO audiencias (nome, descricao, tipo, filtros, criada_por)
    VALUES (?, ?, ?, ?, ?)
  `).run(nome, descricao, tipo, filtrosJson, criada_por);
  return getById(result.lastInsertRowid);
}

// Wrapper semantico: estatica = cria e adiciona leadIds.
function createEstatica(nome, descricao, leadIds = [], criadaPor = null) {
  const aud = create({ nome, descricao, tipo: 'estatica', criada_por: criadaPor });
  if (Array.isArray(leadIds) && leadIds.length > 0) {
    addLeads(aud.id, leadIds);
  }
  refreshTotal(aud.id);
  return getById(aud.id);
}

// Wrapper semantico: dinamica = cria com filtros JSON e calcula total.
function createDinamica(nome, descricao, filtros = {}, criadaPor = null) {
  const aud = create({ nome, descricao, tipo: 'dinamica', filtros, criada_por: criadaPor });
  refreshTotal(aud.id);
  return getById(aud.id);
}

function update(id, fields = {}) {
  const db = getDb();
  const allowed = ['nome', 'descricao', 'filtros', 'ativa'];
  const sets = [];
  const values = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      let v = fields[k];
      if (k === 'filtros' && v != null && typeof v !== 'string') v = JSON.stringify(v);
      if (k === 'ativa') v = v ? 1 : 0;
      sets.push(`${k} = ?`);
      values.push(v);
    }
  }
  if (sets.length === 0) return getById(id);
  sets.push('atualizado_em = CURRENT_TIMESTAMP');
  values.push(id);
  db.prepare(`UPDATE audiencias SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  if (fields.filtros !== undefined) refreshTotal(id);
  return getById(id);
}

// Soft-delete (Sprint 4): marca ativa=0 e NAO remove audiencia_leads.
// Backward compat: stub tinha DELETE hard. Expose removeHard para callers antigos.
function remove(id) {
  const db = getDb();
  return db.prepare('UPDATE audiencias SET ativa = 0, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

function removeHard(id) {
  const db = getDb();
  db.prepare('DELETE FROM audiencia_leads WHERE audiencia_id = ?').run(id);
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

function removeLead(audienciaId, leadId) {
  const db = getDb();
  const res = db.prepare(
    'DELETE FROM audiencia_leads WHERE audiencia_id = ? AND lead_id = ?'
  ).run(audienciaId, leadId);
  if (res.changes > 0) refreshTotal(audienciaId);
  return res.changes > 0;
}

function refreshTotal(audienciaId) {
  const db = getDb();
  const aud = getById(audienciaId);
  if (!aud) return 0;
  const total = aud.tipo === 'estatica'
    ? db.prepare('SELECT COUNT(*) AS c FROM audiencia_leads WHERE audiencia_id = ?').get(audienciaId).c
    : resolveDynamicCount(aud);
  db.prepare(
    `UPDATE audiencias
     SET total_leads = ?, total_leads_atualizado_em = CURRENT_TIMESTAMP,
         atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(total, audienciaId);
  return total;
}

// Alias mais semantico exposto na API publica
function resolveCount(audienciaId) {
  return refreshTotal(audienciaId);
}

function resolveDynamicCount(aud) {
  const db = getDb();
  const { where, params } = queryBuilder.build(aud.filtros);
  const row = db.prepare(`SELECT COUNT(*) AS c FROM leads WHERE ${where}`).get(...params);
  return row.c;
}

// Count em tempo real a partir de filtros (sem persistir). Usado no live preview da UI.
function countByFiltros(filtros) {
  const db = getDb();
  const { where, params } = queryBuilder.build(filtros);
  const row = db.prepare(`SELECT COUNT(*) AS c FROM leads WHERE ${where}`).get(...params);
  return row.c;
}

function getLeads(audienciaId, { limit = 100000, offset = 0 } = {}) {
  const db = getDb();
  const aud = getById(audienciaId);
  if (!aud) return [];
  if (aud.tipo === 'dinamica') {
    const { where, params } = queryBuilder.build(aud.filtros);
    return db.prepare(
      `SELECT * FROM leads WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(...params, parseInt(limit), parseInt(offset));
  }
  return db.prepare(`
    SELECT l.*
    FROM leads l
    INNER JOIN audiencia_leads al ON al.lead_id = l.id
    WHERE al.audiencia_id = ?
    ORDER BY l.id DESC
    LIMIT ? OFFSET ?
  `).all(audienciaId, parseInt(limit), parseInt(offset));
}

function previewLeads(audienciaId, n = 5) {
  const db = getDb();
  const aud = getById(audienciaId);
  if (!aud) return [];
  if (aud.tipo === 'dinamica') {
    const { where, params } = queryBuilder.build(aud.filtros);
    return db.prepare(
      `SELECT * FROM leads WHERE ${where} ORDER BY RANDOM() LIMIT ?`
    ).all(...params, parseInt(n));
  }
  return db.prepare(`
    SELECT l.*
    FROM leads l INNER JOIN audiencia_leads al ON al.lead_id = l.id
    WHERE al.audiencia_id = ?
    ORDER BY RANDOM() LIMIT ?
  `).all(audienciaId, parseInt(n));
}

module.exports = {
  getById, list,
  create, createEstatica, createDinamica,
  update, remove, removeHard,
  addLeads, removeLead,
  refreshTotal, resolveCount,
  getLeads, previewLeads,
  countByFiltros,
};
