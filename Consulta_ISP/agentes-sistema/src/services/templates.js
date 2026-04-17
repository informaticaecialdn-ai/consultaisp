// Service de templates (stub minimal para Sprint 5).
// Sprint 4 / T2 substituira com CRUD completo + preview + versionamento.

const { getDb } = require('../models/database');

function getById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM templates WHERE id = ?').get(id) || null;
}

function list({ limit = 100, offset = 0, agente } = {}) {
  const db = getDb();
  const params = [];
  let sql = 'SELECT * FROM templates WHERE 1=1';
  if (agente) { sql += ' AND agente = ?'; params.push(agente); }
  sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  return db.prepare(sql).all(...params);
}

function create({ nome, conteudo, agente = null, descricao = null, ja_aprovado_meta = 0 }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO templates (nome, conteudo, agente, descricao, ja_aprovado_meta)
    VALUES (?, ?, ?, ?, ?)
  `).run(nome, conteudo, agente, descricao, ja_aprovado_meta ? 1 : 0);
  return getById(result.lastInsertRowid);
}

function update(id, fields) {
  const db = getDb();
  const allowed = ['nome', 'conteudo', 'agente', 'descricao', 'ja_aprovado_meta', 'versao'];
  const sets = [];
  const values = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(`${k} = ?`); values.push(fields[k]); }
  }
  if (sets.length === 0) return getById(id);
  sets.push('atualizado_em = CURRENT_TIMESTAMP');
  values.push(id);
  db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getById(id);
}

function remove(id) {
  const db = getDb();
  return db.prepare('DELETE FROM templates WHERE id = ?').run(id);
}

module.exports = { getById, list, create, update, remove };
