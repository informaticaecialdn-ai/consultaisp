// Sprint 5 / T5 — testes integration: smoke-test endpoint, kill/resume, health deep.
// Uso: cd agentes-sistema && node tests/integration/smoke-broadcast.test.js
//
// Sem framework — node:assert + fetch nativo contra um express spawned em porta random.
// Usa ENV_FILE_PATH para isolar o arquivo .env modificado pelos endpoints.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';
process.env.BROADCAST_RETRY_DELAYS_SEC = '30,120,600';
process.env.BROADCAST_FAILURE_THRESHOLD_PCT = '20';

// Isola arquivo .env em tmp — api.js respeita ENV_FILE_PATH
const tmpEnvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-broadcast-'));
const tmpEnvPath = path.join(tmpEnvDir, '.env');
fs.writeFileSync(tmpEnvPath, 'BROADCAST_WORKER_ENABLED=true\n', 'utf-8');
process.env.ENV_FILE_PATH = tmpEnvPath;

function skip(reason) {
  console.log(`\n[SKIP] ${reason}`);
  console.log('\n=== DONE (skipped) ===');
  process.exit(0);
}

// ========== 1. Unit: env-file helper ==========
let envFile;
try {
  envFile = require('../../src/utils/env-file');
} catch (err) {
  console.error('[FAIL] nao conseguiu carregar env-file helper:', err.message);
  process.exit(1);
}

(function testEnvFileHelper() {
  console.log('\n=== 1. env-file helper ===');
  const f = path.join(tmpEnvDir, '.env-helper-test');
  try { fs.unlinkSync(f); } catch {}

  envFile.setEnvVar(f, 'FOO', 'bar');
  assert.strictEqual(envFile.getEnvVar(f, 'FOO'), 'bar', 'append funcionou');

  envFile.setEnvVar(f, 'FOO', 'baz');
  assert.strictEqual(envFile.getEnvVar(f, 'FOO'), 'baz', 'replace funcionou');

  envFile.setEnvVar(f, 'ANOTHER', 'x y'); // com espaco, deve ser quoted
  const content = fs.readFileSync(f, 'utf-8');
  assert.ok(/ANOTHER="x y"/.test(content), 'valor com espaco deve ser quoted');
  assert.strictEqual(envFile.getEnvVar(f, 'ANOTHER'), 'x y', 'getEnvVar unquote');

  assert.ok(envFile.unsetEnvVar(f, 'FOO'), 'unset retorna true');
  assert.strictEqual(envFile.getEnvVar(f, 'FOO'), null, 'apos unset, valor e null');

  console.log('[OK] env-file helper (set/get/unset/quote)');
})();

// ========== 2+: HTTP tests contra express spawned ==========
let initialize, getDb, campanhasService, audienciasService, templatesService;
try {
  ({ initialize, getDb } = require('../../src/models/database'));
  campanhasService = require('../../src/services/campanhas');
  audienciasService = require('../../src/services/audiencias');
  templatesService = require('../../src/services/templates');
} catch (err) {
  if (/bindings|better-sqlite3/i.test(err.message)) {
    skip('SQLite nao disponivel neste Node (precisa Node 20 / Docker)');
  }
  throw err;
}

try {
  initialize();
} catch (err) {
  if (/bindings|better-sqlite3/i.test(err.message)) {
    skip('SQLite nao disponivel neste Node (precisa Node 20 / Docker)');
  }
  throw err;
}

// Aplica migrations Sprint 4 + 5 (caso ainda nao tenham sido)
const db = getDb();
const migDir = path.join(__dirname, '../../src/migrations');
if (fs.existsSync(migDir)) {
  const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migDir, f), 'utf-8');
    try { db.exec(sql); }
    catch (err) {
      if (!/duplicate column|already exists|has no column named/i.test(err.message)) throw err;
    }
  }
}

// Monta mini express apenas com o router da api
let server, baseUrl;
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api', require('../../src/routes/api'));

