// Supervisor Worker (Milestone 3 / F1).
// Iani rodando em cron 1h em 1h: analisa snapshot do funil e toma acoes via tools.
//
// Difere do service src/services/supervisor.js (que e on-demand, orquestrador de plans
// multiagente). Este worker e a "camera" constante — roda sempre, curto e focado.
//
// Acoes que Iani pode tomar:
//  - reassign_stuck_leads (leads parados >7d)
//  - pause_campaign (se campanha com taxa falha >30%)
//  - notify_operator (anomalia detectada)
//  - query_leads/query_lead_detail (contexto)
//
// Todas executadas via platform-agent-client (tool_use loop + agent_tool_calls).

const { getDb } = require('../models/database');
const logger = require('../utils/logger');
const platformAgent = require('../services/platform-agent-client');
const autoHealer = require('../services/auto-healer');

const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1h
const FIRST_TICK_DELAY_MS = 10 * 60 * 1000; // espera 10min no boot pra estabilizar

let tickTimer = null;
let stopRequested = false;
let lastTick = null;
let lastResult = null;

function useToolCallingAgents() {
  return String(process.env.USE_TOOL_CALLING_AGENTS || 'false').toLowerCase() === 'true';
}

// Snapshot do funil que Iani recebe como input
function buildSnapshot() {
  const db = getDb();
  try {
    const porEtapa = db
      .prepare(
        `SELECT etapa_funil, COUNT(*) AS c
         FROM leads GROUP BY etapa_funil ORDER BY c DESC`
      )
      .all();
    const porAgente = db
      .prepare(
        `SELECT agente_atual, COUNT(*) AS c
         FROM leads GROUP BY agente_atual ORDER BY c DESC`
      )
      .all();
    const parados7d = db
      .prepare(
        `SELECT l.agente_atual, COUNT(*) AS c
         FROM leads l
         WHERE l.etapa_funil NOT IN ('ganho','perdido','nurturing')
           AND NOT EXISTS (
             SELECT 1 FROM conversas c WHERE c.lead_id = l.id AND c.criado_em > DATETIME('now','-7 days')
           )
         GROUP BY l.agente_atual`
      )
      .all();
    const msgsHoje = db
      .prepare("SELECT COUNT(*) AS c FROM conversas WHERE DATE(criado_em) = DATE('now')")
      .get();
    const errosUnresolved = (() => {
      try {
        return db.prepare('SELECT COUNT(*) AS c FROM errors_log WHERE resolvido = 0').get().c;
      } catch {
        return 0;
      }
    })();
    const custoHoje = (() => {
      try {
        return db
          .prepare(
            "SELECT COALESCE(SUM(custo_usd),0) AS total FROM claude_usage WHERE DATE(criado_em) = DATE('now')"
          )
          .get().total;
      } catch {
        return 0;
      }
    })();

    // Cobertura regional — top 5 mesorregioes com mais leads (pra Iani ver foco)
    const porMesorregiao = (() => {
      try {
        return db
          .prepare(
            `SELECT mesorregiao_nome AS regiao, estado AS uf, COUNT(*) AS total,
                    SUM(CASE WHEN classificacao IN ('quente','ultra_quente') THEN 1 ELSE 0 END) AS quentes,
                    SUM(CASE WHEN etapa_funil = 'ganho' THEN 1 ELSE 0 END) AS ganhos
             FROM leads
             WHERE mesorregiao IS NOT NULL
             GROUP BY 1,2 ORDER BY total DESC LIMIT 5`
          )
          .all();
      } catch {
        return [];
      }
    })();

    // Breakdown por ERP — Iani ve onde concentrar integracao
    const porErp = (() => {
      try {
        return db
          .prepare(
            `SELECT erp, COUNT(*) AS total,
                    SUM(CASE WHEN classificacao IN ('quente','ultra_quente') THEN 1 ELSE 0 END) AS quentes,
                    SUM(CASE WHEN etapa_funil = 'ganho' THEN 1 ELSE 0 END) AS ganhos
             FROM leads
             WHERE erp IS NOT NULL AND erp != ''
             GROUP BY erp ORDER BY total DESC`
          )
          .all();
      } catch {
        return [];
      }
    })();

    // Enrichment gap — quantos leads prospector_auto ainda sem enrichment
    const enrichGap = (() => {
      try {
        return db
          .prepare(
            `SELECT COUNT(*) AS c FROM leads
             WHERE origem = 'prospector_auto'
               AND enriched_at IS NULL
               AND site IS NOT NULL AND LENGTH(site) > 5`
          )
          .get()?.c || 0;
      } catch {
        return 0;
      }
    })();

    return {
      timestamp: new Date().toISOString(),
      por_etapa: porEtapa,
      por_agente: porAgente,
      parados_7d: parados7d,
      mensagens_hoje: msgsHoje?.c || 0,
      erros_unresolved: errosUnresolved,
      custo_hoje_usd: custoHoje,
      // NOVO: dados regionais + ERP
      top_mesorregioes: porMesorregiao,
      por_erp: porErp,
      enrichment_pending: enrichGap
    };
  } catch (err) {
    logger.warn({ err: err.message }, '[SUPERVISOR_WORKER] buildSnapshot erro');
    return null;
  }
}

