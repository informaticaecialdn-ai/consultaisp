// Template engine completo (Sprint 4 / T2).
// Sintaxe: {{var}}, {{var.nested}}, {{var|fallback}}, {{nome|Cliente}}.
// Enriquece vars automaticamente: primeiro_nome, saudacao, dia_semana.

const RE_VAR = /\{\{\s*([\w.]+)(?:\s*\|\s*([^}]+?))?\s*\}\}/g;

function getPath(obj, pathStr) {
  if (!obj) return undefined;
  return pathStr.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function firstName(full) {
  if (!full) return '';
  return String(full).trim().split(/\s+/)[0];
}

function saudacao(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function diaSemana(date = new Date()) {
  const dias = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  return dias[date.getDay()];
}

function enrichVars(vars = {}) {
  const nome = vars.nome || vars.primeiro_nome || '';
  return {
    ...vars,
    primeiro_nome: vars.primeiro_nome || firstName(nome),
    saudacao: vars.saudacao || saudacao(),
    dia_semana: vars.dia_semana || diaSemana(),
    telefone: vars.telefone || '',
    provedor: vars.provedor || '',
    cidade: vars.cidade || '',
    estado: vars.estado || '',
  };
}

function render(template, vars = {}) {
  if (template == null) return '';
  const data = enrichVars(vars);
  return String(template).replace(RE_VAR, (match, key, fallback) => {
    const value = getPath(data, key);
    if (value === undefined || value === null || value === '') {
      return fallback !== undefined ? fallback.trim() : '';
    }
    return String(value);
  });
}

function extractVariables(template) {
  if (!template) return [];
  const set = new Set();
  let m;
  const re = new RegExp(RE_VAR.source, 'g');
  while ((m = re.exec(template)) !== null) set.add(m[1]);
  return [...set];
}

// Retorna lista das variaveis que nao tem valor no contexto enriquecido.
function missingVariables(template, vars = {}) {
  const used = extractVariables(template);
  const data = enrichVars(vars);
  return used.filter(v => {
    const val = getPath(data, v);
    return val === undefined || val === null || val === '';
  });
}

// Backward compat com o antigo services/template-engine.js
const extractVars = extractVariables;

module.exports = {
  render,
  extractVariables,
  extractVars,
  missingVariables,
  enrichVars,
  firstName,
  saudacao,
  diaSemana,
};
