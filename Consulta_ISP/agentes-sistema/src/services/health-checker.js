// Health checks aprofundados (Sprint 3 / T4).
// Retorna status: 'ok' | 'degraded' | 'down'.

const fs = require('fs');
const path = require('path');
const { getDb } = require('../models/database');
const logger = require('../utils/logger');

const CACHE_TTL_MS = 60 * 1000;
const cache = {};

function cached(key, ttl, fn) {
  const hit = cache[key];
  const now = Date.now();
  if (hit && (now - hit.at) < ttl) return Promise.resolve(hit.value);
  return Promise.resolve(fn()).then(value => {
    cache[key] = { at: now, value };
    return value;
  });
}

async function checkDB() {
  const t0 = Date.now();
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    return { status: 'ok', latency_ms: Date.now() - t0 };
  } catch (err) {
    return { status: 'down', latency_ms: Date.now() - t0, error: err.message };
  }
}

async function checkAnthropic() {
  return cached('anthropic', CACHE_TTL_MS, async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { status: 'degraded', reason: 'ANTHROPIC_API_KEY ausente' };
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      });
      if (res.ok) return { status: 'ok', latency_ms: Date.now() - t0, http_status: res.status };
      if (res.status === 401 || res.status === 403) {
        return { status: 'down', latency_ms: Date.now() - t0, http_status: res.status, reason: 'credencial invalida' };
      }
      return { status: 'degraded', latency_ms: Date.now() - t0, http_status: res.status };
    } catch (err) {
      return { status: 'down', error: err.message };
    }
  });
}

async function checkZapi() {
  return cached('zapi', CACHE_TTL_MS, async () => {
    const instanceId = process.env.ZAPI_INSTANCE_ID;
    const token = process.env.ZAPI_TOKEN;
    if (!instanceId || !token) return { status: 'degraded', reason: 'Z-API nao configurada' };
    const baseUrl = process.env.ZAPI_BASE_URL || 'https://api.z-api.io';
    const url = `${baseUrl}/instances/${instanceId}/token/${token}/status`;
    const t0 = Date.now();
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (process.env.ZAPI_CLIENT_TOKEN) headers['Client-Token'] = process.env.ZAPI_CLIENT_TOKEN;
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      });
      if (!res.ok) return { status: 'degraded', latency_ms: Date.now() - t0, http_status: res.status };
      const body = await res.json().catch(() => ({}));
      const connected = body?.connected === true;
      return { status: connected ? 'ok' : 'degraded', latency_ms: Date.now() - t0, connected };
    } catch (err) {
      return { status: 'down', error: err.message };
    }
  });
}

async function checkBackup() {
  const markerPath = path.join(__dirname, '../../data/.last-backup-at');
  try {
    if (!fs.existsSync(markerPath)) {
      return { status: 'degraded', reason: 'nenhum heartbeat em data/.last-backup-at' };
    }
    const raw = fs.readFileSync(markerPath, 'utf8').trim();
    const when = new Date(raw);
    if (Number.isNaN(when.getTime())) return { status: 'degraded', reason: 'timestamp invalido' };
    const ageHours = (Date.now() - when.getTime()) / 3600_000;
    const status = ageHours <= 7 ? 'ok' : (ageHours <= 48 ? 'degraded' : 'down');
    return { status, last_backup_at: raw, age_hours: Number(ageHours.toFixed(2)) };
  } catch (err) {
    return { status: 'degraded', error: err.message };
  }
}

async function checkDisk() {
  try {
    // statfs e experimental em alguns Nodes — envolve com try
    const p = path.join(__dirname, '../../data');
    if (!fs.statfsSync) return { status: 'ok', note: 'statfs indisponivel neste Node' };
    const s = fs.statfsSync(p);
    const used = s.blocks - s.bavail;
    const pctUsed = s.blocks > 0 ? Math.round((used / s.blocks) * 100) : 0;
    const status = pctUsed < 80 ? 'ok' : (pctUsed < 95 ? 'degraded' : 'down');
    return { status, pct_used: pctUsed, free_gb: Number(((s.bavail * s.bsize) / 1024 ** 3).toFixed(2)) };
  } catch (err) {
    return { status: 'degraded', error: err.message };
  }
}

async function checkMemory() {
  const rss = process.memoryUsage().rss;
  const mb = rss / (1024 * 1024);
  const status = mb < 500 ? 'ok' : (mb < 1000 ? 'degraded' : 'down');
  return { status, rss_mb: Number(mb.toFixed(1)) };
}

async function checkUptime() {
  const sec = process.uptime();
  const status = sec >= 60 ? 'ok' : 'degraded';
  return { status, uptime_sec: Math.round(sec) };
}

async function runAll() {
  const entries = await Promise.all([
    ['database', checkDB()],
    ['anthropic', checkAnthropic()],
    ['zapi', checkZapi()],
    ['backup', checkBackup()],
    ['disk', checkDisk()],
    ['memory', checkMemory()],
    ['uptime', checkUptime()],
  ].map(([k, p]) => Promise.resolve(p).then(v => [k, v]).catch(err => [k, { status: 'down', error: err.message }])));

  const checks = Object.fromEntries(entries);
  let overall = 'ok';
  for (const v of Object.values(checks)) {
    if (v.status === 'down') { overall = 'down'; break; }
    if (v.status === 'degraded') overall = 'degraded';
  }
  return { status: overall, checks, timestamp: new Date().toISOString() };
}

module.exports = { runAll, checkDB, checkAnthropic, checkZapi, checkBackup, checkDisk, checkMemory, checkUptime };