const IANI_PROMPT = `Voce acabou de acordar pra seu tick horario de supervisao.
Analise o snapshot abaixo e DECIDA quais tools chamar. Seja cirurgica — se nao ha
nada pra fazer, nao chame tools, so responda "tudo ok".

Criterios pra agir:
1. Se houver leads "parados_7d" > 0 em algum agente comercial (carla/lucas/rafael),
   chame reassign_stuck_leads({ dias_parado: 7, so_agentes: [...], dry_run: false }).
2. Se "erros_unresolved" > 10 OU "custo_hoje_usd" > 40, chame notify_operator
   com severity="warn" ou "critical".
3. Se ver anomalia nao coberta pelas regras acima (ex: mensagens_hoje=0 em
   horario comercial), chame notify_operator.
4. Se "enrichment_pending" > 50, sugira via notify_operator(info) que operador
   rode enrichment manual — muitos leads cold sem contexto = cold ruim.
5. Analise "top_mesorregioes": se ha concentracao saudavel (>5 leads, quentes>0)
   em uma regiao, pode usar handoff_to_agent pra reforcar time comercial alocado
   nela. Se dispersao grande (5 regioes diferentes com <3 leads cada), e sinal
   de que a estrategia regional NAO esta sendo seguida — alerta via notify.
6. "por_erp" mostra onde concentrar esforco: se 70%+ dos leads usam 1 ERP (ex: IXC),
   Marcos pode criar campanha segmentada por esse ERP (integracao nativa como pitch).
7. Sem acao necessaria -> so escreva "tudo ok" e pare.

Nao repita acoes: se ja realocou leads parados nesse tick, nao chame de novo.
Use a tool query_leads (com filtros mesorregiao/erp) pra investigar antes de agir.

SNAPSHOT:`;

async function tick() {
  if (stopRequested) return;
  try {
    if (autoHealer.isKilled('supervisor')) {
      const reason = autoHealer.snapshot().kill_switches['supervisor']?.reason;
      logger.warn({ reason }, '[SUPERVISOR_WORKER] kill-switch ativo, skip');
      lastTick = new Date().toISOString();
      lastResult = { skipped: true, reason: 'kill_switch', detail: reason };
      return;
    }
    if (!useToolCallingAgents()) {
      logger.debug('[SUPERVISOR_WORKER] USE_TOOL_CALLING_AGENTS=false, skip tick');
      lastTick = new Date().toISOString();
      lastResult = { skipped: true, reason: 'tool_calling_off' };
      return;
    }

    const snapshot = buildSnapshot();
    if (!snapshot) {
      lastTick = new Date().toISOString();
      lastResult = { skipped: true, reason: 'no_snapshot' };
      return;
    }

    const input = `${IANI_PROMPT}\n\n${JSON.stringify(snapshot, null, 2)}`;

    const result = await platformAgent.invokeAgent('iani', input, {
      correlationId: `supervisor_tick_${Date.now()}`,
      taskType: 'orchestration',
      maxIterations: 4
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
      '[SUPERVISOR_WORKER] tick concluido'
    );
  } catch (err) {
    logger.error({ err: err.message }, '[SUPERVISOR_WORKER] tick falhou');
    lastTick = new Date().toISOString();
    lastResult = { error: err.message };
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
  logger.info('[SUPERVISOR_WORKER] iniciado (primeiro tick em 10min, depois 1h em 1h)');
  tickTimer = setTimeout(tick, FIRST_TICK_DELAY_MS);
  if (tickTimer.unref) tickTimer.unref();
}

async function stop() {
  stopRequested = true;
  if (tickTimer) clearTimeout(tickTimer);
  tickTimer = null;
  logger.info('[SUPERVISOR_WORKER] parado');
}

function status() {
  return {
    running: !!tickTimer,
    last_tick: lastTick,
    last_result: lastResult,
    snapshot: buildSnapshot()
  };
}

module.exports = { start, stop, status, buildSnapshot, tick };
