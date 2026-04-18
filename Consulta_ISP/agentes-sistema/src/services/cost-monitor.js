// Monitor de custo diario Claude (Sprint 3 / T2).
// Checa a cada 1h se custo do dia ultrapassou COST_ALERT_DAILY_USD
// e dispara POST em COST_ALERT_WEBHOOK (uma vez por dia).

const { getDb } = require('../models/database');
const logger = require('../utils/logger');

let lastAlertDate = null; // YYYY-MM-DD UTC
let timer = null;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getTodayCost() {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT COALESCE(SUM(custo_usd), 0) AS total FROM claude_usage WHERE DATE(criado_em) = DATE('now')"
    ).get();
    return Number(row?.total || 0);
  } catch (err) {
    logger.warn({ err: err.message }, '[COST-MONITOR] falha ao ler claude_usage');
    return 0;
  }
}

async function sendAlert(webhook, total, threshold) {
  const body = JSON.stringify({
    content: `[COST-ALERT] Custo Claude hoje: $${total.toFixed(2)} USD (threshold: $${threshold.toFixed(2)}).`,
    ts: new Date().toISOString(),
  });
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    logger.info({ total, threshold }, '[COST-MONITOR] alerta enviado');
  } catch (err) {
    logger.warn({ err: err.message }, '[COST-MONITOR] falha ao enviar alerta');
  }
}

async function checkAndAlert() {
  const threshold = Number(process.env.COST_ALERT_DAILY_USD || 25);
  const webhook = process.env.COST_ALERT_WEBHOOK;
  const total = getTodayCost();

  logger.debug({ total, threshold }, '[COST-MONITOR] tick');

  if (total < threshold) return;
  if (!webhook) {
    logger.warn({ total, threshold }, '[COST-MONITOR] threshold atingido mas COST_ALERT_WEBHOOK nao configurado');
    return;
  }
  const t = today();
  if (lastAlertDate === t) return; // ja alertou hoje
  lastAlertDate = t;
  await sendAlert(webhook, total, threshold);
}

function start({ intervalMs = 60 * 60 * 1000 } = {}) {
  if (timer) return;
  timer = setInterval(() => {
    checkAndAlert().catch(err => logger.warn({ err: err.message }, '[COST-MONITOR] erro no check'));
  }, intervalMs);
  if (timer.unref) timer.unref();
  logger.info({ intervalMs }, '[COST-MONITOR] iniciado');
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop, checkAndAlert, getTodayCost };
