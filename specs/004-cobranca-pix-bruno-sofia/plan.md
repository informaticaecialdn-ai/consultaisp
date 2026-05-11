# Implementation Plan: Bruno (preventivo) + Sofia (agradecimento) + Pix dinâmico

**Branch**: `004-cobranca-pix-bruno-sofia`
**Date**: 2026-05-11
**Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/004-cobranca-pix-bruno-sofia/spec.md`

## Summary

Segundo slice de valor do **módulo Cobrança Inteligente do Provedor.ai**, construído em cima da infra entregue na Spec 003. Bruno (Haiku 4.5, Direct API) varre diariamente faturas a vencer em D-3 e D-1, gera **cobrança Pix dinâmica** no Asaas do próprio provedor, envia template WhatsApp aprovado com QR Code, e respeita opt-out + janela 08:00–20:00. Sofia (Haiku 4.5, Direct API) reage a **webhook de pagamento confirmado** do Asaas e envia agradecimento personalizado em <5min. Toda outbound passa por **Júlia** (já em produção). Painel admin "Régua Pré-Vencimento" + toggles independentes Bruno/Sofia + dossiê auditoria fecham o ciclo.

Esta spec entrega o **MVP do Standalone Profissional** (R$ 499/mês), elevando o ROI percebido da plataforma sem novas dependências de IA além das já validadas.

## ⚠️ Multi-Tenant SaaS — Invariante Arquitetural (continua valendo)

Todos os princípios da Spec 003 continuam:

- **Tenant** = provedor de internet (`providers.id`)
- **Customer** = assinante do provedor (`customers.id`)
- **Agent** = Bruno/Sofia/Júlia, sempre executados com `tenantId` no contexto
- Bruno **NUNCA** dispara uma régua de um tenant lendo dados de outro
- Cada provedor tem **sua própria** conta Asaas (chave API isolada e cifrada) — fundos vão direto pra conta dele (FR-017)
- Webhook Asaas identifica tenant por `externalReference` (carrega `providerId`) ou por `asaas_accounts.api_key_hash` (lookup) — sem ambiguidade
- Audit log por `provider_id`; toggles `bruno_enabled`/`sofia_enabled` por `provider_id`

**Mudança crítica vs. estado atual:** `server/services/asaas.ts` hoje usa um único `ASAAS_API_KEY` global de ambiente. Esta spec migra para **chave Asaas por provedor**, criptografada em repouso (AES-256-GCM, mesmo padrão de `whatsapp_accounts.access_token_encrypted`). A chave global do `.env` permanece apenas para créditos da própria plataforma (`creditOrders`), que é fluxo SaaS→provedor e não tenant→cliente-final.

## Technical Context

**Language/Version**: TypeScript 5.6 + Node.js 20+ (ESM) — mantido
**Primary Dependencies**:
- Drizzle ORM 0.39 (atual)
- Express 5.0 (atual)
- @anthropic-ai/sdk (já no projeto via Spec 003) — Direct API Haiku 4.5 para Bruno + Sofia
- fetch nativo Node 20 (Asaas + Meta WhatsApp)
- crypto nativo Node (AES-256-GCM, código reaproveitado de Spec 003)
- BullMQ + Redis (já no projeto via Spec 003) — fila para Bruno-scheduler-batches e Sofia-on-payment
- node-cron ou similar leve para scheduler diário (já existem schedulers em `server/worker.ts`)
- vitest 1.x (já no projeto)

**Storage**: PostgreSQL via Drizzle. Schemas atuais (incluindo os 6 da Spec 003) + **5 tabelas novas a autorizar**:
- `asaas_accounts` (1:1 com provider, chave API cifrada)
- `pix_charges` (Pix gerado por Bruno, vinculado a fatura)
- `payment_events` (audit dos webhooks Asaas, idempotência por id de pagamento)
- `agent_toggles` (bruno/sofia on/off + horário do scheduler + janela horária por provedor)
- `outbound_attempts` (estado por etapa de régua: agendado / vetado / enviado / falhou / em retry) — alternativa a sobrecarregar `communications` da Spec 003

> **Decisão de design (ver research D3):** prefira tabela enxuta `outbound_attempts` apenas para o ciclo Bruno/Sofia. `communications` da Spec 003 continua como fonte de verdade da mensagem enviada de fato; `outbound_attempts` rastreia *intenção* + *estado da régua*.

Migration imutabilidade do `audit_logs` (Spec 003) já cobre Sofia e Bruno — sem trigger nova.

**Testing**: Vitest com mocks Asaas + Anthropic. Teste obrigatório `multi-tenant-pix.test.ts` — 2 tenants com Asaas keys distintas, Bruno de A nunca gera Pix na conta de B, webhook do tenant B nunca dispara Sofia em A. E2E via ngrok contra webhook Asaas sandbox.

**Target Platform**: Linux VPS Hostinger (deploy atual)

**Project Type**: Web service multi-tenant SaaS — sem mudança estrutural

**Performance Goals**:
- Bruno por fatura (gerar Pix + chamar Júlia + enviar WhatsApp) <8s p95
- Sofia por webhook (webhook→ack → mensagem enviada) <5min p95 (SC-003), p50 <30s
- Scheduler Bruno diário capaz de processar ≥10.000 faturas/provedor em <30min (varredura + geração Pix + envio)
- Dossiê auditoria <30s p95 (SC-006)
- Webhook Asaas → ack 200 <2s p99 (deve responder antes de processar; processamento via fila)

**Constraints**:
- Multi-tenant rigoroso (Princípio I)
- LGPD: Asaas API key AES-256-GCM, valor da fatura em audit log, CPF nunca em log claro (Princípios IV, V)
- Audit log imutável via trigger Spec 003 (Princípio III)
- Janela 08:00–20:00 dias úteis no fuso do provedor (FR-011)
- Opt-out WhatsApp herdado da Spec 003 (`whatsapp_optouts`) — Bruno consulta antes de tentar enviar
- Idempotência: (fatura × dia × passo D-3/D-1) único na régua; (payment_id) único em Sofia
- Asaas Pix dinâmico: vencimento = vencimento da fatura, valor = valor da fatura, **billingType="PIX"** com expiração configurável

**Scale/Scope**:
- Tenant médio: 2k assinantes → ~70 faturas vencendo por dia → Bruno gera ~140 Pix/dia (D-3 + D-1) e ~70 webhooks de pagamento/dia
- Custo Anthropic Bruno+Sofia somado: ~R$ 60/mês/tenant (Haiku barato + prompt caching agressivo)
- Custo Asaas Pix: R$ 1,99/cobrança paga em produção (provedor absorve, FR-021)
- Piloto: continua Vertical Fibra (Spec 003) + 2 provedores adicionais que já estão usando Asaas

## Constitution Check

Gates avaliados contra `.specify/memory/constitution.md` v1.0.0:

| Princípio | Verificação | Status |
|---|---|---|
| **I. Isolamento Multi-Tenant** | 5 tabelas novas têm `provider_id` FK. Bruno scheduler itera por tenant. Webhook Asaas identifica tenant via `externalReference` + lookup. Teste obrigatório `multi-tenant-pix.test.ts`. | ✅ |
| **II. Schema Imutável** | 5 tabelas novas (`asaas_accounts`, `pix_charges`, `payment_events`, `agent_toggles`, `outbound_attempts`) **autorizadas pelo owner em 2026-05-11**. Não altera tabelas existentes. Asaas key cifrada com mesma master key da Spec 003. | ✅ Autorizado |
| **III. Repository via Drizzle** | Novas storage files: `pix-charge.storage.ts`, `payment-event.storage.ts`, `agent-toggle.storage.ts`, `asaas-account.storage.ts`, `outbound-attempt.storage.ts`. Zero SQL raw. | ✅ |
| **IV. TanStack Query** | UI da régua + toggles + dossiê em hooks `useReguaPreVencimento`, `useAgentToggles`, `useDossie`. Zero fetch direto. | ✅ |
| **V. LGPD** | Asaas API key cifrada AES-256-GCM. CPF em audit log: hash + 4 últimos dígitos. Opt-out reaproveitado. Webhook Asaas valida assinatura/token antes de processar (Princípio "webhooks DEVEM validar assinatura"). | ✅ |
| **VI. Português BR** | Toggles `bruno_ativo`, `sofia_ativa`, `janela_inicio`, `janela_fim`. UI "Régua Pré-Vencimento", "Dossiê de Auditoria". Prompts Bruno/Sofia 100% pt-BR. | ✅ |
| **VII. Incremental Verificável** | P1 (Bruno) entregável sozinho; P2 (Sofia) depois; P3 (painel) depois. SC mensuráveis. Vertical Fibra + 2 provedores Asaas como validação real. | ✅ |

**Gate verdict:** PASS — autorização do schema emitida pelo owner em 2026-05-11, registrada como exceção controlada (idêntico padrão Spec 003). Alternativas (overload de tabelas existentes, JSONB em `providers`) rejeitadas em research D4. Pronto para `/speckit-tasks`.

## Project Structure

### Documentation (this feature)

```text
specs/004-cobranca-pix-bruno-sofia/
├── spec.md                                  # já existe
├── plan.md                                  # ESTE arquivo
├── research.md                              # Phase 0
├── data-model.md                            # Phase 1
├── quickstart.md                            # Phase 1
├── contracts/
│   ├── asaas-pix-charge.contract.md         # criação Pix dinâmico
│   ├── asaas-webhook.contract.md            # eventos PAYMENT_RECEIVED/REFUNDED/CANCELED
│   ├── bruno-direct-api.contract.md         # prompt + tool schema Haiku 4.5
│   ├── sofia-direct-api.contract.md         # prompt + tool schema Haiku 4.5
│   ├── regua-painel.contract.md             # endpoints REST do painel
│   └── dossie-auditoria.contract.md         # endpoint export PDF/JSON
├── drafts/
│   └── schemas-drizzle.ts                   # 5 tabelas — pronto para merge após autorização
├── checklists/
│   └── requirements.md                      # já existe
└── tasks.md                                 # Phase 2 (gerado por /speckit-tasks)
```

### Source Code (repository root)

```text
shared/
└── schema.ts                                # MERGE 5 tabelas novas (após autorização do owner)

