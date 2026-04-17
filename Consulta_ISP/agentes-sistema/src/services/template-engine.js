// Engine handlebars-like minimalista.
// Suporta {{variavel}} e {{variavel.nested}}. Helpers serao adicionados na
// implementacao completa (Sprint 4 T2).

function getPath(obj, pathStr) {
  if (!obj) return undefined;
  return pathStr.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function firstName(full) {
  if (!full) return '';
  return String(full).trim().split(/\s+/)[0];
}

function render(template, context = {}) {
  if (template == null) return '';
  const data = {
    ...context,
    primeiro_nome: context.primeiro_nome || firstName(context.nome),
    telefone: context.telefone || '',
    provedor: context.provedor || '',
    cidade: context.cidade || '',
    estado: context.estado || ''
  };

  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const value = getPath(data, key);
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

// Extrai variaveis usadas no template. Util para UI preview.
function extractVars(template) {
  if (!template) return [];
  const re = /\{\{\s*([\w.]+)\s*\}\}/g;
  const set = new Set();
  let m;
  while ((m = re.exec(template)) !== null) set.add(m[1]);
  return [...set];
}

module.exports = { render, extractVars, firstName };