async function startServer() {
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

async function stopServer() {
  return new Promise((resolve) => server ? server.close(resolve) : resolve());
}

async function api(method, url, { headers = {}, body } = {}) {
  const res = await fetch(baseUrl + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { _raw: text }; }
  return { status: res.status, body: json };
}

const PREFIX = `__smoke_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
const createdCampanhaIds = [];
const createdAudienciaIds = [];
const createdTemplateIds = [];
const createdLeadIds = [];

function cleanup() {
  try {
    for (const id of createdCampanhaIds) {
      try { db.prepare('DELETE FROM campanha_envios WHERE campanha_id = ?').run(id); } catch {}
      try { db.prepare('DELETE FROM campanhas WHERE id = ?').run(id); } catch {}
    }
    for (const id of createdAudienciaIds) {
      try { db.prepare('DELETE FROM audiencia_leads WHERE audiencia_id = ?').run(id); } catch {}
      try { db.prepare('DELETE FROM audiencias WHERE id = ?').run(id); } catch {}
    }
    for (const id of createdTemplateIds) {
      try { db.prepare('DELETE FROM templates WHERE id = ?').run(id); } catch {}
    }
    for (const id of createdLeadIds) {
      try { db.prepare('DELETE FROM leads WHERE id = ?').run(id); } catch {}
    }
    try { fs.rmSync(tmpEnvDir, { recursive: true, force: true }); } catch {}
  } catch {}
}
process.on('exit', cleanup);

(async function run() {
  try {
    await startServer();

    console.log('\n=== 2. POST /api/campanhas/smoke-test ===');
    const telefones = [
      `${PREFIX}_01`, `${PREFIX}_02`, `${PREFIX}_03`
    ].map(t => t.replace(/\D/g, '').slice(0, 13) || '5511999990000');
    // Precisam ser dígitos válidos — sobrescreve:
    const realTelefones = ['5511999990001', '5511999990002', '5511999990003'];
    const r2 = await api('POST', '/api/campanhas/smoke-test', {
      body: { telefones: realTelefones, agente_remetente: 'carlos' }
    });
    assert.strictEqual(r2.status, 201, `smoke-test deveria retornar 201 (got ${r2.status}: ${JSON.stringify(r2.body)})`);
    assert.ok(Number.isInteger(r2.body.campanha_id), 'campanha_id deve ser int');
    assert.ok(Number.isInteger(r2.body.audiencia_id), 'audiencia_id deve ser int');
    assert.ok(Number.isInteger(r2.body.template_id), 'template_id deve ser int');
    assert.ok(Array.isArray(r2.body.lead_ids) && r2.body.lead_ids.length === 3, 'lead_ids deve ter 3');
    createdCampanhaIds.push(r2.body.campanha_id);
    createdAudienciaIds.push(r2.body.audiencia_id);
    createdTemplateIds.push(r2.body.template_id);
    createdLeadIds.push(...r2.body.lead_ids);

    // Campanha deve estar em rascunho (nao dispara automaticamente)
    const campRow = db.prepare('SELECT status FROM campanhas WHERE id = ?').get(r2.body.campanha_id);
    assert.strictEqual(campRow.status, 'rascunho', 'smoke-test cria em rascunho, nao dispara');
    console.log('[OK] 2. smoke-test cria audiencia+template+campanha em rascunho');

    // Validacao: array vazio -> 400
    const rBadEmpty = await api('POST', '/api/campanhas/smoke-test', { body: { telefones: [] } });
    assert.strictEqual(rBadEmpty.status, 400, 'array vazio deve retornar 400');

    // Validacao: mais de 10 telefones -> 400
    const tooMany = Array.from({ length: 11 }, (_, i) => `551199999${String(i).padStart(4, '0')}`);
    const rBadMany = await api('POST', '/api/campanhas/smoke-test', { body: { telefones: tooMany } });
    assert.strictEqual(rBadMany.status, 400, '>10 telefones deve retornar 400');
    console.log('[OK] 2b. validacao de 1-10 telefones');

    console.log('\n=== 3. /api/admin/kill-broadcast sem X-Admin-Confirm ===');
    const r3 = await api('POST', '/api/admin/kill-broadcast', { body: {} });
    assert.strictEqual(r3.status, 403, 'sem header deve retornar 403');
    // .env nao deve ter mudado
    assert.strictEqual(envFile.getEnvVar(tmpEnvPath, 'BROADCAST_WORKER_ENABLED'), 'true', '.env nao deve mudar sem confirm');
    console.log('[OK] 3. sem X-Admin-Confirm -> 403 e .env intacto');

    console.log('\n=== 4. /api/admin/kill-broadcast com header ===');
    const r4 = await api('POST', '/api/admin/kill-broadcast', {
      headers: { 'X-Admin-Confirm': 'yes' },
      body: {}
    });
    assert.strictEqual(r4.status, 200, 'com header deve retornar 200');
    assert.strictEqual(r4.body.success, true);
    assert.strictEqual(r4.body.pending_restart, true, 'resposta deve indicar pending_restart');
    assert.strictEqual(
      envFile.getEnvVar(tmpEnvPath, 'BROADCAST_WORKER_ENABLED'),
      'false',
      '.env deve ter BROADCAST_WORKER_ENABLED=false'
    );
    assert.strictEqual(process.env.BROADCAST_WORKER_ENABLED, 'false', 'process.env deve refletir kill');
    console.log('[OK] 4. kill-broadcast atualiza .env e process.env');

    console.log('\n=== 5. /api/admin/resume-broadcast ===');
    const r5 = await api('POST', '/api/admin/resume-broadcast', {
      headers: { 'X-Admin-Confirm': 'yes' },
      body: {}
    });
    assert.strictEqual(r5.status, 200);
    assert.strictEqual(
      envFile.getEnvVar(tmpEnvPath, 'BROADCAST_WORKER_ENABLED'),
      'true',
      '.env deve voltar para true apos resume'
    );
    console.log('[OK] 5. resume-broadcast restaura .env');

    console.log('\n=== 6. GET /api/health/deep inclui broadcast_worker ===');
    const r6 = await api('GET', '/api/health/deep');
    // status pode ser 200 ou 503 dependendo de heartbeat — ambos aceitaveis
    assert.ok([200, 503].includes(r6.status), `health/deep status inesperado: ${r6.status}`);
    assert.ok(r6.body.checks, 'response deve ter checks');
    assert.ok(r6.body.checks.broadcast_worker, 'checks.broadcast_worker deve existir');
    const bw = r6.body.checks.broadcast_worker;
    assert.ok('status' in bw, 'broadcast_worker.status ausente');
    assert.ok('campanhas_ativas' in bw, 'broadcast_worker.campanhas_ativas ausente');
    assert.ok('envios_pendentes' in bw, 'broadcast_worker.envios_pendentes ausente');
    assert.ok('kill_switch_active' in bw, 'broadcast_worker.kill_switch_active ausente');
    console.log('[OK] 6. /api/health/deep expoe broadcast_worker');

    console.log('\n=== 7. GET /api/admin/broadcast-status ===');
    const r7 = await api('GET', '/api/admin/broadcast-status');
    assert.strictEqual(r7.status, 200);
    assert.ok('kill_switch' in r7.body);
    assert.ok('worker' in r7.body);
    assert.ok(Array.isArray(r7.body.campanhas_ativas));
    console.log('[OK] 7. broadcast-status retorna worker + campanhas');

    console.log('\n=== DONE: smoke-broadcast (7 checks) ===');
  } catch (err) {
    console.error('\n[FAIL]', err && err.stack ? err.stack : err);
    await stopServer();
    cleanup();
    process.exit(1);
  }
  await stopServer();
  process.exit(0);
})();
