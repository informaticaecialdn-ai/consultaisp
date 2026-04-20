// Regioes service — lookup cidade->mesorregiao usando dados IBGE estaticos.
//
// Carrega src/data/mesorregiaos-ibge.json em memoria no boot e mantem indices:
//   - cityIndex: normalize("pouso alegre", "MG") -> { uf, slug, nome }
//   - mesorregioesByUf: "PR" -> [{ slug, nome, cidades }]
//
// Normalizacao: lower + remove acentos + trim. Cobre ~95% dos matches.

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_PATH = path.join(__dirname, '../data/mesorregiaos-ibge.json');

let estados = null;           // UF -> { nome, mesorregioes: { slug -> { nome, cidades } } }
let cityIndex = null;         // "pouso-alegre:MG" -> { uf, slug, nome, cidadeOriginal }
let mesorregioesFlat = null;  // array flat pra UI: [{ uf, uf_nome, slug, nome, cidades }]

function normalizeCityName(name) {
  if (!name) return '';
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeUf(uf) {
  if (!uf) return '';
  return String(uf).trim().toUpperCase();
}

function load() {
  if (estados) return;
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    estados = JSON.parse(raw);

    cityIndex = new Map();
    mesorregioesFlat = [];

    for (const [uf, est] of Object.entries(estados)) {
      for (const [slug, meso] of Object.entries(est.mesorregioes || {})) {
        mesorregioesFlat.push({
          uf,
          uf_nome: est.nome,
          slug,
          nome: meso.nome,
          cidades: meso.cidades,
          total_cidades: meso.cidades.length
        });
        for (const cidade of meso.cidades) {
          const key = `${normalizeCityName(cidade)}:${uf}`;
          cityIndex.set(key, { uf, slug, nome: meso.nome, cidadeOriginal: cidade });
        }
      }
    }
    logger.info(
      { ufs: Object.keys(estados).length, mesorregioes: mesorregioesFlat.length, cidades: cityIndex.size },
      '[REGIOES] base IBGE carregada'
    );
  } catch (err) {
    logger.warn({ err: err.message }, '[REGIOES] falha ao carregar base IBGE');
    estados = {};
    cityIndex = new Map();
    mesorregioesFlat = [];
  }
}

// Lookup principal — retorna mesorregiao dado (cidade, uf) ou null se nao achar.
function lookupMesorregiao(cidade, uf) {
  load();
  if (!cidade) return null;
  const key = `${normalizeCityName(cidade)}:${normalizeUf(uf)}`;
  return cityIndex.get(key) || null;
}

// Lista estados (para dropdown da UI)
function listEstados() {
  load();
  return Object.entries(estados).map(([uf, e]) => ({ uf, nome: e.nome }));
}

// Lista mesorregioes de um UF (para dropdown)
function listMesorregioes(uf) {
  load();
  const est = estados[normalizeUf(uf)];
  if (!est) return [];
  return Object.entries(est.mesorregioes).map(([slug, m]) => ({
    uf,
    slug,
    nome: m.nome,
    total_cidades: m.cidades.length,
    ibge_id: m.ibge_id
  }));
}

// Detalhe de uma mesorregiao (com lista de cidades) — usado em preview + scraping
function getMesorregiao(uf, slug) {
  load();
  const est = estados[normalizeUf(uf)];
  if (!est) return null;
  const meso = est.mesorregioes[slug];
  if (!meso) return null;
  return { uf, slug, nome: meso.nome, cidades: meso.cidades, total_cidades: meso.cidades.length };
}

// Retorna todas as cidades de uma lista de mesorregioes (usado pelo prospector worker).
// Input: [{ uf, slug }]. Output: [{ cidade, uf, mesorregiao_slug, mesorregiao_nome }]
function expandCidades(mesorregioes) {
  load();
  const out = [];
  for (const m of mesorregioes || []) {
    const detail = getMesorregiao(m.uf, m.slug);
    if (!detail) continue;
    for (const cidade of detail.cidades) {
      out.push({
        cidade,
        uf: detail.uf,
        mesorregiao_slug: detail.slug,
        mesorregiao_nome: detail.nome
      });
    }
  }
  return out;
}

// Versao flat pra UI: [{ uf, uf_nome, slug, nome, cidades, total_cidades }]
function listAllMesorregioes() {
  load();
  return mesorregioesFlat;
}

function stats() {
  load();
  return {
    ufs: Object.keys(estados || {}).length,
    mesorregioes: (mesorregioesFlat || []).length,
    cidades: cityIndex ? cityIndex.size : 0,
    data_path: DATA_PATH
  };
}

module.exports = {
  lookupMesorregiao,
  listEstados,
  listMesorregioes,
  getMesorregiao,
  expandCidades,
  listAllMesorregioes,
  stats,
  normalizeCityName,
  normalizeUf
};
