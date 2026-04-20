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
const enricher = require('../services/enricher');
const autoHealer = require('../services/auto-healer');
const regioes = require('../services/regioes');

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
      regioes: JSON.parse(row.regioes || '[]'),           // LEGADO: UFs soltas
      mesorregioes: JSON.parse(row.mesorregioes || '[]'), // NOVO: [{uf, slug, nome}]
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

// Monta lista de (cidade, uf) x termo a partir da config.
// NOVO: expande cidades das mesorregioes escolhidas + anexa hint no raw_data
// LEGADO: se nao tem mesorregioes, usa UFs soltas (comportamento antigo)
function buildSearchTargets(cfg) {
  const targets = [];

  // NOVO: expande mesorregioes em cidades individuais
  if (Array.isArray(cfg.mesorregioes) && cfg.mesorregioes.length > 0) {
    const cidades = regioes.expandCidades(cfg.mesorregioes);
    for (const c of cidades) {
      for (const termo of cfg.termos) {
        targets.push({
          locationLabel: `${c.cidade}, ${c.uf}`,
          locationQuery: `${c.cidade}, ${c.uf}, Brazil`,
          termo,
          mesorregiao_slug: c.mesorregiao_slug,
          mesorregiao_nome: c.mesorregiao_nome,
          cidade: c.cidade,
          uf: c.uf
        });
      }
    }
  }

  // LEGADO: UFs soltas (mantido pra compat, mas gera menos densidade)
  if (targets.length === 0 && Array.isArray(cfg.regioes)) {
    for (const uf of cfg.regioes) {
      for (const termo of cfg.termos) {
        targets.push({
          locationLabel: uf,
          locationQuery: `${uf}, Brazil`,
          termo,
          mesorregiao_slug: null,
          mesorregiao_nome: null,
          cidade: null,
          uf
        });
      }
    }
  }

  return targets;
}

// Roda scraping iterando cidades da mesorregiao x termos.
// Cada item Apify vem marcado com _mesorregiao_slug pra linkar o lead na origem.
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
  if (!cfg.termos?.length) {
    return { skipped: true, reason: 'no_termos' };
  }

  const targets = buildSearchTargets(cfg);
  if (targets.length === 0) {
    return { skipped: true, reason: 'no_targets' };
  }

  // Limite de alvos por tick pra evitar explosao de custo
  const MAX_TARGETS_PER_TICK = Math.min(cfg.max_leads_por_run || 50, 100);
  const workTargets = targets.slice(0, MAX_TARGETS_PER_TICK);

  logger.info(
    { total_targets: targets.length, executando: workTargets.length, mesorregioes: cfg.mesorregioes?.length || 0 },
    '[PROSPECTOR] iniciando scraping regional'
  );

  const db = getDb();
  const results = [];

  for (const t of workTargets) {
    try {
      const input = {
        searchStringsArray: [t.termo],
        locationQuery: t.locationQuery,
        maxCrawledPlacesPerSearch: Math.min(cfg.max_leads_por_run, 20),
        language: 'pt-BR',
        maxImages: 0,
        includeReviews: false
      };

      const t0 = Date.now();

      const runInsert = db
        .prepare(
          `INSERT INTO apify_runs (actor_id, actor_label, params, status, iniciada_por)
           VALUES ('compass/crawler-google-places', 'Google Maps Scraper', ?, 'running', 'prospector_cron')`
        )
        .run(JSON.stringify({ ...input, _meta: { mesorregiao: t.mesorregiao_slug, cidade: t.cidade, uf: t.uf } }));
      const runId = runInsert.lastInsertRowid;

      const items = await apify.client.runSyncGetItems(
        'compass/crawler-google-places',
        { ...input },
        { timeoutSec: 240 }
      );

      // Injeta hint de mesorregiao em cada item antes de enfileirar
      const itemsWithHint = items.map((it) => ({
        ...it,
        _mesorregiao_slug: t.mesorregiao_slug,
        _mesorregiao_nome: t.mesorregiao_nome,
        // Se o item nao traz city/state, usa o target
        city: it.city || t.cidade,
        state: it.state || t.uf
      }));

      const duracao = Date.now() - t0;
      const { enqueued } = validator.enqueueBatch(itemsWithHint, {
        source: 'apify_google_maps',
        source_run_id: runId
      });

      db.prepare(
        `UPDATE apify_runs SET
           status = 'succeeded', items_count = ?, leads_novos = ?,
           duracao_ms = ?, finalizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(items.length, enqueued, duracao, runId);

      results.push({
        label: t.locationLabel,
        termo: t.termo,
        mesorregiao: t.mesorregiao_nome,
        items: items.length,
        enqueued,
        runId
      });
      logger.info(
        { label: t.locationLabel, termo: t.termo, items: items.length, enqueued, duracao_ms: duracao },
        '[PROSPECTOR] scraping target concluido'
      );
    } catch (err) {
      logger.error(
        { label: t.locationLabel, termo: t.termo, err: err.message },
        '[PROSPECTOR] erro scraping target'
      );
      results.push({ label: t.locationLabel, termo: t.termo, error: err.message });
    }
  }

  lastScrapingRun = new Date().toISOString();
  return { ran: true, results, total_targets: targets.length, executed: workTargets.length };
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

    // Enrichment automatico apos import (CNPJ + emails + socials via Apify)
    let enrichResult = { skipped: true };
    if (imp.importados > 0 && apify.client.isConfigured()) {
      try {
        enrichResult = await enricher.enrichBatch({ limit: Math.min(imp.importados, 30) });
      } catch (err) {
        logger.warn({ err: err.message }, '[PROSPECTOR] enrichment falhou (nao-bloqueante)');
        enrichResult = { error: err.message };
      }
    }

    lastValidationRun = new Date().toISOString();
    logger.info({ val, imp, enrich: enrichResult }, '[PROSPECTOR] validation + enrich concluida');
    return { ran: true, validation: val, import: imp, enrichment: enrichResult };
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
