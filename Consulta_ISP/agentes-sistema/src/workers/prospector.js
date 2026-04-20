// Prospector Worker (Milestone 1 / C3).
// Roda no processo separado (src/worker.js) quando PROSPECTOR_WORKER_ENABLED=true.
//
// 2 crons:
//  1. Scraping (seg/qua/sex 8h BR) — dispara Apify Google Maps Scraper por regiao/termo
//     configurado em prospector_config e enfileira itens em leads_pending
//  2. Validation (diariamente 9h BR) — processa fila leads_pending (validator) e
//     importa aprovados em leads com origem=prospector_auto
//
// Simple scheduler baseado em setInterval + verificacao de hora (sem dep externa).

const { getDb } = require('../models/database');
const logger = require('../utils/logger');
const apify = require('../services/apify');
const validator = require('../services/lead-validator');
const autoHealer = require('../services/auto-healer');

const TICK_INTERVAL_MS = 5 * 60 * 1000; // checa a cada 5min se tem cron pra rodar
const MAX_ITEMS_POR_RUN = 50;

let tickTimer = null;
let stopRequested = false;
let lastScrapingRun = null; // ISO timestamp
let lastValidationRun = null;

function getConfig() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM prospector_config WHERE id = 1').get();
    if (!row) return null;
    return {
      enabled: !!row.enabled,
      regioes: JSON.parse(row.regioes || '[]'),
      termos: JSON.parse(row.termos || '[]'),
      max_leads_por_run: row.max_leads_por_run || MAX_ITEMS_POR_RUN,
      scraping_cron: row.scraping_cron || '0 8 * * 1,3,5',
      validation_cron: row.validation_cron || '0 9 * * *'
    };
  } catch {
    return null;
  }
}

// Parser cron minimalista — so olha dia-da-semana e hora.
// Formato suportado: "M H * * DOW" onde DOW = lista (0,3,5 ou *)
// Retorna true se a hora atual (BR) bater com a config.
function isCronTimeNow(cron) {
  if (!cron) return false;
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [minCron, hourCron, , , dowCron] = parts;
  const now = new Date();
  // Hora BR (UTC-3 fixo, nao tratamos horario de verao)
  const brHour = (now.getUTCHours() - 3 + 24) % 24;
  const brMin = now.getUTCMinutes();
  const brDow = now.getUTCDay(); // 0=dom

  const hourMatch =
    hourCron === '*' ||
    hourCron
      .split(',')
      .map((h) => parseInt(h, 10))
      .includes(brHour);
  const minMatch =
    minCron === '*' ||
    minCron
      .split(',')
      .map((m) => parseInt(m, 10))
      .includes(brMin);
  const dowMatch =
    dowCron === '*' ||
    dowCron
      .split(',')
      .map((d) => parseInt(d, 10))
      .includes(brDow);

  return hourMatch && minMatch && dowMatch;
}

