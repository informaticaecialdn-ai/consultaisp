// Service de templates (Sprint 4 / T2 - implementacao completa).
// Backward compat: API do stub (create/getById/list/update/remove) preservada.

const { getDb } = require('../models/database');
const engine = require('../utils/template-engine');

function getById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM templates WHERE id = ?').get(parseInt(id)) || null;
}

function getByNome(nome) {
  const db = getDb();
  return db.prepare('SELECT * FROM templates WHERE nome = ? AND ativo = 1 ORDER BY id DESC LIMIT 1').get(nome) || null;
}

function list({ limit = 100, offset = 0, agente, categoria, ativo } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (agente) { where.push('agente = ?'); params.push(agente); }
  if (categoria) { where.push('categoria = ?'); params.push(categoria); }
  if (ativo === true || ativo === 1 || ativo === '1' || ativo === 'true') {
    where.push('ativo = 1');
  } else if (ativo === false || ativo === 0 || ativo === '0' || ativo === 'false') {
    where.push('ativo = 0');
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.push(parseInt(limit), parseInt(offset));
  return db.prepare(
    `SELECT * FROM templates ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params);
}

function create({
  nome,
  conteudo,
  agente = null,
  descricao = null,
  categoria = null,
  meta_template_id = null,
  ja_aprovado_meta = 0,
  variaveis_obrigatorias = null,
} = {}) {
  const db = getDb();
  const vars = JSON.stringify(engine.extractVariables(conteudo || ''));
  const varsObj = variaveis_obrigatorias == null ? null :
    (typeof variaveis_obrigatorias === 'string' ? variaveis_obrigatorias : JSON.stringify(variaveis_obrigatorias));

  const result = db.prepare(`
    INSERT INTO templates
      (nome, conteudo, agente, descricao, categoria, meta_template_id,
       ja_aprovado_meta, variaveis, variaveis_obrigatorias)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nome, conteudo, agente, descricao, categoria, meta_template_id,
         ja_aprovado_meta ? 1 : 0, vars, varsObj);
  return getById(result.lastInsertRowid);
}

// update: incrementa versao se conteudo mudou.
function update(id, fields = {}) {
  const db = getDb();
  const current = getById(id);
  if (!current) return null;

  const allowed = ['nome', 'conteudo', 'agente', 'descricao', 'categoria',
                   'meta_template_id', 'ja_aprovado_meta', 'ativo',
                   'variaveis_obrigatorias'];
  const sets = [];
  const values = [];
  const conteudoMudou = fields.conteudo !== undefined && fields.conteudo !== current.conteudo;

  for (const k of allowed) {
    if (fields[k] !== undefined) {
      let v = fields[k];
      if (k === 'ja_aprovado_meta' || k === 'ativo') v = v ? 1 : 0;
      if (k === 'variaveis_obrigatorias' && v != null && typeof v !== 'string') {
        v = JSON.stringify(v);
      }
      sets.push(`${k} = ?`);
      values.push(v);
    }
  }
  if (conteudoMudou) {
    sets.push('variaveis = ?');
    values.push(JSON.stringify(engine.extractVariables(fields.conteudo)));
    sets.push('versao = versao + 1');
  }
  if (sets.length === 0) return current;

  sets.push('atualizado_em = CURRENT_TIMESTAMP');
  values.push(id);
  db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getById(id);
}

// remove = soft delete (ativo=0). Sprint 5 chama stub de remove, entao mantemos
// compat retornando objeto { changes } como antes.
function remove(id) {
  const db = getDb();
  return db.prepare(
    'UPDATE templates SET ativo = 0, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(id);
}

function removeHard(id) {
  const db = getDb();
  return db.prepare('DELETE FROM templates WHERE id = ?').run(id);
}

function clone(id, { nome } = {}) {
  const src = getById(id);
  if (!src) return null;
  return create({
    nome: nome || `${src.nome} (copia)`,
    conteudo: src.conteudo,
    agente: src.agente,
    descricao: src.descricao,
    categoria: src.categoria,
    meta_template_id: null, // clone perde aprovacao Meta
    ja_aprovado_meta: 0,
    variaveis_obrigatorias: src.variaveis_obrigatorias,
  });
}

// Renderiza template para um lead especifico do banco.
function renderForLead(templateId, leadId) {
  const db = getDb();
  const tpl = getById(templateId);
  if (!tpl) return null;
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(parseInt(leadId));
  if (!lead) return { texto: null, error: 'lead_nao_encontrado' };
  const texto = engine.render(tpl.conteudo, lead);
  const usadas = engine.extractVariables(tpl.conteudo);
  const faltando = engine.missingVariables(tpl.conteudo, lead);
  return { texto, variaveis_usadas: usadas, variaveis_faltando: faltando };
}

// Retorna ate N samples renderizados contra leads da audiencia.
function previewWithSamples(templateId, audienciaId, n = 3) {
  const tpl = getById(templateId);
  if (!tpl) return null;
  const audiencias = require('./audiencias');
  const leads = audiencias.previewLeads(audienciaId, n);
  return leads.map(lead => ({
    lead_id: lead.id,
    lead_nome: lead.nome,
    lead_telefone: lead.telefone,
    texto: engine.render(tpl.conteudo, lead),
    variaveis_faltando: engine.missingVariables(tpl.conteudo, lead),
  }));
}

// Render sem persistir (para editor live na UI).
function renderPreview(conteudo, vars = {}) {
  return {
    texto: engine.render(conteudo, vars),
    variaveis_usadas: engine.extractVariables(conteudo),
    variaveis_faltando: engine.missingVariables(conteudo, vars),
  };
}

module.exports = {
  getById, getByNome, list,
  create, update, remove, removeHard, clone,
  renderForLead, previewWithSamples, renderPreview,
};
