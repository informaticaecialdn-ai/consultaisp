const { getDb } = require('../models/database');
const templatesService = require('./templates');
const audienciasService = require('./audiencias');
const templateEngine = require('./template-engine');
const logger = require('../utils/logger');

const COUNTER_COLS = new Set([
  'total_envios',
  'enviados_count',
  'entregues_count',
  'lidos_count',
  'respondidos_count',
  'falhas_count',
  'bloqueados_count'
]);

function maskPhone(phone) {
  if (!phone) return '';
  const s = String(phone).replace(/\D/g, '');
  if (s.length <= 4) return '***';
  return s.slice(0, 4) + '***' + s.slice(-2);
}

function getById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM campanhas WHERE id = ?').get(id) || null;
}

function list({ status, limit = 100, offset = 0 } = {}) {
  const db = getDb();
  const params = [];
  let sql = 'SELECT * FROM campanhas WHERE 1=1';
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  return db.prepare(sql).all(...params);
}

function create({
  nome,
  audiencia_id,
  template_id,
  agente_remetente,
  rate_limit_per_min = 20,
  jitter_min_sec = 3,
  jitter_max_sec = 8,
  agendada_para = null,
  criada_por = null
}) {
  if (!nome) throw new Error('nome obrigatorio');
  if (!audiencia_id) throw new Error('audiencia_id obrigatorio');
  if (!template_id) throw new Error('template_id obrigatorio');
  if (!agente_remetente) throw new Error('agente_remetente obrigatorio');

  const aud = audienciasService.getById(audiencia_id);
  if (!aud) throw new Error(`audiencia ${audiencia_id} nao encontrada`);
  const tpl = templatesService.getById(template_id);
  if (!tpl) throw new Error(`template ${template_id} nao encontrado`);

  const initialStatus = agendada_para ? 'agendada' : 'rascunho';
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO campanhas (
      nome, audiencia_id, template_id, agente_remetente, status,
      rate_limit_per_min, jitter_min_sec, jitter_max_sec,
      agendada_para, criada_por
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nome, audiencia_id, template_id, agente_remetente, initialStatus,
    rate_limit_per_min, jitter_min_sec, jitter_max_sec,
    agendada_para, criada_por
  );
  return getById(result.lastInsertRowid);
}

function update(id, fields) {
  const campanha = getById(id);
  if (!campanha) throw new Error(`campanha ${id} nao encontrada`);
  if (campanha.status !== 'rascunho') {
    throw new Error(`campanha ${id} nao e editavel (status=${campanha.status})`);
  }
  const allowed = [
    'nome', 'audiencia_id', 'template_id', 'agente_remetente',
    'rate_limit_per_min', 'jitter_min_sec', 'jitter_max_sec', 'agendada_para'
  ];
  const sets = [];
  const values = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(`${k} = ?`); values.push(fields[k]); }
  }
  if (sets.length === 0) return campanha;
  values.push(id);
  getDb().prepare(
    `UPDATE campanhas SET ${sets.join(', ')} WHERE id = ?`
  ).run(...values);
  return getById(id);
}

