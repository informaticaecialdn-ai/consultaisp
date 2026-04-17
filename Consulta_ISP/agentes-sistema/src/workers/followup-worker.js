// Followup worker: migra o setInterval que antes vivia em server.js.
// Roda no processo separado (src/worker.js).

const followup = require('../services/followup');
const logger = require('../utils/logger');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

let timer = null;
let stopRequested = false;

function start({ intervalMs } = {}) {
  if (timer) return;
  stopRequested = false;
  const interval = Number(intervalMs) || Number(process.env.FOLLOWUP_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

  async function tick() {
    if (stopRequested) return;
    try {
      await followup.processFollowups();
    } catch (err) {
      logger.error({ err: err.message }, 'followup tick falhou');
    } finally {
      if (!stopRequested) {
        timer = setTimeout(tick, interval);
        if (timer.unref) timer.unref();
      }
    }
  }

  logger.info({ intervalMs: interval }, 'followup worker iniciado');
  // primeiro tick agendado respeitando intervalo (evita executar imediatamente em startup)
  timer = setTimeout(tick, interval);
  if (timer.unref) timer.unref();
}

async function stop() {
  stopRequested = true;
  if (timer) clearTimeout(timer);
  timer = null;
  logger.info('followup worker parado');
}

function status() {
  return { running: !!timer, stopRequested };
}

module.exports = { start, stop, status };