// Roda scraping: para cada combinacao (regiao x termo) dispara Apify sync (ate 5min)
async function runScraping() {
  const cfg = getConfig();
  if (!cfg || !cfg.enabled) {
    logger.debug('[PROSPECTOR] scraping skip: config desabilitada');
    return { skipped: true };
  }
  if (!apify.client.isConfigured()) {
    logger.warn('[PROSPECTOR] scraping skip: APIFY_TOKEN ausente');
    return { skipped: true, reason: 'no_apify_token' };
  }

  const db = getDb();
  const results = [];

  for (const regiao of cfg.regioes) {
    for (const termo of cfg.termos) {
      try {
        const input = {
          searchStringsArray: [termo],
          locationQuery: `${regiao}, Brazil`,
          maxCrawledPlacesPerSearch: Math.min(cfg.max_leads_por_run, 30),
          language: 'pt-BR',
          maxImages: 0,
          includeReviews: false
        };

        logger.info({ regiao, termo }, '[PROSPECTOR] iniciando scraping');
        const t0 = Date.now();

        // Registra apify_run pendente
        const runInsert = db
          .prepare(
            `INSERT INTO apify_runs (actor_id, actor_label, params, status, iniciada_por)
             VALUES ('compass/crawler-google-places', 'Google Maps Scraper', ?, 'running', 'prospector_cron')`
          )
          .run(JSON.stringify(input));
        const runId = runInsert.lastInsertRowid;

        const items = await apify.client.runSyncGetItems(
          'compass/crawler-google-places',
          { ...input },
          { timeoutSec: 240 }
        );

        const duracao = Date.now() - t0;
        const { enqueued } = validator.enqueueBatch(items, {
          source: 'apify_google_maps',
          source_run_id: runId
        });

        db.prepare(
          `UPDATE apify_runs SET
             status = 'succeeded', items_count = ?, leads_novos = ?,
             duracao_ms = ?, finalizado_em = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(items.length, enqueued, duracao, runId);

        results.push({ regiao, termo, items: items.length, enqueued, runId });
        logger.info(
          { regiao, termo, items: items.length, enqueued, duracao },
          '[PROSPECTOR] scraping concluido'
        );
      } catch (err) {
        logger.error({ regiao, termo, err: err.message }, '[PROSPECTOR] erro scraping');
        results.push({ regiao, termo, error: err.message });
      }
    }
  }

  lastScrapingRun = new Date().toISOString();
  return { ran: true, results };
}

async function runValidation() {
  const cfg = getConfig();
  if (!cfg || !cfg.enabled) {
    logger.debug('[PROSPECTOR] validation skip: config desabilitada');
    return { skipped: true };
  }

  try {
    logger.info('[PROSPECTOR] iniciando validation + import');
    const val = validator.processQueue({ limit: 200 });
    const imp = validator.importApproved({ limit: 200 });
    lastValidationRun = new Date().toISOString();
    logger.info({ val, imp }, '[PROSPECTOR] validation concluida');
    return { ran: true, validation: val, import: imp };
  } catch (err) {
    logger.error({ err: err.message }, '[PROSPECTOR] erro validation');
    return { error: err.message };
  }
}

// Guard anti-double-run: so roda 1x por hora (lastRun + 1h threshold)
function shouldRun(kind, cronExpr) {
  if (!isCronTimeNow(cronExpr)) return false;
  const last = kind === 'scraping' ? lastScrapingRun : lastValidationRun;
  if (!last) return true;
  const elapsedMs = Date.now() - new Date(last).getTime();
  return elapsedMs > 50 * 60 * 1000; // 50min — dentro da janela do cron
}

async function tick() {
  if (stopRequested) return;
  try {
    if (autoHealer.isKilled('prospector')) {
      logger.debug('[PROSPECTOR] kill-switch ativo, skip');
      return;
    }
    const cfg = getConfig();
    if (cfg?.enabled) {
      if (shouldRun('scraping', cfg.scraping_cron)) {
        await runScraping();
      }
      if (shouldRun('validation', cfg.validation_cron)) {
        await runValidation();
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, '[PROSPECTOR] tick falhou');
  } finally {
    if (!stopRequested) {
      tickTimer = setTimeout(tick, TICK_INTERVAL_MS);
      if (tickTimer.unref) tickTimer.unref();
    }
  }
}

function start() {
  if (tickTimer) return;
  stopRequested = false;
  logger.info('[PROSPECTOR] worker iniciado (tick a cada 5min)');
  tickTimer = setTimeout(tick, TICK_INTERVAL_MS);
  if (tickTimer.unref) tickTimer.unref();
}

async function stop() {
  stopRequested = true;
  if (tickTimer) clearTimeout(tickTimer);
  tickTimer = null;
  logger.info('[PROSPECTOR] worker parado');
}

function status() {
  const cfg = getConfig();
  return {
    running: !!tickTimer,
    enabled: cfg?.enabled || false,
    last_scraping: lastScrapingRun,
    last_validation: lastValidationRun,
    config: cfg
  };
}

module.exports = { start, stop, status, runScraping, runValidation, isCronTimeNow };
