// Lead Validator (Milestone 1 / C2) — pipeline de validacao antes de importar.
// Input: items brutos em leads_pending (raw_data JSON do Apify).
// Regras:
//  1. Telefone BR valido (10-13 digitos, DDD real, normalizado)
//  2. Nao duplicado (lookup em leads por telefone e em leads_pending por telefone)
//  3. Site valido (regex basica) — se existir
//  4. Rating >= config.min_rating (se tiver)
//  5. Reviews >= config.min_reviews (se tiver)
//  6. Nao esta em blacklist de palavras (clinica, igreja, etc. — falsos positivos)
//  7. Cidade/estado reconhecidos (Brasil BR)
// Output: { approved, score, flags, reasons }.

const { getDb } = require('../models/database');
const { normalizePhoneBR } = require('./lead-importer');
const logger = require('../utils/logger');
const regioes = require('./regioes');

// Keywords que indicam FORA DO ICP (substring match case-insensitive).
// Usadas como filtro grosso. Patterns mais especificos (regex) estao em
// OPERADORA_PATTERNS abaixo — aqueles sao os criticos pra filtrar revendas
// de operadora nacional (Vivo/Claro/TIM/Oi), que NAO sao nosso publico.
const BLACKLIST_KEYWORDS = [
  'clinica',
  'igreja',
  'escola',
  'farmacia',
  'restaurante',
  'mercado',
  'padaria',
  'academia',
  'barbearia'
];

// Patterns REGEX (case-insensitive) que identificam revendas/autorizadas de
// grandes operadoras nacionais. ISP regional usa esses nomes as vezes no
// nome fantasia, mas a combinacao com palavras como "autorizada" ou "fibra"
// indica revenda — nao sao ISPs proprios.
const OPERADORA_PATTERNS = [
  // Vivo
  /\bvivo\s+fibra\b/i,
  /\bvivo\s+autoriz/i,
  /\bvivo\s+loja\b/i,
  /\bloja\s+vivo\b/i,
  /\brevenda\s+vivo\b/i,
  /\bautoriz(ada|ado)\s+vivo\b/i,
  // TIM
  /\btim\s+live\b/i,
  /\btim\s+fibra\b/i,
  /\btim\s+loja\b/i,
  /\bloja\s+tim\b/i,
  /\brevenda\s+tim\b/i,
  /\bautoriz(ada|ado)\s+tim\b/i,
  // Claro/Net (cuidado — "claro" sozinho e ambiguo)
  /\bclaro\s+net\b/i,
  /\bclaro\s+fibra\b/i,
  /\bclaro\s+residencial\b/i,
  /\bnet\s+claro\b/i,
  /\bloja\s+claro\b/i,
  /\brevenda\s+claro\b/i,
  /\bautoriz(ada|ado)\s+claro\b/i,
  // Oi
  /\boi\s+fibra\b/i,
  /\boi\s+fibrax\b/i,
  /\bloja\s+oi\b/i,
  /\brevenda\s+oi\b/i,
  /\bautoriz(ada|ado)\s+oi\b/i,
  // Algar (operadora regional grande)
  /\balgar\s+telecom\b/i,
  // Genericos
  /\brevendedor(a)?\b/i,
  /\brevenda\s+autoriz/i,
  /\bponto\s+de\s+venda\b/i,
  /\bloja\s+autoriz/i,
  // Multimarcas (revendem varias operadoras — nao tem base propria)
  /\bmultimarca(s)?\b/i
];

function isRevendaOperadora(nome) {
  if (!nome) return { hit: false };
  const s = String(nome);
  for (const pat of OPERADORA_PATTERNS) {
    if (pat.test(s)) return { hit: true, pattern: pat.source };
  }
  return { hit: false };
}

// DDDs brasileiros validos (lista oficial ANATEL)
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99
]);

