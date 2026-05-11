---
description: "Task list for Spec 004 — Bruno (preventivo) + Sofia (agradecimento) + Pix dinâmico"
---

# Tasks: Bruno (preventivo) + Sofia (agradecimento) + Pix dinâmico

**Input**: Design documents from `specs/004-cobranca-pix-bruno-sofia/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ (6 arquivos) ✅, quickstart.md ✅
**Schema autorizado**: 5 tabelas (2026-05-11)

**Tests**: Áreas críticas (multi-tenant, idempotência, webhook auth) DEVEM ter testes — Constitution §Testes. Mocks de banco PROIBIDOS — usar PostgreSQL real.

**Organization**: Phase 1 Setup → Phase 2 Foundational (bloqueante) → Phase 3 US1 (Bruno MVP) → Phase 4 US2 (Sofia) → Phase 5 US3 (Painel) → Phase 6 Polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]** = paralelizável (arquivos diferentes, sem dependência incompleta)
- **[US1/2/3]** = user story (apenas para tasks de Phase 3+)

## Path Conventions (este projeto)

- Backend: `server/`
- Frontend: `client/src/`
- Shared schema: `shared/schema.ts`
- Testes: lado a lado com source (`*.test.ts`)
- Migrations: `server/migrations/` (criar dir; hoje migrations vivem em `server/models/migrations.js`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Validar dependências e preparar diretórios.

- [x] T001 Verificar que dependências já existem em `package.json`: `@anthropic-ai/sdk` ✓, `bullmq` ✓, `ioredis` ✓, `vitest` ✓, `zod` ✓. `node-cron` e `pdfkit` faltam — install diferido para Phase 3 (bruno-scheduler).
- [x] T002 [P] Criado `server/workers/` (será populado em Phase 3+).
- [x] T003 [P] Migrações ficam em `migrations/` (root, lido por `server/migrate.ts`). `server/migrations/` tem cópia histórica Spec 003.

**Checkpoint Setup**: Diretórios prontos, deps validadas.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: Nenhuma US pode começar até esta fase completar.

### Schema + Migrations

- [x] T004 Criado `drafts/schemas-drizzle.ts` com Drizzle defs das 5 tabelas + Zod schemas + types.
- [x] T005 Mesclado em `shared/schema.ts` (linhas 663-784). Imports atualizados (`date`, `numeric`). Nenhuma tabela existente alterada. Typecheck ✅.
- [x] T006 Criado `migrations/0005_spec004_create_tables.sql` (root migrations/, lido pelo runner) — IF NOT EXISTS p/ coexistir com drizzle-kit push.
- [x] T007 Criado `migrations/0006_spec004_outbound_unique_index.sql` — UNIQUE com expression `(scheduled_for::date)` partial WHERE step IN ('D-3','D-1').
- [x] T008 Criado `migrations/0007_spec004_backfill_agent_toggles.sql` — INSERT...SELECT...ON CONFLICT DO NOTHING.
- [ ] T009 ⏸ Aplicar via `npm run db:migrate` na VPS após deploy (decisão do owner 2026-05-11: aplicar via SSH na VPS Hostinger, não local). SQL é idempotente, sem risco.

### Storage Layer (todos paralelizáveis — arquivos diferentes)

- [x] T010 [P] `server/storage/asaas-account.storage.ts` — byProviderId/getApiKey/getWebhookToken/upsert/markRevoked/touchLastUsed. AES-256-GCM via Spec 003 helper.
- [x] T011 [P] `server/storage/pix-charge.storage.ts` — create/byAsaasId/byInvoiceAndDay/updateStatus/cacheQrCode/listForRegua.
- [x] T012 [P] `server/storage/payment-event.storage.ts` — insertOrSkip (ON CONFLICT DO NOTHING)/logRejection/listByPixCharge/attachSofiaJobId.
- [x] T013 [P] `server/storage/agent-toggle.storage.ts` — byProviderId (cria default OFF se não existe)/update/listProvidersWithBrunoActive/isSofiaActive.
- [x] T014 [P] `server/storage/outbound-attempt.storage.ts` — tryReserve (idempotente via 23505 catch)/markWaitingWindow/markAwaitingCompliance/markVetoed/markSent/markFailed/markNeedsHumanReview/selectForRetry/listForRegua.
- [x] T015 Exports adicionados em `server/storage/index.ts` (DatabaseStorage instances + re-export classes).

### Asaas refactor (multi-tenant)

- [x] T016 `server/services/asaas.ts` refatorado: `asaasRequest(apiKey, method, path, body)` recebe apiKey por parâmetro; funções públicas aceitam `apiKey?` (fallback env para creditOrders); adicionado `createDynamicPix(params, apiKey)` (billingType=PIX) + `validateApiKey(apiKey)`. Erros pré-existentes em credits.routes.ts (cnpj/customer) NÃO foram introduzidos por este refator — confirmado via stash.
- [x] T017 `server/services/asaas-multi-tenant.ts` criado — buildExternalRef/parseExternalReference/createPixForInvoice/cancelPix/getPaymentStatus/validateAndDetectMode. Reusa Spec 003 crypto helper.

### Multi-Tenant Test

- [x] T018 `server/__tests__/multi-tenant-pix.test.ts` criado — Postgres real (sem mock de DB). 13 testes cobrindo: asaas_accounts isolation (3), pix_charges isolation (2), outbound_attempts idempotency + isolation (3), payment_events idempotency (2), parseExternalReference (3). Roda quando `DATABASE_URL` está configurado.

### Crypto helper compartilhado

- [x] T019 ⏭ Skip — helper já existe em `server/lib/crypto/encryption.ts` (Spec 003, AES-256-GCM, ENCRYPTION_MASTER_KEY, formato `iv:tag:ciphertext` hex). Reutilizado em `asaas-account.storage.ts`.

**Checkpoint Foundational**: Schema vivo no DB, storages funcionando, asaas multi-tenant pronto, multi-tenant test passando. **Liberado para iniciar US1.**

---

## Phase 3: User Story 1 — Bruno (Priority: P1) 🎯 MVP

**Goal**: Bruno varre faturas D-3/D-1 diariamente, gera Pix dinâmico no Asaas do provedor, envia template WhatsApp com QR Code via Júlia, respeita janela horária + opt-out, é idempotente.

**Independent Test**: Configurar provider de teste com Asaas sandbox key + 1 fatura vencendo em 3 dias + 1 customer com opt-in WhatsApp. Rodar Bruno scheduler manualmente. Verificar: (a) Pix criado no Asaas sandbox, (b) WhatsApp recebido com QR Code, (c) audit_logs grava decisão Júlia + envio, (d) re-rodar scheduler no mesmo dia NÃO duplica.

### Bruno Agent + Prompt + Tool

- [x] T020 [P] [US1] `server/prompts/bruno.md` criado com frontmatter (`agent_id: agt_preventivo_v1`, `modelo: claude-haiku-4-5-20251001`) e System Prompt em pt-BR (persona, regras de comunicação, output JSON estruturado, few-shot D-3). `prompt-loader.ts` estendido para aceitar `bruno|sofia`.
- [x] T021 [P] [US1] `server/agents/tools/gerar-pix-bruno.ts` criado: `gerarPixBrunoTool` (schema JSON) + `executeGerarPixBruno(ctx, args)` com multi-tenant gate (invoice+customer×providerId), idempotência defensiva via `byInvoiceAndDay`, chamada a `createPixForInvoice`.
- [x] T022 [US1] `server/agents/bruno.ts` criado: `invokeBruno(tenantId, input, options)` com loop max 3 turnos, prompt caching (`cache_control: ephemeral` no system + templates), extração + validação de JSON output, reconstrução defensiva de `pix` se modelo omitir após tool_use bem-sucedido.

### HSM Template draft

- [x] T023 [P] [US1] `drafts/template-lembrete-prevencimento-v1.json` criado: payload Meta Business Manager (UTILITY, pt_BR, header IMAGE QR, body com 3 variáveis, footer assinatura), instruções de submissão embutidas via `_instructions` array + corpo alternativo se Meta rejeitar IMAGE.

### Scheduler + Worker

- [x] T024 [US1] `server/workers/bruno-scheduler.ts` criado: tick horário (sem `node-cron` — `setInterval` + `Intl.DateTimeFormat` para TZ por UF), filtra providers com `brunoAtivo=true` cuja `schedulerHoraLocal` casa com hora local atual, varre faturas D-3/D-1 não pagas, exclui opt-outs, reserva via `tryReserve`, enfileira na queue `bruno-process-invoice`. `server/lib/queue.ts` criado como helper compartilhado (lazy Redis + queue factory + `OUTBOUND_JOB_DEFAULTS`).
- [x] T025 [US1] `server/workers/bruno-process-invoice.ts` criado: BullMQ Worker (concurrency 5) que faz todo o fluxo — load multi-tenant, skipped_paid, opt-out check, janela horária (com `nextWindowOpenUtc` que respeita sábado/domingo), `invokeBruno`, `invokeJulia` (proposedAction com renderedBody), `createMetaClient.sendTemplate(params)`, persist `communications` + `markSent`, audit completo em cada step.
- [x] T026 [P] [US1] `server/workers/outbound-retry.ts` criado: tick 15min, `selectForRetry` → re-enfileira Bruno (Sofia placeholder até Phase 4); promove para `needs_human_review` após `attemptCount >= 2` com audit `outbound_needs_review`.
- [x] T027 [US1] `server/worker.ts` atualizado: importação dinâmica de `startBrunoScheduler`/`startBrunoWorker`/`startOutboundRetry` guarded por `REDIS_URL` (degrada limpo se Redis ausente); shutdown hook fecha worker + queue connections.

### Audit + Testes

- [x] T028 [US1] `server/agents/audit-actions.ts` criado como helper centralizado: `BRUNO_AUDIT_ACTIONS`, `SOFIA_AUDIT_ACTIONS`, `WEBHOOK_AUDIT_ACTIONS`, `OUTBOUND_RETRY_AUDIT_ACTIONS` (cada uma com `legalBasis` + `legalReferences` default) + `auditAction(name)` builder. `bruno-process-invoice.ts` e `outbound-retry.ts` refatorados para usar o helper (zero strings inline).
- [x] T029 [US1] `server/workers/bruno-process-invoice.test.ts` criado (vitest, Postgres real, mocks Anthropic/Júlia/Meta via `vi.mock`): 8 testes cobrindo skipped_paid, skipped_optout, waiting_window, bruno_disabled, happy_path, julia_blocked, meta_fail, bruno_failed. Skipa quando `DATABASE_URL` ausente (validado: typecheck verde, 8/8 skipped no run local sem DB). Idempotência dupla agenda já é coberta em `multi-tenant-pix.test.ts` (T018).

**Checkpoint US1**: Bruno funcional, testado, idempotente. **MVP entregável aqui** — provedor já reduz inadimplência D+0 sem precisar de Sofia/painel.

---

## Phase 4: User Story 2 — Sofia (Priority: P2)

**Goal**: Webhook Asaas confirmado → Sofia compõe agradecimento personalizado dentro de template HSM aprovado → Júlia valida → envia via WhatsApp em <5min. Idempotente por payment_id.

**Independent Test**: Disparar webhook Asaas simulado (curl com payload PAYMENT_RECEIVED) → verificar Sofia envia mensagem em <5min; reprocessar mesmo webhook → não duplica.

### Sofia Agent + Prompt

- [ ] T030 [P] [US2] Criar `server/prompts/sofia.md` com system prompt pt-BR conforme `contracts/sofia-direct-api.contract.md`. Tom cordial, sem upsell, sem pedir nada em troca.
- [ ] T031 [P] [US2] Criar `server/agents/tools/consultar-memoria-cliente.ts` (read-only) exportando schema + executor que faz lookup em `agent_memories` (Spec 003) por (customerId, agentId='sofia_v1' ou herdar de helena).
- [ ] T032 [US2] Criar `server/agents/sofia.ts` exportando `invokeSofia(tenantId, input)`. Estrutura idêntica à Bruno: prompt-loader, Anthropic SDK, output JSON validado. Diferente: tool é só `consultar_memoria_cliente`, output não inclui `pix`.

### HSM Template Sofia

- [ ] T033 [P] [US2] Criar `specs/004-cobranca-pix-bruno-sofia/drafts/template-agradecimento-pagamento-v1.json` para submissão Meta Business Manager. Categoria UTILITY, idioma `pt_BR`, body com `{{1}}=nome_cliente`, `{{2}}=valor`, `{{3}}=data_pagamento`. Sem header (texto puro).

### Webhook Asaas

- [ ] T034 [US2] Criar handler em `server/routes/webhook.routes.ts` (ADD novo, NÃO modifica handlers Meta existentes da Spec 003): `POST /webhooks/asaas`.
  1. Parse JSON.
  2. Extrair `externalReference` → `parseProviderRefId(ref)` retorna `{providerId, invoiceId, attemptId}`.
  3. Load `asaas_accounts` pelo providerId.
  4. Validar `req.headers['asaas-access-token']` === `decrypt(webhookTokenEncrypted)` via `crypto.timingSafeEqual`. Falha → 401 + audit log `webhook_auth_failed`.
  5. `payment-event.insertOrSkip(...)` retorna `{inserted, eventId}`.
  6. Se NÃO inserted (duplicate) → 200 imediato + audit `webhook_duplicate`.
  7. Se inserted: atualizar `pix_charges.status` conforme `eventType`, atualizar `invoices.status` se `PAYMENT_RECEIVED`, e se `eventType IN ('PAYMENT_RECEIVED','PAYMENT_CONFIRMED')` AND `agent_toggles.sofia_ativa` → enfileirar job "sofia-thank" `{providerId, paymentEventId, customerId, invoiceId, value, paidAt}`.
  8. Responder 200 imediato.
- [ ] T035 [US2] Helper `server/services/asaas-multi-tenant.ts`: adicionar `parseExternalReference(ref): { providerId, invoiceId, attemptId } | null` com regex `^provider:(\d+):invoice:(\d+):attempt:(\d+)$`.

### Sofia Worker

- [ ] T036 [US2] Criar `server/workers/sofia-event-processor.ts` (BullMQ consumer queue `sofia-thank`):
  1. Carrega customer + provider + agent_toggles.
  2. Verifica `whatsapp_optouts` — match → skip + audit `sofia_skipped_optout`, return.
  3. Verifica janela horária — fora → enfileira novamente com delay até próxima abertura.
  4. Chama `invokeSofia(providerId, input)` → recebe `{templateName, variables, freeFormText}`.
  5. Cria `outbound_attempts` row com `step='THANK_YOU', status='awaiting_compliance'`.
  6. Chama `invokeJulia(providerId, { proposedAction })`.
  7. Aprovado → `metaWhatsappClient.sendTemplate(...)` (ou free-form se janela 24h ativa) → cria `communications` row + `markSent`. Audit `sofia_send_thanks`.
  8. Veto → `markVetoed` + audit.
- [ ] T037 [US2] Integrar `startSofiaEventProcessor()` em `server/worker.ts`.

### Audit + Testes

- [ ] T038 [US2] Adicionar action types Sofia em audit helper: `sofia_send_thanks`, `sofia_skipped_optout`, `sofia_skipped_window`, `sofia_blocked_julia`, `webhook_auth_failed`, `webhook_duplicate`, `webhook_processed`.
- [ ] T039 [US2] Criar `server/routes/webhook.routes.test.ts` (sobrescreve/incrementa se já existe Spec 003):
  - POST /webhooks/asaas com header válido + payload PAYMENT_RECEIVED → 200 + `payment_events` inserido + job enfileirado.
  - Mesmo payload reenviado → 200 + `payment_events` duplicate (1 row) + NENHUM job novo.
  - Header inválido → 401 + audit_log entry.
  - `externalReference` malformado → 400.
- [ ] T040 [US2] Criar `server/workers/sofia-event-processor.test.ts`:
  - Caso feliz → `communications` row criada, audit completo, latência < 5min simulado.
  - Caso opt-out → skip.
  - Caso Júlia veto → markVetoed sem envio.
  - Caso webhook duplicado disparou job (defensive double-check) → idempotência segunda camada.

**Checkpoint US2**: Sofia funcional. Régua completa de marca (Bruno → pagamento → Sofia) operacional sem painel.

---

## Phase 5: User Story 3 — Painel + Configurações + Dossiê (Priority: P3)

**Goal**: Admin do provedor consegue (1) conectar chave Asaas, (2) ativar/desativar Bruno e Sofia, (3) ver painel da régua, (4) gerar dossiê de auditoria por cliente.

**Independent Test**: Como admin: conectar chave Asaas sandbox via UI; toggle Bruno ON; ver painel com fatura agendada D-3; gerar dossiê PDF de 90 dias para 1 customer e verificar conteúdo (comunicações + compliance + pix + audit).

### Backend Routes

- [ ] T041 [P] [US3] Criar `server/routes/asaas-config.routes.ts` com `GET /api/asaas/account`, `POST /api/asaas/account` (valida chave via Asaas `/myAccount`, detecta `mode`, cifra, salva), `DELETE /api/asaas/account`. Middlewares `requireAuth` + `requireAdmin`. Rate-limit 5/15min em POST.
- [ ] T042 [P] [US3] Criar `server/routes/regua.routes.ts` com `GET /api/regua/pre-vencimento` (filtros `from/to/status/step/page/limit`), `GET /api/regua/agente-config` (cria default se não existe), `PATCH /api/regua/agente-config` (atualiza + audit + cancela jobs BullMQ pendentes se desativa Bruno).
- [ ] T043 [P] [US3] Criar `server/routes/dossie.routes.ts` com `GET /api/dossie/cliente/:customerId` query `from`, `to`, `format=pdf|json`. Multi-tenant gate (`customer.providerId === req.session.providerId`).
- [ ] T044 [US3] Criar `server/services/dossie-builder.ts` exportando `buildDossie(providerId, customerId, from, to): DossieData` que faz 6 SELECTs paralelos via storages (Promise.all). Helper `renderDossiePdf(data): Buffer` usando `pdfkit` (já no projeto).
- [ ] T045 [US3] Registrar as 3 novas rotas em `server/routes/index.ts`.

### Frontend Pages

- [ ] T046 [P] [US3] Criar `client/src/pages/configuracoes-asaas.tsx`: form de conexão (input chave + token webhook + botão "Testar e salvar"), status badge (`connected/mode/lastUsedAt`), botão "Desconectar". Usa `useAsaasAccount` hook.
- [ ] T047 [P] [US3] Criar `client/src/pages/configuracoes-agentes.tsx`: 2 toggles (Bruno + Sofia), TimePicker para `schedulerHoraLocal`, `janelaInicio`, `janelaFim`, checkbox `permiteSabado/Domingo`, select para templates. Usa `useAgentToggles` hook.
- [ ] T048 [P] [US3] Criar `client/src/pages/regua-pre-vencimento.tsx`: tabela paginada com colunas (cliente, valor, vencimento, step, status Pix, status envio, ações). Filtros: data, status, step. Badge colorida por status. Usa `useReguaPreVencimento`.
- [ ] T049 [P] [US3] Criar `client/src/pages/cliente-dossie.tsx` (ou botão dentro de `clientes/[id].tsx` existente): seletor `from/to`, botões "Baixar PDF" + "Baixar JSON". Usa `useDossie`.

### Frontend Hooks (TanStack Query)

- [ ] T050 [P] [US3] Criar `client/src/hooks/use-asaas-account.ts` com `useAsaasAccount()` (GET) + `useConnectAsaas()` (POST mutation) + `useDisconnectAsaas()` (DELETE mutation). Invalida cache pertinente.
- [ ] T051 [P] [US3] Criar `client/src/hooks/use-agent-toggles.ts` com `useAgentToggles()` + `useUpdateAgentToggles()`.
- [ ] T052 [P] [US3] Criar `client/src/hooks/use-regua-pre-vencimento.ts` com `useReguaPreVencimento(filters)`.
- [ ] T053 [P] [US3] Criar `client/src/hooks/use-dossie.ts` com `useDossie(customerId, from, to, format)` retornando blob para download.

### Componentes shadcn + Routing

- [ ] T054 [P] [US3] Criar componentes auxiliares: `client/src/components/regua/PixStatusBadge.tsx`, `client/src/components/regua/EnvioStatusBadge.tsx`, `client/src/components/dossie/DossieExportButton.tsx`. Cores conforme padrão shadcn.
- [ ] T055 [US3] Adicionar 4 rotas em `client/src/App.tsx` (Wouter): `/configuracoes/asaas`, `/configuracoes/agentes`, `/regua-pre-vencimento`, e botão dossiê no perfil cliente existente. Atualizar `client/src/components/app-sidebar.tsx` com novos itens de menu agrupados em "Cobrança".

### Testes E2E backend

- [ ] T056 [US3] Criar `server/routes/asaas-config.routes.test.ts`: connect com chave fake → mock Asaas `/myAccount` → 201; chave inválida → 400; multi-tenant (provider B nunca vê chave de A).
- [ ] T057 [US3] Criar `server/routes/dossie.routes.test.ts`: gerar dossiê 12 meses (com seed de comunicações + audit_logs) → SC-006 medido (<30s); multi-tenant gate (admin de B tentando GET cliente de A → 404).

**Checkpoint US3**: Admin tem visibilidade + controle + defesa jurídica. Pronto pra vender plano pago.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T058 [P] Atualizar `quickstart.md` com qualquer ajuste descoberto na implementação (env vars, sequência real, smoke test).
- [ ] T059 [P] Rodar `npm run check` (TypeScript) e corrigir erros novos. **Zero warnings novos**.
- [ ] T060 [P] Adicionar entrada no `CHANGELOG.md` (se existir) ou criar uma seção em `docs/spec-004-changelog.md` com summary de 5 linhas.
- [ ] T061 Smoke test em Vertical Fibra (produção): conectar chave Asaas real, ativar Bruno + Sofia para 1 cliente teste do owner, gerar 1 fatura D-3 manual, verificar fluxo completo. Documentar resultado em `specs/004-cobranca-pix-bruno-sofia/SMOKE-TEST-RESULT.md`.
- [ ] T062 Submeter 2 templates HSM (`lembrete_prevencimento_v1`, `agradecimento_pagamento_v1`) no Meta Business Manager do Vertical Fibra. Aguardar aprovação (~24-72h). Atualizar `agent_toggles.templateBrunoNome` e `templateSofiaNome` no provider Vertical Fibra após aprovação.
- [ ] T063 Validar SC-005 (zero duplicatas Sofia) com logs reais durante 1 semana de smoke test. Anotar em SMOKE-TEST-RESULT.md.
- [ ] T064 Deploy em VPS Hostinger seguindo runbook (push main → SSH → pull → build → restart). Validar fluxos da Spec 003 não regrediram (Helena + Júlia continuam respondendo WhatsApp).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: imediato.
- **Phase 2 (Foundational)**: depende de Phase 1. **BLOQUEIA** US1, US2, US3.
- **Phase 3 (US1 Bruno)**: depende de Phase 2.
- **Phase 4 (US2 Sofia)**: depende de Phase 2. Independente de US1 — **pode ser paralelo se tiver dev livre**, mas atenção: integration tests de Sofia precisam que `pix_charges` exista (Phase 2 já cobre).
- **Phase 5 (US3 Painel)**: depende de Phase 2; **se trabalhado isolado**, painel mostra vazio até US1/US2 popularem dados — mas é testável (queries retornam vazio corretamente).
- **Phase 6 (Polish)**: depende de US1 + US2 + US3 + autorização templates HSM Meta.

### User Story Independence

- **US1 (Bruno)** entrega valor real isoladamente: provedor já reduz inadimplência D+0. Painel manual via `psql` aceitável no MVP.
- **US2 (Sofia)** depende de pagamentos chegando (em produção, Bruno gera o tráfego; em teste, mock webhook funciona).
- **US3 (Painel)** entrega visibilidade. Independente — pode ser construído em paralelo com US1/US2 por outro dev.

### Within Each User Story

- Prompt + tool + agente antes do worker.
- Worker antes de integrar em `server/worker.ts`.
- Routes antes das pages.
- Hooks antes de componentes.
- Tests por último dentro de cada bloco (constituição não exige TDD, mas exige testes para áreas críticas — multi-tenant + idempotência).

### Parallel Opportunities

- **Phase 1**: T002, T003 paralelos.
- **Phase 2**: T010-T014 (5 storages) paralelos depois de T005 (schema merge). T016 e T017 sequenciais. T018 (multi-tenant test) começa após T015 + T017.
- **Phase 3 (US1)**: T020 (prompt), T021 (tool), T023 (HSM draft), T026 (retry worker) paralelos. T022 (bruno agent) depende de T020+T021. T024 (scheduler) e T025 (worker) sequenciais. T029 (testes) por último.
- **Phase 4 (US2)**: T030, T031, T033 paralelos. T032 depende de T030+T031.
- **Phase 5 (US3)**: T041, T042, T043 paralelos (routes); T046-T049 paralelos (pages); T050-T053 paralelos (hooks); T054 paralelo. T055 (wiring) e T044 (dossie builder) sequenciais com suas dependências.

---

## Parallel Example: User Story 1

```bash
# Após Phase 2 completa, dispare em paralelo:
Task: "T020 [US1] Bruno prompt em server/prompts/bruno.md"
Task: "T021 [US1] gerar-pix-bruno tool em server/agents/tools/gerar-pix-bruno.ts"
Task: "T023 [US1] HSM template draft em specs/.../drafts/template-lembrete-prevencimento-v1.json"
Task: "T026 [US1] outbound-retry worker em server/workers/outbound-retry.ts"

