---
description: "Spec 005 — plano de implementação faseado, com riscos e rollback"
created: 2026-05-11
---

# Plan — Anthropic Platform Integration

## Estratégia geral

3 fases independentes, paralelizáveis quando o pré-requisito (Spec 003+004 em prod estável) for atendido:

1. **Phase 1 — Memory Tool migration** (técnico, 3 dias-dev)
2. **Phase 2 — MCP server ERPs** (técnico, 4 dias-dev)
3. **Phase 3 — ZDR + LGPD operacional** (legal/comercial, 1-3 semanas calendário)

Não há dependência forte entre as 3 — podem rodar em ordem ou em paralelo. Sugestão: começar **Phase 3 imediatamente** (porque depende de calendário comercial Anthropic, não código) e Phase 1 em paralelo.

## Phase 1 — Memory Tool migration

**Goal:** substituir `agent_memories` table por Memory Tool client-side. Helena/Bruno/Sofia/Júlia migrados, ZDR-eligible, 200 LOC removidos.

### Sequência

1. **Schema migration (zero-downtime):**
   - Criar tabela `agent_memory_files` com (provider_id, customer_id, agent_id, path, content, updated_at). UNIQUE em (customer_id, agent_id, path).
   - Migration `0008_create_agent_memory_files.sql` (idempotente).
   - **Não dropar `agent_memories` ainda** — coexiste por 30 dias.

2. **Backend handler `server/agents/memory-tool-backend.ts`:**
   - Subclasse `betaMemoryTool` do SDK TS.
   - Mapeia comandos:
     - `view /memories` → SELECT files com prefix `/memories/`
     - `view /memories/file.md` → SELECT content WHERE path=...
     - `create` → INSERT
     - `str_replace` → UPDATE (validar `old_str` unicidade)
     - `insert` → UPDATE (line-aware)
     - `delete` → DELETE
     - `rename` → UPDATE path
   - Multi-tenant: path prefix obrigatório `/memories/provider-{providerId}/customer-{customerId}/...`
   - Path traversal guard: rejeitar `../`, `%2e%2e`, paths fora de `/memories/`
   - Limite por tenant: máx 100 arquivos × 50KB = ~5MB/customer

3. **Bootstrap script `scripts/migrate-agent-memories-to-files.ts`:**
   - Itera `agent_memories` rows.
   - Para cada (customer, agent):
     - Cria `/memories/provider-{P}/customer-{C}/agent-{A}/facts.md` com facts JSONB serializado.
     - Cria `promises.md` com promises.
     - Cria `summary.md` com summary text.
     - Cria `sentiment.md` com sentimentHistory (timeline).
   - Idempotente (skip se arquivo já existe).
   - Logs estruturados pino.

4. **Refatorar Helena (`server/agents/helena.ts`):**
   - Remover `memStorage.load()` no início.
   - Remover `extractFactsFromTurn` + `appendFact` chamadas inline.
   - Adicionar `memoryTool` no array `tools`:
     ```ts
     tools: [...helenaTools, { type: "memory_20250818", name: "memory" }]
     ```
   - Atualizar dispatcher para rotear `memory` calls para `memory-tool-backend`.
   - Sistema prompt continua o mesmo (Anthropic injeta protocolo automaticamente).
   - Remover `compactSummary` background job (Claude decide quando reorganizar).

5. **Refatorar Bruno/Sofia/Júlia análogo:**
   - Bruno e Sofia raramente usam memória — adicionar tool é opt-in.
   - Júlia: pode usar memory para "lembrar de vetos anteriores" do mesmo cliente.

6. **Testes (regressão):**
   - Helena 5 turnos contra customer X persistindo facts → reabrir nova run e verificar lembrança.
   - Bruno tool round-trip continua funcionando.
   - Sofia continua tom cordial.
   - Júlia compliance check inalterado.

7. **Side-by-side validation (1 semana em prod):**
   - Feature flag `USE_MEMORY_TOOL=true` ativa novo caminho.
   - Logs comparam fact extraction antes/depois.
   - Validar: nenhuma regressão em compliance_checks ou audit_logs.

8. **Deprecação `agent_memories`:**
   - Após 30 dias sem regressão, dropar tabela em Spec 008+.
   - Manter backup SQL antes de drop.

### Estimativa
- Schema + handler: 1 dia
- Migrate script: 0.5 dia
- Refatorar Helena (mais complexo): 1 dia
- Bruno/Sofia/Júlia: 0.5 dia
- Testes + side-by-side: 1 dia
- **Total: 3-4 dias-dev**

### Riscos + mitigação
- **Risco:** Memory Tool path traversal exploit. **Mitigação:** validação `pathlib.Path.resolve()` + `relative_to('/memories')`, rejeitar `..`/URL-encoded.
- **Risco:** Claude grava muito (file bloat). **Mitigação:** limite 50KB/file, 100 files/customer, cleanup mensal.
- **Risco:** regressão Helena (memória crítica pro contexto). **Mitigação:** feature flag por provider, rollback em 1 commit.

