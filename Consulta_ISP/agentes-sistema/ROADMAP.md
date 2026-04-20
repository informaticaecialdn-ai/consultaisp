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

## Sprint 2 — Security + LGPD (entregue, abr/2026)

**Objetivo:** Endurecer o sistema antes de campanhas em massa: auth,
HMAC webhook, opt-out automatico, sanitizacao de inputs e mascaramento
de PII em logs.

### T1 — Auth Bearer + Helmet + Rate limit (`5e00dbd`)
- `src/middleware/auth.js` — `requireAuth` valida `Authorization: Bearer <API_AUTH_TOKEN>`
- Helmet com security headers em todas as respostas
- Rate limit `/api/*` (100 req/15min) e `/api/prospectar` (10 req/h)
- Bypass auth: `/api/health`, `/webhook/*`, estaticos
- Dashboard injeta token via `localStorage.api_token` (banner amarelo se ausente)

### T2 — HMAC token validation no webhook Z-API (`c16fe6c`)
- `validateZapiToken()` em `routes/webhook.js` valida header `x-z-api-token`
- Modo enforce/log-only via `ZAPI_WEBHOOK_ENFORCE=true|false`
- `setWebhook()` configura Z-API com header customizado para callback HMAC

### T3 — Opt-out LGPD automatico (`2d3755b`)
- `consent.detectOptOutFromMessage()` com regex ESTRITA (evita falso-positivo)
- Webhook detecta `STOP|SAIR|PARAR|CANCELAR|UNSUBSCRIBE|...` e marca `lead_opt_out`
- Cancela followups + envia confirmacao + responde 200
- `orchestrator.sendOutbound` bloqueia telefones com optout (`{blocked:true}`)
- 4 endpoints CRUD em `/api/consentimento`

### T4 — Sanitizacao Zod (`8ed0123`)
- `src/schemas/api.js` — schemas Zod para 4 endpoints criticos
- `src/middleware/validate.js` — wrapper centralizado, devolve 400 com `issues[]`
- Aplicado em `/api/leads`, `/api/prospectar`, `/api/send`, `/api/campanhas`

### T5 — Pino logger + PII mascarado (`56d50e6`)
- `src/utils/logger.js` — Pino com `redact` automatico de tokens/headers
- `src/utils/pii.js` — `maskPhone(5511****1234)`, `maskName`, `maskMessage`
- Substituido `console.*` por `logger.*` em 6 services criticos
- Dev: pino-pretty colorido. Prod: JSON estruturado

---

## Sprint 3 — Observability (entregue, abr/2026)

**Objetivo:** Operar com confianca: correlacionar logs, rastrear custo
Claude, tests automatizados, health profundo e captura de erros.

### T1 — Pino + correlationId (`2f780c0`)
- `src/middleware/correlation.js` — gera/propaga `X-Correlation-Id` em todas as routes
- `req.logger = logger.withCorrelation(id)` disponivel em handlers
- Substituido `console.*` em 9 services restantes (training, ab-testing,
  instagram, email-sender, meta-ads, google-ads, ads-optimizer, skills-knowledge)
- `.eslintrc.json` com `no-console` warn (allow `error`, `warn`)

### T2 — Painel custo Claude (`e130e51`)
- Migration `012-claude-usage.sql` (agente, modelo, tokens, custo_usd, correlation_id)
- `data/claude-prices.json` — precos por modelo com `verified_at`
- `src/utils/cost-calculator.js` — calcula USD por modelo
- `src/utils/claude-client.js` — wrapper que persiste em `claude_usage`
- `claude.js` + `training.js` migrados para o wrapper
- Endpoints `/api/costs/{today,month,range,timeseries}`
- `services/cost-monitor.js` — alerta diario via `COST_ALERT_WEBHOOK`
- `cost-card.js` no dashboard (verde/amarelo/vermelho por threshold)

### T3 — Vitest + 8 testes integracao + CI (`146ba1f`)
- `vitest` + `supertest` + `@vitest/coverage-v8`
- `vitest.config.js` escopa apenas `tests/integration/sprint3/`
- Legacy tests movidos para `tests/legacy/` com README
- 8 testes: auth, webhook-hmac, opt-out, outbound-blocked, validation,
  followup-lock, claude-messages, diagnose
- Helpers `db/auth/app` para setup em memoria (`DB_PATH=:memory:`)
- Tests pulam se `better-sqlite3` bindings indisponiveis (Node 24 local)
- CI `.github/workflows/test.yml` com Node 20 (prebuilds funcionam)

