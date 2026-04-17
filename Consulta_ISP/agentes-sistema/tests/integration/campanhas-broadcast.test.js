// Tests de integracao do Broadcast Engine (Sprint 5).
// Uso: node tests/integration/campanhas-broadcast.test.js
// Nao depende de framework — usa assert nativo.

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Isolamento: usa banco efemero
const tmpDbDir = path.join(__dirname, '../../data');
const tmpDbPath = path.join(tmpDbDir, 'test-agentes.db');
fs.mkdirSync(tmpDbDir, { recursive: true });
try { fs.unlinkSync(tmpDbPath); } catch {}

// monkeypatch do path do banco
const originalDbModule = require.resolve('../../src/models/database');
const dbCode = fs.readFileSync(originalDbModule, 'utf-8');
// Ao inves de modificar, setamos env var. Mas database.js usa path fixo — workaround: rename
process.env.SQLITE_DB_PATH = tmpDbPath;

const Database = require('better-sqlite3');

// Para simplicidade: executa migrations diretamente sem passar pelo runner
async function run() {
  const db = new Database(tmpDbPath);
  db.pragma('journal_mode = WAL');

  // Core tables (minimo)
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telefone TEXT UNIQUE NOT NULL,
      nome TEXT,
      provedor TEXT,
      cidade TEXT,
      estado TEXT,
      agente_atual TEXT DEFAULT 'carlos',
      classificacao TEXT DEFAULT 'frio',
      etapa_funil TEXT DEFAULT 'novo',
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS conversas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      agente TEXT, direcao TEXT, mensagem TEXT, tipo TEXT, canal TEXT,
      status_entrega TEXT DEFAULT 'enviado',
      zapi_message_id TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Aplica migrations Sprint 4 stubs + Sprint 5
  const migDir = path.join(__dirname, '../../src/migrations');
  const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migDir, f), 'utf-8');
    try {
      db.exec(sql);
    } catch (err) {
      if (!/duplicate column|already exists/i.test(err.message)) throw err;
    }
  }

  // ===== TESTE 1: schema aplicado =====
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name);
  assert.ok(tables.includes('campanhas'), 'tabela campanhas nao existe');
  assert.ok(tables.includes('campanha_envios'), 'tabela campanha_envios nao existe');
  assert.ok(tables.includes('audiencias'), 'tabela audiencias nao existe');
  assert.ok(tables.includes('templates'), 'tabela templates nao existe');
  assert.ok(tables.includes('lead_opt_out'), 'tabela lead_opt_out nao existe');
  console.log('[OK] 1. Schema aplicado');

  // ===== TESTE 2: colunas novas =====
  const campCols = db.prepare('PRAGMA table_info(campanhas)').all().map(c => c.name);
  ['audiencia_id', 'template_id', 'agente_remetente', 'rate_limit_per_min', 'jitter_min_sec']
    .forEach(col => assert.ok(campCols.includes(col), `coluna ${col} ausente em campanhas`));
  const envioCols = db.prepare('PRAGMA table_info(campanha_envios)').all().map(c => c.name);
  ['campanha_id', 'lead_id', 'telefone', 'mensagem_renderizada', 'status', 'tentativas', 'proximo_retry', 'zapi_message_id']
    .forEach(col => assert.ok(envioCols.includes(col), `coluna ${col} ausente em campanha_envios`));
  const convCols = db.prepare('PRAGMA table_info(conversas)').all().map(c => c.name);
  assert.ok(convCols.includes('zapi_message_id'), 'conversas.zapi_message_id ausente');
  console.log('[OK] 2. Colunas criadas corretamente');

  // ===== TESTE 3: insere leads + audiencia =====
  const insertLead = db.prepare('INSERT INTO leads (telefone, nome) VALUES (?, ?)');
  const leadIds = [];
  for (let i = 1; i <= 5; i++) {
    const r = insertLead.run(`551199999000${i}`, `Teste ${i}`);
    leadIds.push(r.lastInsertRowid);
  }

  const audRes = db.prepare('INSERT INTO audiencias (nome, tipo, total_leads) VALUES (?, ?, ?)').run('Test Aud', 'estatica', 0);
  const audId = audRes.lastInsertRowid;
  const audLeadStmt = db.prepare('INSERT INTO audiencia_leads (audiencia_id, lead_id) VALUES (?, ?)');
  for (const lid of leadIds) audLeadStmt.run(audId, lid);
  db.prepare('UPDATE audiencias SET total_leads = ? WHERE id = ?').run(leadIds.length, audId);

  const tplRes = db.prepare('INSERT INTO templates (nome, conteudo, agente) VALUES (?, ?, ?)').run('Test Tpl', 'Oi {{primeiro_nome}}!', 'carlos');
  const tplId = tplRes.lastInsertRowid;
  console.log('[OK] 3. Audiencia e template criados');

  // ===== TESTE 4: cria campanha =====
  const campRes = db.prepare(`
    INSERT INTO campanhas (nome, audiencia_id, template_id, agente_remetente)
    VALUES (?, ?, ?, ?)
  `).run('Test Camp', audId, tplId, 'carlos');
  const campId = campRes.lastInsertRowid;
  const camp = db.prepare('SELECT * FROM campanhas WHERE id = ?').get(campId);
  assert.strictEqual(camp.status, 'rascunho');
  assert.strictEqual(camp.rate_limit_per_min, 20);
  assert.strictEqual(camp.jitter_min_sec, 3);
  assert.strictEqual(camp.jitter_max_sec, 8);
  console.log('[OK] 4. Campanha criada com defaults corretos');

  // ===== TESTE 5: UNIQUE(campanha_id, lead_id) evita duplicacao =====
  const insertEnvio = db.prepare(`
    INSERT OR IGNORE INTO campanha_envios (campanha_id, lead_id, telefone, mensagem_renderizada)
    VALUES (?, ?, ?, ?)
  `);
  let inserted = 0;
  for (const lid of leadIds) {
    const r = insertEnvio.run(campId, lid, `5511999900${lid}`, 'Oi teste!');
    if (r.changes > 0) inserted++;
  }
  assert.strictEqual(inserted, 5, 'deveria ter inserido 5');

  // Tenta inserir novamente — UNIQUE bloqueia
  let dup = 0;
  for (const lid of leadIds) {
    const r = insertEnvio.run(campId, lid, `5511999900${lid}`, 'Oi teste!');
    if (r.changes > 0) dup++;
  }
  assert.strictEqual(dup, 0, 'UNIQUE nao bloqueou duplicacao');
  console.log('[OK] 5. UNIQUE(campanha_id, lead_id) garante idempotencia');

  // ===== TESTE 6: claim atomico =====
  // Marcar campanha como enviando
  db.prepare("UPDATE campanhas SET status='enviando' WHERE id = ?").run(campId);
  const claim = db.prepare(`
    UPDATE campanha_envios
    SET status = 'processando'
    WHERE id IN (
      SELECT e.id FROM campanha_envios e
      INNER JOIN campanhas c ON c.id = e.campanha_id
      WHERE e.status = 'pendente' AND c.status = 'enviando'
      ORDER BY e.id ASC LIMIT ?
    )
    RETURNING *
  `);
  const batch1 = claim.all(3);
  const batch2 = claim.all(3);
  assert.strictEqual(batch1.length, 3);
  assert.strictEqual(batch2.length, 2);
  const ids1 = new Set(batch1.map(e => e.id));
  const ids2 = new Set(batch2.map(e => e.id));
  for (const id of ids2) assert.ok(!ids1.has(id), 'claim nao disjunto');
  console.log('[OK] 6. Claim atomico retorna conjuntos disjuntos');

  // ===== TESTE 7: CASCADE delete =====
  const newCamp = db.prepare(`
    INSERT INTO campanhas (nome, audiencia_id, template_id, agente_remetente)
    VALUES (?, ?, ?, ?)
  `).run('Temp Camp', audId, tplId, 'lucas');
  const newCampId = newCamp.lastInsertRowid;
  insertEnvio.run(newCampId, leadIds[0], '5511aaa', 'x');
  db.pragma('foreign_keys = ON');
  db.prepare('DELETE FROM campanhas WHERE id = ?').run(newCampId);
  const orphans = db.prepare('SELECT COUNT(*) AS c FROM campanha_envios WHERE campanha_id = ?').get(newCampId).c;
  assert.strictEqual(orphans, 0, 'CASCADE delete nao limpou envios');
  console.log('[OK] 7. DELETE CASCADE limpa envios');

  // ===== TESTE 8: template engine =====
  const tmplEngine = require('../../src/services/template-engine');
  const rendered = tmplEngine.render('Oi {{primeiro_nome}}, empresa {{provedor}}', { nome: 'Joao Silva', provedor: 'NetLink' });
  assert.strictEqual(rendered, 'Oi Joao, empresa NetLink');
  console.log('[OK] 8. Template engine renderiza variaveis');

  // ===== TESTE 9: rate limiter computa intervalo =====
  const rl = require('../../src/services/broadcast-rate-limiter');
  const start = Date.now();
  // Override setTimeout para nao aguardar de verdade — truque: usar campanha com rate 1000/min -> 0.06s
  await rl.waitForNextSlot({ rate_limit_per_min: 1000, jitter_min_sec: 0, jitter_max_sec: 0 });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 500, 'rate limiter esperou mais do que esperado (>500ms)');
  console.log(`[OK] 9. Rate limiter usa config (esperou ${elapsed}ms com rate 1000/min)`);

  // ===== TESTE 10: consent opt-out =====
  db.prepare("INSERT INTO lead_opt_out (telefone, motivo) VALUES (?, ?)").run('5511999990001', 'test');
  const row = db.prepare('SELECT * FROM lead_opt_out WHERE telefone = ?').get('5511999990001');
  assert.ok(row, 'opt-out nao registrou');
  console.log('[OK] 10. Opt-out persiste');

  console.log('\n✅ TODOS OS 10 TESTES PASSARAM');
  db.close();

  // cleanup
  try { fs.unlinkSync(tmpDbPath); } catch {}
  try { fs.unlinkSync(tmpDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(tmpDbPath + '-shm'); } catch {}
}

run().catch(err => {
  console.error('\n❌ TESTE FALHOU:', err.message);
  console.error(err.stack);
  process.exit(1);
});
