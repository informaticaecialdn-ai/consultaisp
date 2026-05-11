# Implementation Plan: P1 Cobrança — WhatsApp + Júlia + Helena

**Branch**: `003-whatsapp-julia-helena` (atualmente sob `heatmap-fix`)
**Date**: 2026-05-11
**Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/003-whatsapp-julia-helena/spec.md`

## Summary

Primeiro slice de valor do **módulo Cobrança Inteligente do Provedor.ai**
(SaaS B2B **multi-tenant**). Quando um cliente envia mensagem WhatsApp para
o número do provedor, **Helena** (Sonnet 4.6, Direct API) responde em <30s
com informações corretas de fatura (consultadas via ERP, nunca inventadas),
mantendo memória persistente por (tenant × cliente × agente). **Júlia**
(Haiku 4.5, Direct API) valida toda outbound em <500ms contra Anatel 765 /
CDC art. 71 / LGPD, com poder de veto absoluto. Todas as ações ficam em
**audit_logs** imutável (triggers Postgres) — defesa jurídica em
Procon/Anatel em <30s.

Esta spec entrega o **MVP do Standalone Essencial** (~R$ 249/mês/tenant).
Sofia, Bruno, Marcos, Rafael, Carla, Daniel, Lucas, Pedro ficam para specs
futuras.

## ⚠️ Multi-Tenant SaaS — Invariante Arquitetural

**Provedor.ai é SaaS multi-tenant.** Cada cliente do Provedor.ai é um
**tenant** (provedor de internet), cada tenant tem seus **próprios clientes
finais** (assinantes do provedor). Isolamento é absoluto e não-negociável.

**Conceitos:**
- **Tenant** = provedor de internet (cliente do Provedor.ai) = `providers.id`
- **Customer** = assinante do provedor (cliente do cliente) = `customers.id`
- **User** = operador humano que loga no painel do tenant = `users.id`
- **Agent** = funcionário digital (Helena, Júlia, etc.) — execução é por tenant

**Princípio I (Constitution) — não-negociável:**
Toda tabela com dados de tenant TEM `provider_id`. Toda query filtra por
`req.session.providerId`. Toda invocação de agente recebe `tenantId`. Toda
linha de audit log carrega `provider_id`. Toda conexão Meta WhatsApp é
isolada por tenant (1 `whatsapp_accounts` row por `provider_id`).

**Concretamente nesta spec:**
- Webhook Meta identifica tenant pelo `phone_number_id` (lookup em
  `whatsapp_accounts.phone_number_id` → `provider_id`)
- Helena/Júlia recebem `tenantId` em cada invocação, propagam para tools
- AgentMemory é por `(customer_id, agent_id)` mas `customer_id` carrega
  `provider_id` implícito — sem cross-tenant
- Audit log por `provider_id` — operador de tenant A NUNCA vê logs do tenant B
- Tokens Meta criptografados (AES-256-GCM) por tenant — vazamento de um
  tenant não compromete outros
- Multi-tenant isolation testada via `multi-tenant.test.ts` — caso de teste
  obrigatório: dois tenants paralelos não veem dados um do outro

## Technical Context

**Language/Version**: TypeScript 5.6 + Node.js 20+ (ESM)
**Primary Dependencies**:
- Drizzle ORM 0.39 (atual — Caminho B)
- Express 5.0 (atual)
- @anthropic-ai/sdk (NOVO — Direct API para Júlia + Helena)
- fetch nativo Node 20 (Meta WhatsApp Cloud API)
- crypto nativo Node (AES-256-GCM)
- BullMQ + Redis (NOVO — fila webhook processing)
- p-limit + p-retry (já no projeto)
- vitest 1.x (já no projeto)

**Storage**: PostgreSQL via Drizzle. Schemas atuais + 6 tabelas novas
autorizadas (`project_schema_authorization_spec003.md`):
`communications`, `audit_logs` (append-only via trigger), `agent_memories`,
`compliance_checks`, `agreements`, `whatsapp_accounts`.

**Testing**: Vitest com mocks Meta + Anthropic. E2E via ngrok contra Meta
sandbox. **Teste obrigatório de isolamento multi-tenant** em `multi-tenant.test.ts`.

**Target Platform**: Linux VPS Hostinger (deploy atual)

**Project Type**: Web service multi-tenant SaaS (Express + React monorepo)

**Performance Goals**:
- Helena resposta inbound→outbound <30s p95 (SC-001)
- Júlia validação <500ms p95 (SC-002)
- Webhook Meta → ack 200 <4s p99
- Audit log write <100ms

**Constraints**:
- **Multi-tenant rigoroso** (Princípio I) — invariante arquitetural
- LGPD: CPF/CNPJ hash, tokens AES-256-GCM (Princípios V, IV)
- Audit log imutável via triggers Postgres (Princípio III)
- Janela 24h WhatsApp Meta: free-form só dentro de 24h após inbound
- Opt-out "PARAR" permanente, 100% enforcement por tenant

**Scale/Scope**:
- Tenant médio: 2k assinantes, ~80 inbound/dia, ~150 compliance checks/dia
- Custo Anthropic combinado por tenant: ~R$ 435/mês (Júlia R$ 95 + Helena R$ 340)
- Custo Meta WhatsApp: ~R$ 7/mês/tenant (negligenciável)
- Piloto: Vertical Fibra → 5 provedores → GA Standalone Essencial

## Constitution Check

Gates avaliados contra `.specify/memory/constitution.md` v1.0.0:

| Princípio | Verificação | Status |
|---|---|---|
| **I. Isolamento Multi-Tenant** | TODAS as 6 tabelas têm `provider_id` FK. Webhook identifica tenant por `wabaId`/`phoneNumberId`. Helena/Júlia recebem `tenantId` em invocação. Teste obrigatório `multi-tenant.test.ts`. | ✅ |
| **II. Schema Imutável** | Autorização explícita 2026-05-11 para adicionar 6 tabelas. Não altera tabelas existentes. Migration atômica em commit separado. | ✅ Autorizado |
| **III. Repository via Drizzle** | Storage layer: `server/storage/{communications,audit-log,agent-memory,compliance-check,whatsapp-account}.storage.ts`. SQL raw apenas para triggers (necessário por design). | ✅ |
| **IV. TanStack Query** | UI em `client/src/pages/configuracoes-whatsapp.tsx` + viewer comunicações usam `useQuery`/`useMutation`. Zero fetch direto. | ✅ |
| **V. LGPD** | Tokens Meta AES-256-GCM. CPF nunca em log. Audit log com `legalBasis` em toda ação. Opt-out permanente. Vulnerabilidade pausa régua. | ✅ |
| **VI. Português BR** | Campos audit em pt-BR (`legalBasis`, `legalReferences`). Prompts Júlia/Helena pt-BR. Mensagens pt-BR. Nomes funcionários (Marcos, Júlia, etc.). | ✅ |
| **VII. Incremental Verificável** | MVP delimitado (US1 only). Sofia/Bruno ficam para spec 004. SC mensuráveis. Vertical Fibra como validação real. | ✅ |

**Gate verdict:** PASS — autorização do schema é exceção registrada, não violação.

## Project Structure

### Documentation (this feature)

```text
specs/003-whatsapp-julia-helena/
├── spec.md                                  # já existe
├── plan.md                                  # ESTE arquivo
├── research.md                              # Phase 0 — consolida 4 agents
├── data-model.md                            # Phase 1 — entidades + relacionamentos
├── quickstart.md                            # Phase 1 — guia implementação
├── contracts/
│   ├── webhook-whatsapp.contract.md
│   ├── julia-direct-api.contract.md
│   ├── helena-direct-api.contract.md
│   ├── audit-log.contract.md
│   └── meta-cloud-api.contract.md
├── drafts/
│   └── schemas-drizzle.ts                   # 6 tabelas — pronto para merge
├── checklists/
│   └── requirements.md                      # já existe
└── tasks.md                                 # Phase 2 (gerado por /speckit-tasks)
```

### Source Code (repository root)

```text
shared/
└── schema.ts                                # MERGE 6 tabelas novas

