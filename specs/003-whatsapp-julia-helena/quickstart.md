# Quickstart — Spec 003 Implementation

**Phase**: 1 (Design output)
**Audience:** developer implementando esta spec

## Sequência de Implementação Recomendada

### 1. Schema + Migrations (1 dia)
- Merge `drafts/schemas-drizzle.ts` em `shared/schema.ts` (6 tabelas + whatsapp_optouts auxiliar)
- Adicionar Zod insert schemas + types exportados
- Migration SQL: `0XX_spec003_add_tables.sql` (CREATE TABLE) + `0XX_spec003_audit_immutability.sql` (trigger)
- `npm run db:push` em dev, validar com `psql`
- Teste obrigatório `multi-tenant.test.ts`: 2 tenants paralelos, isolamento absoluto

### 2. Storage Layer (1 dia)
- 5 storage files em `server/storage/`: communications, audit-log, agent-memory, compliance-check, whatsapp-account
- TODAS as funções recebem `providerId` como primeiro parâmetro
- Helper `audit-log.ts`: `registrarAcao()` + `gerarDossie(customerId, providerId)` para defesa Procon

### 3. WhatsApp Cloud API Client (2 dias)
- `server/communications/whatsapp/client.ts` — class MetaWhatsappClient (recebe tenantId)
- `signature.ts` — HMAC validation antes de parsear
- `webhook.ts` — endpoint POST /webhooks/whatsapp + BullMQ enqueue
- `embedded-signup.ts` — OAuth callback que salva `whatsapp_accounts` criptografado
- Testes unitários com mock de fetch

### 4. Anthropic Integration (2 dias)
- `server/agents/anthropic-client.ts` — SDK shared
- `server/agents/prompt-loader.ts` — carrega `server/prompts/*.md` (frontmatter + body)
- `server/agents/julia.ts` — invokeJulia() com 4 camadas (determinístico → Anatel → LLM Haiku + cache → vulnerabilidade)
- `server/agents/helena.ts` — invokeHelena() com loop tool-use até 8 turnos
- `server/agents/memory.ts` — load/save AgentMemory + compactação

### 5. Tools Implementation (1 dia)
- `server/agents/tools/`: wrappers TS que Helena invoca via tool_use
- Cada tool recebe `tenantId` e filtra ERP/storage por ele
- `consultar_fatura.ts` usa `server/erp/connectors/` existentes

### 6. Worker + Orquestrador (1 dia)
- `server/workers/webhook-processor.ts` — BullMQ consumer: identifica tenant → cliente → invoca Helena
- `server/agents/orchestrator.ts` — pre-flight: customer existe? em vulnerabilidade? procon aberto?
- Cron `token-rotator.ts` — renovar long-lived token 45 em 45 dias

### 7. UI Mínima (2 dias)
- `client/src/pages/configuracoes-whatsapp.tsx` — Embedded Signup button + status WABA
- `client/src/pages/communications.tsx` — viewer de comunicações filtrado por tenant
- Hooks TanStack Query: `useWhatsappAccount()`, `useCommunications(customerId)`

### 8. Testes E2E (2 dias)
- ngrok → Meta sandbox → enviar mensagem real do número de teste
- Verificar: webhook recebido, tenant identificado, Helena resposta correta, Júlia compliance, audit log gravado
- Smoke test no Vertical Fibra com 1 cliente real

**Total estimado:** ~12 dias-dev (solo) ou 6-7 dias com 2 devs paralelos.

## Variáveis de Ambiente Necessárias

```env
# Meta WhatsApp Cloud API
META_APP_ID=...
META_APP_SECRET=...
META_VERIFY_TOKEN=...                # arbitrário, mesmo no Meta Dashboard
META_REDIRECT_URI=https://provedor.ai/webhooks/whatsapp/oauth-callback

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Crypto (32 bytes hex = 64 chars)
ENCRYPTION_MASTER_KEY=...            # gerar com: openssl rand -hex 32

# Redis (BullMQ)
REDIS_URL=redis://localhost:6379

# Já existentes
DATABASE_URL=...
SESSION_SECRET=...
```

## Critérios de Aceitação Pré-GA

- [ ] Cliente Vertical Fibra envia WhatsApp e recebe resposta correta em <30s
- [ ] Júlia bloqueia mensagem 23:30 (horário Anatel)
- [ ] Júlia bloqueia conteúdo "URGENTE PAGUE OU JÁ ERA" (CDC art. 71)
- [ ] Cliente que responde "PARAR" não recebe mais nada
- [ ] Audit log tem entrada para cada outbound com `delivered_at + read_at`
- [ ] `multi-tenant.test.ts` passa: 2 tenants não veem dados um do outro
- [ ] Token Meta criptografado no banco (verificar com `psql`)
- [ ] `npm run check` sem erros novos
- [ ] Deploy em produção via VPS Hostinger sem regressão

## Próximos Comandos

```bash
# Phase 2 — gerar tasks.md
/speckit-tasks

# Após tasks.md aprovado — implementação paralela
# (dispatch agents para steps 1-8 em paralelo quando possível)
```
