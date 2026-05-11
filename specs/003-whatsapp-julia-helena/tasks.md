---
description: "Task list — P1 Cobrança: WhatsApp + Júlia (Compliance) + Helena (Reativo)"
---

# Tasks: P1 Cobrança — WhatsApp + Júlia + Helena

**Input**: Design documents from `specs/003-whatsapp-julia-helena/`
**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Selecionados. Suite obrigatória: `multi-tenant.test.ts`, validação compliance Júlia, mock Meta webhooks.

## Format: `[ID] [P?] [Story?] Description`

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Adicionar deps via `pnpm add @anthropic-ai/sdk bullmq ioredis` em `package.json`
- [ ] T002 [P] Adicionar variáveis em `.env.example`: `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_REDIRECT_URI`, `ANTHROPIC_API_KEY`, `ENCRYPTION_MASTER_KEY`, `REDIS_URL`
- [ ] T003 [P] Configurar `server/lib/crypto/encryption.ts` — AES-256-GCM (encrypt/decrypt) usando `ENCRYPTION_MASTER_KEY`
- [ ] T004 [P] Configurar conexão BullMQ + Redis em `server/lib/queues/index.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: User stories só começam após esta fase concluir.

### Schema + Migrations

- [ ] T005 Merge `specs/003-whatsapp-julia-helena/drafts/schemas-drizzle.ts` em `shared/schema.ts` (6 tabelas: communications, audit_logs, agent_memories, compliance_checks, agreements, whatsapp_accounts + auxiliar whatsapp_optouts)
- [ ] T006 Adicionar Zod insert schemas + tipos exportados ao final de `shared/schema.ts` para cada nova tabela
- [ ] T007 Criar migration `server/migrations/0XX_spec003_add_tables.sql` com CREATE TABLE statements + índices
- [ ] T008 Criar migration `server/migrations/0XX_spec003_audit_immutability.sql` com função `raise_immutability_error()` e triggers `audit_logs_immutable_update/delete`
- [ ] T009 Criar migration `server/migrations/0XX_spec003_rls.sql` — habilitar RLS em todas as 6 tabelas + policy `tenant_isolation` usando `current_setting('app.current_provider_id')::int` (FR-016)
- [ ] T010 Executar `npm run db:push` em dev; validar via `psql` que tabelas criadas + triggers ativos + RLS habilitada

### Storage Layer

- [ ] T011 [P] Criar `server/storage/communications.storage.ts` com funções CRUD recebendo `providerId` como primeiro parâmetro (listInbound, listOutbound, create, updateStatus, findByWamid)
- [ ] T012 [P] Criar `server/storage/audit-log.storage.ts` com `registrarAcao(providerId, action, ...)` e `gerarDossie(providerId, customerId)` para defesa Procon
- [ ] T013 [P] Criar `server/storage/agent-memory.storage.ts` com `load(customerId, agentId)`, `save(...)`, helper `compactarSummary()` via Haiku
- [ ] T014 [P] Criar `server/storage/compliance-check.storage.ts` com `registrar(check)` + `historicoMensal(providerId)` para report Júlia
- [ ] T015 [P] Criar `server/storage/whatsapp-account.storage.ts` com `findByPhoneNumberId(phoneNumberId)`, `findByProviderId(providerId)`, `upsertFromOAuth(...)` (criptografa token via AES-256-GCM)
- [ ] T016 [P] Criar `server/storage/whatsapp-optout.storage.ts` com `isOptedOut(providerId, phone)`, `markOptedOut(providerId, phone, reason)`
- [ ] T017 Atualizar `server/storage/index.ts` exportando todos os novos storage modules

### Multi-Tenant Defense (Belt-and-Suspenders)

- [ ] T018 Criar `server/middleware/tenant-context.middleware.ts` — middleware Express que executa `SET LOCAL app.current_provider_id = ${req.session.providerId}` no início de cada transaction autenticada (FR-017)
- [ ] T019 Aplicar `tenantContextMiddleware` no `server/index.ts` após `requireAuth`
- [ ] T020 [P] Criar regra ESLint customizada em `.eslintrc.cjs` ou config — proibir queries em `server/storage/*.ts` sem `.where(eq(table.providerId, ...))` explícito ou `withTenantContext()` helper (FR-018)
- [ ] T021 [P] Criar `server/__tests__/multi-tenant.test.ts` — criar 2 tenants, inserir comunicações/audit/memory em cada, verificar isolamento absoluto (zero leak, RLS bloqueia mesmo com query maliciosa)

### Anthropic Client + Prompt Loader

- [ ] T022 Criar `server/agents/anthropic-client.ts` — SDK Anthropic instanciado com `ANTHROPIC_API_KEY`, helper `createMessage(model, messages, tools, cacheControl?)` com retry+backoff (max 3 tentativas)
- [ ] T023 Criar `server/agents/prompt-loader.ts` — `loadPrompt(agentName: string)` lê `server/prompts/${agentName}.md`, parseia frontmatter YAML, retorna `{ metadata, systemPrompt }`

**Checkpoint:** schema, storage, RLS, lint, multi-tenant test passing. User stories podem começar.

---

## Phase 3: User Story 1 — Cliente envia WhatsApp e Helena responde (Priority: P1) 🎯 MVP

**Goal:** Cliente envia WA → Helena responde <30s com info correta de fatura. Júlia bloqueia outbound fora de horário/CDC 71. Audit log registra tudo.

**Independent Test:** Setup Vertical Fibra como tenant piloto, configurar WhatsApp (Embedded Signup), cliente envia "qual valor da minha fatura?", verificar resposta em <30s com dados corretos do IXC + audit log + compliance check registrados.

### Tests for US1

- [ ] T024 [P] [US1] Teste de contrato em `server/agents/__tests__/julia.contract.test.ts`: mock decisões APPROVED/BLOCKED, validar formato JSON, multi-tenant isolation
- [ ] T025 [P] [US1] Teste de contrato em `server/agents/__tests__/helena.contract.test.ts`: mock Anthropic API, validar loop tool-use até 8 turnos, escalação
- [ ] T026 [P] [US1] Teste E2E em `server/communications/whatsapp/__tests__/webhook.test.ts`: payload Meta válido → tenant identificado → enfileirado em BullMQ → resposta 200 em <4s

### WhatsApp Cloud API Implementation

- [ ] T027 [P] [US1] Criar `server/communications/whatsapp/signature.ts` — HMAC-SHA256 validation com `META_APP_SECRET` (raw body antes de parse)
- [ ] T028 [P] [US1] Criar `server/communications/whatsapp/client.ts` — class `MetaWhatsappClient` com `sendTemplate()`, `sendText()`, `sendInteractive()`, `getTemplates()`, `getPhoneNumberQuality()` (recebe `tenantId` no construtor, busca credenciais)
- [ ] T029 [US1] Criar `server/communications/whatsapp/embedded-signup.ts` — rota GET `/auth/whatsapp/initiate` (gera state), rota GET `/auth/whatsapp/callback` (troca code por token, exchange para long-lived, salva criptografado em `whatsapp_accounts`, subscreve webhook). **Depende de T015, T028**
- [ ] T030 [P] [US1] Criar `server/communications/whatsapp/window-24h.ts` — `isWithin24hWindow(providerId, phone)`, `updateLastInbound(providerId, phone, timestamp)`, cron worker para fechar janelas expiradas
- [ ] T031 [P] [US1] Criar `server/communications/whatsapp/opt-out.ts` — detecta "PARAR"/"CANCELAR"/"PARE" em inbound text → chama `whatsappOptout.markOptedOut()`, responde mensagem confirmando

### Webhook + Orquestrador

- [ ] T032 [US1] Criar `server/communications/whatsapp/webhook.ts` — POST handler em `/webhooks/whatsapp`: (a) valida signature, (b) responde 200 imediato, (c) enfileira em BullMQ `whatsapp-webhook`. GET handler para verify do Meta. **Depende de T027, T032 do route registration**
- [ ] T033 [US1] Adicionar rota `/webhooks/whatsapp` em `server/routes/webhook.routes.ts` ou similar, sem requireAuth (público para Meta), passando por signature middleware
- [ ] T034 [US1] Criar `server/workers/whatsapp-webhook-processor.ts` — BullMQ consumer: parse payload → lookup tenant por phoneNumberId → identificar customer por phone → atualizar window24h + lastInboundAt → invocar orquestrador
- [ ] T035 [US1] Criar `server/agents/orchestrator.ts` — pre-flight (customer existe? em vulnerabilidade? Procon ativo? VIP?) → route para Helena (inbound 24/7) ou escalar humano

### Júlia — Compliance Agent

- [ ] T036 [US1] Criar `server/agents/julia.ts` — `invokeJulia(input)` com 4 camadas: (1) determinísticas (horário, frequência, opt-in lookup), (2) Anatel timeline check, (3) LLM Haiku 4.5 com prompt cache para análise semântica CDC art. 71, (4) vulnerabilidade detection. Latência alvo <500ms. Output JSON. **Depende de T022, T023, T011, T014, T016**
- [ ] T037 [US1] Implementar referências legais em `server/audit/legal-references.ts` — constantes com CDC arts. 42/43/71, Anatel 765/2023 timeline, LGPD art. 7º (bases legais)

### Helena — Reativo Agent

- [ ] T038 [US1] Criar `server/agents/tools/consultar-fatura.ts` — wrapper que invoca `server/erp/connectors/ixc.ts` (ou apropriado por tenant), recebe `tenantId + customerId`, retorna faturas atuais
- [ ] T039 [P] [US1] Criar `server/agents/tools/gerar-segunda-via.ts` + `gerar-pix.ts` + `consultar-pagamento.ts` — wrappers ERP
- [ ] T040 [P] [US1] Criar `server/agents/tools/handoff-humano.ts` — cria task urgente, marca conversa `ESCALATED_HUMAN`, pausa régua automatizada
- [ ] T041 [US1] Criar `server/agents/memory.ts` — `loadMemory(customerId, agentId)`, `saveMemory(...)`, `extractFactsFromTurn(...)`, `detectPromise(text)`, `compactSummary()` (cada 5 turnos via Haiku)
- [ ] T042 [US1] Criar `server/agents/helena.ts` — `invokeHelena(input)` com loop tool-use até 8 turnos: load memory → carregar contexto enriquecido (customer, contract, faturas, score consulta_isp) → loop com tools → cada outbound passa por `invokeJulia()` → enviar via MetaWhatsappClient → atualizar memory. **Depende de T022, T023, T036, T038, T039, T040, T041**

### Persistência & Audit

- [ ] T043 [US1] Helena ao final do loop: persistir `communications` (inbound + outbound) + atualizar `agent_memories` + registrar em `audit_logs(action='whatsapp_outbound', actorType='AGENT', actorName='Helena - Atendente Master', legalBasis, legalReferences, notificationProof)`
- [ ] T044 [US1] Júlia ao final de cada validação: `compliance_checks.create()` + `audit_logs(action='compliance_check')` se BLOCKED

### Token Rotation

- [ ] T045 [P] [US1] Criar `server/workers/token-rotator.ts` — cron 1x/dia: lista `whatsapp_accounts` com `tokenExpiresAt < now() + 15 dias`, faz exchange para novo long-lived, atualiza criptografado, se falhar alerta admin tenant

### UI Mínima

- [ ] T046 [P] [US1] Criar `client/src/pages/configuracoes-whatsapp.tsx` — página com botão Embedded Signup (popup FB.login) + WhatsappStatusCard (quality rating, token validity, número, displayName)
- [ ] T047 [P] [US1] Criar `client/src/hooks/use-whatsapp-account.ts` — `useQuery({ queryKey: ['whatsapp-account'], queryFn: () => fetch('/api/provider/whatsapp/account').then(r => r.json()) })`
- [ ] T048 [P] [US1] Criar `client/src/components/whatsapp/EmbeddedSignupButton.tsx` — wrapper React do FB.login com `scope: 'whatsapp_business_management,whatsapp_business_messaging'`
- [ ] T049 [US1] Adicionar rota frontend em `client/src/App.tsx` para `/configuracoes/whatsapp` + link no menu de configurações

### Backend API Routes

- [ ] T050 [US1] Criar `server/routes/whatsapp.routes.ts` — `GET /api/provider/whatsapp/account` (status), `POST /api/provider/whatsapp/disconnect` (revoga), `GET /api/provider/whatsapp/templates` (lista HSM aprovados), todos com `requireAuth` + tenant filter
- [ ] T051 [P] [US1] Criar `client/src/pages/communications.tsx` + hook + componente CommunicationsTimeline — viewer de comunicações inbound/outbound do tenant (paginado, filtrado por customer opcional)

### Smoke Test E2E

- [ ] T052 [US1] Setup ngrok local → Meta sandbox app → conectar via Embedded Signup com WABA de teste → enviar mensagem real do número de teste → verificar: webhook recebido, tenant identificado, Helena resposta correta com dados IXC, Júlia compliance check gravado, audit log com `delivered_at + read_at`. Documentar resultado em commit message.

**Checkpoint:** US1 MVP funcional. Pronto para piloto Vertical Fibra.

---

## Phase 4: Polish & Cross-Cutting Concerns

- [ ] T053 [P] Atualizar CLAUDE.md seção 9 (Rotas API) com novos endpoints `/webhooks/whatsapp`, `/api/provider/whatsapp/*`
- [ ] T054 [P] Atualizar README do `server/agents/` mencionando que Júlia + Helena estão implementadas (não só prompts)
- [ ] T055 [P] Adicionar logging estruturado JSON em pontos críticos: webhook receipt, Júlia decision, Helena turn, token rotation. Campos obrigatórios: `tenantId`, `customerId`, `agentId`, `action`, `correlationId`, `latencyMs`, `tokensInput`, `tokensOutput`, `cacheHit`
- [ ] T056 Rodar `npm run check` — zero novos erros TypeScript
- [ ] T057 Rodar `npx vitest run server/` — todos os testes passam, incluindo `multi-tenant.test.ts`
- [ ] T058 Smoke test em Vertical Fibra com 1 cliente real, validar SC-001 a SC-009 da spec
- [ ] T059 [P] Atualizar memória persistente Claude com status de implementação para próxima sessão

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: sem deps — pode começar imediato
- **Phase 2 (Foundational)**: depende Phase 1 — BLOQUEIA US1
- **Phase 3 (US1)**: depende Phase 2 completo
- **Phase 4 (Polish)**: depende US1 funcional

### Within US1

- T036 (Júlia) depende de T022, T023 (Anthropic), T011/T014/T016 (storage)
- T042 (Helena) depende de T036 + T038-T041 (tools, memory)
- T032 (webhook) depende de T027 (signature)
- T034 (worker) depende de T032 + T035 (orquestrador) + T042 (Helena)
- T029 (Embedded Signup callback) depende de T015 (whatsapp_account storage) + T028 (client)
- T046-T049 (UI) podem rodar em paralelo após T050

### Parallel Opportunities

**Phase 2 (Foundational):**
- T011-T016 (6 storage modules) em paralelo após T010 (schema deployed)
- T020 (ESLint) + T021 (multi-tenant test) em paralelo

**Phase 3 (US1):**
- Tests T024-T026 em paralelo (mock-heavy)
- WhatsApp helpers T027, T030, T031 em paralelo
- Tools T038-T040 em paralelo
- UI T046-T048 em paralelo após T050 (route)
- T045 (token rotator) independente

---

## Implementation Strategy

### MVP First (US1 completo)

1. Phase 1 (Setup) — T001-T004 (~1 dia, paralelizável)
2. Phase 2 (Foundational) — T005-T023 (~3 dias, sequência crítica em schema/migrations + paralelo em storage)
3. Phase 3 (US1) — T024-T052 (~6-8 dias com paralelismo)
4. **Smoke test Vertical Fibra (T052)** — bloqueio crítico antes de Phase 4

**Total estimado:** ~12 dias-dev solo · 6-7 dias com 2 devs · 4-5 dias com 4 agents paralelos

### Parallel Team Strategy (4 agents simultâneos após Phase 2)

- **Agent A:** WhatsApp client + webhook + signature (T027, T028, T030, T031, T032, T033, T034)
- **Agent B:** Júlia compliance (T036, T037, T044) + multi-tenant test (T021)
- **Agent C:** Helena + tools + memory (T038-T043) + Anthropic client (T022, T023)
- **Agent D:** UI + frontend hooks + routes (T046-T051) + Embedded Signup (T029)

Cada agent trabalha em arquivos não-overlapping. Convergência: smoke test E2E (T052).

---

## Task Count Summary

| Phase | Tasks | Paralelizáveis | Story |
|---|---|---|---|
| 1. Setup | 4 | 3 | — |
| 2. Foundational | 19 | 11 | — |
| 3. US1 (MVP) | 29 | 16 | US1 |
| 4. Polish | 7 | 4 | — |
| **Total** | **59** | **34** | — |

---

## Notes

- [P] = arquivos diferentes, sem deps
- [Story] mapeia traceabilidade ao FR/SC da spec
- US1 é o MVP completo do Standalone Essencial — Vertical Fibra como piloto
- Sofia, Bruno, Marcos, Rafael, Carla, Daniel, Lucas, Pedro = Specs futuras (004+)
- RLS + ESLint custom + multi-tenant test = belt-and-suspenders contra cross-tenant leak
- Audit log imutável é defesa jurídica — triggers Postgres não-bypassáveis
