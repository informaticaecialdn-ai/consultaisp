// Sprint 5 / T5 — helper idempotente para editar chaves em arquivos .env.
// Uso:
//   const { setEnvVar, getEnvVar } = require('./env-file');
//   setEnvVar('/app/.env', 'BROADCAST_WORKER_ENABLED', 'false');
//
// Comportamento:
//   - Cria o arquivo se nao existir.
//   - Se a chave ja existe, substitui a linha inteira (preserva ordem e demais linhas).
//   - Se nao existe, faz append ao final garantindo newline.
//   - Escreve em UTF-8, sem BOM.
const fs = require('fs');
const path = require('path');

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function quoteIfNeeded(value) {
  const v = String(value);
  if (v === '' || /\s|#|=/.test(v)) {
    return `"${v.replace(/"/g, '\\"')}"`;
  }
  return v;
}

function setEnvVar(filePath, key, value) {
  if (!filePath || !key) throw new Error('setEnvVar requer filePath e key');
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const line = `${key}=${quoteIfNeeded(value)}`;
  const re = new RegExp(`^${escapeRegex(key)}\\s*=.*$`, 'm');

  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf-8');
  }

  if (re.test(content)) {
    content = content.replace(re, line);
  } else {
    if (content.length > 0 && !content.endsWith('\n')) content += '\n';
    content += line + '\n';
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  return { filePath, key, value: String(value) };
}

function getEnvVar(filePath, key) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  const re = new RegExp(`^${escapeRegex(key)}\\s*=(.*)$`, 'm');
  const m = content.match(re);
  if (!m) return null;
  let v = m[1].trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"');
  return v;
}

function unsetEnvVar(filePath, key) {
  if (!fs.existsSync(filePath)) return false;
  let content = fs.readFileSync(filePath, 'utf-8');
  const re = new RegExp(`^${escapeRegex(key)}\\s*=.*\\n?`, 'm');
  if (!re.test(content)) return false;
  content = content.replace(re, '');
  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
}

module.exports = { setEnvVar, getEnvVar, unsetEnvVar };