server/
├── services/
│   ├── asaas.ts                             # MOD — adicionar createDynamicPix, parseWebhookEvent, refatorar para receber `apiKey` (não ler do env). Manter backward-compat para creditOrders.
│   └── asaas-multi-tenant.ts                # NOVO — wrapper que decifra chave do provedor e injeta no client
│
├── agents/
│   ├── bruno.ts                             # NOVO — invokeBruno(tenantId, fatura) → mensagem aprovada
│   ├── sofia.ts                             # NOVO — invokeSofia(tenantId, payment) → mensagem aprovada
│   └── tools/
│       ├── gerar-pix-bruno.ts               # NOVO — Asaas createDynamicPix por tenant
│       └── personalizar-agradecimento.ts    # NOVO — Sofia tool (lê histórico Helena/agent_memory)
│
├── prompts/
│   ├── bruno.md                             # NOVO — system prompt + few-shots
│   └── sofia.md                             # NOVO
│
├── workers/                                 # criar dir (worker.ts já existe ad hoc)
│   ├── bruno-scheduler.ts                   # cron diário, varre faturas D-3/D-1 por tenant
│   ├── sofia-event-processor.ts             # BullMQ consumer dos webhooks Asaas
│   └── outbound-retry.ts                    # cron para FR-020 retry (2 tentativas + alerta)
│
├── routes/
│   ├── webhook.routes.ts                    # ADD POST /webhooks/asaas
│   ├── asaas-config.routes.ts               # NOVO — conectar/editar chave Asaas (admin do tenant)
│   ├── regua.routes.ts                      # NOVO — GET /api/regua/pre-vencimento + toggles
│   └── dossie.routes.ts                     # NOVO — GET /api/dossie/cliente/:id
│
├── storage/
│   ├── asaas-account.storage.ts             # NOVO
│   ├── pix-charge.storage.ts                # NOVO
│   ├── payment-event.storage.ts             # NOVO
│   ├── agent-toggle.storage.ts              # NOVO
│   ├── outbound-attempt.storage.ts          # NOVO
│   └── index.ts                             # MOD — exportar novos
│
└── migrations/
    └── 0XX_spec004_add_tables.sql           # 5 tabelas + índices