### Rollback
Reverter feature flag `USE_MEMORY_TOOL` para `false`. Helena/Bruno volta a usar `agent_memories`. Dados em `agent_memory_files` ficam órfãos mas não causam problema.

## Phase 2 — MCP server ERPs

**Goal:** ERP connectors expostos via MCP em `https://provedor.ai/mcp/erp`. OAuth 2.1 + PKCE, multi-tenant via JWT claim. Consumível por Claude Desktop do owner + agentes Managed futuros.

### Sequência

1. **Dependências:**
   - `npm install @modelcontextprotocol/sdk @modelcontextprotocol/sdk-server`
   - `npm install jose` (JWT validation) ou reusar `passport-jwt` se já instalado.

2. **Server skeleton `server/mcp/erp-server.ts`:**
   - `McpServer` instance, name "provedor-ai-erp", version "1.0.0"
   - Transport: `StreamableHTTPServerTransport` em path `/mcp/erp`
   - Registrar tools (ver lista abaixo)
   - Middleware OAuth 2.1: extrair Bearer, validar audience, extrair `provider_id`

3. **Auth setup:**
   - Endpoint `/mcp/erp/.well-known/oauth-protected-resource` (RFC 9728)
   - Endpoint `/mcp/erp/oauth/register` (Dynamic Client Registration RFC 7591) — opcional, talvez emitir tokens estáticos por provider inicialmente
   - Endpoint `/mcp/erp/oauth/token` — emite JWT com claim `provider_id`
   - Tabela nova `mcp_oauth_clients` (provider_id, client_id, client_secret_hash, audience)
   - Tabela nova `mcp_oauth_tokens` (token_hash, provider_id, expires_at, revoked_at)
   - Audience = `https://provedor.ai/mcp/erp` (binding RFC 8707)
   - Token TTL 1 hora, refresh permitido

4. **Tools expostas:**
   - `erp_list_delinquents(minValue?, daysOverdue?, limit, offset)` → reusa `getConnector(erpSource).fetchDelinquents()`
   - `erp_get_customer(cpfCnpj)` → reusa `fetchCustomers` ou byCpfCnpj
   - `erp_get_invoices(customerId, status?, from?, to?)` → query Postgres local
   - `erp_test_connection(erpSource)` → reusa `testConnection`
   - `erp_list_supported(_)` → catálogo de ERPs configurados pro provider
   - **Todas as tools** recebem `provider_id` injetado pelo middleware (não do model).

5. **PII handling em queries MCP:**
   - `erp_get_customer` retorna PII (nome, CPF, endereço)
   - Anthropic registra essas chamadas em logs operacionais (MCP NÃO é ZDR)
   - Mitigação: para casos sensíveis, retornar versão mascarada (CPF: ***.789-00, nome: primeiro nome)
   - Adicionar parâmetro `unmasked: boolean` que requer scope OAuth especial
   - Default mascara, owner pede unmask explicitamente quando precisa

6. **Audit logging:**
   - Toda chamada MCP gera entry em `audit_logs` com `actorType: 'mcp'`, `actorId: client_id`, `payload: {tool, args, providerId}`.

7. **Inspector validation:**
   - `npx @modelcontextprotocol/inspector` aponta para `https://provedor.ai/mcp/erp`
   - Configura Bearer token de teste
   - Lista tools, executa cada uma, valida response

8. **Deploy VPS:**
   - Adicionar à rota Express em `server/routes/index.ts`
   - Caddy reverse proxy `/mcp/*` → upstream Express
   - HTTPS obrigatório (Caddy já provê)

9. **Documentação `docs/mcp/`:**
   - README com setup Claude Desktop
   - Quickstart owner: claim de tokens, exemplos uso

### Estimativa
- Skeleton + transport: 0.5 dia
- OAuth 2.1 + PKCE: 1.5 dia
- 5 tools + multi-tenant: 1 dia
- Audit + masking: 0.5 dia
- Testes + Inspector validation: 0.5 dia
- Deploy + docs: 0.5 dia
- **Total: 4-4.5 dias-dev**

### Riscos
- **Risco:** OAuth 2.1 implementado errado → token leak. **Mitigação:** usar `jose` lib mature, PKCE obrigatório, rotacionar `JWT_SECRET` separado do session secret.
- **Risco:** confused-deputy (Anthropic tools chamando MCP com token errado). **Mitigação:** audience binding (RFC 8707) — token só vale para `provedor.ai/mcp/erp`, não para outros endpoints.
- **Risco:** PII vaza pra Anthropic via tool result. **Mitigação:** mascarar por default, requer scope para unmask.

### Rollback
Desabilitar rota `/mcp/erp` no Express. Clients MCP recebem 404, nada mais quebra.

## Phase 3 — ZDR + DPA + LGPD docs (operacional)

**Goal:** contrato Enterprise Anthropic com ZDR ativo + DPA assinado + política privacidade Provedor.ai atualizada + cláusula contrato ISP.

### Sequência

