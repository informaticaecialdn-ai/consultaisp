// Outbound Worker (Milestone 2 / D1).
// Carlos SDR autonomo: a cada 2h em horario comercial BR pega ate N leads
// novos (origem=prospector_auto) e dispara cold outbound via WhatsApp.
//
// Guardrails:
//  - horario comercial: 9h-17h (UTC-3), seg-sex
//  - rate limit: OUTBOUND_MAX_COLD_PER_DAY (default 30) por agente
//  - consent: canSendTo() obrigatorio (opt-out LGPD)
//  - dedup: so envia se nao houve outbound anterior nas ultimas 48h
//  - jitter 20-60s entre mensagens pra nao parecer bot/nao saturar Z-API
//  - pausa automatica se Z-API retornar erros consecutivos

const { getDb } = require('../models/database');
const logger = require('../utils/logger');
const consent = require('../services/consent');
const zapi = require('../services/zapi');
const platformAgent = require('../services/platform-agent-client');
const claude = require('../services/claude');
const autoHealer = require('../services/auto-healer');

// Conta quantos provedores da mesma mesorregiao ja foram contatados/qualificados.
// Usa pra pitch "rede regional" nos prompts cold.
function getRegionalDensity(mesorregiao) {
  if (!mesorregiao) return null;
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN classificacao IN ('morno','quente','ultra_quente') THEN 1 ELSE 0 END) AS engajados,
        SUM(CASE WHEN etapa_funil = 'ganho' THEN 1 ELSE 0 END) AS fechados
      FROM leads
      WHERE mesorregiao = ?
    `).get(mesorregiao);
    return {
      total: row?.total || 0,
      engajados: row?.engajados || 0,
      fechados: row?.fechados || 0
    };
  } catch {
    return null;
  }
}

const TICK_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2h
const BATCH_SIZE = 5;
const JITTER_MIN_MS = 20 * 1000;
const JITTER_MAX_MS = 60 * 1000;

let tickTimer = null;
let stopRequested = false;
let lastTick = null;
let lastBatchStats = null;
let consecutiveErrors = 0;
const ERROR_PAUSE_THRESHOLD = 5;

function isBusinessHourBR() {
  const now = new Date();
  const brHour = (now.getUTCHours() - 3 + 24) % 24;
  const brDow = now.getUTCDay(); // 0=dom, 6=sab
  if (brDow === 0 || brDow === 6) return false;
  return brHour >= 9 && brHour < 17;
}

function coldBudgetRemaining(agente = 'carlos') {
  const db = getDb();
  const maxPorDia = Number(process.env.OUTBOUND_MAX_COLD_PER_DAY) || 30;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM conversas
       WHERE agente = ? AND direcao = 'enviada'
       AND DATE(criado_em) = DATE('now')
       AND (metadata LIKE '%cold_outbound%' OR metadata IS NULL)`
    )
    .get(agente);
  const usado = Number(row?.c) || 0;
  return Math.max(0, maxPorDia - usado);
}

// Seleciona ate N leads novos, origem prospector_auto, que nao receberam cold recentemente.
function pickCandidates(limit = BATCH_SIZE) {
  const db = getDb();
  return db
    .prepare(
      `SELECT l.* FROM leads l
       WHERE l.origem = 'prospector_auto'
         AND l.agente_atual = 'carlos'
         AND l.etapa_funil IN ('novo','prospeccao')
         AND NOT EXISTS (
           SELECT 1 FROM conversas c
           WHERE c.lead_id = l.id
             AND c.direcao = 'enviada'
             AND c.criado_em > DATETIME('now','-48 hours')
         )
         AND NOT EXISTS (
           SELECT 1 FROM lead_opt_out o
           WHERE o.telefone = l.telefone AND o.status = 'optout'
         )
       ORDER BY l.score_total DESC, l.id ASC
       LIMIT ?`
    )
    .all(Number(limit) || BATCH_SIZE);
}