server/
├── communications/                          # já criado (Spec 002)
│   ├── whatsapp/
│   │   ├── client.ts                        # MetaWhatsappClient — recebe tenantId
│   │   ├── webhook.ts                       # POST /webhooks/whatsapp
│   │   ├── signature.ts                     # HMAC-SHA256 validation
│   │   ├── window-24h.ts                    # janela por (tenant × customer)
│   │   ├── opt-out.ts                       # opt-out por tenant
│   │   ├── templates.ts                     # HSM registry por tenant
│   │   └── embedded-signup.ts               # OAuth — cria whatsapp_account por tenant
│   ├── sms/                                 # placeholder
│   └── email/                               # placeholder
│
├── agents/                                  # já criado (Spec 002)
│   ├── anthropic-client.ts                  # SDK compartilhado
│   ├── julia.ts                             # invokeJulia(tenantId, ...)
│   ├── helena.ts                            # invokeHelena(tenantId, ...)
│   ├── orchestrator.ts                      # webhook → routing por tenant
│   ├── prompt-loader.ts                     # carrega server/prompts/*.md
│   ├── memory.ts                            # AgentMemory por (customer × agent)
│   └── tools/
│       ├── consultar-fatura.ts              # wraps ERP por tenant
│       ├── gerar-segunda-via.ts
│       ├── gerar-pix.ts
│       ├── consultar-pagamento.ts
│       ├── handoff-humano.ts
│       └── compliance-validar.ts            # invokes Júlia
│
├── audit/                                   # já criado (Spec 002)
│   ├── audit-log.ts                         # registrarAcao(tenantId, ...)
│   ├── triggers.sql                         # raise_immutability_error()
│   └── legal-references.ts                  # CDC/LGPD/Anatel citations
│
├── prompts/                                 # já criado
│   ├── julia.md                             # já existe
│   └── helena.md                            # já existe
│
├── storage/
│   ├── communications.storage.ts            # NOVO — filtra por providerId
│   ├── audit-log.storage.ts                 # NOVO — filtra por providerId
│   ├── agent-memory.storage.ts              # NOVO
│   ├── compliance-check.storage.ts          # NOVO
│   ├── whatsapp-account.storage.ts          # NOVO
│   └── index.ts                             # MOD — exportar novos
│
├── workers/                                 # NOVO (criar dir)
│   ├── webhook-processor.ts                 # BullMQ consumer
│   ├── token-rotator.ts                     # cron 45d rotação Meta tokens
│   └── compliance-monthly-report.ts         # cron mensal por tenant
│
├── routes/
│   ├── webhook.routes.ts                    # ADD /webhooks/whatsapp
│   ├── whatsapp.routes.ts                   # NOVO — config + Embedded Signup
│   └── communications.routes.ts             # NOVO — viewer
│
└── migrations/
    ├── 0XX_spec003_add_tables.sql           # 6 tabelas
    └── 0XX_spec003_audit_immutability.sql   # trigger

