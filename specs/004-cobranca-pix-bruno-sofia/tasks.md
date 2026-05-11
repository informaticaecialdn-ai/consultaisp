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

- [x] T030 [P] [US2] `server/prompts/sofia.md` criado: persona cordial sem upsell, regras de tom (curto, não menciona próxima fatura), output JSON (templateName + variables + freeFormText opcional). `agent_id: agt_relacionamento_v1`, modelo Haiku 4.5.
- [x] T031 [P] [US2] `server/agents/tools/consultar-memoria-cliente.ts` criado: read-only com multi-tenant gate (customer × provider) + cross-customer guard (expectedCustomerId). Cross-agent lookup em `agent_memories`.
- [x] T032 [US2] `server/agents/sofia.ts` criado: `invokeSofia(tenantId, input, options)`, loop max 3 turnos, prompt caching, temperature 0.1 (leve criatividade pro freeFormText), parse+validate JSON output. Tool opcional `consultar_memoria_cliente` (Sofia normalmente não chama — memoryFacts vem no input).

### HSM Template Sofia

- [x] T033 [P] [US2] `drafts/template-agradecimento-pagamento-v1.json` criado: UTILITY, pt_BR, body texto puro com 3 variáveis, footer assinatura Provedor.ai. Tom cordial e curto — sem upsell.

### Webhook Asaas

- [x] T034 [US2] `server/routes/webhook.routes.ts` criado com `POST /webhooks/asaas`: parse externalRef, auth via `crypto.timingSafeEqual` contra `webhook_token_encrypted` decifrado, `insertOrSkip` em `payment_events` (idempotência FR-008), update de `pix_charges.status` por evento, update `invoices.status='paid'` em `PAYMENT_RECEIVED/CONFIRMED`, enfileiramento de job `sofia-thank` quando `agent_toggles.sofiaAtiva=true`. Audit para cada caminho (`webhook_processed`, `webhook_duplicate`, `webhook_auth_failed`). Registrado em `server/routes/index.ts`.
- [x] T035 [US2] ✓ já implementado em T017 (Phase 2): `parseExternalReference` e `buildExternalRef` em `server/services/asaas-multi-tenant.ts` com regex `^provider:(\d+):invoice:(\d+):attempt:(\d+)$`.

### Sofia Worker

- [x] T036 [US2] `server/workers/sofia-event-processor.ts` criado: BullMQ Worker (concurrency 5) com fluxo opt-out → janela horária (delay re-enqueue) → tryReserve step='THANK_YOU' → invokeSofia → invokeJulia → Meta sendTemplate (ou sendText se isWithin24hWindow) → persist comunicação + markSent + audit. Veto e falha Meta tratados com markVetoed/markFailed.
- [x] T037 [US2] `server/worker.ts` atualizado: `startSofiaEventProcessor` integrado junto com Bruno/retry sob guard `REDIS_URL`. Shutdown fecha worker Sofia também.

### Audit + Testes

- [x] T038 [US2] ✓ já antecipado em T028: `SOFIA_AUDIT_ACTIONS` + `WEBHOOK_AUDIT_ACTIONS` em `server/agents/audit-actions.ts` cobrem `sofia_send_thanks`, `sofia_skipped_optout`, `sofia_skipped_window`, `sofia_blocked_julia`, `webhook_processed`, `webhook_duplicate`, `webhook_auth_failed`. Worker Sofia e webhook handler consomem via `auditAction(name)`.
- [x] T039 [US2] `server/routes/webhook.routes.test.ts` criado: 5 testes via supertest (200 token válido + payment_events inserido + sofia job enfileirado, duplicate idempotência, 401 token inválido + audit, 400 externalRef malformado, PAYMENT_RECEIVED dispara pix_charges→paid). Mocka apenas `getQueue` para não rodar BullMQ real.
- [x] T040 [US2] `server/workers/sofia-event-processor.test.ts` criado: 5 testes (happy_path, opt_out, julia_blocked, sofia_disabled, sofia_failed). Mocka Sofia/Júlia/Meta/queue. Idempotência defensiva já é coberta pelo webhook handler (T039) — duplicate webhook não enfileira novo job.

**Checkpoint US2**: Sofia funcional. Régua completa de marca (Bruno → pagamento → Sofia) operacional sem painel.

---

## Phase 5: User Story 3 — Painel + Configurações + Dossiê (Priority: P3)

**Goal**: Admin do provedor consegue (1) conectar chave Asaas, (2) ativar/desativar Bruno e Sofia, (3) ver painel da régua, (4) gerar dossiê de auditoria por cliente.

**Independent Test**: Como admin: conectar chave Asaas sandbox via UI; toggle Bruno ON; ver painel com fatura agendada D-3; gerar dossiê PDF de 90 dias para 1 customer e verificar conteúdo (comunicações + compliance + pix + audit).

### Backend Routes

- [x] T041 [P] [US3] `server/routes/asaas-config.routes.ts` criado: GET status, POST connect (Zod validate + Asaas /myAccount + detecta mode + AES-256-GCM via storage), DELETE disconnect (markRevoked + auto-suspende brunoAtivo). Rate-limit 5/15min in-memory. Audit completo.
- [x] T042 [P] [US3] `server/routes/regua.routes.ts` criado: GET /api/regua/pre-vencimento com paginação + filtros (from/to/step/status), join batch de customer+invoice+pix. GET + PATCH /api/regua/agente-config com Zod validate, audit, normalização HH:MM:SS.
- [x] T043 [P] [US3] `server/routes/dossie.routes.ts` criado: GET /api/dossie/cliente/:customerId com format=pdf|json. Multi-tenant gate em buildDossie. Audit do próprio dossiê (LGPD).
- [x] T044 [US3] `server/services/dossie-builder.ts` criado: buildDossie com 6 SELECTs paralelos (Promise.all) + multi-tenant gate. renderDossiePdf com pdfkit streaming: cabeçalho provider, resumo executivo, compliance checks, comunicações, pix charges, audit timeline, declaração legal.
- [x] T045 [US3] 3 rotas registradas em `server/routes/index.ts` (registerAsaasConfigRoutes + registerReguaRoutes + registerDossieRoutes).

