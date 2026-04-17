const fs = require('fs');
const path = require('path');

const { getDb } = require('../models/database');
const campanhasService = require('../services/campanhas');
const templatesService = require('../services/templates');
const consent = require('../services/consent');
const windowChecker = require('../services/window-checker');
const rateLimiter = require('../services/broadcast-rate-limiter');
const zapi = require('../services/zapi');
const logger = require('../utils/logger');

let running = false;
let stopRequested = false;
let loopPromise = null;

const HEARTBEAT_PATH = path.join(__dirname, '../../data/.worker-heartbeat-broadcast');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function writeHeartbeat() {
  try {
    const payload = {
      ts: new Date().toISOString(),
      pid: process.pid,
      running,
      stopRequested
    };
    fs.writeFileSync(HEARTBEAT_PATH, JSON.stringify(payload));
  } catch (err) {
    // nao bloqueia o worker por falha de heartbeat
  }
}

function readHeartbeat() {
  try {
    if (!fs.existsSync(HEARTBEAT_PATH)) return null;
    return JSON.parse(fs.readFileSync(HEARTBEAT_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function killSwitchActive() {
  // Releitura a cada iteracao permite flip via env sem restart
  try { require('dotenv').config({ override: true }); } catch {}
  return process.env.BROADCAST_WORKER_ENABLED === 'false';
}

function claimBatch(batchSize) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE campanha_envios
    SET status = 'processando'
    WHERE id IN (
      SELECT e.id
      FROM campanha_envios e
      INNER JOIN campanhas c ON c.id = e.campanha_id
      WHERE e.status = 'pendente'
        AND (e.proximo_retry IS NULL OR e.proximo_retry <= datetime('now'))
        AND c.status = 'enviando'
      ORDER BY e.id ASC
      LIMIT ?
    )
    RETURNING *
  `);
  const claimed = stmt.all(batchSize);
  // Enriquece com dados da campanha em uma unica query para evitar N+1
  if (claimed.length === 0) return [];
  const campanhaIds = [...new Set(claimed.map(e => e.campanha_id))];
  const placeholders = campanhaIds.map(() => '?').join(',');
  const campanhas = db.prepare(
    `SELECT * FROM campanhas WHERE id IN (${placeholders})`
  ).all(...campanhaIds);
  const byId = Object.fromEntries(campanhas.map(c => [c.id, c]));
  return claimed.map(e => ({ ...e, campanha: byId[e.campanha_id] }));
}

function markBlocked(envio, statusBloqueio, reason) {
  const db = getDb();
  db.prepare(`
    UPDATE campanha_envios
    SET status = ?, erro = ?
    WHERE id = ?
  `).run(statusBloqueio, reason || null, envio.id);
  campanhasService.incrementCounter(envio.campanha_id, 'bloqueados_count');
  logger.warn({ envioId: envio.id, statusBloqueio, reason }, 'envio bloqueado mid-flight');
}

function markEnviado(envio, zapiMessageId) {
  const db = getDb();
  db.prepare(`
    UPDATE campanha_envios
    SET status = 'enviado',
        enviado_em = CURRENT_TIMESTAMP,
        zapi_message_id = ?,
        erro = NULL
    WHERE id = ?
  `).run(zapiMessageId || null, envio.id);
  campanhasService.incrementCounter(envio.campanha_id, 'enviados_count');

  // Registra tambem em conversas (assim delivery webhooks atualizam ambos)
  try {
    db.prepare(`
      INSERT INTO conversas (lead_id, agente, direcao, mensagem, tipo, canal, zapi_message_id)
      VALUES (?, ?, 'enviada', ?, 'broadcast', 'whatsapp', ?)
    `).run(
      envio.lead_id,
      envio.campanha?.agente_remetente || 'broadcast',
      envio.mensagem_renderizada,
      zapiMessageId || null
    );
  } catch (err) {
    logger.warn({ envioId: envio.id, err: err.message }, 'falha ao registrar conversa');
  }
}

function handleEnvioError(envio, err, log) {
  const db = getDb();
  const retryDelays = (process.env.BROADCAST_RETRY_DELAYS_SEC || '30,120,600')
    .split(',')
    .map(s => parseInt(s, 10))
    .filter(n => Number.isFinite(n) && n > 0);

  const statusCode = err.statusCode || err.response?.status || 0;
  const msg = err.message || '';
  const isPermanent =
    statusCode === 400 ||
    statusCode === 401 ||
    statusCode === 403 ||
    /invalid_phone|blocked|phone-does-not-exist/i.test(msg);

  const canRetry = !isPermanent && envio.tentativas < retryDelays.length;

  if (canRetry) {
    const nextDelay = retryDelays[envio.tentativas];
    const proximoRetry = new Date(Date.now() + nextDelay * 1000).toISOString();
    db.prepare(`
      UPDATE campanha_envios
      SET status = 'pendente',
          tentativas = tentativas + 1,
          proximo_retry = ?,
          erro = ?
      WHERE id = ?
    `).run(proximoRetry, msg.slice(0, 500), envio.id);
    log.warn({ tentativa: envio.tentativas + 1, nextDelay, err: msg }, 'retry agendado');
  } else {
    db.prepare(`
      UPDATE campanha_envios
      SET status = 'falhou',
          erro = ?
      WHERE id = ?
    `).run(msg.slice(0, 500), envio.id);
    campanhasService.incrementCounter(envio.campanha_id, 'falhas_count');
    log.error({ err: msg, isPermanent, statusCode }, 'envio falhou definitivamente');
    checkAutoPause(envio.campanha_id);
  }
}

function checkAutoPause(campanhaId) {
  const db = getDb();
  const campanha = db.prepare('SELECT * FROM campanhas WHERE id = ?').get(campanhaId);
  if (!campanha || campanha.status !== 'enviando') return;

  const totalProcessado = (campanha.enviados_count || 0) + (campanha.falhas_count || 0);
  if (totalProcessado < 10) return;

  const threshold = parseFloat(process.env.BROADCAST_FAILURE_THRESHOLD_PCT) || 20;
  const failPct = (campanha.falhas_count / totalProcessado) * 100;

  if (failPct > threshold) {
    const res = db.prepare(
      "UPDATE campanhas SET status = 'pausada' WHERE id = ? AND status = 'enviando'"
    ).run(campanhaId);
    if (res.changes > 0) {
      logger.warn(
        { campanhaId, failPct: failPct.toFixed(1), threshold },
        'campanha auto-pausada por alta taxa de falha'
      );
      notifyWebhook(
        `Campanha ${campanhaId} auto-pausada. Taxa de falha ${failPct.toFixed(1)}% (limite ${threshold}%)`
      );
    }
  }
}

function notifyWebhook(message) {
  const url = process.env.ERROR_REPORT_WEBHOOK;
  if (!url) return;
  const body = JSON.stringify({ content: message, ts: new Date().toISOString() });
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  }).catch(err => logger.warn({ err: err.message }, 'webhook de alerta falhou'));
}

async function processEnvio(envio) {
  const log = logger.withCorrelation(`envio-${envio.id}`);
  const campanha = envio.campanha;

  try {
    // 1. Checagem opt-out (estado pode ter mudado entre expand e processamento)
    const consentCheck = consent.canSendTo(envio.telefone);
    if (!consentCheck.allowed) {
      return markBlocked(envio, 'bloqueado_optout', consentCheck.reason);
    }

    // 2. Checagem janela 24h para templates non-HSM
    const template = campanha?.template_id
      ? templatesService.getById(campanha.template_id)
      : null;
    const hsmApproved = template && template.ja_aprovado_meta === 1;
    if (!hsmApproved) {
      const win = await windowChecker.canSendFreeForm(envio.lead_id);
      if (!win.allowed) {
        return markBlocked(envio, 'bloqueado_window', win.reason);
      }
    }

    // 3. Envio real
    const result = await zapi.sendText(envio.telefone, envio.mensagem_renderizada);
    const zapiMessageId =
      result?.id || result?.messageId || result?.zaapId || null;
    markEnviado(envio, zapiMessageId);
    log.info({ telefone: campanhasService.maskPhone(envio.telefone) }, 'envio bem-sucedido');
  } catch (err) {
    handleEnvioError(envio, err, log);
  }
}

async function loop() {
  const batchSize = parseInt(process.env.BROADCAST_BATCH_SIZE) || 10;
  while (!stopRequested) {
    writeHeartbeat();

    if (killSwitchActive()) {
      logger.warn('kill switch ativo (BROADCAST_WORKER_ENABLED=false), idle');
      await sleep(10000);
      continue;
    }

    try {
      const batch = claimBatch(batchSize);
      if (batch.length === 0) {
        // Checagem de conclusao para campanhas sem envios pendentes
        const db = getDb();
        const ativas = db.prepare(
          "SELECT id FROM campanhas WHERE status = 'enviando'"
        ).all();
        for (const c of ativas) campanhasService.checkConclusion(c.id);
        await sleep(5000);
        continue;
      }

      for (const envio of batch) {
        if (stopRequested) break;
        await processEnvio(envio);
        if (stopRequested) break;
        if (envio.campanha) {
          await rateLimiter.waitForNextSlot(envio.campanha);
        }
      }

      const campanhasTocadas = new Set(batch.map(e => e.campanha_id));
      for (const cid of campanhasTocadas) campanhasService.checkConclusion(cid);
    } catch (err) {
      logger.error({ err: err.message, stack: err.stack }, 'erro no loop do broadcast worker');
      await sleep(10000);
    }
  }
  running = false;
  writeHeartbeat();
  logger.info('broadcast worker parado');
}

function start() {
  if (running) return;
  stopRequested = false;
  running = true;
  logger.info('broadcast worker iniciado');
  writeHeartbeat();
  loopPromise = loop();
}

async function stop() {
  if (!running) return;
  stopRequested = true;
  logger.info('broadcast worker: stop solicitado');
  while (running) await sleep(100);
  if (loopPromise) {
    try { await loopPromise; } catch {}
  }
}

function status() {
  return {
    running,
    stopRequested,
    heartbeat: readHeartbeat(),
    kill_switch_active: killSwitchActive()
  };
}

module.exports = {
  start,
  stop,
  status,
  processEnvio,
  claimBatch,
  checkAutoPause,
  handleEnvioError,
  markBlocked,
  markEnviado,
  readHeartbeat,
  HEARTBEAT_PATH
};
