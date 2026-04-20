// ReceitaWS service (enriquecimento via CNPJ).
// Docs: https://developers.receitaws.com.br/
//
// Endpoint: GET https://receitaws.com.br/v1/cnpj/:cnpj  (CNPJ so digitos)
// Plano gratuito: ~3 req/min, sem token. Passar token (Authorization: Bearer)
// aumenta limite. Resposta JSON:
//   {
//     cnpj, nome (razao social), fantasia, abertura, situacao, data_situacao,
//     logradouro, numero, complemento, cep, bairro, municipio, uf,
//     email, telefone, atividade_principal[{code,text}], atividades_secundarias,
//     porte, natureza_juridica, capital_social, qsa[{nome, qual}],
//     status: "OK" | "ERROR", message, ultima_atualizacao
//   }
//
// Cache in-memory 24h por CNPJ pra evitar estouro rate limit.
// Rate limiter: minimo 20s entre calls (3/min) se sem token.

const logger = require('../utils/logger');

const BASE_URL = 'https://receitaws.com.br/v1/cnpj';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NO_TOKEN_MIN_INTERVAL_MS = 20 * 1000;

const cache = new Map(); // cnpj -> { data, at }
let lastCallAt = 0;

function normalizeCnpj(raw) {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, '');
  if (d.length !== 14) return null;
  return d;
}

function isValidCnpj(raw) {
  const cnpj = normalizeCnpj(raw);
  if (!cnpj) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false; // todos iguais

  const calcDv = (base, weights) => {
    const sum = base.reduce((acc, n, i) => acc + n * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };

  const base12 = cnpj.slice(0, 12).split('').map(Number);
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const dv1 = calcDv(base12, weights1);
  const dv2 = calcDv([...base12, dv1], weights2);
  return dv1 === Number(cnpj[12]) && dv2 === Number(cnpj[13]);
}

function getCached(cnpj) {
  const hit = cache.get(cnpj);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(cnpj);
    return null;
  }
  return hit.data;
}

function setCached(cnpj, data) {
  cache.set(cnpj, { data, at: Date.now() });
  // Limita memoria: max 500 entradas
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

async function throttleIfNoToken() {
  if (process.env.RECEITAWS_TOKEN) return; // paid tier nao precisa throttle agressivo
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < NO_TOKEN_MIN_INTERVAL_MS) {
    const wait = NO_TOKEN_MIN_INTERVAL_MS - elapsed;
    logger.debug({ waitMs: wait }, '[RECEITAWS] throttle free tier');
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

async function lookup(cnpjRaw, { useCache = true, timeoutMs = 10000 } = {}) {
  const cnpj = normalizeCnpj(cnpjRaw);
  if (!cnpj) return { ok: false, error: 'cnpj_invalido', message: 'CNPJ com formato invalido (precisa 14 digitos)' };
  if (!isValidCnpj(cnpj)) return { ok: false, error: 'cnpj_dv_invalido', message: 'DV do CNPJ nao confere' };

  if (useCache) {
    const cached = getCached(cnpj);
    if (cached) return { ok: true, cached: true, data: cached };
  }

  await throttleIfNoToken();
  lastCallAt = Date.now();

  const headers = { Accept: 'application/json' };
  if (process.env.RECEITAWS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.RECEITAWS_TOKEN}`;
  }

  try {
    const res = await fetch(`${BASE_URL}/${cnpj}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined
    });

    if (res.status === 429) {
      logger.warn({ cnpj }, '[RECEITAWS] rate limit (429)');
      return { ok: false, error: 'rate_limit', message: 'ReceitaWS rate limit atingido, tente daqui 1 min' };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn({ cnpj, status: res.status, body: body.slice(0, 200) }, '[RECEITAWS] erro HTTP');
      return { ok: false, error: 'http_error', http_status: res.status };
    }

    const data = await res.json();

    if (data.status === 'ERROR') {
      return { ok: false, error: 'receita_error', message: data.message || 'CNPJ rejeitado', raw: data };
    }

    setCached(cnpj, data);
    return { ok: true, cached: false, data };
  } catch (err) {
    logger.error({ cnpj, err: err.message }, '[RECEITAWS] falha');
    return { ok: false, error: 'network_error', message: err.message };
  }
}

// Extrai campos mais uteis pro lead ISP (ignora ruido do raw).
function summarize(data) {
  if (!data) return null;
  return {
    cnpj: data.cnpj,
    razao_social: data.nome,
    fantasia: data.fantasia,
    situacao: data.situacao,
    data_situacao: data.data_situacao,
    abertura: data.abertura,
    porte: data.porte,
    natureza_juridica: data.natureza_juridica,
    capital_social: data.capital_social,
    atividade_principal: data.atividade_principal?.[0]?.text,
    atividade_codigo: data.atividade_principal?.[0]?.code,
    email: data.email,
    telefone: data.telefone,
    endereco: [
      data.logradouro,
      data.numero,
      data.complemento,
      data.bairro,
      data.municipio && data.uf ? `${data.municipio}/${data.uf}` : data.municipio,
      data.cep
    ]
      .filter(Boolean)
      .join(', '),
    municipio: data.municipio,
    uf: data.uf,
    cep: data.cep,
    socios: Array.isArray(data.qsa)
      ? data.qsa.map((s) => ({ nome: s.nome, qual: s.qual })).slice(0, 5)
      : [],
    ultima_atualizacao: data.ultima_atualizacao
  };
}

function isConfigured() {
  return true; // endpoint publico, token e opcional (aumenta limite)
}

function hasToken() {
  return !!process.env.RECEITAWS_TOKEN;
}

function cacheStats() {
  return { size: cache.size, last_call_at: new Date(lastCallAt).toISOString() };
}

module.exports = {
  lookup,
  summarize,
  normalizeCnpj,
  isValidCnpj,
  isConfigured,
  hasToken,
  cacheStats
};
