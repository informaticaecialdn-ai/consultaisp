// Auto-Healer (Milestone 3 / G) — persistido em system_flags para funcionar cross-process.
//
// O DB compartilhado entre API (agentes) e worker e o ponto de sincronizacao.
// Kill switches sao lidos via isKilled() com cache leve (5s TTL) pra nao martelar DB.
//
// Thresholds (env):
//   AUTO_PAUSE_COST_USD=50        — pausa outbound se custo hoje > X USD
//   AUTO_PAUSE_ZAPI_DOWN_MIN=30   — pausa outbound se Z-API down > X min
//   AUTO_PAUSE_ERROR_RATE_PCT=5   — pausa tudo se taxa erro > X%

const { getDb } = require('../models/database');
const logger = require('../utils/logger');
const healthChecker = require('./health-checker');

const KILL_PREFIX = 'kill_switch.';
const CACHE_TTL_MS = 5 * 1000;

let cache = { at: 0, flags: null };
let lastAutoCheckAt = null;
let zapiDownSince = null;
let intervalTimer = null;

function readAllFlags() {
  const now = Date.now();
  if (cache.flags && now - cache.at < CACHE_TTL_MS) return cache.flags;
  const db = getDb();
  try {
    const rows = db
      .prepare("SELECT key, value, reason, set_by, atualizado_em FROM system_flags WHERE key LIKE ?")
      .all(`${KILL_PREFIX}%`);
    const flags = {};
    for (const r of rows) {
      const worker = r.key.slice(KILL_PREFIX.length);
      flags[worker] = {
        reason: r.reason,
        set_by: r.set_by,
        at: r.atualizado_em
      };
    }
    cache = { at: now, flags };
    return flags;
  } catch (err) {
    // migration 018 nao aplicada ainda
    return {};
  }
}

function invalidate() {
  cache = { at: 0, flags: null };
}

function isKilled(worker) {
  const flags = readAllFlags();
  return !!flags[worker];
}

function setKill(worker, reason = 'manual', setBy = 'manual') {
  const db = getDb();
  try {
    db.prepare(
      `INSERT INTO system_flags (key, value, reason, set_by, atualizado_em)
       VALUES (?, 'true', ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET reason = excluded.reason, set_by = excluded.set_by, atualizado_em = CURRENT_TIMESTAMP`
    ).run(KILL_PREFIX + worker, reason, setBy);
    invalidate();
    logger.warn({ worker, reason, setBy }, '[AUTO_HEALER] kill switch LIGADO');
  } catch (err) {
    logger.warn({ worker, err: err.message }, '[AUTO_HEALER] setKill falhou (migration 018?)');
  }
}

function clearKill(worker) {
  const db = getDb();
  try {
    const r = db.prepare('DELETE FROM system_flags WHERE key = ?').run(KILL_PREFIX + worker);
    invalidate();
    if (r.changes > 0) logger.info({ worker }, '[AUTO_HEALER] kill switch DESLIGADO');
    return r.changes > 0;
  } catch {
    return false;
  }
}

function killAll(reason = 'manual kill-all') {
  for (const w of ['outbound', 'supervisor', 'prospector', 'broadcast']) setKill(w, reason, 'manual');
}

function clearAll() {
  const db = getDb();
  try {
    const r = db.prepare('DELETE FROM system_flags WHERE key LIKE ?').run(KILL_PREFIX + '%');
    invalidate();
    return r.changes;
  } catch {
    return 0;
  }
}

function snapshot() {
  return {
    last_check_at: lastAutoCheckAt,
    zapi_down_since: zapiDownSince,
    kill_switches: readAllFlags()
  };
}

async function runCheck() {
  lastAutoCheckAt = new Date().toISOString();
  const db = getDb();

  // 1. Custo Claude hoje
  try {
    const costToday = db
      .prepare(
        "SELECT COALESCE(SUM(custo_usd),0) AS total FROM claude_usage WHERE DATE(criado_em) = DATE('now')"
      )
      .get();
    const threshold = Number(process.env.AUTO_PAUSE_COST_USD) || 50;
    if (Number(costToday.total) > threshold) {
      if (!isKilled('outbound')) {
        setKill('outbound', `custo diario $${costToday.total.toFixed(2)} > $${threshold}`, 'auto_healer');
      }
      if (!isKilled('supervisor')) {
        setKill('supervisor', `custo diario $${costToday.total.toFixed(2)} > $${threshold}`, 'auto_healer');
      }
    }
  } catch (err) {
    logger.debug({ err: err.message }, '[AUTO_HEALER] cost check skip');
  }

  // 2. Z-API down persistente
  try {
    const zapiStatus = await healthChecker.checkZapi();
    if (zapiStatus.status === 'down' || zapiStatus.status === 'degraded') {
      if (!zapiDownSince) zapiDownSince = new Date().toISOString();
      const downMin = (Date.now() - new Date(zapiDownSince).getTime()) / 60_000;
      const threshold = Number(process.env.AUTO_PAUSE_ZAPI_DOWN_MIN) || 30;
      if (downMin >= threshold && !isKilled('outbound')) {
        setKill(
          'outbound',
          `Z-API ${zapiStatus.status} ha ${Math.round(downMin)}min > ${threshold}min`,
          'auto_healer'
        );
      }
    } else {
      if (zapiDownSince) {
        logger.info({ downSince: zapiDownSince }, '[AUTO_HEALER] Z-API recuperada');
        zapiDownSince = null;
      }
    }
  } catch (err) {
    logger.debug({ err: err.message }, '[AUTO_HEALER] zapi check skip');
  }

  // 3. Taxa de erro nas ultimas 1h
  try {
    const errors = db
      .prepare(
        "SELECT COUNT(*) AS c FROM errors_log WHERE criado_em > DATETIME('now','-1 hour')"
      )
      .get();
    const msgs = db
      .prepare(
        "SELECT COUNT(*) AS c FROM conversas WHERE criado_em > DATETIME('now','-1 hour') AND direcao = 'enviada'"
      )
      .get();
    const total = Number(msgs.c) || 0;
    const errorRate = total > 0 ? (Number(errors.c) / total) * 100 : 0;
    const threshold = Number(process.env.AUTO_PAUSE_ERROR_RATE_PCT) || 5;
    if (total >= 10 && errorRate > threshold) {
      if (!isKilled('outbound')) {
        setKill('outbound', `error rate ${errorRate.toFixed(1)}% > ${threshold}%`, 'auto_healer');
      }
    }
  } catch (err) {
    logger.debug({ err: err.message }, '[AUTO_HEALER] error rate check skip');
  }

  return snapshot();
}

function start() {
  if (intervalTimer) return;
  logger.info('[AUTO_HEALER] iniciado (check a cada 5min)');
  setTimeout(() => {
    runCheck().catch((err) => logger.warn({ err: err.message }, '[AUTO_HEALER] check erro'));
    intervalTimer = setInterval(() => {
      runCheck().catch((err) => logger.warn({ err: err.message }, '[AUTO_HEALER] check erro'));
    }, 5 * 60 * 1000);
    if (intervalTimer.unref) intervalTimer.unref();
  }, 60 * 1000);
}

function stop() {
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = null;
  logger.info('[AUTO_HEALER] parado');
}

module.exports = {
  isKilled,
  setKill,
  clearKill,
  killAll,
  clearAll,
  snapshot,
  runCheck,
  start,
  stop
};
