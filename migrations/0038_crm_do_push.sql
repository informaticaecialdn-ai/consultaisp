-- As onze tabelas do CRM, que o `drizzle-kit push` criou e nunca viraram migracao.
--
-- Mesma deriva da `0007b_schema_do_push.sql`, achada no mesmo dia (12/09/2026)
-- ao criar o primeiro banco do zero desta base, o da demonstracao. As tabelas
-- sao declaradas em `shared/crm-schema.ts` — que o `drizzle.config.ts` entrega
-- ao push junto com `shared/schema.ts`, e foi assim que elas nasceram em
-- producao — e o servidor as usa: `server/routes/crm.routes.ts` (o painel do
-- superadmin e dois webhooks PUBLICOS da Z-API),
-- `server/services/crm/orchestrator.ts` e `server/services/crm/training.ts`.
-- Num banco novo, o primeiro POST em `/api/crm/webhook/zapi` caia em 500.
--
-- Por que migracao propria, e nao dentro da 0007b: a 0007b ja estava aplicada
-- no banco da demonstracao quando estas apareceram, e o runner nao reaplica
-- migracao registrada. E, ao contrario dos objetos da 0007b, nenhuma migracao
-- antiga le estas tabelas — elas nao precisam correr cedo.
--
-- Idempotente: em producao, onde as onze existem (vazias, em 12/09/2026), esta
-- migracao e registrada e nao muda nada. Tipos, defaults e nomes de constraint
-- e de indice sao os de producao, copiados do `pg_dump --schema-only`, e as
-- chaves primarias sao SERIAL como la (`serial("id")` no schema). A ordem das
-- tabelas e a que as chaves estrangeiras exigem: leads antes de conversas,
-- conversas antes de avaliacoes.

CREATE TABLE IF NOT EXISTS crm_leads (
  id                  SERIAL PRIMARY KEY,
  telefone            TEXT NOT NULL,
  nome                TEXT,
  provedor            TEXT,
  cidade              TEXT,
  estado              TEXT,
  regiao              TEXT,
  porte               TEXT NOT NULL DEFAULT 'desconhecido',
  erp                 TEXT,
  num_clientes        INTEGER,
  decisor             TEXT,
  email               TEXT,
  cargo               TEXT,
  site                TEXT,
  score_perfil        INTEGER NOT NULL DEFAULT 0,
  score_comportamento INTEGER NOT NULL DEFAULT 0,
  score_total         INTEGER NOT NULL DEFAULT 0,
  classificacao       TEXT NOT NULL DEFAULT 'frio',
  etapa_funil         TEXT NOT NULL DEFAULT 'novo',
  agente_atual        TEXT NOT NULL DEFAULT 'carlos',
  origem              TEXT NOT NULL DEFAULT 'manual',
  valor_estimado      NUMERIC(10,2) NOT NULL DEFAULT '0'::numeric,
  motivo_perda        TEXT,
  data_proxima_acao   TIMESTAMP,
  observacoes         TEXT,
  criado_em           TIMESTAMP DEFAULT now(),
  atualizado_em       TIMESTAMP DEFAULT now(),
  CONSTRAINT crm_leads_telefone_unique UNIQUE (telefone)
);

CREATE TABLE IF NOT EXISTS crm_conversas (
  id                SERIAL PRIMARY KEY,
  lead_id           INTEGER NOT NULL,
  agente            TEXT NOT NULL,
  direcao           TEXT NOT NULL,
  mensagem          TEXT NOT NULL,
  tipo              TEXT NOT NULL DEFAULT 'texto',
  canal             TEXT NOT NULL DEFAULT 'whatsapp',
  tokens_usados     INTEGER NOT NULL DEFAULT 0,
  tempo_resposta_ms INTEGER NOT NULL DEFAULT 0,
  metadata          JSONB,
  criado_em         TIMESTAMP DEFAULT now(),
  CONSTRAINT crm_conversas_lead_id_crm_leads_id_fk
    FOREIGN KEY (lead_id) REFERENCES crm_leads(id)
);