### T4 — /api/health/deep com 7 checks (`28aee15`)
- `services/health-checker.js`: db, anthropic, zapi, backup, disk, memory, uptime
- Anthropic + Z-API cacheados 60s (zero custo extra)
- `/api/health/deep` publico retorna apenas `{status}`; com Bearer retorna detalhe
- HTTP 503 se overall=down, 200 caso contrario
- `scripts/backup-snapshot.sh` grava `data/.last-backup-at` (heartbeat)
- `health-card.js` no dashboard (semaforo verde/amarelo/vermelho)

### T5 — Errors log + uncaughtException (`711165e`)
- Migration `013-errors-log.sql`
- `services/error-tracker.js` persiste + aciona webhook + cleanup 24h
- `server.js`: handler Express + `process.on('uncaughtException'|'unhandledRejection')`
- Endpoints `/api/errors`, `/errors/count`, `/errors/:id`, `/errors/cleanup`
- `uncaughtException` aguarda 1s antes de `process.exit(1)`
- `errors-card.js` no dashboard (count vermelho se > 0)

---

## Sprint 4 — Audiencias + Templates (entregue, abr/2026)

**Objetivo:** Substituir os stubs de Sprint 4 (008-sprint4-stubs.sql) por
implementacao real de audiencias dinamicas com query builder seguro,
templates com versionamento e preview live, opt-in tracking.

### T1 — Audiencias service + query builder (`314043a`)
- Migration `014-sprint4-fields.sql` adiciona campos: `ativa`, `criada_por`,
  `total_leads_atualizado_em` em audiencias; `categoria`, `ativo`,
  `meta_template_id`, `variaveis_obrigatorias` em templates;
  `status`, `optin_em`, `optin_origem`, `atualizado_em` em lead_opt_out
- `src/utils/audiencia-query-builder.js` com whitelist estrita (10 filtros)
- Params prepared, NUNCA interpolados. Filtros invalidos ignorados silenciosamente
- `services/audiencias.js` estendido: `createEstatica`, `createDinamica`,
  `previewLeads`, `removeLead`, `countByFiltros`, soft delete (`ativa=0`)

### T2 — Template engine completo (`84be5c5`)
- `utils/template-engine.js`: render com `{{var|fallback}}`, `enrichVars`
  (`saudacao`, `dia_semana`, `primeiro_nome`), `missingVariables`
- `services/templates.js` completo: `getByNome`, `clone`, `renderForLead`,
  `previewWithSamples`, `renderPreview` (live), versao++ em mudanca de conteudo,
  soft delete (`ativo=0`), `removeHard` separado
- `services/template-engine.js` vira re-export do utils/ (compat Sprint 5)
- Schemas Zod: `template`, `templateUpdate`, `audienciaCreate`
  (discriminated union), `audienciaUpdate`, `filtrosSchema`

### T3 — Window checker 24h + opt-in tracking (`4b3ad69`)
- `window-checker.js`: `canSendFreeForm` retorna `allowed/reason/recommendation/`
  `hoursSince/hoursRemaining`
- `canReceiveAnyOutbound` combina janela + consent
- `batchCheckWindow` otimizado (1 query para N leads)
- `consent.markOptIn`: insere `status='ativo'` sem sobrescrever optout
- Webhook marca opt-in automatico em inbound organico
- Endpoint `GET /api/leads/:id/can-send`

### T4 — CRUD audiencias + UI (`77fc43e`)
- 10 endpoints auth Bearer em `/api/audiencias/*`:
  GET list, POST create (Zod discriminated), GET :id, PUT :id, DELETE :id (soft),
  GET :id/leads, GET :id/preview, POST :id/refresh-count,
  POST :id/leads, DELETE :id/leads/:leadId, POST `/audiencias/count` (live)
- `audiencias-list.js`: tabela com preview/refresh/excluir actions
- `new-audiencia.js`: modal 2 tabs (Estatica | Dinamica) com preview live
  de count (debounce 500ms)
- Menu lateral ganha entrada "Audiencias"

### T5 — CRUD templates + UI editor (`d126778`)
- 8 endpoints auth Bearer em `/api/templates/*`:
  GET list, POST create (Zod), GET :id, PUT :id (incrementa versao),
  DELETE :id (soft), GET :id/render?leadId=X,
  GET :id/preview?audienciaId=Y&n=3, POST :id/clone,
  POST `/templates/render-preview` (render live sem persistir)
- `template-card.js`: grid de cards com versao, vars, badges HSM/INATIVO
- `template-editor.js`: modal com preview live (debounce 500ms) +
  sample vars + char count + warnings de var faltando
- Menu lateral ganha entrada "Templates"

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

