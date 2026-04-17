// Sprint 5 / T2 — Testes do worker: claim atomico + kill switch.
// Uso: node tests/integration/worker-claim.test.js
// Nao depende de framework — usa assert nativo.

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const AGENTES_ROOT = path.resolve(__dirname, '../..');

// Isola: tmp dir + cwd para neutralizar dotenv do repo
// (broadcast.killSwitchActive re-le .env com override:true a cada iteracao)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-claim-'));
const tmpDbPath = path.join(tmpDir, 'test-worker.db');
const originalCwd = process.cwd();
process.chdir(tmpDir);

// Estado inicial do kill switch: off (o teste 4 liga explicitamente)
process.env.BROADCAST_WORKER_ENABLED = 'true';
process.env.BROADCAST_BATCH_SIZE = '10';

// ============================================================
// Setup: DB isolado + schema + migrations
// ============================================================
const setupDb = new Database(tmpDbPath);
setupDb.pragma('journal_mode = WAL');
setupDb.pragma('foreign_keys = ON');

// Schema core (leads + conversas)
setupDb.exec(`
  CREATE TABLE leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telefone TEXT UNIQUE NOT NULL,
    nome TEXT,
    agente_atual TEXT DEFAULT 'carlos',
    classificacao TEXT DEFAULT 'frio',
    etapa_funil TEXT DEFAULT 'novo',
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE conversas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    agente TEXT, direcao TEXT, mensagem TEXT, tipo TEXT, canal TEXT,
    status_entrega TEXT DEFAULT 'enviado',
    zapi_message_id TEXT,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Aplica migrations 008-011 (Sprint 4 stubs + Sprint 5)
const migDir = path.join(AGENTES_ROOT, 'src/migrations');
const migFiles = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
for (const f of migFiles) {
  const sql = fs.readFileSync(path.join(migDir, f), 'utf-8');
  try {
    setupDb.exec(sql);
  } catch (err) {
    if (!/duplicate column|already exists/i.test(err.message)) throw err;
  }
}

// ============================================================
// Patch getDb ANTES de carregar o modulo broadcast para que
// claimBatch use nosso DB de teste. Como broadcast.js destrutura
// getDb no require, precisamos mutar o export antes desse require.
// ============================================================
const dbModule = require(path.join(AGENTES_ROOT, 'src/models/database'));
dbModule.getDb = () => setupDb;

const broadcastWorker = require(path.join(AGENTES_ROOT, 'src/workers/broadcast'));

// ============================================================
// Helpers de seed
// ============================================================
let seedCounter = 0;
function seedEnvios(n, { campanhaStatus = 'enviando', proximoRetry = null } = {}) {
  const tag = `${Date.now().toString(36)}-${seedCounter++}`;
  const audRes = setupDb.prepare(
    'INSERT INTO audiencias (nome, tipo, total_leads) VALUES (?,?,?)'
  ).run(`Aud ${tag}`, 'estatica', n);
  const audId = audRes.lastInsertRowid;
  const tplRes = setupDb.prepare(
    'INSERT INTO templates (nome, conteudo, agente) VALUES (?,?,?)'
  ).run(`Tpl ${tag}`, 'Oi {{primeiro_nome}}!', 'carlos');
  const tplId = tplRes.lastInsertRowid;
  const campRes = setupDb.prepare(
    `INSERT INTO campanhas (nome, audiencia_id, template_id, agente_remetente, status)
     VALUES (?,?,?,?,?)`
  ).run(`Camp ${tag}`, audId, tplId, 'carlos', campanhaStatus);
  const campId = campRes.lastInsertRowid;

  const insertLead = setupDb.prepare('INSERT INTO leads (telefone, nome) VALUES (?, ?)');
  const insertEnvio = setupDb.prepare(
    `INSERT INTO campanha_envios
       (campanha_id, lead_id, telefone, mensagem_renderizada, status, proximo_retry)
     VALUES (?,?,?,?,?,?)`
  );
  const envioIds = [];
  for (let i = 0; i < n; i++) {
    const tel = `55119${tag.replace(/-/g, '')}${String(i).padStart(2, '0')}`.slice(0, 20);
    const leadRes = insertLead.run(tel, `Teste ${tag}-${i}`);
    const envRes = insertEnvio.run(
      campId, leadRes.lastInsertRowid, tel, 'Oi!',
      'pendente', proximoRetry
    );
    envioIds.push(envRes.lastInsertRowid);
  }
  return { campId, envioIds };
}

function resetData() {
  setupDb.exec(`
    DELETE FROM campanha_envios;
    DELETE FROM campanhas;
    DELETE FROM audiencia_leads;
    DELETE FROM audiencias;
    DELETE FROM templates;
    DELETE FROM leads;
  `);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// Tests
// ============================================================
async function run() {
  // ===== TESTE 1: claim concorrente retorna conjuntos disjuntos =====
  // better-sqlite3 e sincrono, mas UPDATE...RETURNING e atomico — mesmo
  // com Promise.all, duas claim(5) sobre 5 pendentes nao podem dar overlap.
  resetData();
  seedEnvios(5);
  const [batchA, batchB] = await Promise.all([
    Promise.resolve().then(() => broadcastWorker.claimBatch(5)),
    Promise.resolve().then(() => broadcastWorker.claimBatch(5))
  ]);
  const idsA = new Set(batchA.map(e => e.id));
  const idsB = new Set(batchB.map(e => e.id));
  for (const id of idsA) {
    assert.ok(!idsB.has(id), `claim nao atomico: envio ${id} aparece em ambos os batches`);
  }
  assert.strictEqual(
    idsA.size + idsB.size, 5,
    `esperava 5 envios reclamados no total, obteve ${idsA.size + idsB.size}`
  );
  // Todos viraram 'processando'
  const processando = setupDb.prepare(
    "SELECT COUNT(*) AS c FROM campanha_envios WHERE status='processando'"
  ).get().c;
  assert.strictEqual(processando, 5, 'esperava 5 envios em status processando');
  console.log('[OK] 1. claimBatch concorrente retorna conjuntos disjuntos');

  // ===== TESTE 2: claimBatch ignora envios de campanhas fora de status=enviando =====
  for (const status of ['rascunho', 'pausada', 'concluida', 'cancelada']) {
    resetData();
    seedEnvios(3, { campanhaStatus: status });
    const batch = broadcastWorker.claimBatch(10);
    assert.strictEqual(
      batch.length, 0,
      `claim deveria ser vazio com campanha.status=${status}, obteve ${batch.length}`
    );
  }
  console.log('[OK] 2. claimBatch ignora envios de campanhas != enviando');

  // ===== TESTE 3: claimBatch respeita proximo_retry =====
  // 3a. retry futuro -> nao reclama
  resetData();
  const futureRetry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  seedEnvios(4, { proximoRetry: futureRetry });
  const futBatch = broadcastWorker.claimBatch(10);
  assert.strictEqual(
    futBatch.length, 0,
    `claim deveria ignorar envios com proximo_retry futuro, obteve ${futBatch.length}`
  );

  // 3b. retry passado -> reclama
  resetData();
  const pastRetry = new Date(Date.now() - 60 * 1000).toISOString();
  seedEnvios(2, { proximoRetry: pastRetry });
  const pastBatch = broadcastWorker.claimBatch(10);
  assert.strictEqual(
    pastBatch.length, 2,
    `claim deveria pegar envios com proximo_retry passado, obteve ${pastBatch.length}`
  );

  // 3c. proximo_retry NULL -> reclama
  resetData();
  seedEnvios(3, { proximoRetry: null });
  const nullBatch = broadcastWorker.claimBatch(10);
  assert.strictEqual(
    nullBatch.length, 3,
    `claim deveria pegar envios com proximo_retry NULL, obteve ${nullBatch.length}`
  );
  console.log('[OK] 3. claimBatch filtra por proximo_retry (futuro/passado/null)');

  // ===== TESTE 4: BROADCAST_WORKER_ENABLED=false mantem worker idle =====
  resetData();
  seedEnvios(4);
  process.env.BROADCAST_WORKER_ENABLED = 'false';

  broadcastWorker.start();
  // Aguarda tempo suficiente para o loop iterar pelo menos uma vez.
  await sleep(1500);

  const status = broadcastWorker.status();
  assert.strictEqual(status.running, true, 'worker deveria estar running mesmo com kill switch');
  assert.strictEqual(status.kill_switch_active, true, 'kill switch deveria estar ativo');

  // Nenhum envio deve ter mudado de status=pendente
  const pendentes = setupDb.prepare(
    "SELECT COUNT(*) AS c FROM campanha_envios WHERE status='pendente'"
  ).get().c;
  assert.strictEqual(
    pendentes, 4,
    `kill switch falhou: ${4 - pendentes} envios foram reclamados`
  );

  // Restaura estado e para o worker
  process.env.BROADCAST_WORKER_ENABLED = 'true';
  await broadcastWorker.stop();
  console.log('[OK] 4. BROADCAST_WORKER_ENABLED=false mantem worker idle (loop nao claima)');

  // Cleanup
  setupDb.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  process.chdir(originalCwd);

  console.log('\n✅ TODOS OS 4 TESTES PASSARAM (worker claim + kill switch)');
}

run().catch(err => {
  console.error('\n❌ TESTE FALHOU:', err.message);
  console.error(err.stack);
  try { setupDb.close(); } catch {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  process.chdir(originalCwd);
  process.exit(1);
});