const SITE_REGEX = /^https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function getConfig() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM prospector_config WHERE id = 1').get();
    if (!row) {
      return { min_rating: 3.5, min_reviews: 3, max_leads_por_run: 50 };
    }
    return {
      min_rating: Number(row.min_rating) || 3.5,
      min_reviews: Number(row.min_reviews) || 3,
      max_leads_por_run: Number(row.max_leads_por_run) || 50,
      enabled: !!row.enabled
    };
  } catch {
    return { min_rating: 3.5, min_reviews: 3, max_leads_por_run: 50 };
  }
}

function validatePhone(phoneRaw) {
  const normalized = normalizePhoneBR(phoneRaw);
  if (!normalized) return { valid: false, reason: 'telefone_invalido', phone: null };
  // Extrai DDD (apos 55)
  const ddd = parseInt(normalized.slice(2, 4), 10);
  if (!DDDS_VALIDOS.has(ddd)) return { valid: false, reason: 'ddd_invalido', phone: normalized };
  return { valid: true, phone: normalized, ddd };
}

function isDuplicateLead(phone) {
  if (!phone) return false;
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM leads WHERE telefone = ?').get(phone);
    if (existing) return { duplicate: true, where: 'leads', id: existing.id };
    const pending = db
      .prepare(
        "SELECT id FROM leads_pending WHERE telefone = ? AND status IN ('pending','approved','imported','enriching','validating')"
      )
      .get(phone);
    if (pending) return { duplicate: true, where: 'leads_pending', id: pending.id };
    return { duplicate: false };
  } catch {
    return { duplicate: false };
  }
}

function blacklistCheck(nome) {
  if (!nome) return { hit: false };
  const n = String(nome).toLowerCase();
  for (const kw of BLACKLIST_KEYWORDS) {
    if (n.includes(kw)) return { hit: true, keyword: kw };
  }
  return { hit: false };
}

// validate() recebe o raw_data bruto (objeto JSON) e retorna veredito.
function validate(raw) {
  const flags = [];
  const reasons = [];
  let score = 0;

  const nome = raw.title || raw.name || raw.provedor || null;
  const phoneRaw =
    raw.phone || raw.phoneUnformatted || raw.contactPhone || raw.telefone || null;
  const site = raw.website || raw.url || raw.site || null;
  const email = raw.email || null;

  // 1. Telefone
  const phoneCheck = validatePhone(phoneRaw);
  if (!phoneCheck.valid) {
    flags.push('sem_telefone_valido');
    reasons.push(`telefone invalido: ${phoneCheck.reason}`);
    return { approved: false, score: 0, flags, reasons, phone: null, nome, email, site };
  }
  score += 0.3;

  // 2. Duplicado
  const dup = isDuplicateLead(phoneCheck.phone);
  if (dup.duplicate) {
    flags.push('duplicado');
    reasons.push(`duplicado em ${dup.where} id=${dup.id}`);
    return {
      approved: false,
      score: 0,
      flags,
      reasons,
      phone: phoneCheck.phone,
      nome,
      email,
      site,
      duplicate: true
    };
  }

  // 3a. Blacklist (falsos positivos: igreja, clinica, etc.)
  const bl = blacklistCheck(nome);
  if (bl.hit) {
    flags.push('fora_icp');
    reasons.push(`blacklist: contem "${bl.keyword}"`);
    return {
      approved: false,
      score: 0.1,
      flags,
      reasons,
      phone: phoneCheck.phone,
      nome,
      email,
      site
    };
  }

  // 3b. Revenda de operadora (Vivo/TIM/Claro/Oi autorizadas) = NAO e ISP regional
  const rev = isRevendaOperadora(nome);
  if (rev.hit) {
    flags.push('revenda_operadora');
    reasons.push(`rejeitado: revenda de operadora (pattern ${rev.pattern})`);
    return {
      approved: false,
      score: 0,
      flags,
      reasons,
      phone: phoneCheck.phone,
      nome,
      email,
      site
    };
  }
  score += 0.1;

  // 4. Rating / reviews (Google Maps)
  const cfg = getConfig();
  const rating = Number(raw.totalScore || raw.rating || 0);
  const reviews = Number(raw.reviewsCount || raw.reviewCount || 0);

  if (rating > 0) {
    if (rating < cfg.min_rating) {
      flags.push('rating_baixo');
      reasons.push(`rating ${rating} < min ${cfg.min_rating}`);
      score -= 0.15;
    } else {
      score += 0.2;
      if (rating >= 4.3) {
        score += 0.1;
        reasons.push('rating_alto');
      }
    }
  }

  if (reviews > 0) {
    if (reviews < cfg.min_reviews) {
      flags.push('poucos_reviews');
      score -= 0.05;
    } else {
      score += 0.15;
      if (reviews >= 50) {
        score += 0.1;
        reasons.push('estabelecido');
      }
    }
  }

  // 5. Site valido
  if (site) {
    const siteOk = SITE_REGEX.test(String(site));
    if (siteOk) {
      score += 0.1;
      reasons.push('site_valido');
    } else {
      flags.push('site_invalido');
    }
  }

  // 6. Email disponivel
  if (email) {
    score += 0.05;
    reasons.push('email_disponivel');
  }

  // 7. Palavras ISP no nome aumentam confianca
  if (nome) {
    const n = String(nome).toLowerCase();
    if (/internet|fibra|telecom|provedor|web|net\b|speed/.test(n)) {
      score += 0.15;
      reasons.push('palavras_isp_no_nome');
    }
  }

  // Normaliza score 0-1
  score = Math.max(0, Math.min(1, score));

  // Threshold de aprovacao: score >= 0.45
  const approved = score >= 0.45 && flags.filter((f) => !['poucos_reviews', 'site_invalido'].includes(f)).length === 0;

  if (!approved) reasons.push(`score ${score.toFixed(2)} abaixo do threshold 0.45`);
  else reasons.push(`score ${score.toFixed(2)} >= 0.45 APROVADO`);

  return { approved, score, flags, reasons, phone: phoneCheck.phone, nome, email, site };
}