### Prioridade BLOQUEADOR
0. **Restaurar credenciais Z-API** — instance configurada em `.env`
   da VPS retorna "Instance not found" ao chamar `/api/setup-webhook`.
   Sem isso, broadcast/inbound nao funcionam. Verificar painel Z-API
   e atualizar `ZAPI_INSTANCE_ID`/`ZAPI_TOKEN`/`ZAPI_CLIENT_TOKEN`.

### Prioridade alta
1. **Campanha real #1** — depois de Z-API funcionar, executar smoke
   test documentado em `docs/SMOKE-TEST-CAMPANHA.md`, aprovar criterios,
   liberar primeira campanha de verdade com audiencia pequena (50-100 leads).
2. **Flipar `ZAPI_WEBHOOK_ENFORCE=true`** — depois de validar via logs
   que Z-API esta enviando o header `X-Z-API-Token` corretamente.
3. **Retomar Litestream** — escolher entre trocar B2 para us-west,
   AWS S3, ou Cloudflare R2. Ver `RUNBOOK-DEPLOY.md` secao 10.
4. **Dashboard de campanhas em tempo real** — ja existe polling 5s;
   adicionar grafico de envios/min e taxa de entrega.

### Limpeza tecnica recomendada
- **Caddyfile + servico caddy no docker-compose** — VPS usa nginx do host
  (Sprint 1/T3). Codigo morto. Decidir: deletar ou manter como exemplo.
- **Stubs Meta/Google Ads** — `meta-ads.js`, `google-ads.js`,
  `ads-optimizer.js` estao implementados mas nunca chamados pelo
  orchestrator. Decidir: integrar (chamar em `_processAction`) ou deletar.
- **Tests legacy** — `tests/integration/*.test.js` (Sprint 5) sao scripts
  Node, nao Vitest. Migrar pra Vitest ou mover pra `tests/legacy/`.

### Backlog
- NFS-e FocusNFe (emissao automatica de NF apos conversao)
- SPC desbloqueio (integracao com SPC Brasil SOAP — ja tem ref em
  memoria de projeto)
- Profile % inadimplencia por regiao no dashboard
- fetchCustomers com paginacao para ERPs grandes (IXC, MK)
- Multi-canal: Instagram DM + email como fallback quando WhatsApp
  janela 24h fecha
- UI explicita para kill switch (`/api/admin/kill-broadcast` so e
  acessivel via curl com header `X-Admin-Confirm: yes`)

### Divida tecnica conhecida
- Litestream desativado (Sprint 1/T4)
- Caddy comentado em docker-compose.yml (substituido por nginx host
  no Sprint 1/T3)
- Dependencia N8N em `heatmap-cache.ts` do Consulta_ISP principal
  (nao afeta agentes-sistema diretamente, mas compartilha VPS)
- Tests de integracao Sprint 5 pulam quando `better-sqlite3` native
  bindings ausentes — rodar em Docker ou Node 20
- Tests Sprint 3 (Vitest) tambem pulam em Node 24 local; CI Node 20 funciona

---

## Estrutura de diretorios (referencia rapida)

```
agentes-sistema/
├── src/
│   ├── server.js              # Express entry (HTTP) + helmet + auth + correlation
│   ├── worker.js              # Worker entry (broadcast + followup)
│   ├── routes/                # api.js (~50 endpoints), webhook.js, ads.js, supervisor.js, dashboard.js
│   ├── middleware/            # auth.js, correlation.js, validate.js (Sprints 2/3)
│   ├── schemas/api.js         # schemas Zod (Sprint 2/T4)
│   ├── services/              # 24 services (claude, zapi, orchestrator, campanhas, audiencias, templates, ...)
│   ├── workers/               # broadcast.js, followup-worker.js
│   ├── utils/                 # logger.js (Pino), pii.js, claude-client.js, cost-calculator.js,
│   │                          # template-engine.js, audiencia-query-builder.js, env-file.js
│   └── migrations/            # 008-014 aplicadas (008 stubs, 009-011 broadcast, 012 cost,
│                              # 013 errors, 014 sprint4 fields)
├── public/
│   ├── index.html             # dashboard com banner auth + cards observability
│   └── js/
│       ├── cards/             # cost, health, errors, audiencias-list, template, campanha, kill-switch
│       ├── modals/            # new-audiencia, template-editor
│       └── wizards/           # new-campanha
├── data/
│   ├── agentes.db             # SQLite (better-sqlite3)
│   ├── claude-prices.json     # precos por modelo (Sprint 3/T2)
│   └── .last-backup-at        # heartbeat usado por health/deep
├── tests/
│   ├── setup.js               # config global Vitest
│   ├── helpers/               # db, auth, app
│   ├── integration/sprint3/   # 8 testes Vitest (Sprint 3)
│   ├── integration/           # tests legados Sprint 5 (scripts Node)
│   └── legacy/                # tests anteriores arquivados
├── scripts/
│   ├── deploy-sprint4.sh      # deploy idempotente VPS (Sprint 2/3/4)
│   ├── smoke-test-deploy.sh   # validacao deploy sem rebuild
│   ├── backup-snapshot.sh     # snapshot SQLite + heartbeat
│   └── restore-litestream.sh  # restore (Litestream desativado)
├── docs/SMOKE-TEST-CAMPANHA.md
├── RUNBOOK-DEPLOY.md          # ops (deploy, backup, troubleshoot)
├── ROADMAP.md                 # este arquivo (visao estrategica)
├── docker-compose.yml         # app + worker (+ caddy/litestream comentados)
├── vitest.config.js           # Vitest config (Sprint 3/T3)
├── .eslintrc.json             # no-console warn (Sprint 3/T1)
├── Caddyfile                  # DEAD CODE (nginx host substitui em prod)
└── fix-vps.sh                 # deploy limpo emergencial
```

