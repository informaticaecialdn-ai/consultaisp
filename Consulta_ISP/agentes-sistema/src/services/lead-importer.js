// Lead importer (Sprint 7).
// Recebe items brutos de actors Apify e insere em leads/ com:
// - Normalizacao de telefone (regex BR: 55DDDNNNNNNNN)
// - Dedup por telefone (UNIQUE constraint da tabela leads cuida)
// - Mapeamento por shape do actor (Google Maps tem fields diferentes
//   de email-extractor)
// - Score boost se reviews > 50 (ISP estabelecido)

const { getDb } = require('../models/database');
const logger = require('../utils/logger');
const regioes = require('./regioes');

// Normaliza telefone para formato 55DDDNNNNNNNN (apenas digitos).
// Retorna null se nao parecer numero brasileiro valido.
function normalizePhoneBR(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/\D/g, '');
  if (!s) return null;

  // Se ja comeca com 55 e tem 12-13 digitos, OK
  if (s.startsWith('55') && (s.length === 12 || s.length === 13)) return s;

  // Se nao comeca com 55, mas tem 10-11 digitos (DDD + numero), prefixa 55
  if (s.length === 10 || s.length === 11) return '55' + s;

  // Trim leading zeros (alguns sites: 0xx)
  s = s.replace(/^0+/, '');
  if (s.length === 10 || s.length === 11) return '55' + s;
  if (s.startsWith('55') && (s.length === 12 || s.length === 13)) return s;

  return null;
}

// Mapeia 1 item do Google Maps Scraper -> shape de lead
function mapGoogleMapsItem(item) {
  // Apify Maps actor retorna campo `phone` como string (+5535988887777 ou 35 9 8888-7777)
  // Tambem tem `phoneUnformatted` em alguns actors. Tenta varios.
  const phoneRaw = item.phone || item.phoneUnformatted || item.contactPhone || null;
  const telefone = normalizePhoneBR(phoneRaw);
  if (!telefone) return null;

  // Address parsing: city/state vem direto na maioria dos casos
  const cidade = item.city || item.address?.split(',')?.[1]?.trim() || null;
  const estado = item.state || item.address?.match(/\b([A-Z]{2})\b/)?.[1] || null;

  // Lookup mesorregiao IBGE
  const mesoHit = cidade && estado ? regioes.lookupMesorregiao(cidade, estado) : null;

  // Score boost por estabelecimento (proxy de tamanho)
  const reviews = Number(item.reviewsCount || item.reviewCount || 0);
  const rating = Number(item.totalScore || item.rating || 0);
  let scorePerfil = 10; // base
  if (reviews >= 100) scorePerfil += 15;
  else if (reviews >= 30) scorePerfil += 8;
  if (rating >= 4.0) scorePerfil += 5;

  return {
    telefone,
    nome: item.title || item.name || null,           // nome do estabelecimento
    provedor: item.title || item.name || null,       // mesmo (ISP é a empresa)
    cidade,
    estado,
    regiao: mesoHit?.nome || cidade, // mesorregiao real se tiver, senao fallback cidade
    mesorregiao: mesoHit?.slug || null,
    mesorregiao_nome: mesoHit?.nome || null,
    erp: null,
    site: item.website || null,
    email: item.email || null,
    score_perfil: scorePerfil,
    classificacao: 'frio',
    etapa_funil: 'novo',
    agente_atual: 'carla',
    origem: 'apify_google_maps',
    dados_externos: JSON.stringify({
      address: item.address,
      rating,
      reviewsCount: reviews,
      categories: item.categories || item.categoryName,
      lat: item.location?.lat || item.latitude,
      lng: item.location?.lng || item.longitude,
    }),
  };
}

// Heuristica: detecta o shape do actor olhando os primeiros items
function detectShape(items) {
  if (!items || items.length === 0) return 'unknown';
  const first = items[0];
  if (first.title && (first.address || first.location)) return 'google_maps';
  if (first.url && first.text) return 'website_crawler';
  return 'unknown';
}

function mapItem(item, shape) {
  if (shape === 'google_maps') return mapGoogleMapsItem(item);
  return null;
}

// Importa items do dataset Apify para tabela leads.
// Retorna { novos, dup, invalidos, total }.
function importItems(items, { runId = null, dryRun = false } = {}) {
  const db = getDb();
  const shape = detectShape(items);
  if (shape === 'unknown') {
    logger.warn({ count: items?.length }, '[IMPORTER] shape desconhecido, abortando');
    return { novos: 0, dup: 0, invalidos: items?.length || 0, total: items?.length || 0, shape };
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO leads
      (telefone, nome, provedor, cidade, estado, regiao, mesorregiao, mesorregiao_nome,
       erp, site, email,
       score_perfil, classificacao, etapa_funil, agente_atual, origem,
       apify_run_id, dados_externos)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let novos = 0, dup = 0, invalidos = 0;
  const tx = db.transaction(() => {
    for (const item of items) {
      const lead = mapItem(item, shape);
      if (!lead) { invalidos++; continue; }
      if (dryRun) { novos++; continue; }
      const r = stmt.run(
        lead.telefone, lead.nome, lead.provedor, lead.cidade, lead.estado,
        lead.regiao, lead.mesorregiao, lead.mesorregiao_nome,
        lead.erp, lead.site, lead.email,
        lead.score_perfil, lead.classificacao, lead.etapa_funil, lead.agente_atual,
        lead.origem, runId, lead.dados_externos
      );
      if (r.changes > 0) novos++;
      else dup++;
    }
  });
  tx();

  return { novos, dup, invalidos, total: items.length, shape };
}

module.exports = {
  importItems,
  normalizePhoneBR,
  detectShape,
  mapGoogleMapsItem,
};
