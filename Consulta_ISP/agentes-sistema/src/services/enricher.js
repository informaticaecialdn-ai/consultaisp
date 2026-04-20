// Enricher service — enriquecimento de leads via Apify contact-info-scraper + ReceitaWS.
//
// Fluxo:
//  1. Pega leads com site preenchido e ainda nao enriquecidos
//  2. Dispara 1 run Apify 'apify/contact-info-scraper' com TODOS os sites em batch
//     (1 run com N startUrls e muito mais barato/rapido que N runs individuais)
//  3. Pra cada item retornado: extrai emails, telefones, redes sociais, e regex CNPJ
//  4. Se achou CNPJ valido, chama ReceitaWS pra completar (razao social, socios, etc.)
//  5. UPDATE leads com dados enriquecidos + enriched_at = NOW
//
// Custo: ~$3 por 1000 leads (Apify) + ReceitaWS (free throttle 20s sem token).

const { getDb } = require('../models/database');
const logger = require('../utils/logger');
const apify = require('./apify');
const receitaws = require('./receitaws');

const APIFY_ACTOR = 'apify/contact-info-scraper';
const DEFAULT_BATCH_SIZE = 20;
const APIFY_TIMEOUT_SEC = 240;

function normalizeUrl(raw) {
  if (!raw) return null;
  let u = String(raw).trim();
  if (!u) return null;
  // adiciona protocolo se faltar
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  // remove path extras pra aumentar chance de match
  try {
    const parsed = new URL(u);
    return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname);
  } catch {
    return null;
  }
}

function extractCnpjFromText(text) {
  if (!text) return null;
  // Tenta primeiro formato XX.XXX.XXX/XXXX-XX
  const formatted = String(text).match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g) || [];
  for (const m of formatted) {
    const c = receitaws.normalizeCnpj(m);
    if (c && receitaws.isValidCnpj(c)) return c;
  }
  // Fallback: 14 digitos puros (menos confiavel)
  const bare = String(text).match(/\b\d{14}\b/g) || [];
  for (const m of bare) {
    if (receitaws.isValidCnpj(m)) return m;
  }
  return null;
}

function extractFromItem(item) {
  const emails = Array.from(new Set([
    ...(item.emails || []),
    ...(item.emailsUncertain || [])
  ])).filter(e => e && /@/.test(e));

  const phones = Array.from(new Set([
    ...(item.phones || []),
    ...(item.phonesUncertain || [])
  ])).filter(Boolean);

  const socials = {
    linkedin: Array.from(new Set(item.linkedIns || [])),
    facebook: Array.from(new Set(item.facebooks || [])),
    instagram: Array.from(new Set(item.instagrams || [])),
    twitter: Array.from(new Set(item.twitters || [])),
    youtube: Array.from(new Set(item.youtubes || []))
  };

  // CNPJ: procura no JSON inteiro (inclui texto, emails, URLs)
  const allText = JSON.stringify(item);
  const cnpj = extractCnpjFromText(allText);

  return { cnpj, emails, phones, socials };
}

// Tenta matchar url do item Apify ao site salvo do lead.
// Apify pode retornar url final apos redirect, por isso match tolerante.
function matchItemToLead(item, leads) {
  const itemUrl = String(item.url || item.loadedUrl || '').toLowerCase();
  if (!itemUrl) return null;
  for (const lead of leads) {
    const leadUrl = normalizeUrl(lead.site);
    if (!leadUrl) continue;
    const leadHost = (() => { try { return new URL(leadUrl).hostname.toLowerCase(); } catch { return ''; } })();
    if (!leadHost) continue;
    // Match por hostname (cobre redirects, trailing slash, paths)
    if (itemUrl.includes(leadHost)) return lead;
  }
  return null;
}

