// Worker que processa email sequences com proximo_envio_em vencido.
// Cron 15min em 15min — envia max 50 emails por tick pra nao estourar rate
// limit do Resend (100/s free tier, mas conservador).

const emailSequences = require('../services/email-sequences');
const autoHealer = require('../services/auto-healer');
const logger = require('../utils/logger');

const TICK_INTERVAL_MS = 15 * 60 * 1000;
let timer = null;
let stopRequested = false;
let lastStats = null;

async function tick() {
  if (stopRequested) return;
  try {
    if (autoHealer.isKilled('email_sequences')) {
      lastStats = { skipped: true, reason: 'kill_switch' };
      return;
    }
    const result = await emailSequences.processDueSequences({ limit: 50 });
    lastStats = { at: new Date().toISOString(), ...result };
    if (result.processed > 0) {
      logger.info(result, '[EMAIL_SEQ_WORKER] tick concluido');
    }
  } catch (err) {
    logger.error({ err: err.message }, '[EMAIL_SEQ_WORKER] tick falhou');
    lastStats = { error: err.message };
  } finally {
    if (!stopRequested) {
      timer = setTimeout(tick, TICK_INTERVAL_MS);
      if (timer.unref) timer.unref();
    }
  }
}

function start() {
  if (timer) return;
  stopRequested = false;
  logger.info('[EMAIL_SEQ_WORKER] iniciado (tick 15min)');
  timer = setTimeout(tick, TICK_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

async function stop() {
  stopRequested = true;
  if (timer) clearTimeout(timer);
  timer = null;
}

function status() {
  return { running: !!timer, last: lastStats };
}

module.exports = { start, stop, status };
