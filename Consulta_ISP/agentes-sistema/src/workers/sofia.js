// Sofia Worker — estrategia semanal (domingo 20h BR).
// Analisa cobertura regional + performance + custo, decide:
//  - adicionar mesorregiao promissora (tem leads organicos quentes)
//  - remover mesorregiao improdutiva (>30 leads, 0 qualificados)
//  - ajustar min_rating/min_reviews se qualidade caiu
//  - delegar copy pro Leo ou campanha pro Marcos
//  - relatorio semanal pra Bia via notify_operator

const { getDb } = require('../models/database');
const logger = require('../utils/logger');
const platformAgent = require('../services/platform-agent-client');
const autoHealer = require('../services/auto-healer');

const TICK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1 semana
const FIRST_TICK_DELAY_MS = 20 * 60 * 1000;       // 20min no boot

let tickTimer = null;
let stopRequested = false;
let lastTick = null;
let lastResult = null;

function useToolCallingAgents() {
  return String(process.env.USE_TOOL_CALLING_AGENTS || 'false').toLowerCase() === 'true';
}

// Domingo 20h BR (UTC-3 = domingo 23h UTC)
function isWeeklyTickTimeBR() {
  const now = new Date();
  const brHour = (now.getUTCHours() - 3 + 24) % 24;
  const brDow = now.getUTCDay();
  return brDow === 0 && brHour === 20;
}

function buildStrategicSnapshot() {
  const db = getDb();
  try {
    // Cobertura por mesorregiao com agregados 30 dias
    const cobertura = db.prepare(`
      SELECT
        l.mesorregiao AS slug,
        l.mesorregiao_nome AS nome,
        l.estado AS uf,
        COUNT(*) AS total_leads,
        SUM(CASE WHEN l.etapa_funil = 'ganho' THEN 1 ELSE 0 END) AS ganhos,
        SUM(CASE WHEN l.classificacao IN ('quente','ultra_quente') THEN 1 ELSE 0 END) AS quentes,
        SUM(CASE WHEN l.classificacao = 'morno' THEN 1 ELSE 0 END) AS mornos,
        SUM(CASE WHEN l.criado_em > DATETIME('now','-30 days') THEN 1 ELSE 0 END) AS novos_30d,
        SUM(CASE WHEN l.etapa_funil = 'perdido' AND l.atualizado_em > DATETIME('now','-30 days') THEN 1 ELSE 0 END) AS perdidos_30d
      FROM leads l
      WHERE l.mesorregiao IS NOT NULL
      GROUP BY 1, 2, 3
      ORDER BY total_leads DESC
    `).all();

    // Conversao por ERP
    const porErp = db.prepare(`
      SELECT erp, COUNT(*) AS total,
             SUM(CASE WHEN etapa_funil = 'ganho' THEN 1 ELSE 0 END) AS ganhos
      FROM leads
      WHERE erp IS NOT NULL AND erp != ''
      GROUP BY erp ORDER BY total DESC
    `).all();

    // Conversao por porte
    const porPorte = db.prepare(`
      SELECT porte, COUNT(*) AS total,
             SUM(CASE WHEN etapa_funil = 'ganho' THEN 1 ELSE 0 END) AS ganhos
      FROM leads
      GROUP BY porte
    `).all();

    // Funil atual
    const funil = db.prepare(`
      SELECT etapa_funil AS etapa, COUNT(*) AS c
      FROM leads GROUP BY etapa_funil
    `).all();

    // Custo Claude 30 dias + receita prevista (contratos ganhos)
    const custo30d = (() => {
      try {
        return db.prepare(
          "SELECT COALESCE(SUM(custo_usd),0) AS total FROM claude_usage WHERE criado_em > DATETIME('now','-30 days')"
        ).get().total;
      } catch { return 0; }
    })();

    const receitaMensal = db.prepare(
      "SELECT COALESCE(SUM(valor_estimado),0) AS total FROM leads WHERE etapa_funil = 'ganho'"
    ).get().total;

    // Config atual
    const cfg = db.prepare('SELECT * FROM prospector_config WHERE id = 1').get();
    let mesorregioesAtivas = [];
    try {
      mesorregioesAtivas = JSON.parse(cfg?.mesorregioes || '[]');
    } catch { /* ignore */ }

    // Classifica cobertura em categorias (Sofia usa pra decidir)
    const mesorregioesUteis = cobertura
      .filter(c => c.total_leads >= 5)
      .map(c => {
        let status;
        if (c.ganhos > 0) status = 'convertendo';
        else if (c.quentes >= 2) status = 'quente_sem_fechar';
        else if (c.mornos >= 3) status = 'morno';
        else if (c.total_leads >= 30 && c.quentes === 0) status = 'improdutiva';
        else status = 'em_desenvolvimento';
        return { ...c, status };
      });

    return {
      timestamp: new Date().toISOString(),
      periodo: 'ultimos 30 dias',
      funil,
      cobertura_mesorregioes: mesorregioesUteis.slice(0, 20),
      mesorregioes_ativas_no_prospector: mesorregioesAtivas,
      conversao_por_erp: porErp,
      conversao_por_porte: porPorte,
      custo_claude_30d_usd: Number(custo30d).toFixed(2),
      receita_mensal_contratada_brl: Number(receitaMensal).toFixed(2),
      min_rating_atual: cfg?.min_rating || 3.5,
      min_reviews_atual: cfg?.min_reviews || 3
    };
  } catch (err) {
    logger.warn({ err: err.message }, '[SOFIA_WORKER] buildStrategicSnapshot erro');
    return null;
  }
}

