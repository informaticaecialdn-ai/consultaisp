# ROADMAP — agentes-sistema

Visao estrategica do subsistema de agentes de vendas do Consulta ISP.
Para procedimentos operacionais (deploy, backup, troubleshooting), ver
`RUNBOOK-DEPLOY.md`.

Branch ativa: `heatmap-fix` (origin/heatmap-fix no GitHub).
Deploy alvo: VPS Hostinger, Docker Compose v2, nginx do host -> 127.0.0.1:3080.

---

## Visao geral

Sistema de 7 agentes IA (Sofia, Leo, Carlos, Lucas, Rafael, Marcos, Diana)
que conversam com leads via WhatsApp (Z-API) para prospeccao, qualificacao
e fechamento de contratos do SaaS Consulta ISP. Orquestrado por Claude
(Anthropic SDK), com scheduler de followup, training rules por agente,
A/B testing e — a partir do Sprint 4/5 — broadcast engine para campanhas
em massa com controle de opt-out, janela 24h e rate limiting.

---

## Sprint 0 — Fundacao (entregue)

**Objetivo:** Stand-up inicial do sistema dentro do monorepo Consulta_ISP.

- `b238471` — feat: add agentes-sistema (sales AI agents com WhatsApp/Docker)
- `5f8d713` — fix: remove backslash-bang from index.html
- `762f4aa` — fix: bugs de runtime no supervisor, followup e claude
- `e7c966a` — feat: prepara Litestream (config + scripts + runbook) sem ativar

**Entregas:**
- Express + better-sqlite3 + Docker container
- 7 agentes definidos com prompts via Claude SDK
- Scheduler de followup, supervisor, training service
- Dashboard HTML basico (`public/index.html`)
- RUNBOOK-DEPLOY.md inicial (secoes 1-8)
- Config de Litestream preparada (sem ativar)

---

## Sprint 1 — Deploy real na VPS (entregue, com divida)

**Objetivo:** Tirar o sistema do dev e colocar em producao real. Validar
end-to-end: codigo -> GitHub -> VPS -> container -> dominio.

- T1 — push para main (`origin/heatmap-fix` passou a ser a branch viva)
- T2 — Docker build e compose up funcionais na VPS
- T3 — nginx do host (nao Caddy) fazendo proxy para 127.0.0.1:3080
- T4 — Litestream FALHOU apos 4 tentativas com B2 (InvalidAccessKeyId)
- T5 — RUNBOOK atualizado com 6 licoes + divida Litestream (`0f49108`)

**Commits relacionados:**
- `bef9f59` — feat(api): endpoint /api/diagnose com health completo
- `7da771d` — fix(dashboard): hardening JS (event delegation, retry, error banner)
- `1c0d8ec` — feat(dashboard): status.html para diagnostico visual
- `725aebe` — chore(ops): fix-vps.sh para deploy limpo emergencial
- `0f49108` — docs(runbook): licoes Sprint 1 + divida Litestream

**Dividas carregadas para sprints futuros:**
- Litestream desativado (bloco comentado em docker-compose.yml)
- Bucket B2 "agentes" (us-east-005) vazio, aguardando ou troca de region/provider
- Replicacao remota compensada por cron de snapshot local na VPS
- Ver `RUNBOOK-DEPLOY.md` secao 10 para plano de retomada

---

## Sprints 2-4 — Broadcast foundations (entregue dentro do Sprint 5)

**Objetivo:** Preparar infra de campanhas antes do motor rodar.

Os commits de Sprint 2-4 foram consolidados nas migrations e services
entregues dentro do Sprint 5 (sem commits dedicados no git — tudo foi
amarrado na migration 008-sprint4-stubs.sql e nas migrations 009-011).

**Entregas:**
- `migrations/008-sprint4-stubs.sql` — schemas base de campanhas
- `services/audiencias.js` — audiencias estaticas e dinamicas
- `services/templates.js` + `template-engine.js` — templates com
  interpolacao `{{primeiro_nome}}`, HSM approved flag
- `services/consent.js` — opt-out com STOP, SAIR, DESCADASTRAR
- `services/window-checker.js` — janela 24h para mensagens non-HSM
- Regex BR de telefone (`55DDDNNNNNNNN`)

---

## Sprint 5 — Broadcast Engine (entregue — FECHA AQUI)

**Objetivo:** Motor completo de campanhas com rate limit, retry, kill
switch e smoke test. Sistema pronto para campanhas reais no Sprint 6.

### T1 — schema + migrations (entregue)
- `migrations/009-campanhas.sql` — tabela campanhas (status, contadores)
- `migrations/010-campanha-envios.sql` — envios com UNIQUE(campanha,lead)
- `migrations/011-conversas-zapi-id.sql` — zapi_message_id para delivery

