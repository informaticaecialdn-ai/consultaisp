const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../../data/agentes.db');
let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

function initialize() {
  const conn = getDb();

  conn.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telefone TEXT UNIQUE NOT NULL,
      nome TEXT,
      provedor TEXT,
      cidade TEXT,
      estado TEXT,
      regiao TEXT,
      porte TEXT DEFAULT 'desconhecido',
      erp TEXT,
      num_clientes INTEGER,
      decisor TEXT,
      email TEXT,
      cargo TEXT,
      site TEXT,
      score_perfil INTEGER DEFAULT 0,
      score_comportamento INTEGER DEFAULT 0,
      score_total INTEGER DEFAULT 0,
      classificacao TEXT DEFAULT 'frio',
      etapa_funil TEXT DEFAULT 'novo',
      agente_atual TEXT DEFAULT 'carlos',
      origem TEXT DEFAULT 'manual',
      valor_estimado REAL DEFAULT 0,
      motivo_perda TEXT,
      data_proxima_acao DATETIME,
      observacoes TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      agente TEXT NOT NULL,
      direcao TEXT NOT NULL,
      mensagem TEXT NOT NULL,
      tipo TEXT DEFAULT 'texto',
      canal TEXT DEFAULT 'whatsapp',
      tokens_usados INTEGER DEFAULT 0,
      tempo_resposta_ms INTEGER DEFAULT 0,
      metadata TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id)
    );

    CREATE TABLE IF NOT EXISTS atividades_agentes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agente TEXT NOT NULL,
      tipo TEXT NOT NULL,
      descricao TEXT NOT NULL,
      lead_id INTEGER,
      decisao TEXT,
      score_antes INTEGER,
      score_depois INTEGER,
      tokens_usados INTEGER DEFAULT 0,
      tempo_ms INTEGER DEFAULT 0,
      metadata TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessoes_agentes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      agente TEXT NOT NULL,
      session_id TEXT,
      ativo INTEGER DEFAULT 1,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id)
    );

    CREATE TABLE IF NOT EXISTS tarefas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER,
      agente TEXT NOT NULL,
      tipo TEXT NOT NULL,
      descricao TEXT NOT NULL,
      status TEXT DEFAULT 'pendente',
      prioridade TEXT DEFAULT 'normal',
      data_limite DATETIME,
      dados TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      concluido_em DATETIME
    );

    CREATE TABLE IF NOT EXISTS metricas_diarias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL,
      agente TEXT NOT NULL,
      mensagens_enviadas INTEGER DEFAULT 0,
      mensagens_recebidas INTEGER DEFAULT 0,
      leads_novos INTEGER DEFAULT 0,
      leads_qualificados INTEGER DEFAULT 0,
      leads_convertidos INTEGER DEFAULT 0,
      leads_perdidos INTEGER DEFAULT 0,
      demos_agendadas INTEGER DEFAULT 0,
      propostas_enviadas INTEGER DEFAULT 0,
      contratos_fechados INTEGER DEFAULT 0,
      tokens_consumidos INTEGER DEFAULT 0,
      tempo_medio_resposta_ms INTEGER DEFAULT 0,
      valor_pipeline REAL DEFAULT 0,
      UNIQUE(data, agente)
    );

    CREATE TABLE IF NOT EXISTS handoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      de_agente TEXT NOT NULL,
      para_agente TEXT NOT NULL,
      motivo TEXT,
      score_no_momento INTEGER,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Tabela campanhas (schema v2, Sprint 5 Broadcast Engine) e criada via migrations/009.
    -- O schema v1 legado, se existir, e renomeado para campanhas_legacy automaticamente.

    CREATE INDEX IF NOT EXISTS idx_leads_telefone ON leads(telefone);
    CREATE INDEX IF NOT EXISTS idx_leads_agente ON leads(agente_atual);
    CREATE INDEX IF NOT EXISTS idx_leads_classificacao ON leads(classificacao);
    CREATE INDEX IF NOT EXISTS idx_leads_etapa ON leads(etapa_funil);
    CREATE INDEX IF NOT EXISTS idx_conversas_lead ON conversas(lead_id);
    CREATE INDEX IF NOT EXISTS idx_conversas_data ON conversas(criado_em);
    CREATE INDEX IF NOT EXISTS idx_atividades_agente ON atividades_agentes(agente);
    CREATE INDEX IF NOT EXISTS idx_atividades_data ON atividades_agentes(criado_em);
    CREATE INDEX IF NOT EXISTS idx_metricas_data ON metricas_diarias(data);
    CREATE INDEX IF NOT EXISTS idx_handoffs_lead ON handoffs(lead_id);

    CREATE TABLE IF NOT EXISTS treinamento_agentes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agente TEXT NOT NULL,
      tipo TEXT NOT NULL,
      regra TEXT NOT NULL,
      contexto TEXT,
      fonte TEXT DEFAULT 'automatico',
      confianca REAL DEFAULT 0.5,
      vezes_aplicada INTEGER DEFAULT 0,
      vezes_sucesso INTEGER DEFAULT 0,
      ativo INTEGER DEFAULT 1,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_treinamento_agente ON treinamento_agentes(agente);
    CREATE INDEX IF NOT EXISTS idx_treinamento_tipo ON treinamento_agentes(tipo);
    CREATE INDEX IF NOT EXISTS idx_treinamento_ativo ON treinamento_agentes(ativo);

    CREATE TABLE IF NOT EXISTS avaliacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      agente TEXT NOT NULL,
      conversa_id INTEGER,
      nota INTEGER NOT NULL,
      sentimento TEXT,
      problemas TEXT,
      sugestao TEXT,
      tags TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_avaliacoes_agente ON avaliacoes(agente);
    CREATE INDEX IF NOT EXISTS idx_avaliacoes_nota ON avaliacoes(nota);

    CREATE TABLE IF NOT EXISTS followups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      agente TEXT NOT NULL,
      mensagem_original TEXT,
      tentativa INTEGER DEFAULT 1,
      proximo_envio DATETIME NOT NULL,
      status TEXT DEFAULT 'pendente',
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_followups_status ON followups(status);
    CREATE INDEX IF NOT EXISTS idx_followups_proximo ON followups(proximo_envio);

    CREATE TABLE IF NOT EXISTS ab_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agente TEXT NOT NULL,
      tipo_mensagem TEXT NOT NULL,
      variante_a TEXT NOT NULL,
      variante_b TEXT NOT NULL,
      envios_a INTEGER DEFAULT 0,
      envios_b INTEGER DEFAULT 0,
      respostas_a INTEGER DEFAULT 0,
      respostas_b INTEGER DEFAULT 0,
      vencedor TEXT,
      min_envios INTEGER DEFAULT 20,
      status TEXT DEFAULT 'ativo',
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_ab_tests_status ON ab_tests(status);
  `);

  // Adicionar campos novos se nao existem (migracao segura)
  try {
    conn.exec("ALTER TABLE conversas ADD COLUMN status_entrega TEXT DEFAULT 'enviado'");
  } catch { /* coluna ja existe */ }

  try {
    conn.exec("ALTER TABLE leads ADD COLUMN canal_preferido TEXT DEFAULT 'whatsapp'");
  } catch { /* coluna ja existe */ }

  // Aplicar migrations versionadas (schema_migrations)
  const { runMigrations } = require('./migrations');
  runMigrations(conn);

  console.log('[DB] Banco de dados inicializado com sucesso');
}

module.exports = { getDb, initialize };