const SOFIA_PROMPT = `Voce e a Sofia, marketing. Acabou de acordar pro seu tick SEMANAL de
estrategia (domingo 20h BR). Analise o snapshot e AJUSTE a estrategia regional.

DIRETRIZ CENTRAL: migracao serial de inadimplencia e LOCAL — conquiste mesorregiao
por mesorregiao. Veja skill sofia-regional-playbook.

CRITERIOS DE DECISAO:

1. Mesorregioes com status 'convertendo' (1+ ganho):
   → mantem no prospector, aumenta esforco. Considere delegar pro Marcos
     criar campanha Meta Ads la (se ainda nao tem — verifique).

2. Mesorregioes 'improdutivas' (>30 leads, 0 quentes):
   → remover do prospector via sofia_adjust_icp. Desperdicio de Apify budget.

3. Mesorregioes 'quente_sem_fechar' (2+ quentes mas 0 ganhos):
   → delegue pro Leo criar copy especifica pra essa regiao OU pro Lucas
     revisar a abordagem (handoff_to_agent({to: 'lucas'})).

4. Regioes com leads organicos (via whatsapp inbound) mas NAO estao no
   prospector_config: candidatas fortes pra adicionar via sofia_adjust_icp.

5. Se conversao_por_porte mostra que "grande" converte 50%+ e "micro" 5%,
   sugira min_reviews maior (30-50) pra filtrar melhor.

6. Custo Claude 30d / Receita mensal: se custo > 20% receita = alerta
   pra notify_operator.

APOS ANALISAR, faca MAX 3 acoes (evita swing). Se nada a mudar, responda
"semana estavel, mantendo estrategia" e use notify_operator(info) com
relatorio 3P.

SNAPSHOT:`;

async function tick() {
  if (stopRequested) return;
  try {
    if (autoHealer.isKilled('sofia')) {
      lastResult = { skipped: true, reason: 'kill_switch' };
      return;
    }
    if (!useToolCallingAgents()) {
      lastResult = { skipped: true, reason: 'tool_calling_off' };
      return;
    }
    if (!isWeeklyTickTimeBR()) {
      // Tick timer dispara a cada 7 dias exatos apos o primeiro, entao
      // normalmente chega no domingo 20h. Este check e guardrail extra.
      lastResult = { skipped: true, reason: 'off_hours' };
      return;
    }

    const snapshot = buildStrategicSnapshot();
    if (!snapshot) {
      lastResult = { skipped: true, reason: 'no_snapshot' };
      return;
    }

    const input = `${SOFIA_PROMPT}\n\n${JSON.stringify(snapshot, null, 2)}`;

    const result = await platformAgent.invokeAgent('sofia', input, {
      correlationId: `sofia_weekly_${Date.now()}`,
      taskType: 'strategy',
      maxIterations: 6
    });

    lastTick = new Date().toISOString();
    lastResult = {
      at: lastTick,
      tool_calls: result.tool_calls || [],
      iterations: result.iterations,
      resposta: result.resposta?.slice(0, 800)
    };

    logger.info(
      { tool_calls: result.tool_calls?.length || 0 },
      '[SOFIA_WORKER] tick semanal concluido'
    );
  } catch (err) {
    logger.error({ err: err.message }, '[SOFIA_WORKER] tick falhou');
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
  logger.info('[SOFIA_WORKER] iniciado (1 tick/semana, ~domingo 20h BR)');
  tickTimer = setTimeout(tick, FIRST_TICK_DELAY_MS);
  if (tickTimer.unref) tickTimer.unref();
}

async function stop() {
  stopRequested = true;
  if (tickTimer) clearTimeout(tickTimer);
  tickTimer = null;
  logger.info('[SOFIA_WORKER] parado');
}

function status() {
  return {
    running: !!tickTimer,
    last_tick: lastTick,
    last_result: lastResult,
    snapshot_preview: buildStrategicSnapshot()
  };
}

module.exports = { start, stop, status, buildStrategicSnapshot, tick };
