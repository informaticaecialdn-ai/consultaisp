// Wrapper centralizado para Anthropic SDK com tracking de custo (Sprint 3 / T2).
// Uso: const { messages } = claudeClient;  await messages.create(params, meta)
// meta = { agente, lead_id, contexto, correlation_id }

const Anthropic = require('@anthropic-ai/sdk');
const { calculate } = require('./cost-calculator');
const logger = require('./logger');
const { getDb } = require('../models/database');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function createAndTrack(params, meta = {}) {
  const t0 = Date.now();
  const response = await client.messages.create(params);
  const duracao_ms = Date.now() - t0;

  const usage = response?.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const modelo = params.model || response?.model || 'unknown';
  const { custo_usd, verified_at } = calculate(modelo, inputTokens, outputTokens);

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO claude_usage
        (agente, modelo, input_tokens, output_tokens, custo_usd, prices_verified_at, lead_id, contexto, correlation_id, duracao_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      meta.agente || 'unknown',
      modelo,
      inputTokens,
      outputTokens,
      custo_usd,
      verified_at,
      meta.lead_id || null,
      meta.contexto || null,
      meta.correlation_id || null,
      duracao_ms
    );
  } catch (err) {
    logger.warn({ err: err.message }, '[COST] falha ao persistir claude_usage');
  }

  return response;
}

module.exports = {
  client,
  createAndTrack,
  messages: { create: createAndTrack },
};
