# Quickstart — Spec 004 Implementation

**Phase**: 1 (Design output)
**Audience:** dev implementando

## Sequência de Implementação Recomendada

### 0. Autorização (✅ resolvida)
- Owner autorizou em 2026-05-11 as 5 tabelas novas: `asaas_accounts`, `pix_charges`, `payment_events`, `agent_toggles`, `outbound_attempts`.
- Registro em memória: `project_schema_authorization_spec004.md`.

### 1. Schema + Migrations (1 dia)
- Mesclar `drafts/schemas-drizzle.ts` em `shared/schema.ts` (após autorização).
- Adicionar Zod insert schemas + types exportados.
- Migration SQL `0XX_spec004_add_tables.sql` (5 tabelas + índices, incluindo o expression UNIQUE em `outbound_attempts`).
- `npm run db:push` em dev, validar com `psql`.
- Backfill `agent_toggles` com defaults OFF para providers existentes.
- Teste obrigatório `multi-tenant-pix.test.ts`.

### 2. Refator Asaas Multi-Tenant (1 dia)
- Refatorar `server/services/asaas.ts`: extrair `asaasRequest(apiKey, method, path, body)` recebendo `apiKey` como parâmetro.
- Manter wrapper legado que lê `process.env.ASAAS_API_KEY` para `creditOrders` (não quebrar fluxo SaaS atual).
- Novo `server/services/asaas-multi-tenant.ts`: decifra chave do provedor + injeta + cria Pix dinâmico + busca QR Code.
- Função `createPixForInvoice(providerId, invoiceId, attemptId)` que retorna `{asaasPaymentId, qrCodeBase64, copyPaste}`.

### 3. Storage Layer (1 dia)
- 5 novos arquivos em `server/storage/`: `asaas-account`, `pix-charge`, `payment-event`, `agent-toggle`, `outbound-attempt`.
- Todas as funções recebem `providerId` como 1º parâmetro.
- Helpers crítos: `pix-charge.upsertByAsaasId()`, `payment-event.insertOrSkip()` (idempotente), `outbound-attempt.tryReserve(invoiceId, step)` (atomic insert ou throw).

### 4. Bruno Agent + Tool (2 dias)
- `server/prompts/bruno.md` — system prompt.
- `server/agents/bruno.ts` — `invokeBruno(tenantId, input) → { templateName, variables, pix }`.
- `server/agents/tools/gerar-pix-bruno.ts` — tool TS que chama `asaas-multi-tenant.createPixForInvoice`.
- Testes unitários com mock Anthropic + mock Asaas.

### 5. Sofia Agent (1 dia)
- `server/prompts/sofia.md`.
- `server/agents/sofia.ts` — invokeSofia().
- Sofia consulta `agent_memories` via storage (Spec 003).

### 6. Workers (2 dias)
- `server/workers/bruno-scheduler.ts` — cron diário por tenant (`node-cron` ou similar leve, dentro de `server/worker.ts`).
- `server/workers/sofia-event-processor.ts` — BullMQ consumer da fila "sofia-thank".
- `server/workers/outbound-retry.ts` — cron 15min para `failed → retry` (FR-020).
- Integrar `server/worker.ts` para iniciar todos.

### 7. Webhook + Routes Asaas (1 dia)
- `server/routes/webhook.routes.ts` ADD `POST /webhooks/asaas` (signature check + enqueue + 200).
- `server/routes/asaas-config.routes.ts` — CRUD da chave Asaas.
- `server/routes/regua.routes.ts` — GET painel + PATCH toggles.
- `server/routes/dossie.routes.ts` — GET dossiê PDF/JSON.

### 8. UI (3 dias)
- `client/src/pages/configuracoes-asaas.tsx` — conectar chave Asaas + status.
- `client/src/pages/configuracoes-agentes.tsx` — toggles Bruno/Sofia + horários.
- `client/src/pages/regua-pre-vencimento.tsx` — tabela com filtros, status badges.
- `client/src/pages/cliente-dossie.tsx` — botão "Gerar dossiê" no perfil do cliente.
- Hooks TanStack Query: `useAsaasAccount`, `useAgentToggles`, `useReguaPreVencimento`, `useDossie`.

### 9. Templates HSM Meta (paralelo, ~3 dias úteis aprovação)
- Submeter 2 templates UTILITY no Business Manager do Vertical Fibra:
  - `lembrete_prevencimento_v1` com componente IMAGE
  - `agradecimento_pagamento_v1` somente texto
- Rascunhos JSON em `drafts/`.

### 10. Testes E2E (2 dias)
- ngrok → Asaas sandbox → criar Pix → confirmar pagamento → ver Sofia disparar.
- Smoke test no Vertical Fibra com 3 faturas reais + 1 pagamento real (cliente teste).
- Verificar dossiê de auditoria contém: Bruno send + Júlia decision + Pix charge + payment event + Sofia send.

**Total estimado:** ~14 dias-dev (solo) ou 7-8 dias com 2 devs paralelos.

## Variáveis de Ambiente Necessárias

```env
# Já existentes (Spec 003)
ANTHROPIC_API_KEY=sk-ant-...
ENCRYPTION_MASTER_KEY=...               # mesma usada por whatsapp_accounts
REDIS_URL=redis://localhost:6379
DATABASE_URL=...

# Asaas (NOVO uso)
# A chave global ASAAS_API_KEY continua existindo SÓ para creditOrders da plataforma.
# Cada tenant cadastra sua própria chave via UI — armazenada cifrada em asaas_accounts.
ASAAS_API_KEY=...                       # MANTIDO (plataforma SaaS->provedor)
```

## Critérios de Aceitação Pré-GA

- [x] Owner autorizou as 5 tabelas (Princípio II) — 2026-05-11
- [ ] `multi-tenant-pix.test.ts` passa: tenant A nunca gera Pix na conta de B
- [ ] Bruno gera Pix correto no Asaas sandbox e mensagem chega no WhatsApp de teste
- [ ] Re-rodar scheduler no mesmo dia NÃO duplica Pix (idempotência FR-005)
- [ ] Webhook Asaas duplicado NÃO dispara Sofia duas vezes (FR-008)
- [ ] Mensagem fora de 08:00–20:00 fica em `waiting_window`, não envia
- [ ] Cliente em opt-out (`whatsapp_optouts`) é excluído da régua
- [ ] Dossiê de 12 meses gerado em <30s para cliente com 50+ comunicações
- [ ] Toggle "Bruno OFF" para o provider e Bruno não dispara
- [ ] `npm run check` sem erros novos
- [ ] Smoke test em produção Vertical Fibra sem regressão em fluxos da Spec 003

## Próximos Comandos

```bash
# Phase 2 — gerar tasks.md
/speckit-tasks

# Após tasks.md aprovado — implementação paralela
# (dispatch agents para steps 1-10 em paralelo quando possível)
```