// Resolve audiencia -> cria envios pendentes (status='pendente')
// Idempotente via UNIQUE(campanha_id, lead_id) + INSERT OR IGNORE.
function expand(campanhaId) {
  const campanha = getById(campanhaId);
  if (!campanha) throw new Error(`campanha ${campanhaId} nao encontrada`);
  const template = templatesService.getById(campanha.template_id);
  if (!template) throw new Error(`template ${campanha.template_id} nao encontrado`);

  const leads = audienciasService.getLeads(campanha.audiencia_id, { limit: 100000 });
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO campanha_envios
      (campanha_id, lead_id, telefone, mensagem_renderizada)
    VALUES (?, ?, ?, ?)
  `);

  let inserted = 0;
  let skipped = 0;
  const tx = db.transaction(() => {
    for (const lead of leads) {
      if (!lead.telefone) { skipped++; continue; }
      let rendered;
      try {
        rendered = templateEngine.render(template.conteudo, lead);
      } catch (err) {
        skipped++;
        logger.warn({ campanhaId, leadId: lead.id, err: err.message }, 'render falhou');
        continue;
      }
      const res = stmt.run(campanhaId, lead.id, lead.telefone, rendered);
      if (res.changes > 0) inserted++;
      else skipped++;
    }

    // total_envios reflete total de envios pendentes/processados dessa campanha
    const totalNow = db.prepare(
      'SELECT COUNT(*) AS c FROM campanha_envios WHERE campanha_id = ?'
    ).get(campanhaId).c;
    db.prepare('UPDATE campanhas SET total_envios = ? WHERE id = ?').run(totalNow, campanhaId);
  });
  tx();

  logger.info({ campanhaId, inserted, skipped }, 'expand concluido');
  return { inserted, skipped };
}

function transitionStatus(id, expectedFrom, to, extraSets = {}) {
  const db = getDb();
  const campanha = getById(id);
  if (!campanha) throw new Error(`campanha ${id} nao encontrada`);
  const expectedList = Array.isArray(expectedFrom) ? expectedFrom : [expectedFrom];
  if (!expectedList.includes(campanha.status)) {
    throw new Error(
      `transicao invalida: ${campanha.status} -> ${to} (esperado de: ${expectedList.join(',')})`
    );
  }
  const sets = ['status = ?'];
  const values = [to];
  for (const [k, v] of Object.entries(extraSets)) {
    sets.push(`${k} = ?`);
    values.push(v);
  }
  values.push(id);
  db.prepare(
    `UPDATE campanhas SET ${sets.join(', ')} WHERE id = ?`
  ).run(...values);
  return getById(id);
}

function start(id) {
  const nowIso = new Date().toISOString();
  return transitionStatus(id, ['rascunho', 'agendada', 'pausada'], 'enviando', {
    iniciada_em: nowIso
  });
}

function pause(id) {
  return transitionStatus(id, ['enviando', 'agendada'], 'pausada');
}

function resume(id) {
  return transitionStatus(id, ['pausada'], 'enviando');
}

function cancel(id) {
  return transitionStatus(id, ['rascunho', 'agendada', 'enviando', 'pausada'], 'cancelada', {
    concluida_em: new Date().toISOString()
  });
}

function remove(id) {
  const campanha = getById(id);
  if (!campanha) return { changes: 0 };
  if (campanha.status !== 'rascunho') {
    throw new Error(`so e possivel deletar campanhas em rascunho (atual=${campanha.status})`);
  }
  return getDb().prepare('DELETE FROM campanhas WHERE id = ?').run(id);
}

function pauseAll() {
  const db = getDb();
  const res = db.prepare(
    "UPDATE campanhas SET status = 'pausada' WHERE status IN ('enviando','agendada')"
  ).run();
  logger.warn({ affected: res.changes }, 'pauseAll executado');
  return res.changes;
}

function incrementCounter(campanhaId, column, delta = 1) {
  if (!COUNTER_COLS.has(column)) {
    throw new Error(`coluna ${column} nao e um contador valido`);
  }
  const db = getDb();
  db.prepare(
    `UPDATE campanhas SET ${column} = ${column} + ? WHERE id = ?`
  ).run(delta, campanhaId);
}

function getStats(campanhaId) {
  const campanha = getById(campanhaId);
  if (!campanha) return null;
  const db = getDb();
  const porStatus = db.prepare(`
    SELECT status, COUNT(*) AS c
    FROM campanha_envios
    WHERE campanha_id = ?
    GROUP BY status
  `).all(campanhaId);

  const byStatus = {};
  for (const r of porStatus) byStatus[r.status] = r.c;

  return {
    id: campanha.id,
    nome: campanha.nome,
    status: campanha.status,
    total_envios: campanha.total_envios,
    enviados: campanha.enviados_count,
    entregues: campanha.entregues_count,
    lidos: campanha.lidos_count,
    respondidos: campanha.respondidos_count,
    falhas: campanha.falhas_count,
    bloqueados: campanha.bloqueados_count,
    pendentes: byStatus.pendente || 0,
    processando: byStatus.processando || 0,
    restantes: (byStatus.pendente || 0) + (byStatus.processando || 0),
    progresso_pct: campanha.total_envios > 0
      ? Math.round(
          ((campanha.enviados_count + campanha.falhas_count + campanha.bloqueados_count) /
            campanha.total_envios) * 100
        )
      : 0,
    iniciada_em: campanha.iniciada_em,
    concluida_em: campanha.concluida_em,
    por_status: byStatus
  };
}

function getTimeline(campanhaId, { lastMinutes = 60 } = {}) {
  const db = getDb();
  const sinceIso = new Date(Date.now() - lastMinutes * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT
      strftime('%Y-%m-%dT%H:%M:00Z', enviado_em) AS bucket,
      SUM(CASE WHEN status IN ('enviado','entregue','lido','respondido') THEN 1 ELSE 0 END) AS enviados,
      SUM(CASE WHEN status = 'falhou' THEN 1 ELSE 0 END) AS falhas
    FROM campanha_envios
    WHERE campanha_id = ?
      AND enviado_em IS NOT NULL
      AND enviado_em >= ?
    GROUP BY bucket
    ORDER BY bucket ASC
  `).all(campanhaId, sinceIso);
  return rows.map(r => ({ ts: r.bucket, enviados: r.enviados, falhas: r.falhas }));
}

function listEnvios(campanhaId, { status, limit = 100, offset = 0 } = {}) {
  const db = getDb();
  const params = [campanhaId];
  let sql = 'SELECT * FROM campanha_envios WHERE campanha_id = ?';
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  return db.prepare(sql).all(...params);
}

function checkConclusion(campanhaId) {
  const campanha = getById(campanhaId);
  if (!campanha) return;
  if (campanha.status !== 'enviando') return;
  const db = getDb();
  const pending = db.prepare(`
    SELECT COUNT(*) AS c
    FROM campanha_envios
    WHERE campanha_id = ? AND status IN ('pendente','processando')
  `).get(campanhaId).c;
  if (pending === 0 && campanha.total_envios > 0) {
    db.prepare(
      "UPDATE campanhas SET status='concluida', concluida_em=CURRENT_TIMESTAMP WHERE id = ? AND status='enviando'"
    ).run(campanhaId);
    logger.info({ campanhaId }, 'campanha concluida');
  }
}

module.exports = {
  getById,
  list,
  create,
  update,
  expand,
  start,
  pause,
  resume,
  cancel,
  remove,
  pauseAll,
  incrementCounter,
  getStats,
  getTimeline,
  listEnvios,
  checkConclusion,
  maskPhone
};