async function persistEnrichment(leadId, extracted, receitaRaw, source) {
  const db = getDb();
  const lead = db.prepare('SELECT email, cnpj FROM leads WHERE id = ?').get(leadId);
  if (!lead) return false;

  const receitaSum = receitaRaw ? receitaws.summarize(receitaRaw) : null;

  db.prepare(`
    UPDATE leads SET
      cnpj = COALESCE(?, cnpj),
      razao_social = COALESCE(?, razao_social),
      situacao_receita = COALESCE(?, situacao_receita),
      dados_receita = CASE WHEN ? IS NOT NULL THEN ? ELSE dados_receita END,
      dados_receita_at = CASE WHEN ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE dados_receita_at END,
      email = COALESCE(email, ?),
      emails_extras = ?,
      telefones_extras = ?,
      redes_sociais = ?,
      enriched_at = CURRENT_TIMESTAMP,
      enrich_source = ?,
      enrich_erro = NULL,
      atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    extracted.cnpj || null,
    receitaSum?.razao_social || null,
    receitaSum?.situacao || null,
    receitaRaw ? JSON.stringify(receitaRaw) : null,
    receitaRaw ? JSON.stringify(receitaRaw) : null,
    receitaRaw ? JSON.stringify(receitaRaw) : null,
    extracted.emails[0] || null,
    JSON.stringify(extracted.emails),
    JSON.stringify(extracted.phones),
    JSON.stringify(extracted.socials),
    source || 'apify_contact_info',
    leadId
  );
  return true;
}

// Marca lead como tentado mas sem dados extraidos (evita re-tentar toda hora)
function markAttempted(leadId, erro = null) {
  const db = getDb();
  db.prepare(`
    UPDATE leads SET
      enriched_at = CURRENT_TIMESTAMP,
      enrich_source = 'apify_contact_info',
      enrich_erro = ?,
      atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(erro || 'no_data', leadId);
}

// === Enriquecimento em batch ===
// Roda 1 Apify run com ate N URLs de uma vez (muito mais barato que N runs).
async function enrichBatch({ limit = DEFAULT_BATCH_SIZE, leadIds = null, force = false } = {}) {
  const db = getDb();

  // Seleciona candidatos
  let leads;
  if (Array.isArray(leadIds) && leadIds.length > 0) {
    const placeholders = leadIds.map(() => '?').join(',');
    leads = db.prepare(
      `SELECT id, site, cnpj FROM leads WHERE id IN (${placeholders}) AND site IS NOT NULL AND LENGTH(site) > 5`
    ).all(...leadIds);
  } else {
    const where = force ? '' : 'AND enriched_at IS NULL';
    leads = db.prepare(`
      SELECT id, site, cnpj FROM leads
      WHERE origem = 'prospector_auto'
        ${where}
        AND site IS NOT NULL
        AND LENGTH(site) > 5
      ORDER BY id DESC LIMIT ?
    `).all(Number(limit) || DEFAULT_BATCH_SIZE);
  }

  if (!leads.length) {
    return { total: 0, enriched: 0, no_data: 0, cnpj_found: 0, receita_ok: 0, skipped: 0, reason: 'no_candidates' };
  }

  if (!apify.client.isConfigured()) {
    return { total: leads.length, enriched: 0, skipped: leads.length, reason: 'apify_not_configured' };
  }

  // Dedup URLs + montar startUrls
  const uniqueUrls = new Map(); // hostname -> url normalized
  for (const lead of leads) {
    const u = normalizeUrl(lead.site);
    if (!u) continue;
    try {
      const host = new URL(u).hostname.toLowerCase();
      if (!uniqueUrls.has(host)) uniqueUrls.set(host, u);
    } catch { /* ignore */ }
  }
  const startUrls = Array.from(uniqueUrls.values()).map(url => ({ url }));

  if (!startUrls.length) {
    return { total: leads.length, enriched: 0, skipped: leads.length, reason: 'no_valid_urls' };
  }

  logger.info(
    { batch_size: leads.length, unique_urls: startUrls.length },
    '[ENRICHER] iniciando batch Apify'
  );

  // 1 Apify run com todos os sites
  let items = [];
  try {
    items = await apify.client.runSyncGetItems(
      APIFY_ACTOR,
      {
        startUrls,
        maxDepth: 1,
        maxConcurrency: 10,
        proxyConfiguration: { useApifyProxy: true }
      },
      { timeoutSec: APIFY_TIMEOUT_SEC }
    );
  } catch (err) {
    logger.error({ err: err.message }, '[ENRICHER] Apify falhou');
    // Marca todos como tentados com erro pra nao tentar de novo em loop
    for (const lead of leads) markAttempted(lead.id, `apify:${err.message.slice(0, 100)}`);
    return { total: leads.length, enriched: 0, error: err.message };
  }

  logger.info({ items_returned: items.length }, '[ENRICHER] Apify retornou items');

  let enriched = 0,
    noData = 0,
    cnpjFound = 0,
    receitaOk = 0;

  const processedLeadIds = new Set();

  // Processa cada item recebido
  for (const item of items) {
    const lead = matchItemToLead(item, leads);
    if (!lead || processedLeadIds.has(lead.id)) continue;
    processedLeadIds.add(lead.id);

    const extracted = extractFromItem(item);

    // Se tem CNPJ, enriquece tambem via Receita
    let receitaRaw = null;
    const cnpjToUse = extracted.cnpj || lead.cnpj;
    if (cnpjToUse) {
      cnpjFound++;
      try {
        const r = await receitaws.lookup(cnpjToUse, { useCache: true });
        if (r.ok) {
          receitaRaw = r.data;
          receitaOk++;
        }
      } catch (err) {
        logger.warn({ lead_id: lead.id, err: err.message }, '[ENRICHER] ReceitaWS falhou (nao-bloqueante)');
      }
    }

    const hasAnyData =
      extracted.cnpj ||
      extracted.emails.length > 0 ||
      extracted.phones.length > 0 ||
      Object.values(extracted.socials).some(arr => arr.length > 0);

    if (hasAnyData || receitaRaw) {
      await persistEnrichment(lead.id, extracted, receitaRaw, 'apify_contact_info');
      enriched++;
    } else {
      markAttempted(lead.id, 'empty_result');
      noData++;
    }
  }

  // Leads que nao tiveram item matching (site invalido ou scraper falhou pra ele)
  for (const lead of leads) {
    if (!processedLeadIds.has(lead.id)) {
      markAttempted(lead.id, 'no_match');
      noData++;
    }
  }

  const result = {
    total: leads.length,
    enriched,
    no_data: noData,
    cnpj_found: cnpjFound,
    receita_ok: receitaOk,
    unique_urls: startUrls.length,
    items_from_apify: items.length
  };

  logger.info(result, '[ENRICHER] batch concluido');
  return result;
}

// Enriquece 1 lead especifico (bypassa batch, util pra trigger manual)
async function enrichLead(leadId) {
  return enrichBatch({ leadIds: [leadId], force: true });
}

// Stats pro UI
function stats() {
  const db = getDb();
  try {
    const total = db
      .prepare(
        "SELECT COUNT(*) AS c FROM leads WHERE origem = 'prospector_auto'"
      )
      .get().c;
    const enriched = db
      .prepare(
        "SELECT COUNT(*) AS c FROM leads WHERE origem = 'prospector_auto' AND enriched_at IS NOT NULL"
      )
      .get().c;
    const pending = db
      .prepare(
        "SELECT COUNT(*) AS c FROM leads WHERE origem = 'prospector_auto' AND enriched_at IS NULL AND site IS NOT NULL AND LENGTH(site) > 5"
      )
      .get().c;
    const comCnpj = db
      .prepare(
        "SELECT COUNT(*) AS c FROM leads WHERE origem = 'prospector_auto' AND cnpj IS NOT NULL"
      )
      .get().c;
    const comEmail = db
      .prepare(
        "SELECT COUNT(*) AS c FROM leads WHERE origem = 'prospector_auto' AND emails_extras IS NOT NULL AND emails_extras != '[]'"
      )
      .get().c;

    return {
      total,
      enriched,
      pending,
      com_cnpj: comCnpj,
      com_email: comEmail,
      enriched_pct: total ? Math.round((enriched / total) * 100) : 0
    };
  } catch {
    return { _migration_pending: true, total: 0, enriched: 0, pending: 0, com_cnpj: 0, com_email: 0, enriched_pct: 0 };
  }
}

module.exports = {
  enrichBatch,
  enrichLead,
  stats,
  normalizeUrl,
  extractCnpjFromText,
  extractFromItem
};
