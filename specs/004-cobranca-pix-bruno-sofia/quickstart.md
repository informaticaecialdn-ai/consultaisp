# Quickstart — Spec 004 Implementation

**Status:** Phases 1-5 implementadas. Phase 6 (Polish + Deploy) em andamento.
**Audience:** dev mantendo / operador deployando

## Status da entrega

| Phase | Status | Commit |
|---|---|---|
| 1 Setup | ✅ | `9f367f7` |
| 2 Foundational (5 tabelas + storages + Asaas multi-tenant) | ✅ exceto T009 migrations VPS | `9f367f7` |
| 3 US1 Bruno (MVP) | ✅ | `6b37c51` |
| 4 US2 Sofia (webhook + worker) | ✅ | `f9b3ec1` |
| 5 US3 Painel (Asaas config + Régua + Dossiê) | ✅ | `3fba2c0` |
| 6 Polish (changelog + smoke test + deploy) | 🔄 em andamento | — |

## Variáveis de Ambiente (verificadas durante implementação)

```env
# Spec 003 (já existentes)
ANTHROPIC_API_KEY=sk-ant-...
ENCRYPTION_MASTER_KEY=<hex 64 chars>        # mesma da Spec 003
REDIS_URL=redis://localhost:6379            # OBRIGATÓRIO para Bruno+Sofia+retry worker
DATABASE_URL=postgresql://...
META_VERIFY_TOKEN=...                       # webhook WhatsApp

# Asaas (multi-uso)
ASAAS_API_KEY=...                           # SOMENTE para creditOrders SaaS->ISP. Pix dinâmico vem da chave do tenant em asaas_accounts.

# Opcionais (per-agent model override)
HELENA_MODEL=claude-sonnet-4-5-20250514     # default no código
BRUNO_MODEL=claude-haiku-4-5-20251001       # default no código
SOFIA_MODEL=claude-haiku-4-5-20251001       # default no código
```

**Importante:** sem `REDIS_URL`, os workers Bruno/Sofia/outbound-retry ficam **desligados** no boot do worker process (degrada limpo via guard no `server/worker.ts`).

## Sequência de Deploy (VPS Hostinger)

Ordem em produção:

```bash
# 1. Local: push commits
git push origin 004-cobranca-pix-bruno-sofia
# (depois merge para main quando smoke test passar)

# 2. SSH VPS Hostinger
ssh user@vps-hostinger
cd /caminho/Consulta-ISP

# 3. Pull + install deps + build
git pull origin main
npm ci
npm run build

# 4. Apply migrations Spec 004 (T009)
npm run db:migrate
# Aplica em ordem:
#   migrations/0005_spec004_create_tables.sql     (5 tabelas novas)
#   migrations/0006_spec004_outbound_unique_index.sql (UNIQUE D-3/D-1/dia)
#   migrations/0007_spec004_backfill_agent_toggles.sql (defaults OFF)

# 5. Restart processes (PM2)
pm2 restart all
# Confirma que worker process loga "Bruno + Sofia + outbound retry started"

# 6. Smoke test (T061)
# Ver specs/004-cobranca-pix-bruno-sofia/SMOKE-TEST-RESULT.md
```

## Critérios de Aceitação — status atual

| Critério | Status | Como verificar |
|---|---|---|
| Owner autorizou as 5 tabelas | ✅ 2026-05-11 | Memória `project_schema_authorization_spec004.md` |
| `multi-tenant-pix.test.ts` passa | ⏳ aguarda VPS DATABASE_URL | Roda automático no CI quando configurado |
| Bruno gera Pix no Asaas sandbox + WhatsApp | ⏳ Phase 6 | Smoke test |
| Re-rodar scheduler mesmo dia não duplica | ✅ por design | UNIQUE em outbound_attempts |
| Webhook Asaas duplicado não dispara Sofia 2x | ✅ por design | UNIQUE em payment_events + insertOrSkip |
| Janela horária respeitada | ✅ código | Tests `waiting_window` cobrem |
| Opt-out exclui da régua | ✅ código | Tests `bruno_skipped_optout` cobrem |
| Dossiê 12 meses <30s | ⏳ teste perf na VPS | `dossie.routes.test.ts` valida SC-006 |
| Toggle Bruno OFF cancela disparo | ✅ código | `bruno_disabled` test |
| `npm run check` sem erros novos | ✅ | Verificado durante US1, US2, US3 |
| Smoke test Vertical Fibra sem regressão Spec 003 | ⏳ Phase 6 | T061 + T064 |

## Endpoints implementados

### Públicos
- `POST /webhooks/asaas` (auth via token header)

### Auth + Admin
- `GET/POST/DELETE /api/asaas/account` — credenciais Asaas (rate-limit 5/15min POST)
- `GET /api/regua/pre-vencimento` — listagem paginada com filtros
- `GET/PATCH /api/regua/agente-config` — toggles + janela horária + templates
- `GET /api/dossie/cliente/:customerId?format=pdf|json` — dossiê

### Frontend (Wouter)
- `/configuracoes/asaas`
- `/configuracoes/agentes`
- `/regua-pre-vencimento`
- `/cliente/:customerId/dossie`

## Próximos comandos (Phase 6)

```bash
# T058: este arquivo (atualizado)
# T059: typecheck full
npx tsc --noEmit

# T060: changelog
# docs/spec-004-changelog.md criado

# T061-T064: ver SMOKE-TEST-RESULT.md + docs/spec-004-deploy.md
```

## Decisões importantes registradas

1. **Direct API mantida** — pesquisa em maio/2026 confirmou que Managed Agents (platform.claude.com) é produto para coding agents long-running; Bruno/Sofia/Helena/Júlia ficam no Messages API (caminho oficial Anthropic para custom agent loops). Detalhes em `specs/005-platform-integration/spec.md`.
2. **pdfkit local** para dossiê (não Skills) — Skills NÃO são ZDR-eligible; CPF iria pra Anthropic.
3. **Audit imutável local** via triggers Postgres — defesa Procon/Anatel garantida.
4. **MCP server pra ERPs** virou Spec 005 — fora do escopo Spec 004.