---

## Estado atual do sistema (snapshot abr/2026)

| Componente | Status | Observacao |
|-----------|--------|------------|
| Express server | OK | porta 3001, exposto :3080 via 127.0.0.1 |
| Worker process | OK | container `consulta-isp-worker` separado |
| Auth Bearer | OK | token via `API_AUTH_TOKEN`, dashboard com banner |
| HMAC webhook | log-only | `ZAPI_WEBHOOK_ENFORCE=false` na VPS (transicao gradual) |
| Pino logs + correlation | OK | JSON estruturado em prod, pino-pretty em dev |
| Cost monitoring | OK | tabela claude_usage, alerta diario via webhook |
| Health/deep (7 checks) | OK | 503 se overall=down, publico = `{status}` apenas |
| Errors log | OK | uncaughtException capturado, cleanup 90+ dias |
| Audiencias service+UI | OK | estatica + dinamica com 10 filtros whitelist |
| Templates service+UI | OK | preview live, versionamento, HSM flag |
| Window checker 24h | OK | + opt-in tracking automatico em inbound |
| Broadcast engine | OK | rate limit + retry + kill switch + auto-pause |
| **Z-API integration** | **QUEBRADO** | **Instance not found - precisa reconfig (Sprint 6/P0)** |
| Litestream | desativado | snapshot local 6h via cron (Sprint 1/T4) |
| Caddy | desativado | nginx do host substitui (Sprint 1/T3) |
| Meta/Google Ads | stub | services existem mas nao chamados |

---

**Donos:** time Consulta ISP. Atualize este arquivo ao abrir cada sprint
novo (Sprint X — objetivo + T1..Tn) e ao fechar cada ticket.

---

## Autonomia End-to-End (Milestones 1-3, 2026-04)

Direcao: sistema vira **self-driving** — ciclo prospeccao→qualificacao→fechamento
rodando 24h sem operador, reportando apenas excecoes. Ver [`.planning/AUTONOMY.md`](.planning/AUTONOMY.md)
pra visao completa e [`.planning/STATUS.md`](.planning/STATUS.md) pra progresso.

### Entregue
| Componente | Arquivos | Flag |
|-----------|----------|------|
| Tools registry (17 handlers) | `src/tools/` | — |
| platform-agent-client (tool_use loop) | `src/services/platform-agent-client.js` | `USE_TOOL_CALLING_AGENTS` |
| Migration 016 `agent_tool_calls` | `src/migrations/016-*` | — |
| Prospector autonomo | `src/workers/prospector.js` + `src/services/lead-validator.js` | `PROSPECTOR_WORKER_ENABLED` |
| Outbound autonomo (Carlos) | `src/workers/outbound.js` | `OUTBOUND_WORKER_ENABLED` |
| Supervisor (Diana cron 1h) | `src/workers/supervisor.js` | `SUPERVISOR_WORKER_ENABLED` |
| Auto-healer + kill switches | `src/services/auto-healer.js` + migration 018 | monitor sempre on |
| UI painel `/autonomia` | `public/js/cards/autonomy-panel.js` | — |
| Skill BANT | `skills-ref/carlos-qualificacao-bant.md` | — |

Todas as flags **default OFF** pra rollout seguro. Ordem recomendada
em [`.planning/STATUS.md`](.planning/STATUS.md#rollout-recomendado--quando-ligar-as-flags).

### Pendente externo
- [ ] Z-API reconfig (usuario na VPS)
- [ ] Ativacao progressiva das flags (1 por dia)

