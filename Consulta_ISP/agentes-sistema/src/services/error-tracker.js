// Error tracker (Sprint 3 / T5). Persiste erros em errors_log + webhook opcional.

const { getDb } = require('../models/database');
const logger = require('../utils/logger');

let cleanupTimer = null;

function trackError(err, contexto = {}) {
  const tipo = contexto.tipo || (err && err.name) || 'error';
  const mensagem = (err && err.message) ? err.message : String(err || 'unknown');
  const stack = err && err.stack ? err.stack : null;
  const correlation_id = contexto.correlation_id || contexto.correlationId || null;
  const ctxJson = (() => {
    try {
      const clean = { ...contexto };
      delete clean.correlation_id;
      delete clean.correlationId;
      delete clean.tipo;
      return JSON.stringify(clean);
    } catch { return null; }
  })();

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO errors_log (tipo, mensagem, stack, contexto, correlation_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(tipo, mensagem, stack, ctxJson, correlation_id);
  } catch (dbErr) {
    // Fail-safe: nao relancar, so logar
    logger.warn({ err: dbErr.message }, '[ERROR-TRACKER] falha ao persistir errors_log');
  }

  logger.error({ tipo, mensagem, correlation_id, ...contexto, stack }, '[ERROR-TRACKER] capturado');

  const webhook = process.env.ERROR_REPORT_WEBHOOK;
  if (webhook) {
    const body = JSON.stringify({
      content: `[ERROR] ${tipo}: ${mensagem.slice(0, 250)}`,
      correlation_id,
      ts: new Date().toISOString(),
    });
    try {
      fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch(e => logger.warn({ err: e.message }, '[ERROR-TRACKER] webhook falhou'));
    } catch (e) {
      logger.warn({ err: e.message }, '[ERROR-TRACKER] webhook falhou');
    }
  }
}

function cleanupOldResolved({ days = 90 } = {}) {
  try {
    const db = getDb();
    const res = db.prepare(
      `DELETE FROM errors_log WHERE resolvido = 1 AND criado_em < DATETIME('now', ?)`
    ).run(`-${days} days`);
    if (res.changes > 0) logger.info({ removidos: res.changes, days }, '[ERROR-TRACKER] cleanup executado');
    return res.changes;
  } catch (err) {
    logger.warn({ err: err.message }, '[ERROR-TRACKER] cleanup falhou');
    return 0;
  }
}

function startCleanup({ intervalMs = 24 * 60 * 60 * 1000 } = {}) {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => cleanupOldResolved(), intervalMs);
  if (cleanupTimer.unref) cleanupTimer.unref();
  logger.info({ intervalMs }, '[ERROR-TRACKER] cleanup diario iniciado');
}

function stopCleanup() {
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
}

module.exports = { trackError, cleanupOldResolved, startCleanup, stopCleanup };
