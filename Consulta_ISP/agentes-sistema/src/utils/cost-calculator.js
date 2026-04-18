// Calculadora de custo Claude (Sprint 3 / T2).
// Le data/claude-prices.json em cache (hot reload opcional via refreshPrices()).

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const PRICES_PATH = path.join(__dirname, '../../data/claude-prices.json');

let cache = null;

function loadPrices() {
  try {
    const raw = fs.readFileSync(PRICES_PATH, 'utf8');
    cache = JSON.parse(raw);
  } catch (err) {
    logger.warn({ err: err.message, path: PRICES_PATH }, '[COST] nao consegui ler claude-prices.json, usando fallback vazio');
    cache = { verified_at: null, models: {} };
  }
  return cache;
}

function refreshPrices() {
  cache = null;
  return loadPrices();
}

function getPrices() {
  if (!cache) loadPrices();
  return cache;
}

function calculate(modelo, inputTokens = 0, outputTokens = 0) {
  const prices = getPrices();
  const modelKey = String(modelo || '').trim();
  const entry = prices.models[modelKey];
  if (!entry) {
    return { custo_usd: 0, verified_at: prices.verified_at, modelo_conhecido: false };
  }
  const custo_usd =
    (Number(inputTokens) / 1_000_000) * entry.input_per_1m +
    (Number(outputTokens) / 1_000_000) * entry.output_per_1m;
  return {
    custo_usd: Number(custo_usd.toFixed(6)),
    verified_at: prices.verified_at,
    modelo_conhecido: true,
  };
}

module.exports = { calculate, getPrices, refreshPrices };
