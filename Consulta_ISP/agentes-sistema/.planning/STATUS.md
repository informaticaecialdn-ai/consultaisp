# STATUS — Onde estamos

Atualizado: 2026-04-20

## Entregue (committed)

### Milestone 1 — Foundation
- [x] B1 — Research Platform Agents API (`.planning/PLATFORM-AGENTS-API.md`)
- [x] B2 — Tools registry (`src/tools/`) com 17 tool handlers
  - Core (10): send_whatsapp, check_consent, check_window_24h, query_lead_detail,
    query_leads, mark_qualified, mark_unqualified, schedule_followup, enrich_lead,
    handoff_to_agent
  - Vendas/Closer (3): create_proposal, mark_closed_won, mark_closed_lost
  - Supervisor (4): reassign_stuck_leads, notify_operator, pause_campaign, resume_campaign
- [x] B3 — `src/services/platform-agent-client.js` com loop tool_use
- [x] B4 — Migration 016 `agent_tool_calls` (auditoria)
- [x] B5 — `orchestrator.processIncoming` roteia via flag USE_TOOL_CALLING_AGENTS
- [x] B7 — Feature flag `USE_TOOL_CALLING_AGENTS` (default false)
- [x] B8 — Testes integration + dashboard card "Tool calls hoje"
- [x] C1 — Migration 017 `leads_pending` + `prospector_config`
- [x] C2 — `src/services/lead-validator.js` (pipeline BR)
- [x] C3 — `src/workers/prospector.js` (cron scraping + validation)
- [x] C6 — Apify CATALOG +2 actors (email-extractor, contact-info-scraper)

### Milestone 2 — Pipeline autonomo
- [x] D1 — `src/workers/outbound.js` (Carlos SDR cron 2h BR)
- [x] D2 — skill `skills-ref/carlos-qualificacao-bant.md` + tools Lucas/Rafael

### Milestone 3 — Self-driving
- [x] F1 — `src/workers/supervisor.js` (Diana cron 1h via platform-agent-client)
- [x] G — `src/services/auto-healer.js` (monitor 5min + kill switches)
- [x] H — pagina `/autonomia` + `public/js/cards/autonomy-panel.js`
- [x] A3 — docs `AUTONOMY.md`, `STATUS.md`, `PLATFORM-AGENTS-API.md`

## Pendente (bloqueadores externos)

### Frente A (requer usuario na VPS)
- [ ] A1 — Z-API reconfig (nano /opt/consulta-isp-agentes/.env: ZAPI_INSTANCE_ID/TOKEN/CLIENT_TOKEN)
- [ ] A2 — Validar inbound real (mandar mensagem de telefone pessoal → ver log `[WEBHOOK] mensagem recebida`)

**Sem Z-API funcionando, nenhum envio chega no WhatsApp.** Tudo que depende
disso pode ser testado em dry-run.

## Rollout recomendado — quando ligar as flags

Ordem sugerida (cada passo: 1 dia de observacao minimo):

```bash
# Passo 1 — ligar agentes com tools em homolog
USE_TOOL_CALLING_AGENTS=true

# Verificar:
docker compose exec agentes node -e "
const db=require('better-sqlite3')('/app/data/agentes.db');
console.log(db.prepare('SELECT agente, tool_name, COUNT(*) c FROM agent_tool_calls WHERE DATE(criado_em)=DATE(\"now\") GROUP BY 1,2').all());
"

# Passo 2 — ligar prospector
PROSPECTOR_WORKER_ENABLED=true
# Ativar via UI: POST /api/prospector/config { enabled: true, regioes: [...], termos: [...] }
# Ou manual trigger: POST /api/prospector/run-scraping

# Verificar:
sqlite3 data/agentes.db "SELECT COUNT(*), status FROM leads_pending GROUP BY status"
sqlite3 data/agentes.db "SELECT COUNT(*) FROM leads WHERE origem='prospector_auto'"

# Passo 3 — ligar Carlos SDR autonomo (LIMITE BAIXO inicial)
OUTBOUND_WORKER_ENABLED=true
OUTBOUND_MAX_COLD_PER_DAY=5  # ← COMECE COM 5, nao 30

# Verificar (apos 1 dia comercial):
sqlite3 data/agentes.db "
SELECT agente, COUNT(*) FROM conversas
WHERE DATE(criado_em)=DATE('now') AND metadata LIKE '%cold_outbound%'
GROUP BY 1"

# Passo 4 — ligar Diana supervisora
SUPERVISOR_WORKER_ENABLED=true

# Verificar (apos 1 hora):
sqlite3 data/agentes.db "
SELECT tool_name, COUNT(*) FROM agent_tool_calls
WHERE agente='diana' AND DATE(criado_em)=DATE('now')
GROUP BY 1"
```

## Criterios de aceite por Milestone

**M1 (Foundation):** lead novo aparece em `leads` com origem=prospector_auto
automaticamente. Carlos usa `check_consent` + `send_whatsapp` via tool call
visivel em `agent_tool_calls`.

**M2 (Pipeline):** 1 lead flui Prospector → Carlos (cold) → resposta inbound
→ qualificacao BANT → handoff lucas → proposta, tudo sem operador tocar.

**M3 (Self-driving):** operador 7 dias sem tocar. Metricas em crescimento.
Alertas funcionam (notify_operator dispara webhook em anomalia). Custo <$50/dia.

## Nao sera feito por enquanto

- Managed Agents via MCP (deixa pra quando USE_TOOL_CALLING_AGENTS estiver estavel)
- Multi-agent research preview (requer access request)
- NFS-e / SPC / Multi-usuario
- Instagram DM e outros canais