1. **Semana 1 — Cotação:**
   - Email sales@anthropic.com (CC: legal@) com:
     - Volume estimado: ~5k execuções/dia × 100 providers = 500k execuções/mês inicialmente, escalando para 5M/mês ano 1
     - Modelo dominante: Haiku 4.5 (~80% custo), Sonnet 4.6 (Helena ~15%), Opus (~5%)
     - Pedido: tier Enterprise com **ZDR habilitado** + **DPA pt-BR** (ou GDPR-equivalent aceito por equivalência LGPD)
     - Pergunta: pricing volume discount tier-based?
   - Aguardar resposta (1-2 semanas típicas)

2. **Semana 2 — Setup Console:**
   - Após contrato Enterprise ativo: settings → ZDR enabled per workspace
   - Criar workspaces separados: `provedor-ai-prod` (dados reais, ZDR ON) e `provedor-ai-test` (sandbox)
   - API keys novas por workspace

3. **Semana 2-3 — Legal:**
   - Receber DPA assinado por Anthropic (vai a Provedor.ai assinar contraparte)
   - Atualizar `docs/legal/`:
     - `dpa-anthropic-2026.pdf`
     - `lgpd-policy-provedor-ai.md` (política privacidade)
     - `contrato-isp-template.md` (cláusula sub-processadores)
   - Reescrever política privacidade do Provedor.ai listando:
     - Anthropic como suboperador (US, AWS principal)
     - Base legal LGPD: Art. 7º V (execução contrato) e IX (legítimo interesse cobrança)
     - Transferência internacional (Art. 33): coberto por SCC + decisão de adequação ANPD se vier
     - Direitos do titular (acesso, correção, deletação)
   - Cláusula contrato ISP↔Provedor.ai (template para todos contratos novos + addendum para existentes):
     - Lista Anthropic + sub-processadores Anthropic (AWS, GCP, Cloudflare)
     - Provedor.ai como controlador conjunto com ISP
     - Ciência do ISP sobre transferência internacional

4. **Semana 3 — Comunicação ao cliente final (assinante):**
   - Atualizar tela Política de Privacidade no app/website do provedor (cada ISP precisa atualizar a sua, mas Provedor.ai oferece template)
   - Banner discreto na primeira mensagem WhatsApp: "Comunicação automatizada via IA. Mais info: vertical.com.br/privacidade"

5. **Validação:**
   - Console Anthropic mostra ZDR enabled
   - DPA assinado em vault
   - Política privacidade publicada
   - 3+ contratos ISP atualizados ou novos com cláusula

### Estimativa
- Calendário: 2-4 semanas (depende velocidade comercial Anthropic + legal Provedor.ai)
- Dev time: ~1 dia (atualizar `.env` com novas keys, criar workspaces, deploy)
- Legal time: ~5 horas (revisão DPA, redação política, redação cláusula contrato)

### Riscos
- **Risco:** Anthropic recusa ZDR por volume baixo. **Mitigação plano B:** mascarar PII agressivamente (últimos 4 dígitos CPF + hash determinístico). Mantém defesa LGPD mesmo sem ZDR.
- **Risco:** Custo Enterprise excessivo. **Mitigação:** começar com tier API standard, ZDR só quando volume justificar. Mascaramento PII funciona como mitigação intermediária.
- **Risco:** ISPs resistem a cláusula sub-processadores. **Mitigação:** explicar que é exigência LGPD (transparência ao titular), comparar com outros operadores (ex: Sengrid, AWS) — todos têm.

### Rollback
ZDR não tem rollback (é configuração da Anthropic). Se descontentar, cancelar contrato Enterprise volta a tier standard.

## Implementation Strategy

### Ordem recomendada

1. **Dia 1**: Disparar Phase 3 (email sales Anthropic). Não bloqueia outras phases.
2. **Dias 1-4**: Phase 1 (Memory Tool) — desenvolvedor único.
3. **Dias 5-9**: Phase 2 (MCP server) — desenvolvedor único.
4. **Em paralelo (calendário)**: Phase 3 progride. ZDR ativa quando contrato fechar.

### Marcos

- **M1 (dia 4):** Helena em prod usando Memory Tool, side-by-side com agent_memories. Testes Spec 003+004 verdes.
- **M2 (dia 9):** MCP server em `provedor.ai/mcp/erp` funcional, owner consegue usar via Claude Desktop.
- **M3 (semana 4):** ZDR ativo, DPA assinado, política publicada. Spec 005 completa.

### Critérios de aceitação por phase

- **Phase 1 ✓:** Todos SC-001, SC-002, SC-007 atendidos. `agent_memories` marcada como deprecated em comentário no schema.
- **Phase 2 ✓:** SC-003, SC-004 atendidos. Documento `docs/mcp/quickstart.md` permite owner consumir em <10min.
- **Phase 3 ✓:** SC-005, SC-006 atendidos. Workspace Console com ZDR ON. DPA em pasta legal.

## Estimativa Total

- **Engenharia:** 7-9 dias-dev (Phases 1+2 + setup Phase 3)
- **Calendário:** 4 semanas (Phase 3 depende da Anthropic)
- **Custo adicional Anthropic:** Enterprise tier — depende cotação. Estimativa: $0 base + commit anual + uso à parte.
- **Custo Hostinger:** +0 (MCP roda no mesmo VPS)
