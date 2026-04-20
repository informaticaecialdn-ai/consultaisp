-- Milestone 1 / B4: auditoria de tool calls dos agentes.
-- Cada linha = 1 chamada de tool feita por um agente (send_whatsapp, check_consent, etc.).
-- Permite observabilidade fina da autonomia: quem chamou o que, quando, qual resultado.

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agente TEXT NOT NULL,                -- sofia, leo, carlos, lucas, rafael, marcos, iani
  lead_id INTEGER,                     -- nullable (algumas tools nao sao por lead)
  tool_name TEXT NOT NULL,             -- send_whatsapp, check_consent, handoff_to_agent, etc.
  tool_input TEXT,                     -- JSON do input_schema enviado pelo modelo
  tool_output TEXT,                    -- JSON do resultado retornado ao modelo
  status TEXT DEFAULT 'ok'
    CHECK(status IN ('ok','error','blocked','timeout')),
  erro TEXT,                           -- mensagem de erro se status != 'ok'
  duracao_ms INTEGER,                  -- tempo de execucao do handler
  correlation_id TEXT,                 -- amarra com claude_usage e logs Pino
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_agente ON agent_tool_calls(agente);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_tool ON agent_tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_lead ON agent_tool_calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_data ON agent_tool_calls(criado_em);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_correlation ON agent_tool_calls(correlation_id);
