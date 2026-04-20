# AUTONOMY — Visao-alvo

**Principio unico:** o sistema existe pra **funcionar sozinho 24h**, reportando apenas excecoes.

## Pipeline end-to-end

```
┌────────────────────────────────────────────────────────────────┐
│  PIPELINE AUTONOMO                                             │
├────────────────────────────────────────────────────────────────┤
│  1. PROSPECCAO   → prospector worker + Apify Google Maps       │
│  2. VALIDACAO    → lead-validator (regras BR + scoring)        │
│  3. ABORDAGEM    → outbound worker + Carlos Platform Agent     │
│  4. QUALIFICACAO → Carlos extrai BANT via tools                │
│  5. HANDOFF      → tool handoff_to_agent(to=lucas)             │
│  6. FECHAMENTO   → Rafael + tool mark_closed_won               │
│  7. FOLLOWUP     → followup worker (existente)                 │
│  8. SUPERVISAO   → supervisor worker (Iani cron 1h)           │
│  9. AUTOHEAL     → auto-healer monitora custo/erro/Z-API       │
└────────────────────────────────────────────────────────────────┘
```

## Mapeamento — agente ↔ tools ↔ worker

| Agente | Tools disponiveis | Worker que invoca |
|--------|------------------|-------------------|
| **Carlos** (SDR) | send_whatsapp, check_consent, check_window_24h, query_lead_detail, query_leads, mark_qualified, mark_unqualified, schedule_followup, enrich_lead, handoff_to_agent | `outbound.js` (cold) + `orchestrator.js` (inbound) |
| **Lucas** (Vendas) | Carlos + `create_proposal` | `orchestrator.js` (pos-handoff) |
| **Rafael** (Closer) | Lucas + `mark_closed_won`, `mark_closed_lost` | `orchestrator.js` (pos-handoff) |
| **Sofia** (Marketing) | query_leads, query_lead_detail, schedule_followup, handoff_to_agent | nurturing via followup worker |
| **Leo** (Copy) | query_leads, query_lead_detail | invocado on-demand por Sofia/Marcos |
| **Marcos** (Midia) | query_leads | invocado on-demand |
| **Iani** (Ops) | query_leads, query_lead_detail, handoff_to_agent, reassign_stuck_leads, notify_operator, pause_campaign, resume_campaign | `supervisor.js` (cron 1h) |

## Feature flags (rollout progressivo)

Todas em `.env`, default OFF. Ative gradualmente:

| Flag | O que liga | Recomendacao rollout |
|------|-----------|---------------------|
| `USE_TOOL_CALLING_AGENTS=true` | Agentes chamam tools via Messages API (vs JSON legado) | 1. Ligar em homolog, testar 1 dia com leads internos |
| `PROSPECTOR_WORKER_ENABLED=true` | Scraping + validacao automatica | 2. Apos confirmar USE_TOOL_CALLING_AGENTS estavel |
| `OUTBOUND_WORKER_ENABLED=true` | Carlos manda cold outbound autonomo | 3. Apos ter leads prospector_auto em fila, com limite OUTBOUND_MAX_COLD_PER_DAY=10 inicialmente |
| `SUPERVISOR_WORKER_ENABLED=true` | Iani supervisora em cron 1h | 4. Apos pipeline completo rodando |

## Kill switches (runtime)

Sao persistidos em `system_flags` table (migration 018). API setta, worker le antes de cada tick.

API:
- `GET /api/autonomy/kill-switches` — lista ativos
- `POST /api/autonomy/kill-switches/:worker` body `{reason}` — liga
- `DELETE /api/autonomy/kill-switches/:worker` — desliga
- `POST /api/autonomy/kill-switches/all` — Kill ALL
- `DELETE /api/autonomy/kill-switches/all` — Clear ALL

UI: pagina `/autonomia` no dashboard.

## Auto-healer (thresholds)

Roda no worker process, check a cada 5min. Se ultrapassar threshold, liga kill switch automaticamente.

| Threshold | Default | O que pausa |
|-----------|--------|-------------|
| `AUTO_PAUSE_COST_USD` | 50 USD | outbound + supervisor |
| `AUTO_PAUSE_ZAPI_DOWN_MIN` | 30 min | outbound |
| `AUTO_PAUSE_ERROR_RATE_PCT` | 5% (em 1h, min 10 msgs) | outbound |

## Observabilidade

| Dashboard card | Fonte |
|----------------|-------|
| Tool calls hoje | `/api/tool-calls/stats` → `agent_tool_calls` table |
| Pipeline E2E | `/api/autonomy/dashboard` |
| Custo Claude | `/api/costs/today` (ja existente) |
| Erros 24h | `/api/errors/count` (ja existente) |
| Workers status | `/autonomia` pagina |

Logs estruturados: `grep 'TOOL'`, `grep 'AGENT_CLIENT'`, `grep 'AUTO_HEALER'`, `grep 'PROSPECTOR'`, `grep 'OUTBOUND'` em `docker compose logs`.

## Intervencao humana — quando?

Sistema chama voce apenas em:
1. Iani dispara `notify_operator(severity=critical)` via webhook
2. Kill switch liga sozinho (voce ve na pagina Autonomia)
3. Custo diario > AUTO_PAUSE_COST_USD
4. Campanha pausada sozinha por taxa de falha
5. Erro Anthropic ou Z-API nao recupera em 30min

Fora isso, o sistema roda.

## Roadmap de evolucao

Curto prazo (feature flags ligados):
- Tuning do lead-validator (threshold 0.45 → ajustar por qualidade)
- Auto-tuning do `OUTBOUND_MAX_COLD_PER_DAY` pelo Marcos (Frente F3 futura)
- A/B test de prompts do Carlos em cima das taxas de resposta

Medio prazo:
- Managed Agents (Claude Agent Platform) pra Sofia/Marcos tasks longas via MCP server
- Memoria cross-session (research preview)
- Multi-agent orquestrado pelo supervisor service (ja existe)