client/src/
├── pages/
│   └── configuracoes-whatsapp.tsx           # NOVO — Embedded Signup + status
├── hooks/
│   ├── use-whatsapp-account.ts              # NOVO
│   └── use-communications.ts                # NOVO
└── components/
    ├── whatsapp/
    │   ├── EmbeddedSignupButton.tsx
    │   └── WhatsappStatusCard.tsx
    └── communications/
        └── CommunicationsTimeline.tsx
```

**Structure Decision:** Mantida a estrutura atual (server/ + client/).
Novas pastas (`server/communications/whatsapp/`, `server/agents/`,
`server/audit/`, `server/prompts/`) já criadas na Spec 002. Esta Spec
adiciona código TS + 6 schemas + migrations + UI mínima.

## Complexity Tracking

> Autorização explícita do schema é exceção registrada, não violação.

| Decisão | Por quê | Alternativa rejeitada |
|---|---|---|
| Direct API (não Managed Agents) Júlia + Helena | Latência crítica + prompt caching 60-90% | Managed Agents adiciona 200-500ms |
| Tokens Meta AES-256-GCM | LGPD + Princípio V | Plaintext = vazamento expõe todos tenants |
| BullMQ + Redis webhook async | Meta exige ack <5s | Processar inline pode timeout |
| Trigger Postgres imutabilidade | Princípio III não-negociável | App-check = bypassável |
| Memória Helena Postgres + Redis cache | Persistência + latência baixa | Só Redis = perda em restart |