# Aguarde os 4 acima, depois:
Task: "T022 [US1] invokeBruno em server/agents/bruno.ts"

# Em sequência (cada um usa o anterior):
Task: "T024 [US1] bruno-scheduler"
Task: "T025 [US1] bruno-process-invoice consumer"
Task: "T027 [US1] integrar em server/worker.ts"
Task: "T028 [US1] action types audit"
Task: "T029 [US1] integration tests"
```

---

## Implementation Strategy

### MVP First (User Story 1 apenas)

1. Phase 1 Setup (1 dia).
2. Phase 2 Foundational (3 dias).
3. Phase 3 US1 Bruno (3 dias).
4. **STOP + VALIDATE**: smoke test em Vertical Fibra com 3 faturas reais.
5. Submeter templates HSM Meta (T062) em paralelo desde dia 1 para já estarem aprovados.
6. Deploy MVP.

### Incremental Delivery

1. Setup + Foundational → base pronta.
2. US1 Bruno → smoke test → deploy (MVP, R$ 249/mês).
3. US2 Sofia → smoke test → deploy (NPS boost, Standalone Profissional).
4. US3 Painel → smoke test → deploy (defesa jurídica + selling point).
5. Polish + dossiê analytics.

### Parallel Team Strategy

Com 2 devs paralelos:

1. Ambos rodam Phase 1+2 juntos.
2. Dev A começa US1 Bruno (scheduler + worker).
3. Dev B começa US3 Painel (routes + hooks) — pode trabalhar contra dados mock até US1 popular.
4. Quando US1 sair, Dev A pega US2 Sofia (webhook + worker).
5. Dev B termina UI + finaliza Phase 6.

**Total estimado**: 14 dias-dev solo / 7-8 dias com 2 devs paralelos.

---

## Notas

- `[P]` = arquivos diferentes, sem dependências incompletas.
- `[USx]` rastreia origem na user story (spec.md).
- Cada US é independentemente testável — Bruno funciona sozinho (MVP), Sofia também funciona sozinho contra webhook mock, painel funciona vazio.
- **Commit por task** ou bloco lógico (max 2-3 tasks por commit). Mensagem prefixo `feat(spec004): <task-id> <descrição curta>`.
- **Multi-tenant**: toda function de storage recebe `providerId` como 1º parâmetro. Toda query filtra. Toda invocação de agente recebe `tenantId`. Sem exceção.
- **Crypto**: `ENCRYPTION_MASTER_KEY` é a mesma da Spec 003. Reutilizar helper.
- **Stop conditions**: regressão em Spec 003 (Helena/Júlia/WhatsApp) ou falha em `multi-tenant-pix.test.ts` → parar, investigar, reverter se necessário.
