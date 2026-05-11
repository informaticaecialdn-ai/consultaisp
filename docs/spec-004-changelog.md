# Spec 004 — Bruno + Sofia + Pix Dinâmico (Changelog)

**Versão:** v1.0 — Módulo Cobrança Inteligente · MVP
**Data:** 2026-05-11
**Branch:** `004-cobranca-pix-bruno-sofia`

## Resumo em 5 linhas

1. **Bruno (D-3/D-1)** envia lembrete pré-vencimento via WhatsApp com Pix dinâmico Asaas anexado, validado pela Júlia (compliance) antes do envio.
2. **Sofia (pós-pagamento)** agradece o cliente assim que o webhook Asaas confirma pagamento, idempotente por `payment_events.UNIQUE`.
3. **Painel** permite admin conectar chave Asaas, ativar/desativar agentes, configurar janela horária e visualizar régua paginada com filtros.
4. **Dossiê PDF** de 12 meses gerado em <30s para defesa Procon/Anatel/Justiça — fonte: tabela `audit_logs` imutável.
5. **Pivot platform.claude.com investigado e arquitetura mantida** — Direct API é caminho oficial Anthropic; migração eventual fica em Spec 005.

## Componentes entregues

### Schema (5 tabelas novas)

- `asaas_accounts` — credenciais Asaas por provider (AES-256-GCM)
- `pix_charges` — Pix dinâmico gerado por Bruno
- `payment_events` — webhooks Asaas (idempotência via UNIQUE 3-tupla)
- `agent_toggles` — Bruno/Sofia on/off + janela horária + templates
- `outbound_attempts` — estado da régua (intenção + Júlia decision + retry)

Migrations: `migrations/0005_*.sql`, `0006_*.sql`, `0007_*.sql` (idempotentes via `IF NOT EXISTS` + `ON CONFLICT DO NOTHING`).

### Backend

| Camada | Arquivos | LOC aprox |
|---|---|---|
| Storage (5 stores multi-tenant) | `server/storage/{asaas-account,pix-charge,payment-event,agent-toggle,outbound-attempt}.storage.ts` | ~600 |
| Agentes (Bruno + Sofia) | `server/agents/{bruno,sofia}.ts` + `server/agents/tools/{gerar-pix-bruno,consultar-memoria-cliente}.ts` | ~900 |
| Workers (3 processos) | `server/workers/{bruno-scheduler,bruno-process-invoice,sofia-event-processor,outbound-retry}.ts` | ~1100 |
| Routes (4 novos) | `server/routes/{asaas-config,regua,dossie,webhook}.routes.ts` | ~700 |
| Services | `server/services/{asaas-multi-tenant,dossie-builder}.ts` | ~600 |
| Helpers | `server/lib/queue.ts`, `server/agents/audit-actions.ts` | ~230 |
| Prompts | `server/prompts/{bruno,sofia}.md` | ~310 (markdown) |

### Frontend

| Camada | Arquivos |
|---|---|
| Hooks TanStack | `use-asaas-account`, `use-agent-toggles`, `use-regua-pre-vencimento`, `use-dossie` |
| Pages | `configuracoes-asaas`, `configuracoes-agentes`, `regua-pre-vencimento`, `cliente-dossie` |
| Components | `PixStatusBadge`, `EnvioStatusBadge`, `DossieExportButton` |
| Sidebar | Novo grupo "Cobrança" |

### Testes

| Arquivo | Casos |
|---|---|
| `server/__tests__/multi-tenant-pix.test.ts` | 13 (isolation cross-tenant) |
| `server/workers/bruno-process-invoice.test.ts` | 8 (happy/paid/optout/window/julia veto/meta fail) |
| `server/workers/sofia-event-processor.test.ts` | 5 (happy/optout/julia veto/disabled/sofia fail) |
| `server/routes/webhook.routes.test.ts` | 5 (200/duplicate/401/400/pix paid) |
| `server/routes/asaas-config.routes.test.ts` | 6 (CRUD + multi-tenant + auto-suspend) |
| `server/routes/dossie.routes.test.ts` | 6 (JSON/PDF/multi-tenant/perf SC-006) |
| **Total** | **43 testes** (skipam sem DATABASE_URL) |

## Dependências novas (1)

- `pdfkit ^0.x` — renderização do dossiê PDF (streaming)

Removidas: nenhuma.

## Decisões arquiteturais registradas

1. **Direct API > Managed Agents** para Bruno/Sofia/Helena/Júlia. Docs Anthropic explícita: Messages API é o caminho para "custom agent loops with fine-grained control".
2. **Multi-tenant rigoroso**: toda query filtra por `providerId`. Validado pelo `multi-tenant-pix.test.ts` (13 testes).
3. **Idempotência em 2 camadas**: UNIQUE em `outbound_attempts` (Bruno scheduler) + UNIQUE em `payment_events` (Sofia webhook).
4. **Compliance gate centralizado**: Júlia (Spec 003) valida toda saída outbound de Bruno e Sofia. APPROVED → envia; BLOCKED → markVetoed + audit.
5. **Audit imutável**: triggers Postgres em `audit_logs` bloqueiam UPDATE/DELETE. Dossiê extrai dali.
6. **pdfkit local** para dossiê (não Skills) — Skills da Anthropic NÃO são ZDR-eligible.

## Comandos úteis

```bash
# Apply migrations (na VPS)
npm run db:migrate

# Rodar testes (precisa DATABASE_URL)
npm test

# Type-check
npm run check

# Build
npm run build

# Start worker (dev)
npx tsx server/worker.ts
```

## Roadmap pós-MVP

- **Phase 6 (em andamento):** smoke test Vertical Fibra, submeter HSM Meta, deploy VPS
- **Spec 005:** Memory Tool + MCP server ERPs + ZDR Anthropic + LGPD docs
- **Phase futura:** outros funcionários digitais (Marcos, Rafael, Carla, Daniel, Lucas, Pedro)

## Referências

- `specs/004-cobranca-pix-bruno-sofia/spec.md` — escopo + user stories
- `specs/004-cobranca-pix-bruno-sofia/plan.md` — design técnico
- `specs/004-cobranca-pix-bruno-sofia/tasks.md` — checklist tasks T001-T064
- `specs/004-cobranca-pix-bruno-sofia/contracts/` — 6 contratos canônicos
- `specs/005-platform-integration/` — próxima evolução