client/src/
├── pages/
│   ├── regua-pre-vencimento.tsx             # NOVO — painel régua
│   ├── configuracoes-asaas.tsx              # NOVO — conectar chave Asaas
│   └── configuracoes-agentes.tsx            # NOVO — toggles + janela horária
├── hooks/
│   ├── use-regua-pre-vencimento.ts
│   ├── use-agent-toggles.ts
│   ├── use-asaas-account.ts
│   └── use-dossie.ts
└── components/
    ├── regua/
    │   ├── ReguaTable.tsx
    │   ├── PixStatusBadge.tsx
    │   └── ReguaFilters.tsx
    └── dossie/
        └── DossieExportButton.tsx
```

**Structure Decision:** Mantém estrutura `server/` + `client/src/` do projeto. Spec 003 já criou `server/agents/`, `server/communications/whatsapp/`, `server/audit/`. Esta spec adiciona `server/workers/` (formaliza o que `server/worker.ts` já faz ad hoc), separa Asaas multi-tenant em wrapper para não romper o uso atual em `creditOrders` (que continua usando chave global da plataforma).

## Complexity Tracking

| Decisão | Por quê | Alternativa rejeitada |
|---|---|---|
| Chave Asaas por tenant (vs. única global) | FR-017 exige fundos direto na conta do provedor; sem isso a plataforma intermediaria dinheiro (regulatório + PCI) | Asaas Split Payments — adiciona complexidade contratual e contábil, e tira simplicidade do fluxo |
| Tabela `outbound_attempts` separada de `communications` | Régua tem ciclo de estados (agendado→aprovado→enviado/vetado/falhou + retry) que polui `communications`; manter `communications` como histórico de fato | Sobrecarregar `communications` com status `scheduled`/`vetoed`/`retry_pending` — torna a tabela mais ambígua e complica queries existentes |
| Tabela `payment_events` para idempotência | Webhook Asaas reenvia (retry); dedupe por id na DB é mais robusto que cache | Cache Redis only — perde idempotência em restart/clear |
| Bruno e Sofia em Haiku 4.5 (vs. Sonnet) | Tarefas são bem-delimitadas (Bruno escolhe template + variáveis; Sofia personaliza dentro de template aprovado); custo 10x menor; latência 3x menor | Sonnet 4.6 — gasto desproporcional ao ganho de qualidade nesse escopo |
| Scheduler em `server/worker.ts` existente | Worker já é processo separado por design; adicionar novos schedulers não muda topologia | Novo daemon dedicado — sobrecarga operacional sem ganho |
| Toggles separados Bruno/Sofia (não um toggle global) | Provedor pode querer Bruno OFF + Sofia ON (durante refinamento de templates Bruno) ou vice-versa | Toggle único "régua ativa" — perde granularidade pedida em FR-013 |