function buildColdPrompt(lead) {
  // Monta resumo do enrichment pra dar contexto rico ao Carlos
  const enriched = [];
  if (lead.razao_social) enriched.push(`Razao social: ${lead.razao_social}`);
  if (lead.cnpj) enriched.push(`CNPJ: ${lead.cnpj}`);
  if (lead.situacao_receita) enriched.push(`Situacao: ${lead.situacao_receita}`);

  try {
    if (lead.dados_receita) {
      const dr = typeof lead.dados_receita === 'string' ? JSON.parse(lead.dados_receita) : lead.dados_receita;
      if (dr.abertura) enriched.push(`Fundada em: ${dr.abertura}`);
      if (Array.isArray(dr.qsa) && dr.qsa.length) {
        const primeiro = dr.qsa[0];
        enriched.push(`Decisor provavel: ${primeiro.nome} (${primeiro.qual})`);
      }
    }
  } catch { /* ignore */ }

  try {
    if (lead.emails_extras) {
      const ems = JSON.parse(lead.emails_extras);
      if (Array.isArray(ems) && ems.length) enriched.push(`Emails oficiais: ${ems.slice(0, 2).join(', ')}`);
    }
  } catch { /* ignore */ }

  const enrichedBlock = enriched.length
    ? `\n\nDADOS ENRIQUECIDOS (use pra personalizar a abordagem):\n${enriched.map(e => '- ' + e).join('\n')}\n`
    : '\n\n(Lead ainda nao enriquecido — abordagem mais generica.)\n';

  // NETWORK EFFECT REGIONAL — core do pitch do produto
  const density = getRegionalDensity(lead.mesorregiao);
  const regionalBlock = (density && density.total >= 2)
    ? `\nREDE REGIONAL JA ATIVA:
Na mesorregiao "${lead.mesorregiao_nome || lead.mesorregiao}" ja temos ${density.total} provedores
mapeados, ${density.engajados} engajados e ${density.fechados} fechando. QUANTO MAIS
provedores da mesma regiao participarem, MAIOR o valor da base (cliente calote
em um provedor sera detectado pelos outros). Use isso no pitch:
- "Ja temos X provedores aqui na regiao ${lead.mesorregiao_nome || 'sua'}"
- "Voce seria o Y-esimo a entrar — e quem entra primeiro tem vantagem"
- "O efeito de rede e local: so funciona se a regiao estiver coberta"
`
    : `\nREDE REGIONAL:
Voce e um dos primeiros provedores da regiao ${lead.mesorregiao_nome || lead.cidade || 'local'}
que estamos abordando. Pitch diferente: "estamos entrando na regiao de ${lead.mesorregiao_nome || 'sua cidade'}
e quem topar primeiro ajuda a definir a base (+ ganha condicao especial de pioneiro)".
`;

  return `COLD OUTBOUND para lead novo (ele NUNCA conversou com a gente ainda).
Lead: ${lead.nome || lead.provedor || 'ISP'} — ${lead.cidade || '?'}/${lead.estado || '?'}
Mesorregiao: ${lead.mesorregiao_nome || 'n/a'}
Site: ${lead.site || 'n/a'}
${enrichedBlock}${regionalBlock}

Contexto: voce descobriu esse provedor via Google Maps e ja pegou dados da Receita
Federal + emails/redes do site. O PRODUTO e uma base colaborativa REGIONAL — so
funciona se varios ISPs da mesma regiao participarem (por isso a mensagem regional
acima e CENTRAL ao pitch).

Seu objetivo: abrir conversa de forma natural e curta pra descobrir se tem interesse.
- Max 3 frases, tom conversacional, SEM markdown, SEM pitch agressivo
- Se tiver decisor identificado, chame ele pelo primeiro nome
- SEMPRE mencione o aspecto REGIONAL (rede local, densidade, network effect)
- Termine com 1 pergunta aberta simples
- Se a janela 24h estiver fechada (lead nunca enviou inbound), use send_whatsapp com is_template=true
- NUNCA revele que e IA

Se detectar que o lead nao tem interesse ou que e fora do ICP, chame mark_unqualified.
Se conseguir qualquer informacao util, chame enrich_lead.`;
}

function useToolCallingAgents() {
  return String(process.env.USE_TOOL_CALLING_AGENTS || 'false').toLowerCase() === 'true';
}

function jitterDelay() {
  return JITTER_MIN_MS + Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS));
}