CREATE TABLE IF NOT EXISTS crm_atividades (
  id            SERIAL PRIMARY KEY,
  agente        TEXT NOT NULL,
  tipo          TEXT NOT NULL,
  descricao     TEXT NOT NULL,
  lead_id       INTEGER,
  decisao       TEXT,
  score_antes   INTEGER,
  score_depois  INTEGER,
  tokens_usados INTEGER NOT NULL DEFAULT 0,
  tempo_ms      INTEGER NOT NULL DEFAULT 0,
  metadata      JSONB,
  criado_em     TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_avaliacoes (
  id              SERIAL PRIMARY KEY,
  conversa_id     INTEGER NOT NULL,
  lead_id         INTEGER,
  agente          TEXT NOT NULL,
  nota            INTEGER NOT NULL,
  lead_respondeu  BOOLEAN,
  lead_sentimento TEXT,
  score_impacto   INTEGER,
  problemas       TEXT[] DEFAULT '{}'::text[],
  sugestao        TEXT,
  aprovada        BOOLEAN,
  criado_em       TIMESTAMP DEFAULT now(),
  CONSTRAINT crm_avaliacoes_conversa_id_crm_conversas_id_fk
    FOREIGN KEY (conversa_id) REFERENCES crm_conversas(id)
);

CREATE TABLE IF NOT EXISTS crm_campanhas (
  id                 SERIAL PRIMARY KEY,
  nome               TEXT NOT NULL,
  tipo               TEXT NOT NULL,
  agente             TEXT NOT NULL,
  regiao             TEXT,
  status             TEXT NOT NULL DEFAULT 'rascunho',
  total_enviados     INTEGER NOT NULL DEFAULT 0,
  total_respondidos  INTEGER NOT NULL DEFAULT 0,
  total_qualificados INTEGER NOT NULL DEFAULT 0,
  mensagem_template  TEXT,
  criado_em          TIMESTAMP DEFAULT now(),
  finalizado_em      TIMESTAMP
);

CREATE TABLE IF NOT EXISTS crm_conhecimento (
  id              SERIAL PRIMARY KEY,
  agente          TEXT NOT NULL,
  tipo            TEXT NOT NULL,
  contexto        TEXT,
  mensagem_lead   TEXT,
  resposta_agente TEXT,
  resultado       TEXT,
  tags            TEXT[] DEFAULT '{}'::text[],
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_handoffs (
  id               SERIAL PRIMARY KEY,
  lead_id          INTEGER NOT NULL,
  de_agente        TEXT NOT NULL,
  para_agente      TEXT NOT NULL,
  motivo           TEXT,
  score_no_momento INTEGER,
  criado_em        TIMESTAMP DEFAULT now(),
  CONSTRAINT crm_handoffs_lead_id_crm_leads_id_fk
    FOREIGN KEY (lead_id) REFERENCES crm_leads(id)
);

CREATE TABLE IF NOT EXISTS crm_metricas_diarias (
  id                      SERIAL PRIMARY KEY,
  data                    TEXT NOT NULL,
  agente                  TEXT NOT NULL,
  mensagens_enviadas      INTEGER NOT NULL DEFAULT 0,
  mensagens_recebidas     INTEGER NOT NULL DEFAULT 0,
  leads_novos             INTEGER NOT NULL DEFAULT 0,
  leads_qualificados      INTEGER NOT NULL DEFAULT 0,
  leads_convertidos       INTEGER NOT NULL DEFAULT 0,
  leads_perdidos          INTEGER NOT NULL DEFAULT 0,
  demos_agendadas         INTEGER NOT NULL DEFAULT 0,
  propostas_enviadas      INTEGER NOT NULL DEFAULT 0,
  contratos_fechados      INTEGER NOT NULL DEFAULT 0,
  tokens_consumidos       INTEGER NOT NULL DEFAULT 0,
  tempo_medio_resposta_ms INTEGER NOT NULL DEFAULT 0,
  valor_pipeline          NUMERIC(10,2) NOT NULL DEFAULT '0'::numeric
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_metricas_data_agente_idx
  ON crm_metricas_diarias (data, agente);

CREATE TABLE IF NOT EXISTS crm_regras_aprendidas (
  id          SERIAL PRIMARY KEY,
  agente      TEXT NOT NULL,
  regra       TEXT NOT NULL,
  evidencia   TEXT,
  categoria   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pendente',
  prioridade  INTEGER NOT NULL DEFAULT 0,
  criado_em   TIMESTAMP DEFAULT now(),
  aprovado_em TIMESTAMP
);

CREATE TABLE IF NOT EXISTS crm_sessoes_agentes (
  id         SERIAL PRIMARY KEY,
  lead_id    INTEGER NOT NULL,
  agente     TEXT NOT NULL,
  session_id TEXT,
  ativo      BOOLEAN NOT NULL DEFAULT true,
  criado_em  TIMESTAMP DEFAULT now(),
  CONSTRAINT crm_sessoes_agentes_lead_id_crm_leads_id_fk
    FOREIGN KEY (lead_id) REFERENCES crm_leads(id)
);

CREATE TABLE IF NOT EXISTS crm_tarefas (
  id           SERIAL PRIMARY KEY,
  lead_id      INTEGER,
  agente       TEXT NOT NULL,
  tipo         TEXT NOT NULL,
  descricao    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pendente',
  prioridade   TEXT NOT NULL DEFAULT 'normal',
  data_limite  TIMESTAMP,
  dados        JSONB,
  criado_em    TIMESTAMP DEFAULT now(),
  concluido_em TIMESTAMP
);
