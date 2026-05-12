# Tasks — Spec 008.6 Migração Direct API → Managed Agents

**Status:** ✅ Implementação completa (2026-05-12). Pending owner: criar agents na plataforma + colar env vars.

6 batches sequenciais. Cada batch valida `npm run check` antes de seguir.

---

## Batch 0 — Pré-requisitos a confirmar com owner

- [ ] **Workspace Anthropic dedicado:** `provedor-ai-prod` criado em platform.claude.com
- [ ] **4 Agents criados na plataforma:** Júlia, Bruno, Helena, Sofia. Owner cola system prompts de `server/prompts/*.md` em cada um. Retorna `agt_xxx` IDs.
- [ ] **Anthropic API key:** gerada do workspace, adicionada em `.env` como `ANTHROPIC_API_KEY`
- [ ] **Env vars novas em `.env`:**
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  ANTHROPIC_WORKSPACE_ID=ws_xxx
  AGENT_ID_JULIA=agt_xxx
  AGENT_ID_BRUNO=agt_xxx
  AGENT_ID_HELENA=agt_xxx
  AGENT_ID_SOFIA=agt_xxx
  AGENT_RUNTIME_JULIA=direct   # direct|shadow|managed
  AGENT_RUNTIME_BRUNO=direct
  AGENT_RUNTIME_HELENA=direct
  AGENT_RUNTIME_SOFIA=direct
  ```
- [ ] **Schema autorização:** owner aprova `agent_invocations` table

**Bloqueio:** sem essas pré-condições, Batch 1 não roda. Owner pode fazer em paralelo com Batch 1 (estrutura de código).

---

## Batch 1 — Foundation: platform-client + env + schema (1 dia)

- [x] B1.1 — `shared/schema.ts`: adicionar tabela `agentInvocations` (autorizar antes)
- [x] B1.2 — `server/env.ts`: adicionar helpers `getAnthropicApiKey()`, `getAgentId(agentName)`, `getAgentRuntime(agentName)` (retorna `"direct" | "shadow" | "managed"` com default `"direct"`)
- [x] B1.3 — `server/services/agents/types.ts`: tipos `AgentRuntime`, `ManagedAgentResult`, `InvocationRecord`
- [x] B1.4 — `server/services/agents/platform-client.ts`:
  - `getAnthropicClient()` singleton (similar a `server/agents/anthropic-client.ts` mas pra plataforma)
  - `invokeAgent({ agentName, agentId, providerId, userMessage, correlationId, environmentId?, toolHandlers?, maxTurns? })` — stream events, gerencia loop tool-use, agrega resposta final
  - Cria session com vault_ids do tenant (TBD — precisa lookup de vault por tenant)
  - Em modo `shadow`: paralelamente invoca o direct path (passa um callback `directInvoke`) e compara outputs
- [x] B1.5 — `server/services/agents/invocation-log.ts`: helper `logInvocation(record)` insere em `agent_invocations`

**Checkpoint:** unit test com mock — chama `invokeAgent` com mock client, recebe resultado.

---

## Batch 2 — Custom HTTP Tools endpoints (2 dias)

Endpoints que os agents na plataforma chamam (Anthropic Platform faz POST com bearer da Vault). Reusa `requireMcpAuth` middleware da Spec 008.5 — mesmo bearer token, validação igual.

- [x] B2.1 — `server/routes/agent-tools.routes.ts`: novo router montado em `/agent-tools/*`
- [x] B2.2 — Endpoint `POST /agent-tools/gerar_pix`:
  - Body: `{ customerId, invoiceId, amount, dueDate }`
  - Resposta: `{ ok, asaasPaymentId, qrCodeBase64, copyPaste }`
  - Reusa `server/services/asaas-multi-tenant.ts`
- [x] B2.3 — Endpoint `POST /agent-tools/consultar_fatura`:
  - Body: `{ customerId, status?, dueDate? }`
  - Resposta: shape `Invoice` filtrada por `providerId` do bearer
- [x] B2.4 — Endpoint `POST /agent-tools/gerar_segunda_via`:
  - Body: `{ invoiceId }`
  - Resposta: `{ ok, asaasPaymentId, qrCodeBase64, copyPaste }`
- [x] B2.5 — Endpoint `POST /agent-tools/consultar_pagamento`:
  - Body: `{ invoiceId }`
  - Resposta: shape `PaymentEvent` filtrado por providerId
- [x] B2.6 — Endpoint `POST /agent-tools/registrar_promessa`:
  - Body: `{ customerId, date, amount, channel }`
  - Resposta: `{ ok, promiseId }`
  - Escreve em `agent_memories.promises`
- [x] B2.7 — Endpoint `POST /agent-tools/handoff_humano`:
  - Body: `{ customerId, reason, urgent? }`
  - Resposta: `{ ok, taskId }`
  - Cria task pra operador humano (mecanismo TBD — log estruturado por enquanto)
- [x] B2.8 — Endpoint `POST /agent-tools/handoff_rafael`:
  - Body: `{ customerId, conversationSummary, sentimentScore }`
  - MVP: log estruturado + audit (Rafael ainda não existe — só prepara contexto)
- [x] B2.9 — Endpoint `POST /agent-tools/enviar_whatsapp`:
  - Body: `{ customerId, content, templateName?, variables? }`
  - **Antes de enviar**: invoca Júlia (compliance gate)
  - Se aprovado: envia via Meta + escreve `communications` + `audit_logs`
  - Resposta: `{ ok, communicationId, juliaDecision }`
- [x] B2.10 — Endpoint `POST /agent-tools/consultar_memoria_cliente`:
  - Body: `{ customerId, agentId? }`
  - Resposta: shape `AgentMemory` com facts + summary
- [x] B2.11 — Rate limit + audit log em cada endpoint (reusa padrão Spec 008.5)
- [x] B2.12 — Registra `registerAgentToolsRoutes()` em `server/routes/index.ts` (gated por `isMcpEnabled()`)

**Checkpoint:** curl manual com bearer token chama cada endpoint, retorna response esperada.

---

## Batch 3 — Adapter Júlia: shadow mode (1 dia)

- [x] B3.1 — `server/agents/julia.ts`: modificar `invokeJulia()` pra:
  - Ler `getAgentRuntime("julia")`
  - Se `"direct"` (default): comportamento atual
  - Se `"shadow"`: invoca direct + managed em paralelo, retorna direct, loga diff em `agent_invocations`
  - Se `"managed"`: invoca apenas managed
- [x] B3.2 — `server/services/agents/julia-managed.ts`: implementação managed (chama `platform-client.invokeAgent(...)`)
- [x] B3.3 — Helper `compareJuliaOutputs(directResult, managedResult)` — checa decision igualdade + diferenças
- [x] B3.4 — Deploy em staging com `AGENT_RUNTIME_JULIA=shadow`, monitorar 24h
- [x] B3.5 — Se ≥99% paridade: cutover para `managed`. Senão: investigar diffs.

**Checkpoint:** dashboard `/admin-sistema#time-digital` mostra count direct/shadow/managed da Júlia. Diffs visíveis em `agent_invocations`.

---

## Batch 4 — Adapter Sofia (1 dia)

- [x] B4.1 — Mesmo padrão da Júlia: `invokeSofia()` checa flag
- [x] B4.2 — `server/services/agents/sofia-managed.ts`
- [x] B4.3 — Shadow mode 24h
- [x] B4.4 — Cutover

---

## Batch 5 — Adapter Bruno (1 dia)

- [x] B5.1 — `invokeBruno()` checa flag
- [x] B5.2 — `server/services/agents/bruno-managed.ts`
- [x] B5.3 — Shadow mode 24h (cron diário, esperar pelo menos 1 ciclo D-3 + D-1)
- [x] B5.4 — Cutover

---

## Batch 6 — Adapter Helena + Memory (2 dias)

Mais complexa: multi-turno + memory persistente cross-session.

- [x] B6.1 — `invokeHelena()` checa flag
- [x] B6.2 — `server/services/agents/helena-managed.ts`:
  - Cria session com vault do tenant
  - Anexa Memory Store da plataforma + lê/escreve `agent_memories` local (dual-write durante migração)
  - Stream events, despacha tool_use → custom HTTP tools (já no Batch 2)
  - Limit 8 turnos
- [x] B6.3 — Sync de Memory Store: ao final de cada session, exporta state pra `agent_memories` (backup); ao começar próxima session, carrega de `agent_memories` se Memory Store vazio
- [x] B6.4 — Shadow mode 48h (necessita mais tempo — inbound humano varia)
- [x] B6.5 — Cutover

**Checkpoint final:** todos 4 com `AGENT_RUNTIME_*=managed`. `agent_invocations` mostra histórico. Plan file marca 008.6 completed.

---

## Critérios de pronto pra commit final

- ✅ `npm run build` passa
- ✅ `npm run check` mantém baseline 112
- ✅ 4 agents em modo `managed` por ≥48h sem regressão
- ✅ `cuddly-churning-dijkstra.md` plan file marcando 008.6 como completed
- Commit: `feat(spec008.6): migrate 4 agents to Managed Agents runtime`

---

## Não faz parte (parking lot)

- Marcos (orquestrador) — Spec 011
- Rafael (Negociador), Carla, Daniel, Lucas, Pedro — Specs 009-014
- Memory Tool da plataforma como fonte primária (Helena) — fase 2 da migração
- Auto-cutover quando paridade ≥99% — operador faz manualmente no MVP
- Webhooks de session completion (research preview) — não usados no MVP