### Frontend Pages

- [x] T046 [P] [US3] `client/src/pages/provedor/configuracoes-asaas.tsx` criado: form chave+webhook token, badge sandbox/produção, status accountStatus, lastUsedAt, botão Desconectar com confirmação.
- [x] T047 [P] [US3] `client/src/pages/provedor/configuracoes-agentes.tsx` criado: 2 Switches (Bruno/Sofia), 3 TimePickers (scheduler/janelaInicio/janelaFim), 2 Checkboxes (sábado/domingo), 2 Inputs (templates Meta), Save com feedback success/error.
- [x] T048 [P] [US3] `client/src/pages/provedor/regua-pre-vencimento.tsx` criado: tabela paginada Cliente/Valor/Vencimento/Passo/Pix/Envio/Tentativas/Agendado. Filtros from/to/step/status. Paginação prev/next.
- [x] T049 [P] [US3] `client/src/pages/provedor/cliente-dossie.tsx` criado: seletor from/to (default 12 meses), 2 botões DossieExportButton (PDF + JSON). Card de integridade jurídica explicando audit_logs imutável.

### Frontend Hooks (TanStack Query)

- [x] T050 [P] [US3] `client/src/hooks/use-asaas-account.ts` — useAsaasAccount/useConnectAsaas/useDisconnectAsaas com TanStack Query + invalidação.
- [x] T051 [P] [US3] `client/src/hooks/use-agent-toggles.ts` — useAgentToggles/useUpdateAgentToggles.
- [x] T052 [P] [US3] `client/src/hooks/use-regua-pre-vencimento.ts` — useReguaPreVencimento(filters) com queryString construído.
- [x] T053 [P] [US3] `client/src/hooks/use-dossie.ts` — useDossie() mutation que faz blob download para PDF + retorna JSON para format=json.

### Componentes shadcn + Routing

- [x] T054 [P] [US3] PixStatusBadge + EnvioStatusBadge (mapas variant + label pt-BR) + DossieExportButton (com loading state e error feedback).
- [x] T055 [US3] 4 rotas adicionadas em App.tsx (/configuracoes/asaas, /configuracoes/agentes, /regua-pre-vencimento, /cliente/:customerId/dossie). app-sidebar: novo grupo "Cobrança" com 3 itens (Régua/Configurar Agentes/Conexão Asaas).

### Testes E2E backend

- [x] T056 [US3] `server/routes/asaas-config.routes.test.ts` — 6 testes via supertest (GET vazio, POST válido, POST inválido 400, POST webhookToken curto 422, multi-tenant isolation, DELETE auto-suspend Bruno).
- [x] T057 [US3] `server/routes/dossie.routes.test.ts` — 6 testes (JSON OK, PDF binário com %PDF, multi-tenant 404, invalid customerId 400, from>to 400, performance SC-006 <30s).

**Checkpoint US3**: Admin tem visibilidade + controle + defesa jurídica. Pronto pra vender plano pago.

---

## Phase 6: Polish & Cross-Cutting

- [x] T058 [P] `specs/004-cobranca-pix-bruno-sofia/quickstart.md` reescrito: status real das phases, env vars verificados, sequência de deploy VPS, endpoints implementados, decisões registradas.
- [x] T059 [P] `npx tsc --noEmit` rodado — zero erros nos arquivos da Spec 004 (203 erros pré-existentes em outras áreas do projeto, sem regressão introduzida).
- [x] T060 [P] `docs/spec-004-changelog.md` criado: resumo 5 linhas, componentes entregues por camada, 43 testes registrados, 1 dep nova (pdfkit), decisões arquiteturais.
- [x] T061 `specs/004-cobranca-pix-bruno-sofia/SMOKE-TEST-RESULT.md` criado: runbook 11 etapas (config Asaas → fatura D-3 → trigger scheduler → validar Bruno → idempotência → simular webhook → Sofia → idempotência → dossiê PDF → regressão Spec 003). Inclui template de resultado em tabela + queries de validação.
- [x] T062 `specs/004-cobranca-pix-bruno-sofia/HSM-SUBMISSION.md` criado: passo-a-passo Meta Business Manager UI, payload dos 2 templates, fallback se Meta rejeitar IMAGE, atualização agent_toggles pós-aprovação, custo estimado Meta.
- [x] T063 Plano SC-005 monitoring incluído no SMOKE-TEST-RESULT.md: 2 queries SQL canônicas (duplicatas em payment_events + comunicações Sofia 2x mesmo dia), preenchido após 1 semana real.
- [x] T064 `docs/spec-004-deploy.md` criado: 9 passos VPS Hostinger (push → backup → pull → build → migrate → env → restart → smoke → regressão), atalho 1-linha, rollback, checklist pós-deploy, 5 queries de monitoramento primeira semana.

**Notas Phase 6:**
- T061-T063: documentação pronta — execução é operacional (owner faz no smoke test real)
- T064: runbook pronto — execução é operacional (owner faz no deploy)
- Spec 004 está code-complete; Phase 6 deixou tudo pronto para execução em produção

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