### T2 — worker process separado + claim atomico (`cdec758`)
- `src/worker.js` — entry point do processo worker dedicado
- `src/workers/broadcast.js` — loop principal com claim SQL atomico
- `docker-compose.yml` — service `consulta-isp-worker` isolado
- Heartbeat em `data/.worker-heartbeat-broadcast`

### T3 + T4 — rate limit, retry e UI campanhas (`e348542`)
- `services/broadcast-rate-limiter.js` — token bucket por campanha
  com jitter configuravel
- Retry exponencial (30s, 2min, 10min) com classificacao
  transient vs permanent (4xx vai direto pra falhou)
- Auto-pause se taxa de falha > 20% com base >= 10 processados
- UI `public/js/cards/campanha-card.js` + `wizards/new-campanha.js`
- CRUD completo `/api/campanhas/*` com expand, start, pause, resume

### T5 — smoke test, kill switch, alertas (`de12b8e`)
- `docs/SMOKE-TEST-CAMPANHA.md` — procedimento end-to-end
- `POST /api/campanhas/smoke-test` — cria campanha de teste em rascunho
- `POST /api/admin/kill-broadcast` + `/resume-broadcast`
  (header `X-Admin-Confirm: yes`)
- `src/utils/env-file.js` — helper idempotente para editar `.env`
- Worker le `.env` a cada iteracao — kill switch reconhecido em ate 10s
- `GET /api/health/deep` — inclui broadcast_worker (heartbeat, envios
  pendentes, campanhas ativas, kill switch flag)
- UI `public/js/cards/kill-switch.js` com fluxo `CONFIRMAR`
- Alertas via `ERROR_REPORT_WEBHOOK` em auto-pause e kill switch

---

## Sprint 6 — Proximos passos (nao iniciado)

**Objetivo:** Por o broadcast engine em producao com campanhas reais
+ resolver dividas carregadas dos sprints anteriores.

### Prioridade alta
1. **Campanha real #1** — executar smoke test documentado em
   `docs/SMOKE-TEST-CAMPANHA.md`, aprovar criterios, liberar primeira
   campanha de verdade com audiencia pequena (50-100 leads).
2. **Retomar Litestream** — escolher entre trocar B2 para us-west,
   AWS S3, ou simplesmente manter cron de snapshot local se o volume
   de dados seguir baixo. Ver `RUNBOOK-DEPLOY.md` secao 10.
3. **Dashboard de campanhas em tempo real** — ja existe polling 5s;
   adicionar grafico de envios/min e taxa de entrega.

### Backlog
- NFS-e FocusNFe (emissao automatica de NF apos conversao)
- SPC desbloqueio (integracao com SPC Brasil SOAP — ja tem ref em
  memoria de projeto)
- Profile % inadimplencia por regiao no dashboard
- fetchCustomers com paginacao para ERPs grandes (IXC, MK)
- Multi-canal: Instagram DM + email como fallback quando WhatsApp
  janela 24h fecha

### Divida tecnica conhecida
- Litestream desativado (Sprint 1/T4)
- Dependencia N8N em `heatmap-cache.ts` do Consulta_ISP principal
  (nao afeta agentes-sistema diretamente, mas compartilha VPS)
- Tests de integracao pulam quando `better-sqlite3` native bindings
  ausentes — rodar em Docker ou Node 20

---

## Estrutura de diretorios (referencia rapida)

```
agentes-sistema/
├── src/
│   ├── server.js              # Express entry (HTTP)
│   ├── worker.js              # Worker entry (broadcast + followup)
│   ├── routes/api.js          # ~1000 linhas, ~50 endpoints
│   ├── services/              # 20+ services (agentes, campanhas, etc)
│   ├── workers/broadcast.js   # loop com claim atomico
│   ├── utils/env-file.js      # helper kill switch
│   └── migrations/            # 008-011 aplicadas
├── public/                    # dashboard estatico (index.html + js/)
├── tests/integration/         # 7 suites (pulam sem SQLite native)
├── docs/SMOKE-TEST-CAMPANHA.md
├── RUNBOOK-DEPLOY.md          # ops (deploy, backup, troubleshoot)
├── ROADMAP.md                 # este arquivo (visao estrategica)
├── docker-compose.yml         # app + worker (+ litestream comentado)
├── Caddyfile                  # NAO usado em producao (nginx host faz proxy)
└── fix-vps.sh                 # deploy limpo emergencial
```

---

**Donos:** time Consulta ISP. Atualize este arquivo ao abrir cada sprint
novo (Sprint X — objetivo + T1..Tn) e ao fechar cada ticket.
