// Marcos Worker — Midia Paga autonoma (cron diario 8h BR).
//
// Fluxo:
//  1. Busca snapshot de campanhas ativas + cobertura regional + budget hoje
//  2. Invoca Marcos (Platform Agent Messages API) com prompt estrategico
//  3. Marcos decide via tools: criar nova campanha pra regiao subcoberta,
//     pausar low performer, escalar winner, ajustar budget
//  4. Registra decisoes em ads_decisions, tool calls em agent_tool_calls
//
// Guardrails:
//  - MARCOS_WORKER_ENABLED=true (default false — requer tokens Meta/Google)
//  - Budget total diario nao ultrapassa MARCOS_MAX_DAILY_BUDGET_BRL (default 1000)
//  - Kill switch via auto-healer bloqueia
//  - Tool calling tem max_iterations 8

const { getDb } = require('../models/database');
const logger = require('../utils/logger');
const platformAgent = require('../services/platform-agent-client');
const autoHealer = require('../services/auto-healer');

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 dia
const FIRST_TICK_DELAY_MS = 15 * 60 * 1000;   // 15min no boot

let tickTimer = null;
let stopRequested = false;
let lastTick = null;
let lastResult = null;

function useToolCallingAgents() {
  return String(process.env.USE_TOOL_CALLING_AGENTS || 'false').toLowerCase() === 'true';
}

function isDailyTickTimeBR() {
  const now = new Date();
  const brHour = (now.getUTCHours() - 3 + 24) % 24;
  const brDow = now.getUTCDay();
  if (brDow === 0 || brDow === 6) return false; // so seg-sex
  return brHour === 8; // 8h BR
}

function buildSnapshot() {
  const db = getDb();
  try {
    const campanhasAtivas = db
      .prepare(
        `SELECT id, platform, name, mesorregiao, mesorregiao_nome, status,
                budget_daily_brl, spent_brl, leads_gerados, cpl_atual, ctr_atual,
                datetime(criada_em) AS criada
         FROM ads_campaigns WHERE status = 'active'
         ORDER BY criada_em DESC LIMIT 30`
      )
      .all();

    const campanhasPausadas = db
      .prepare(
        `SELECT id, platform, name, mesorregiao_nome,
                observacoes, datetime(atualizada_em) AS pausada_em
         FROM ads_campaigns WHERE status = 'paused' AND criada_por_agente = 'marcos'
         ORDER BY atualizada_em DESC LIMIT 10`
      )
      .all();

    const budgetHoje = db
      .prepare(`SELECT COALESCE(SUM(budget_daily_brl), 0) AS total FROM ads_campaigns WHERE status = 'active'`)
      .get().total;

    const cobertura = db
      .prepare(
        `SELECT mesorregiao_nome AS regiao, estado AS uf, COUNT(*) AS leads,
                SUM(CASE WHEN classificacao IN ('quente','ultra_quente') THEN 1 ELSE 0 END) AS quentes,
                SUM(CASE WHEN etapa_funil = 'ganho' THEN 1 ELSE 0 END) AS ganhos
         FROM leads
         WHERE mesorregiao IS NOT NULL
         GROUP BY 1,2
         HAVING leads >= 3
         ORDER BY leads DESC LIMIT 10`
      )
      .all();

    const regioesComCampanha = new Set(campanhasAtivas.map(c => c.mesorregiao));
    const regioesSemCampanha = cobertura.filter(r =>
      !Array.from(regioesComCampanha).some(rc => rc && r.regiao && rc.toLowerCase().includes(r.regiao.toLowerCase().slice(0, 10)))
    );

    return {
      timestamp: new Date().toISOString(),
      campanhas_ativas: campanhasAtivas,
      campanhas_pausadas_recentes: campanhasPausadas,
      budget_diario_total_brl: budgetHoje,
      max_budget_permitido: Number(process.env.MARCOS_MAX_DAILY_BUDGET_BRL) || 1000,
      cobertura_regional: cobertura,
      regioes_sem_campanha: regioesSemCampanha.slice(0, 5),
      meta_configurada: !!process.env.META_ACCESS_TOKEN,
      google_configurada: !!process.env.GOOGLE_ADS_CUSTOMER_ID
    };
  } catch (err) {
    logger.warn({ err: err.message }, '[MARCOS_WORKER] buildSnapshot erro');
    return null;
  }
}