// Processa fila leads_pending -> atualiza status (approved/rejected).
// Retorna { processados, aprovados, rejeitados, duplicados }.
function processQueue({ limit = 100 } = {}) {
  const db = getDb();
  const pending = db
    .prepare(
      "SELECT id, raw_data FROM leads_pending WHERE status = 'pending' ORDER BY id ASC LIMIT ?"
    )
    .all(Number(limit) || 100);

  let aprovados = 0,
    rejeitados = 0,
    duplicados = 0,
    erros = 0;

  const stmtUpdate = db.prepare(`
    UPDATE leads_pending SET
      status = ?, score = ?, flags = ?, reasons = ?,
      telefone = ?, nome = ?, email = ?, site = ?,
      atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  for (const row of pending) {
    try {
      const raw = JSON.parse(row.raw_data || '{}');
      const result = validate(raw);
      let status = result.approved ? 'approved' : 'rejected';
      if (result.duplicate) {
        status = 'duplicate';
        duplicados++;
      } else if (result.approved) {
        aprovados++;
      } else {
        rejeitados++;
      }
      stmtUpdate.run(
        status,
        result.score,
        JSON.stringify(result.flags),
        JSON.stringify(result.reasons),
        result.phone,
        result.nome,
        result.email,
        result.site,
        row.id
      );
    } catch (err) {
      erros++;
      logger.error({ id: row.id, err: err.message }, '[VALIDATOR] erro ao processar item');
      db.prepare(
        "UPDATE leads_pending SET status = 'rejected', erro = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(err.message, row.id);
    }
  }

  return { processados: pending.length, aprovados, rejeitados, duplicados, erros };
}

// Importa leads com status='approved' pra tabela leads.
// Retorna { importados, duplicados }.
function importApproved({ limit = 100 } = {}) {
  const db = getDb();
  const approved = db
    .prepare(
      "SELECT id, raw_data, telefone, nome, email, site FROM leads_pending WHERE status = 'approved' ORDER BY id ASC LIMIT ?"
    )
    .all(Number(limit) || 100);

  let importados = 0,
    duplicados = 0;

  const insertLead = db.prepare(`
    INSERT OR IGNORE INTO leads
      (telefone, nome, provedor, cidade, estado, regiao, mesorregiao, mesorregiao_nome,
       erp, site, email,
       score_perfil, classificacao, etapa_funil, agente_atual, origem, dados_externos)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const markImported = db.prepare(`
    UPDATE leads_pending SET
      status = 'imported',
      imported_lead_id = ?,
      imported_at = CURRENT_TIMESTAMP,
      atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const tx = db.transaction(() => {
    for (const row of approved) {
      try {
        const raw = JSON.parse(row.raw_data || '{}');
        const cidade = raw.city || null;
        const estado = raw.state || null;
        const scorePerfil = Math.round((Number(raw.score_perfil) || 10) * 1);

        // Lookup mesorregiao IBGE
        const mesoHit = cidade && estado ? regioes.lookupMesorregiao(cidade, estado) : null;

        const r = insertLead.run(
          row.telefone,
          row.nome,
          row.nome, // provedor = nome da empresa
          cidade,
          estado,
          mesoHit?.nome || cidade, // regiao = mesorregiao nome ou fallback cidade
          mesoHit?.slug || null,
          mesoHit?.nome || null,
          null, // erp desconhecido
          row.site,
          row.email,
          scorePerfil,
          'frio',
          'novo',
          'carla',
          'prospector_auto',
          row.raw_data
        );

        if (r.changes > 0) {
          importados++;
          markImported.run(r.lastInsertRowid, row.id);
        } else {
          duplicados++;
          db.prepare(
            "UPDATE leads_pending SET status = 'duplicate', atualizado_em = CURRENT_TIMESTAMP WHERE id = ?"
          ).run(row.id);
        }
      } catch (err) {
        logger.error({ id: row.id, err: err.message }, '[VALIDATOR] erro ao importar approved');
      }
    }
  });
  tx();

  return { importados, duplicados, total: approved.length };
}

// Enfileira 1 item bruto em leads_pending.
function enqueue(raw, { source = 'apify_google_maps', source_run_id = null } = {}) {
  const db = getDb();
  const telefone =
    normalizePhoneBR(raw.phone || raw.phoneUnformatted || raw.contactPhone) || null;

  const cidade = raw.city || null;
  const estado = raw.state || null;
  // Se o scraper foi disparado com mesorregiao_hint, usa direto; senao lookup
  let mesoSlug = raw._mesorregiao_slug || null;
  let mesoNome = raw._mesorregiao_nome || null;
  if (!mesoSlug && cidade && estado) {
    const hit = regioes.lookupMesorregiao(cidade, estado);
    if (hit) { mesoSlug = hit.slug; mesoNome = hit.nome; }
  }

  const r = db
    .prepare(
      `INSERT INTO leads_pending (source, source_run_id, raw_data, nome, telefone, email, site, cidade, estado, mesorregiao, mesorregiao_nome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      source,
      source_run_id,
      JSON.stringify(raw),
      raw.title || raw.name || null,
      telefone,
      raw.email || null,
      raw.website || raw.url || null,
      cidade,
      estado,
      mesoSlug,
      mesoNome
    );
  return r.lastInsertRowid;
}

function enqueueBatch(items, meta = {}) {
  let enqueued = 0;
  for (const item of items || []) {
    try {
      enqueue(item, meta);
      enqueued++;
    } catch (err) {
      logger.warn({ err: err.message }, '[VALIDATOR] enqueue falhou');
    }
  }
  return { enqueued };
}

function stats() {
  const db = getDb();
  try {
    const byStatus = db
      .prepare('SELECT status, COUNT(*) AS c FROM leads_pending GROUP BY status')
      .all();
    const ultima = db
      .prepare('SELECT MAX(criado_em) AS ultima FROM leads_pending')
      .get();
    return { by_status: byStatus, ultima_enfileirada: ultima?.ultima };
  } catch {
    return { by_status: [], ultima_enfileirada: null };
  }
}

module.exports = {
  validate,
  processQueue,
  importApproved,
  enqueue,
  enqueueBatch,
  stats,
  validatePhone,
  isDuplicateLead,
  isRevendaOperadora,
  OPERADORA_PATTERNS
};