async function processLead(lead) {
  const db = getDb();

  // Consent gate (LGPD)
  const consentCheck = consent.canSendTo(lead.telefone);
  if (!consentCheck.allowed) {
    logger.info(
      { lead_id: lead.id, reason: consentCheck.reason },
      '[OUTBOUND] lead skipped: opt-out'
    );
    return { status: 'skipped_optout' };
  }

  try {
    const prompt = buildColdPrompt(lead);
    let resposta = '';

    if (useToolCallingAgents()) {
      // Path 1 (futuro): agente chama send_whatsapp tool direto
      const result = await platformAgent.invokeAgent('carlos', prompt, {
        leadData: lead,
        correlationId: `outbound_${lead.id}_${Date.now()}`,
        taskType: 'cold_outbound'
      });
      const enviou = (result.tool_calls || []).some(
        (t) => t.name === 'send_whatsapp' && t.status === 'ok'
      );
      resposta = result.resposta || '';
      if (enviou) {
        // Marca metadata pra coldBudgetRemaining contar corretamente
        db.prepare(
          `UPDATE conversas SET metadata = json_set(COALESCE(metadata,'{}'), '$.cold_outbound', 1)
           WHERE lead_id = ? AND direcao = 'enviada'
           ORDER BY id DESC LIMIT 1`
        ).run(lead.id);
        consecutiveErrors = 0;
        return { status: 'sent_via_tool', lead_id: lead.id };
      }
      // Se agente NAO chamou send_whatsapp, nao insiste
      if (!resposta) return { status: 'no_response', lead_id: lead.id };
    } else {
      // Path 2 (legado): gera texto com sendToAgent + envia via zapi direto
      const out = await claude.sendToAgent('carlos', prompt, { leadData: lead });
      resposta = out.resposta;
    }

    if (resposta && resposta.trim()) {
      await zapi.sendText(lead.telefone, resposta);
      db.prepare(
        `INSERT INTO conversas (lead_id, agente, direcao, mensagem, tipo, canal, metadata)
         VALUES (?, 'carlos', 'enviada', ?, 'texto', 'whatsapp', ?)`
      ).run(lead.id, resposta, JSON.stringify({ cold_outbound: true, via: 'outbound_worker' }));
      consecutiveErrors = 0;
      return { status: 'sent', lead_id: lead.id };
    }
    return { status: 'empty_response', lead_id: lead.id };
  } catch (err) {
    consecutiveErrors++;
    logger.error(
      { lead_id: lead.id, err: err.message, consecutiveErrors },
      '[OUTBOUND] erro ao processar lead'
    );
    return { status: 'error', lead_id: lead.id, error: err.message };
  }
}

async function runBatch() {
  if (autoHealer.isKilled('outbound')) {
    const reason = autoHealer.snapshot().kill_switches['outbound']?.reason;
    logger.warn({ reason }, '[OUTBOUND] kill-switch ativo, skip');
    return { skipped: true, reason: 'kill_switch', detail: reason };
  }
  if (!isBusinessHourBR()) {
    logger.debug('[OUTBOUND] fora do horario comercial BR, skip');
    return { skipped: true, reason: 'off_hours' };
  }
  if (consecutiveErrors >= ERROR_PAUSE_THRESHOLD) {
    logger.warn(
      { consecutiveErrors },
      '[OUTBOUND] pausado por erros consecutivos — reabilite com reset manual'
    );
    return { skipped: true, reason: 'circuit_open' };
  }

  const budget = coldBudgetRemaining('carlos');
  if (budget === 0) {
    logger.info('[OUTBOUND] budget diario esgotado');
    return { skipped: true, reason: 'daily_budget' };
  }

  const take = Math.min(BATCH_SIZE, budget);
  const candidates = pickCandidates(take);
  if (candidates.length === 0) {
    logger.debug('[OUTBOUND] sem candidatos novos');
    return { processed: 0, sent: 0 };
  }

  logger.info({ candidatos: candidates.length }, '[OUTBOUND] iniciando batch');

  const results = [];
  let sent = 0;

  for (const lead of candidates) {
    const r = await processLead(lead);
    results.push(r);
    if (r.status === 'sent' || r.status === 'sent_via_tool') sent++;

    // Jitter antes do proximo (exceto no ultimo)
    if (lead !== candidates[candidates.length - 1]) {
      await new Promise((resolve) => setTimeout(resolve, jitterDelay()));
    }

    if (consecutiveErrors >= ERROR_PAUSE_THRESHOLD) {
      logger.warn({ consecutiveErrors }, '[OUTBOUND] circuit-break no meio do batch');
      break;
    }
  }

  lastBatchStats = { at: new Date().toISOString(), processed: results.length, sent, results };
  return lastBatchStats;
}

async function tick() {
  if (stopRequested) return;
  try {
    await runBatch();
  } catch (err) {
    logger.error({ err: err.message }, '[OUTBOUND] tick falhou');
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
  consecutiveErrors = 0;
  logger.info('[OUTBOUND] worker iniciado (tick a cada 2h em horario comercial BR)');
  // Primeiro tick em 2min (tempo pra boot estabilizar), depois 2h em 2h
  tickTimer = setTimeout(tick, 2 * 60 * 1000);
  if (tickTimer.unref) tickTimer.unref();
}

async function stop() {
  stopRequested = true;
  if (tickTimer) clearTimeout(tickTimer);
  tickTimer = null;
  logger.info('[OUTBOUND] worker parado');
}

function status() {
  return {
    running: !!tickTimer,
    last_tick: lastTick,
    last_batch: lastBatchStats,
    consecutive_errors: consecutiveErrors,
    paused: consecutiveErrors >= ERROR_PAUSE_THRESHOLD,
    business_hour: isBusinessHourBR(),
    budget_remaining: coldBudgetRemaining('carlos')
  };
}

function resetCircuit() {
  consecutiveErrors = 0;
  return { reset: true };
}

module.exports = { start, stop, status, runBatch, resetCircuit, isBusinessHourBR, coldBudgetRemaining };