const MARCOS_PROMPT = `Voce acabou de acordar pro seu tick DIARIO de midia paga (8h BR).
Analise o snapshot e decida o que fazer. Seja cirurgico — nao faca mudancas se
nao ha sinal claro. Max 3 acoes por tick.

CRITERIOS:

1. PAUSAR (ads_pause_campaign):
   - CPL > 2x meta (R$60 target) E spent > 3x CPL → pausa imediato
   - CTR < 0.5% com impressions > 1000 → pausa, creativos nao engajam
   - Sem leads apos spend > CPL * 3 → nao converte

2. ESCALAR (ads_adjust_budget, +25-50%):
   - CPL < 0.7x meta (R$42 target) E leads >= 3 → winner, aumentar
   - ROAS > 2 e spent consistente → sustentar crescimento
   - Nunca escala mais que +50% por dia (risco overspend)

3. CRIAR NOVA (ads_create_campaign):
   - "regioes_sem_campanha" tem mesorregiao com >= 5 leads quentes → ha
     tracao organica, vale campanha paga pra amplificar
   - So crie se meta_configurada=true (pra meta) ou google_configurada=true
   - Budget inicial conservador: R$30-50/dia. Cria PAUSED, revisa config
     com Leo (copy), depois ativa.

4. AJUSTAR TARGETING ou CREATIVOS:
   - Se CPL alto mas CTR bom = problema de landing ou targeting, nao pausa imediato
   - Neste caso, chame notify_operator pedindo revisao humana

5. BUDGET GUARDRAIL:
   - Se budget_diario_total + novo >= max_budget_permitido, NAO crie nova
   - Primeiro libere (pause low performer) antes de expandir

6. NADA A FAZER: se metricas estao dentro do esperado, responda "tudo ok"

Use ads_get_performance antes de decidir — NAO aja as cegas.

SNAPSHOT:`;

async function tick() {
  if (stopRequested) return;
  try {
    if (autoHealer.isKilled('marcos')) {
      const reason = autoHealer.snapshot().kill_switches['marcos']?.reason;
      logger.warn({ reason }, '[MARCOS_WORKER] kill-switch ativo, skip');
      lastResult = { skipped: true, reason: 'kill_switch', detail: reason };
      return;
    }
    if (!useToolCallingAgents()) {
      logger.debug('[MARCOS_WORKER] USE_TOOL_CALLING_AGENTS=false, skip');
      lastResult = { skipped: true, reason: 'tool_calling_off' };
      return;
    }
    if (!isDailyTickTimeBR()) {
      logger.debug('[MARCOS_WORKER] fora do horario (8h BR seg-sex), skip');
      lastResult = { skipped: true, reason: 'off_hours' };
      return;
    }

    const snapshot = buildSnapshot();
    if (!snapshot) {
      lastResult = { skipped: true, reason: 'no_snapshot' };
      return;
    }

    if (!snapshot.meta_configurada && !snapshot.google_configurada) {
      logger.info('[MARCOS_WORKER] nenhuma plataforma configurada, skip');
      lastResult = { skipped: true, reason: 'no_platform_config' };
      return;
    }

    const input = `${MARCOS_PROMPT}\n\n${JSON.stringify(snapshot, null, 2)}`;

    const result = await platformAgent.invokeAgent('marcos', input, {
      correlationId: `marcos_daily_${Date.now()}`,
      taskType: 'ad-campaign',
      maxIterations: 8
    });

    lastTick = new Date().toISOString();
    lastResult = {
      at: lastTick,
      tool_calls: result.tool_calls || [],
      iterations: result.iterations,
      resposta: result.resposta?.slice(0, 500)
    };

    logger.info(
      { tool_calls: result.tool_calls?.length || 0, iterations: result.iterations },
      '[MARCOS_WORKER] tick diario concluido'
    );
  } catch (err) {
    logger.error({ err: err.message }, '[MARCOS_WORKER] tick falhou');
    lastResult = { error: err.message };
  } finally {
    lastTick = new Date().toISOString();
    if (!stopRequested) {
      tickTimer = setTimeout(tick, TICK_INTERVAL_MS);
      if (tickTimer.unref) tickTimer.unref();
    }
  }
}

function start() {
  if (tickTimer) return;
  stopRequested = false;
  logger.info('[MARCOS_WORKER] iniciado (1 tick por dia, ~8h BR, 15min apos boot)');
  tickTimer = setTimeout(tick, FIRST_TICK_DELAY_MS);
  if (tickTimer.unref) tickTimer.unref();
}

async function stop() {
  stopRequested = true;
  if (tickTimer) clearTimeout(tickTimer);
  tickTimer = null;
  logger.info('[MARCOS_WORKER] parado');
}

function status() {
  return {
    running: !!tickTimer,
    last_tick: lastTick,
    last_result: lastResult,
    snapshot_preview: buildSnapshot()
  };
}

module.exports = { start, stop, status, buildSnapshot, tick };
