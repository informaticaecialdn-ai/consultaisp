# Auditoria Completa — Sistema de Agentes de Vendas (Consulta ISP)

**Data:** 2026-04-16
**Executante:** Claude (13 skills aplicadas em sequência)
**Escopo:** `C:\ClaudeCode\Consulta_ISP\agentes-sistema\`

---

## Contexto de produto

Distinção importante pro resto do documento:

| Nome                                | O que é                                                                                              | Relação                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Consulta ISP** (produto)          | Plataforma SaaS de **análise de crédito para provedores de internet** — é o produto que se vende.     | Cliente final = ISPs brasileiros   |
| **Sistema de Agentes AI** (este)    | Ferramenta interna com 7 agentes de IA que prospectam, qualificam e fecham vendas do Consulta ISP.   | Motor comercial do produto acima   |

Esta auditoria cobre **apenas o Sistema de Agentes AI** — o motor de vendas que usa WhatsApp/Z-API, Claude AI e Instagram DM para converter ISPs em clientes do produto Consulta ISP. O produto em si (análise de crédito) não está no escopo desta auditoria.

**Perfil dos leads que o sistema trata:**

- Sócios, CEOs, diretores comerciais/financeiros de ISPs brasileiros
- ISPs com 300+ assinantes ativos tipicamente
- Usam ERPs como SGP, IXC Soft, MK-AUTH, Radius Manager, Voalle
- Procuram reduzir inadimplência (normal no setor: 5-12% do MRR)

**O que os agentes argumentam (pitch):**

- "O Consulta ISP consulta CPF/CNPJ antes do contrato, reduz inadimplência em até 40%."
- "Integração nativa com seu ERP (SGP/IXC/MK), sem trabalho pra TI."
- "Monitora a base ativa e avisa quando cliente degrada score."

---

## Sumário Executivo

### Veredito geral

**Sistema funcional na camada core, mas não pronto pra operar com leads reais de ISPs na forma atual.** Há bloqueadores críticos de segurança, compliance (LGPD) e risco operacional que precisam ser tratados antes de qualquer ativação comercial com leads reais ou campanha de broadcast.

### Pontuação por pilar (0-10)

| Pilar                              | Score | Justificativa resumida                                                              |
| ---------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| Código (arquitetura + correção)    | 6.0   | Boa separação de responsabilidades; 17 issues abertos, 4 críticos                   |
| Segurança                          | 3.0   | Webhook e API sem auth, token na URL, race condition, container como root           |
| Compliance (LGPD + Meta/WA policy) | 2.5   | Sem opt-out, sem aviso de coleta, sem retenção definida                             |
| Observabilidade                    | 4.0   | Logs morgan dev apenas; sem métricas, sem tracing, sem alerta                       |
| Confiabilidade / resiliência       | 4.5   | SQLite funciona mas sem backup; scheduler in-process; sem retry em envio            |
| UX / Acessibilidade                | 4.5   | Dashboard único; menus confirmadamente quebrados; WCAG 2.1 AA falha em 14/20 itens  |
| Arquitetura pra escalar            | 5.0   | Monolito Node+SQLite OK hoje; precisa de 5 ADRs antes de broadcast 1:N em massa     |
| Documentação                       | 5.5   | GUIA-DEPLOY existe mas diverge do estado real; faltam runbooks de incidente         |

**Média ponderada: 4.4 / 10** — categoria "Beta técnico, não produção".

### Top 10 achados por impacto

| #  | Achado                                                                              | Severidade | Onda |
| -- | ----------------------------------------------------------------------------------- | ---------- | ---- |
| 1  | Conflito nginx × Caddy na :80 impede acesso externo ao dashboard hoje               | 🔴 P0      | 0    |
| 2  | Webhook Z-API aceita qualquer payload externo sem HMAC                              | 🔴 P0      | 1    |
| 3  | Todos os endpoints `/api/*` estão públicos — vazamento de PII + envio manual livre  | 🔴 P0      | 1    |
| 4  | Token Z-API na URL — aparece em logs de proxy, morgan, APM                          | 🔴 P0      | 1    |
| 5  | Sem opt-out (STOP) — violação LGPD + Meta Business Policy                           | 🔴 P0      | 1    |
| 6  | Sem aviso de coleta de dados (LGPD Art. 9º)                                          | 🔴 P0      | 1    |
| 7  | Sem backup automatizado do SQLite — perda total em falha de disco                    | 🟠 P1      | 1    |
| 8  | Race condition em `processIncoming` → lead duplicado se 2 msgs simultâneas           | 🟠 P1      | 1    |
| 9  | Menus do dashboard confirmadamente não funcionam (event handlers inline quebrados)  | 🟠 P1      | 0    |
| 10 | Scheduler de follow-up in-process — restart perde/duplica mensagens                  | 🟡 P2      | 2    |

### Plano de 5 ondas (visão agregada)

| Onda  | Prazo       | Objetivo                                                                                                |
| ----- | ----------- | ------------------------------------------------------------------------------------------------------- |
| 0     | Esta semana | Colocar dashboard online + push dos arquivos locais + fix do conflito nginx                             |
| 1     | 2 semanas   | Bloqueadores de segurança e compliance (HMAC, auth, rate limit, opt-out LGPD para ISPs, backup)         |
| 2     | 1 mês       | Observabilidade (logs estruturados, métricas, APM), container não-root, revisão dos prompts dos agentes |
| 3     | 2 meses     | Arquitetura pra broadcast 1:N (fila, worker pool, migração SQLite → PostgreSQL gerenciado)              |
| 4     | 3 meses     | Multi-tenant (se Consulta ISP quiser vender o motor white-label), UX revisada, a11y AA, contratação automática |

### Métricas de sucesso pós-plano (propostas)

**Métricas técnicas do sistema de agentes:**

- **Entregabilidade WhatsApp:** ≥ 95% lidos em 24h
- **Tempo médio de resposta do bot:** < 3s p95
- **Uptime dashboard:** ≥ 99.5%
- **Zero incidentes de PII leak** nos 90 dias após Onda 1

**Métricas comerciais (conversão de ISPs em clientes Consulta ISP):**

- **Taxa de resposta do lead ISP:** ≥ 35% (inbound), ≥ 12% (outbound)
- **Conversão Carlos → Lucas (ISP qualificado):** ≥ 18%
- **Conversão Lucas → Rafael (proposta enviada):** ≥ 40%
- **Fechamento Rafael → ganho (ISP virou cliente):** ≥ 25%
- **CAC (custo de aquisição de cliente ISP):** definir baseline em 90 dias

### Documentos relacionados

- **TOPOLOGIA-SISTEMA.md** — topologia completa + 10 diagramas de fluxo (Mermaid)
- **PROMPT-CLAUDE-CODE-ONDA0.md** — prompt executável pro Claude Code resolver Onda 0
- **RECUPERACAO-DASHBOARD.md** — runbook específico do incidente nginx×Caddy
- Abaixo: detalhamento técnico por skill (13 seções)

---

## Tier 1 - Auditoria Técnica

### 1.1 Code Review

**Sumário:** Código funcional, com boa separação de responsabilidades (routes/services/models), mas tem **17 issues críticos ou relevantes** em segurança, performance e correção. Veredito: Request Changes.

**Issues Críticos**

| # | Arquivo | Linha | Issue | Severidade |
|---|---|---|---|---|
| C1 | `routes/webhook.js` | 7-42 | **Webhook Z-API sem autenticação**. Qualquer pessoa no mundo pode POST em `/webhook/zapi` e injetar leads/mensagens falsas. Precisa validar `Client-Token` ou HMAC. | Crítica |
| C2 | `routes/webhook.js` | 38-41 | Retorna `200` em caso de erro com mensagem interna no body. Vaza stack/erro pro atacante e confunde Z-API (que vai achar que foi processado). Deve retornar 4xx/5xx apropriado e não vazar `error.message`. | Alta |
| C3 | `routes/api.js` | geral | **Nenhum endpoint `/api/*` tem autenticação**. `/api/leads`, `/api/send`, `/api/prospectar`, `/api/transferir` são todos públicos. Qualquer um pode listar todos os leads/telefones ou disparar WhatsApp. | Crítica |
| C4 | `routes/api.js` | 80 | **SQL injection via template literal** em `metricas/historico`: `WHERE data >= DATE('now', '-${parseInt(dias)} days')`. `parseInt` mitiga, mas é padrão perigoso — o linter/revisor pode não pegar em próximas mudanças. | Média (mitigada) |
| C5 | `services/orchestrator.js` | 234 | **SQL injection via nome de coluna** em `_updateDailyMetric`: `SET ${campo} = ${campo} + ?`. `campo` vem de callers internos, mas não há whitelist. Qualquer alteração futura que exponha isso abre injection. | Alta |
| C6 | `services/orchestrator.js` | 247 | `_updateLeadData` usa `${key}` direto na query sem validar contra whitelist. `dados_extraidos` vem de JSON do Claude — se o modelo alucinar um nome de coluna arbitrário, pode afetar qualquer campo. | Alta |
| C7 | `services/orchestrator.js` | 16-66 | **Race condition** em `processIncoming`: duas mensagens do mesmo lead chegando simultâneas duplicam o `INSERT` na linha 19 (sem UNIQUE constraint em `telefone`? verificar DB) e podem causar handoffs duplicados. Precisa de lock/transação por `telefone`. | Alta |
| C8 | `routes/webhook.js` | 94 | Comparação de `verify_token` usa `===` (time-comparison). Susceptível a timing attack. Use `crypto.timingSafeEqual`. | Média |
| C9 | `services/zapi.js` | 12 | **Token da Z-API na URL** (`.../token/${this.token}/send-text`). Vai pros logs do servidor, proxies, APM. Z-API permite, mas deveria estar em header. | Alta |
| C10 | `services/orchestrator.js` | 40,47 | `JSON.parse(lastSent.metadata)` sem try/catch isolado adequado — o catch externo engole silenciosamente. Se metadata estiver malformado, tracking de A/B test é perdido sem log. | Baixa |

**Issues de Performance**

| # | Arquivo | Linha | Issue | Categoria |
|---|---|---|---|---|
| P1 | `routes/api.js` | 104-129 | `/metricas/agentes` faz 6 queries × N agentes (30 queries totais) em loop síncrono. Resolver com 1 query agregada usando `GROUP BY`. | N+1 |
| P2 | `routes/api.js` | 132-157 | `/leads` faz `COUNT(*)` separado do `SELECT` — duas queries. Com dataset grande, considerar window function `COUNT(*) OVER()`. | Performance |
| P3 | `services/orchestrator.js` | 42 | `_getHistorico` busca histórico toda mensagem recebida. Com lead de 200+ mensagens, carrega só as últimas 10, OK. Mas falta índice em `conversas(lead_id, criado_em DESC)`. | Index faltando |
| P4 | `routes/api.js` | 20-72 | `/stats` faz ~12 queries sequenciais. Pode usar `UNION ALL` ou rodar em paralelo com `Promise.all` (mas better-sqlite3 é síncrono). Aceitar o trade-off ou migrar pra queries agregadas únicas. | Performance |
| P5 | `services/orchestrator.js` | 67 | `INSERT` de conversa usa `JSON.stringify(metadata)` — se metadata crescer muito, SQLite armazena blob grande. OK por enquanto, mas monitorar tamanho médio. | Growth risk |

**Issues de Correção**

| # | Arquivo | Linha | Issue |
|---|---|---|---|
| F1 | `services/orchestrator.js` | 56-65 | Handoff automático usa `>= 61` e `>= 81`, mas elif `score_total < 31 AND score_total > 0`. Se score ficar entre `0` e `31` incluindo zero, não devolve pra marketing. Provavelmente intencional (score 0 = ainda sem dados), mas não documentado. |
| F2 | `services/orchestrator.js` | 19 | INSERT de lead com `agente_atual: 'carlos'` hardcoded. Se Carlos for desabilitado/renomeado, sistema quebra. Deveria ler de config. |
| F3 | `services/orchestrator.js` | 134 | Em `sendOutbound`, se `abTesting.getVariant` retorna algo mas `zapi.sendText` falha, o A/B `recordSend` já foi contabilizado — métrica inflada. Precisa de compensação em caso de erro. |
| F4 | `routes/webhook.js` | 11-13 | Retorna 200 `{status:'ignored'}` pra qualquer payload sem `phone` ou `text.message`. Mas mensagens de mídia (áudio, imagem) caem nesse branch e são silenciosamente perdidas. Deveria logar e/ou processar. |
| F5 | `services/zapi.js` | 26 | `if (!clean.startsWith('55')) clean = '55' + clean;` — se o usuário já mandou `+55 11 ...` sem traços, vira `5511...` (OK), mas `011 ...` vira `1111...` (quebra). Cobertura incompleta. |
| F6 | `routes/api.js` | 152 | `ORDER BY ${col} ${direction}` usa whitelist pra `col` (OK), mas SQL literal pra direction (OK por validação). Parece seguro; mencionando pra documentação. |
| F7 | `services/orchestrator.js` | 265 | `_getHistorico` faz `.reverse()` em JS depois de `ORDER BY criado_em DESC LIMIT`. Mais eficiente: `ORDER BY criado_em ASC` diretamente com subquery. |

**O que está bom**

- Separação clara de responsabilidades (routes → services → models).
- Uso de `better-sqlite3` com prepared statements em 95% dos casos (evita SQL injection na maioria).
- `dotenv` + config centralizada em classes.
- Idempotência razoável no `transferLead` (insert em `handoffs` + update em `leads`).
- `morgan('dev')` pra observabilidade básica.
- Estrutura de handoff por score é bem pensada (31/61/81).

**Veredito:** ⚠️ **Request Changes** — Corrigir C1 (webhook auth), C3 (API sem auth), C7 (race condition) e C9 (token na URL) antes de operar com dados reais de clientes.

### 1.2 Architecture Assessment

**Resumo:** Monolito Node + SQLite em Docker, com 7 agentes Claude, webhook Z-API, dashboard estático. Para o estágio atual (validação), a arquitetura é adequada. Para escala (1:N broadcast, múltiplos clientes, alta disponibilidade), tem **5 decisões arquiteturais pendentes** que precisam de ADRs formais.

**Diagrama atual (inferido do código)**

```
┌─────────────────┐      ┌──────────────────┐
│  WhatsApp (Z-API)│──POST─▶│ /webhook/zapi    │
│  Instagram DM   │──POST─▶│ /webhook/instagram│
└─────────────────┘      └────────┬─────────┘
                                   │
                          ┌────────▼─────────┐
                          │   Orchestrator   │
                          │  (processIncoming)│
                          └────────┬─────────┘
                                   │
            ┌──────────┬───────────┼───────────┬────────────┐
            ▼          ▼           ▼           ▼            ▼
      ┌──────────┐ ┌────────┐ ┌──────────┐ ┌────────┐ ┌─────────┐
      │ Claude   │ │ SQLite │ │ Training │ │ Follow-│ │ A/B Test│
      │ (7 agents)│ │ 12 tbls│ │ Engine   │ │ up Sch │ │ Engine  │
      └──────────┘ └────────┘ └──────────┘ └────────┘ └─────────┘
                                   │
                          ┌────────▼─────────┐
                          │  Dashboard HTML  │
                          │ (express.static) │
                          └──────────────────┘
```

**Pontos fortes**

- **Simplicidade operacional**: 1 container, 1 banco, 1 config. Deploy em qualquer VPS de R$ 40/mês.
- **Acoplamento baixo por serviço**: cada serviço (orchestrator, claude, zapi, training, followup, ab-testing) é um módulo independente com interface clara.
- **State management pragmático**: SQLite com WAL mode lida bem com ~100 req/s em Node síncrono.
- **Fire-and-forget em hot path**: treinamento e análise assíncronos não bloqueiam resposta ao lead.

**Pontos fracos arquiteturais**

| # | Problema | Impacto |
|---|---|---|
| A1 | **Monolito sem processos separados**. Scheduler (follow-up) roda no mesmo `setInterval` do web server. Se um crash, os dois caem. | Alto |
| A2 | **SQLite compartilhado sem replicação**. Backup manual, sem snapshot point-in-time. Perda de dados se o volume Docker corromper. | Alto |
| A3 | **Sem fila/queue**. Webhook da Z-API chama Claude SYNC antes de responder. Se Claude demorar 5s, a Z-API pode dar timeout e retentar — duplicação de mensagem. | Crítico |
| A4 | **Sem circuit breaker**. Falha do Claude/Z-API derruba o fluxo inteiro. | Médio |
| A5 | **Sem idempotência no webhook**. Z-API pode retentar a mesma mensagem (`messageId`) e o sistema processa 2x. | Alto |
| A6 | **State único (sem multi-tenancy)**. Preparar para múltiplos clientes exige refactor do schema (tenant_id em todas as tabelas). | Médio (futuro) |
| A7 | **Frontend acoplado ao backend**. Um único `index.html` de 750 linhas, sem bundler. Impossível testar componentes isoladamente. | Médio |

**ADRs que precisam ser escritos (pendentes)**

**ADR-001: Queue para processamento de webhooks**
- Status: Proposed
- Contexto: Webhook Z-API dá timeout se Claude demorar. Retentativas duplicam.
- Opções:
  - **A) BullMQ + Redis** — robusto, jobs com retry/dead-letter, requer Redis.
  - **B) better-queue (SQLite-backed)** — zero dep nova, mas simples demais pra escala.
  - **C) Deixar síncrono e responder 200 ACK antes de processar (fire-and-forget)** — simples, mas perde mensagens em crash.
- Recomendação: **A** (BullMQ) se for operar produção séria; **C** (ACK imediato + worker in-process) se MVP.

**ADR-002: SQLite vs Postgres**
- Status: Proposed
- Contexto: SQLite funciona pra ~50 leads ativos/dia, single-writer. Broadcast 1:N (disparar 10k msgs/hora) pode travar em locks.
- Opções:
  - **A) Manter SQLite com WAL** — zero mudança, OK até ~200 writes/s.
  - **B) Migrar pra Postgres (supabase/neon)** — concurrent writers, replicação, backup automático.
  - **C) Híbrido: SQLite pra conversas/leads, Redis/Postgres só pra queues** — pragmático.
- Recomendação: **A** até lançar broadcast; **B** quando tiver 5+ clientes.

**ADR-003: Single Z-API instance vs múltiplas**
- Status: Proposed
- Contexto: Um número WhatsApp tem limite de rate. Broadcast massivo pode banir.
- Opções:
  - **A) Um número só com rate limiter + HSM approved templates** — conservador, lento.
  - **B) 3-5 números em pool com round-robin** — mais throughput, custo 3-5x Z-API.
  - **C) WhatsApp Cloud API (Meta direto)** — mais barato em volume, mais burocrático (verificação, template approval).
- Recomendação: **A** por enquanto; planejar **C** pra broadcast ≥ 50k msgs/mês.

**ADR-004: Dashboard — SPA vs Server-rendered**
- Status: Proposed
- Contexto: `index.html` de 750 linhas com JS inline e zero build. Bug de escape HTML derrubou tudo.
- Opções:
  - **A) Manter single HTML** — zero build, simples, rápido de editar.
  - **B) Migrar pra React/Vue com Vite** — componentizado, testável, mas adiciona build pipeline.
  - **C) HTMX + templates server-side (EJS/Nunjucks)** — pragmático, JS mínimo.
- Recomendação: **C** é o meio-termo ideal pra operação pequena. **A** se time é 1 dev.

**ADR-005: Multi-tenancy**
- Status: Proposed (diferido)
- Contexto: Hoje é single-org (Consulta ISP interno). Se virar produto SaaS, precisa isolar dados por cliente.
- Opções:
  - **A) Row-level tenant_id em todas as tabelas** — refactor de schema, cuidado com leaks.
  - **B) Database por tenant** — isolamento forte, overhead de migrations.
  - **C) Deploy dedicado por cliente (Docker container por org)** — ultra simples, não escala.
- Recomendação: diferir decisão até validar modelo de negócio.

**Ações imediatas de arquitetura (próximos 30 dias)**

1. Adicionar idempotência ao webhook: guardar `messageId` em tabela `webhook_events` com UNIQUE, retornar 200 imediatamente se já processado.
2. Separar processos em 2 containers no docker-compose: `web` e `worker` (mesmo código, flag `--worker` ativa só os schedulers).
3. Adicionar circuit breaker em `claude.js` e `zapi.js` (biblioteca `opossum`).
4. Backup automático do SQLite: cronjob que copia `data/` pra S3/Backblaze todo dia às 3am.
5. Escrever e aprovar os 4 ADRs acima antes de iniciar Fase 3 (Broadcast Engine) do AUDITORIA-E-PLANO.md.

### 1.3 Tech Debt Inventory

**Resumo executivo**
- Divida tecnica organizada em 6 categorias. Total de 23 itens catalogados.
- Severidade: 5 Criticos (bloqueia evolucao), 10 Altos (atrasa qualquer feature), 8 Medios (higiene).
- Esforco estimado total para zerar os Criticos + Altos: ~3 sprints de 2 semanas (1 dev full-time).

**Categoria A - Poluicao do root / arquivos orfaos (Alto)**

| ID | Item | Problema | Severidade | Esforco |
|----|------|----------|------------|---------|
| TD-A1 | 7 arquivos `PROMPT-*.md` no root (144KB totais) | Snapshots historicos de prompts, nao usados pela aplicacao. Confundem quem entra no repo. | Alto | 30min |
| TD-A2 | `FLUXO-SISTEMA-COMPLETO.html` + `ecossistema-vendas.html` | Documentacao visual solta. Poderia estar em `docs/` | Medio | 15min |
| TD-A3 | `skills-conhecimento-*.md` (2 arquivos, 53KB) | Knowledge-base manual de agentes. Ou integra em `src/services/skills-knowledge.js` ou move pra `docs/` | Alto | 2h |
| TD-A4 | `agente-diana-supervisora.json`, `agente-marcos-midia-paga.json`, `agentes-config.json` | 3 fontes diferentes de configuracao de agentes. Os agentes reais estao **hardcoded** em `claude.js` (C6 do code-review). Nao existe single source of truth. | Critico | 1 dia |
| TD-A5 | `dist/` (aplicacao React/Vite completa) | Um segundo sistema inteiro dentro do repo, aparentemente orfao do projeto `agentes-sistema`. Precisa decidir: e parte do roadmap, e deploy separado, ou e lixo? | Critico | Investigar |
| TD-A6 | `marketingskills-ref/` (repo git quebrado, so `.git/`) | Git submodule ou clone falhado. Sem utilidade. | Medio | 5min |
| TD-A7 | `node_modules` no root + em `agentes-sistema/` | Duplo install. Possivel resquicio de iteracoes anteriores. | Medio | 10min |

**Acao recomendada A**: mover tudo para `docs/historico/` (para auditoria), manter so `README.md` + `AUDITORIA-COMPLETA.md` no root, decidir sobre `dist/`.

**Categoria B - Configuracao dos agentes espalhada (Critico)**

Os 7 agentes Sofia/Leo/Carlos/Lucas/Rafael/Marcos/Diana existem em **4 lugares diferentes**:
1. `src/services/claude.js` - mapping `AGENTS` + system prompts hardcoded
2. `agentes-config.json` - uma versao
3. `agente-diana-supervisora.json` - Diana em separado
4. `agente-marcos-midia-paga.json` - Marcos em separado
5. `.env` - IDs dos agentes (`AGENT_SOFIA_ID`, etc) - mas o codigo nao usa esses IDs, hardcoded vence

Isso e a **causa principal** do sistema ser dificil de modificar. Para mudar um prompt da Sofia, nao existe um lugar unico.

| ID | Item | Severidade | Esforco |
|----|------|------------|---------|
| TD-B1 | Consolidar agentes em `agentes-sistema/config/agents.yaml` ou em tabela `agents` do SQLite | Critico | 2 dias |
| TD-B2 | Remover JSONs orfaos do root (migrar conteudo que esteja atualizado) | Alto | 4h |
| TD-B3 | Dashboard ler agentes do banco, nao do JS | Alto | 4h |

**Categoria C - Ausencia total de testes (Critico)**

| ID | Item | Observacao |
|----|------|------------|
| TD-C1 | `package.json` sem `test` script, sem Jest/Vitest | Critico |
| TD-C2 | Zero arquivos `*.test.js` ou `*.spec.js` em `src/` ou `tests/` | Critico |
| TD-C3 | Pasta `tests/` existe mas esta vazia | Critico |
| TD-C4 | Nao ha CI/CD configurado (sem `.github/workflows/`) | Alto |

Ver secao 2.2 (Testing Strategy) para plano detalhado. Minimo viavel: testar `orchestrator.processIncoming`, `ab-testing.selectVariant`, `followup.scheduleFollowup`.

**Categoria D - Dependencias duplicadas / nao usadas (Medio)**

`package.json` declara:
- `google-ads-api` + `facebook-nodejs-business-sdk` → usadas em `google-ads.js` + `meta-ads.js`. OK mas pesadissimas.
- `pdfkit` → usada em `pdf-report.js`. OK.
- `cors` → importado em `server.js`? Confirmar.
- `axios` + `@anthropic-ai/sdk` → o SDK ja faz fetch, axios poderia ir.
- Falta: `zod` para validacao de payloads, `pino` para logging estruturado, `express-rate-limit` para anti-abuse.

| ID | Item | Acao | Esforco |
|----|------|------|---------|
| TD-D1 | Auditar uso real de cada dep com `depcheck` | Medio | 30min |
| TD-D2 | Mover `nodemon` para `devDependencies` (ja esta) OK | — | — |
| TD-D3 | Avaliar remover `axios` (SDK ja tem HTTP) | Medio | 1h |
| TD-D4 | Adicionar `zod` + `express-rate-limit` + `pino` | Alto | 1 dia |

**Categoria E - Refactorings estruturais (Alto)**

| ID | Item | Por que e divida | Esforco |
|----|------|------------------|---------|
| TD-E1 | `src/routes/api.js` com 508 linhas | Deveria estar dividido por dominio: `api-leads.js`, `api-agents.js`, `api-stats.js`, `api-conversations.js` | 1 dia |
| TD-E2 | `src/services/google-ads.js` (453 linhas) + `ads-optimizer.js` (430) + `meta-ads.js` (369) | Sub-dominio "ads" que merece um modulo separado: `src/services/ads/`. Provavelmente nao pertence ao mesmo deploy que o WhatsApp | 2 dias |
| TD-E3 | `src/services/orchestrator.js` - handoff hardcoded | Scores 31/61/81 magicos, deveriam vir de config | 4h |
| TD-E4 | `src/services/claude.js` - 7 agents hardcoded + system prompts inline | Ver TD-B1 | 2 dias |
| TD-E5 | Sem camada de repositorio | Rotas fazem SQL direto. Deveria ter `models/LeadRepository.js`, `ConversationRepository.js` etc | 2 dias |
| TD-E6 | `public/index.html` monolitico (~1600 linhas com CSS+HTML+JS inline) | Dashboard bem melhor se migrado para Vite/React mini-app, ou pelo menos split em files separados | 3-5 dias |

**Categoria F - Observabilidade e logging (Alto)**

| ID | Item | Problema |
|----|------|----------|
| TD-F1 | Sem logger estruturado | So `console.log`. Impossivel grep/filtrar em producao |
| TD-F2 | Sem correlation id por request | Nao da pra seguir a trajetoria de 1 mensagem pelos logs |
| TD-F3 | Sem metrica de custo de tokens Claude | Cada chamada tem `usage.input_tokens` / `output_tokens` no SDK, mas nao e gravado. Voce esta cego sobre quanto cada lead custa |
| TD-F4 | Sem error tracking (Sentry ou equivalente) | Erros em producao morrem no stdout do container |

**Acoes consolidadas de tech-debt (priorizadas)**

**Sprint 1 (higiene imediata, 1 semana):**
1. [TD-A1/A2/A3/A6] Mover arquivos orfaos do root para `docs/historico/`.
2. [TD-A7] Remover `node_modules` do root.
3. [TD-D1] Rodar `depcheck` e limpar deps nao usadas.
4. [TD-F1] Adicionar `pino` como logger padrao. Substituir console.log dos services criticos.
5. [TD-C1/C3] Criar estrutura `tests/` + `jest.config.js`, mesmo sem testes ainda.

**Sprint 2 (bases, 2 semanas):**
6. [TD-B1/B2] Consolidar agentes em `config/agents.yaml` com loader em `src/services/claude.js`. Manter backward-compat do env.
7. [TD-A4/B3] Quebrar arquivos JSON do root, migrar para o novo formato.
8. [TD-E1] Split de `api.js` em modulos por dominio.
9. [TD-F3] Gravar `token_usage` em coluna nova da tabela `conversations`.
10. Escrever primeiros testes unitarios para `orchestrator` e `ab-testing`.

**Sprint 3 (estruturais, 2 semanas):**
11. [TD-A5] Decidir o destino do `dist/`. Ou move pra repo proprio ou deleta.
12. [TD-E2] Extrair `services/ads/` como modulo separado (com seu proprio package.json, se viavel).
13. [TD-E5] Introduzir camada de repositorio, migrar rotas para usar.
14. [TD-E6] Decidir arquitetura final do dashboard (seguir ADR-004 da secao 1.2).

**Itens que NAO sao divida (mas parecem)**
- SQLite — e uma escolha valida para o volume atual. So vira divida se passar de ~100 mensagens/s sustentadas.
- Monolito Node — idem. Nao preciso quebrar em microservicos.
- Docker Compose — boa escolha para single-VPS. Nao precisa k8s agora.

**Metricas antes/depois (baseline 16/04/2026)**
| Metrica | Hoje | Alvo Sprint 3 |
|---------|------|---------------|
| Arquivos no root | 17 | 3 (README, AUDITORIA-COMPLETA, docs/) |
| LOC em `api.js` | 508 | < 200 por arquivo |
| Fontes de config de agente | 4 | 1 |
| Cobertura de testes | 0% | 40% nos services criticos |
| Logger estruturado | Nao | Sim |
| Custo de token trackado | Nao | Sim |

### 1.4 Security Review

**Escopo**: revisao OWASP Top 10 + controles especificos para webhook/WhatsApp + gestao de secrets.

**Veredito geral: CRITICO - Nao expor publicamente na forma atual.**

A superficie de ataque hoje:
- 3 webhooks HTTP publicos (Z-API, Z-API status, Instagram) — nenhum autenticado
- API administrativa completa (`/api/*`) sem login
- Dashboard `/` sem login
- Token da Z-API em URL (log-leak)
- CORS `*` aberto
- Rodando como root no container (default Node image)

**Achados por categoria OWASP**

| ID | Categoria OWASP | Achado | Severidade | Onde | Acao |
|----|-----------------|--------|------------|------|------|
| SEC-01 | A01 Broken Access Control | Webhook `/webhook/zapi` sem HMAC/secret — qualquer um envia payload falso e injeta "leads" | Critico | `routes/webhook.js:7` | Validar header `X-Z-API-Token` contra `process.env.ZAPI_WEBHOOK_SECRET` |
| SEC-02 | A01 | API `/api/*` sem auth — qualquer um lista leads, apaga dados, dispara mensagens | Critico | `server.js:26` | Middleware `requireAuth` + sessao cookie ou JWT |
| SEC-03 | A01 | Webhook Instagram aceita qualquer GET com challenge se `hub.verify_token` vaza | Alto | `routes/webhook.js:94` | OK se o token e forte e secreto; documentar rotacao |
| SEC-04 | A02 Cryptographic Failures | Token Z-API concatenado na URL (`zapi.js:sendMessage`) | Alto | `services/zapi.js` (via code-review C5) | Mover para header `Client-Token`. Mascarar em logs |
| SEC-05 | A02 | `.env` no repositorio ou no host com `chmod 644`? Confirmar `ls -la .env` na VPS | Alto | VPS | `chmod 600 .env`, garantir que nao esta commitado (ver `.gitignore`) |
| SEC-06 | A03 Injection | SQL com placeholders OK em 99% dos casos, mas ORDER BY/LIMIT dinamicos precisam revisao | Medio | `routes/api.js` (C2 do code-review) | Whitelist de colunas para ORDER BY |
| SEC-07 | A04 Insecure Design | Sem rate limiting em nenhum endpoint | Critico | global | `express-rate-limit`: 100req/min por IP no webhook, 30/min na API |
| SEC-08 | A04 | Sem throttle/queue no envio via Z-API — spam do proprio numero pode banir a conta comercial | Critico | `services/zapi.js` | Token bucket: max 1 msg/3s por destinatario, max 1000/dia por conta |
| SEC-09 | A05 Security Misconfig | CORS `*` | Alto | `server.js:18` | Restringir a origens conhecidas via `CORS_ORIGINS` env |
| SEC-10 | A05 | Sem `helmet` — sem CSP, sem X-Frame-Options, sem HSTS | Alto | `server.js` | `app.use(helmet())` com CSP apropriada para o dashboard inline |
| SEC-11 | A05 | Container roda como `root` (default do Node image) | Alto | `Dockerfile` | Add `USER node` |
| SEC-12 | A05 | `process.env.PORT` default 3001 exposto direto sem reverse proxy — confirmar que Caddy esta na frente | Medio | deploy | Se exposto direto, proxy via Caddy com TLS |
| SEC-13 | A06 Vulnerable Components | `axios ^1.7` (CVE-2024-39338) — confirmar patch | Medio | `package.json` | `npm audit fix` + `npm outdated` |
| SEC-14 | A07 Identification & Auth Failures | Nao ha usuarios, sem 2FA, sem reset de senha — ver SEC-02 | Critico | — | Implementar auth |
| SEC-15 | A08 Software & Data Integrity | `git pull` + rsync no deploy, sem checksum/signature | Medio | `update-vps.sh` | Considerar usar tags + `git verify-tag` |
| SEC-16 | A09 Logging & Monitoring | `console.log` sem estrutura, sem retencao, sem alerta | Alto | global | ver TD-F1 na secao tech-debt |
| SEC-17 | A09 | PII (telefone, nome) em logs INFO sem mascaramento | Alto | `webhook.js:27` | Mascarar telefone: `55 ** ***-1234` em logs de INFO |
| SEC-18 | A10 SSRF | Imagens recebidas no WhatsApp sao baixadas pela Z-API e tratadas; nao ha SSRF direto | Baixo | — | OK |

**Gestao de secrets**

Estado atual (conferido em `.env.modelo`):
- `ANTHROPIC_API_KEY`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN`, `GOOGLE_ADS_*`, `META_ACCESS_TOKEN`.
- Todos em plaintext em `.env` na VPS.
- Sem rotacao automatica, sem auditoria de quem tem acesso.

Recomendacoes:
| Item | Prioridade |
|------|------------|
| `.env` com permissao 600, dono `root:root` na VPS | P0 |
| Confirmar que `.env` esta no `.gitignore` e nunca foi commitado (`git log --all -- .env`) | P0 |
| Plano de rotacao a cada 90 dias para `ANTHROPIC_API_KEY` e `ZAPI_TOKEN` | P1 |
| Migrar para um secrets manager (Doppler/Infisical/AWS SM) quando sair de single-VPS | P2 |
| Auditoria: quem mais tem credenciais salvas localmente? | P1 |

**Dados sensiveis em transito / repouso**

- Banco SQLite em `data/` — plaintext no disco. Contem PII (nome, telefone, email, conversas inteiras). Se VPS e comprometida, tudo vaza.
- Backup: nao existe hoje (ver ADR-001 na secao 1.2).
- TLS entre cliente e dashboard: depende do Caddy. Caddy configurado?
- TLS entre app e Z-API: HTTPS (OK).
- TLS entre app e Anthropic: HTTPS (OK).

Acoes:
| ID | Item | Prioridade |
|----|------|------------|
| ENC-01 | Confirmar Caddy com TLS automatico (Let's Encrypt) na frente do 3080 | P0 |
| ENC-02 | Backup criptografado diario do `data/` para S3/B2 (ver tech-debt) | P0 |
| ENC-03 | Avaliar criptografia em repouso das colunas `conversa.mensagem` usando chave do env | P2 |

**Plano de remediacao de seguranca — ordenado**

**P0 (bloqueia producao, fazer nesta semana)**
1. SEC-01: HMAC no webhook Z-API.
2. SEC-02 / SEC-14: auth basica (mesmo login/senha unico em env) na API e dashboard.
3. SEC-07 / SEC-08: rate limiting + throttle de envio WhatsApp.
4. SEC-11: `USER node` no Dockerfile.
5. SEC-04: token Z-API no header, nao na URL.
6. ENC-01: garantir TLS via Caddy.

**P1 (proximas 2 semanas)**
7. SEC-09: CORS restrito por env.
8. SEC-10: `helmet` com CSP.
9. SEC-17: mascarar PII em logs.
10. SEC-06: whitelist de colunas dinamicas.
11. SEC-13: atualizar deps.
12. ENC-02: backup automatico.

**P2 (quando entrar feature de multi-tenant)**
13. SEC-14 completo: usuarios, RBAC, 2FA.
14. Auditoria: registrar quem disparou broadcast, quem deletou lead.
15. Migracao para secrets manager.

**Threat model resumido (top 5 ameacas)**

1. **Webhook spoofing** — atacante envia mensagens falsas ao `/webhook/zapi`, gera leads falsos, confunde funil e consome tokens Claude. **Mitigacao**: SEC-01.
2. **API scraping / mass delete** — script varrendo `/api/leads` ou chamando DELETE. **Mitigacao**: SEC-02.
3. **WhatsApp account ban** — atacante (ou bug) dispara broadcast sem throttle, Meta bane o numero. **Mitigacao**: SEC-08.
4. **Data leak via VPS compromise** — se VPS for comprometida, toda a base PII vaza. **Mitigacao**: ENC-02 + ENC-03 + rotacao de key.
5. **Claude key abuse** — key vazada e usada por terceiros, custo explode. **Mitigacao**: rotacao + monitoring de custo (TD-F3).

---

## Tier 2 - Operações e Compliance

### 2.1 Risk Assessment (Operacional)

**Matriz severidade x probabilidade** (1-5 cada, score = S x P).

| # | Risco | Severidade | Probabilidade | Score | Dono | Mitigacao |
|---|-------|:---:|:---:|:---:|------|-----------|
| R1 | Banimento do numero WhatsApp por spam/broadcast sem throttle | 5 (inviabiliza operacao) | 4 (alta — lancar Fase 3 sem rate limit = certeza) | **20** | Ops | SEC-08 + Broadcast Engine com token bucket e HSM aprovado |
| R2 | VPS cai / SQLite corrompe — sem backup = perda total de leads | 5 | 3 | **15** | Ops | ENC-02 backup automatico + replica off-site |
| R3 | Vazamento de PII (CPF/telefone/conversa) via API aberta | 5 (multa LGPD + dano de imagem) | 4 (exposta hoje) | **20** | Sec | SEC-02 auth + SEC-17 masking |
| R4 | Custo Claude explode (conversa infinita, loop, agente promptado errado) | 4 | 3 | **12** | Eng | TD-F3 token tracking + budget alert + max_tokens por agente |
| R5 | Corrupcao de deploy (o bug do `<\!--` voltar) | 3 | 3 | **9** | Eng | fix-vps.sh + CI/CD + healthcheck |
| R6 | Key Z-API ou Claude vazada em log/commit | 5 | 2 | **10** | Sec | rotacao + pre-commit hook + scanner |
| R7 | Agente Claude da resposta danosa (alucina desconto, fala palavrao, vaza dado) | 4 | 3 | **12** | Produto | Diana supervisora + guardrails em prompt + A/B com contencao |
| R8 | Lead reclama no Procon/ANPD por mensagem sem opt-in | 4 (multa) | 3 | **12** | Legal | Fase 1 LGPD consent (ver secao 2.3) |
| R9 | Concorrencia no orchestrator (mesma conversa processada 2x) | 3 | 3 | **9** | Eng | C4 do code-review (lock por lead_id) |
| R10 | Anthropic outage (muda modelo, tira sonnet-4-6 do ar) | 4 | 2 | **8** | Eng | Ter fallback modelo (opus/haiku) em env, circuit breaker |
| R11 | Z-API outage | 4 | 2 | **8** | Ops | Queue persistente de mensagens pendentes (ver arquitetura A3) |
| R12 | Deploy derruba prod na janela de trabalho | 3 | 3 | **9** | Eng | Blue-green simples via docker-compose scale + validacao /api/diagnose |
| R13 | Chave API roubada via vazamento no frontend (ex: debug aberto) | 4 | 2 | **8** | Sec | Confirmar que nenhuma key esta em HTML/JS do dashboard |
| R14 | Disco cheio (logs nao rotacionam) | 3 | 3 | **9** | Ops | `logrotate` + monitoring de disco |
| R15 | Fuso-horario errado em followup (dispara de madrugada = irrita lead) | 2 | 3 | **6** | Produto | TZ config + janela 9h-21h obrigatoria |
| R16 | Update quebra migracao de DB | 4 | 2 | **8** | Eng | Migrations versionadas + dry-run |
| R17 | Ataque de brute-force na API | 3 | 3 | **9** | Sec | Rate limit (SEC-07) |
| R18 | Funcionario tira cliente para concorrente (tem acesso total via API sem auth) | 4 | 2 | **8** | RH+Sec | Auth + audit log |
| R19 | Falta de observabilidade — bug em producao descoberto por cliente | 3 | 4 | **12** | Eng | Pino + alerting + Sentry |
| R20 | Divergencia entre ambiente dev e prod (sem staging) | 3 | 3 | **9** | Eng | Ambiente staging na mesma VPS (compose.staging.yml) |

**Top 5 priorizado por score:**

1. **R1 (20)** — Banimento WhatsApp. **Bloqueador absoluto para Fase 3.**
2. **R3 (20)** — Vazamento PII via API aberta. **Fazer esta semana.**
3. **R2 (15)** — Sem backup. **Fazer esta semana.**
4. **R4 (12)** — Custo Claude explodindo. **Fazer antes de Fase 3.**
5. **R7 (12)** — Agente respondendo danoso. **Guardrails antes de escalar volume.**

**Controles a implementar (checklist)**

Preventivos:
- [ ] Token bucket em `zapi.js` (R1)
- [ ] Auth em `/api/*` (R3)
- [ ] Backup SQLite criptografado diario (R2)
- [ ] `max_tokens` global + budget alert diario (R4)
- [ ] Guardrails nos system prompts + validacao de resposta (R7)

Detectivos:
- [ ] Alerta Slack/Email se `/api/diagnose` falhar > 5min (R5)
- [ ] Alerta se custo Claude > $X/dia (R4)
- [ ] Alerta se taxa de erro Z-API > Y% (R11)
- [ ] Audit log de acoes admin (R18)

Corretivos:
- [ ] Runbook de "numero banido" (ver secao 3.4)
- [ ] Runbook de "restore do backup"
- [ ] Script de rollback de deploy
- [ ] Processo de incident response (ver secao 3.4)

**Apetite de risco recomendado**

Para a fase atual (MVP, ~1 conta, ~100 leads/semana): **aceitar R6/R10/R11/R16/R17/R20** (score 8-9) com monitoramento, focar em eliminar scores >= 12.

Para quando entrar multi-tenant / multi-ISP: **todos devem cair para score <= 8**, senao o blast-radius de qualquer incidente e inaceitavel.

### 2.2 Testing Strategy

**Situacao atual: 0 testes. Toolchain de teste nao configurada.**

**Proposta de piramide**

```
           ┌─────────────────┐
           │   E2E (5-10)    │   Webhook real -> resposta real (contra mock)
           ├─────────────────┤
           │  Integration    │   Orchestrator + DB real + Claude mockado
           │     (15-25)     │
           ├─────────────────┤
           │     Unit        │   ab-testing, followup, scoring, parsing
           │    (80-120)     │
           └─────────────────┘
```

**Ferramentas recomendadas**

| Camada | Tool | Por que |
|--------|------|---------|
| Runner | `vitest` ou `jest` | vitest: mais rapido, ESM-native. jest: mais conhecido. Escolher jest para menor fricao. |
| Mocking HTTP | `nock` | Mock Anthropic e Z-API sem mexer no codigo |
| Fixtures | `@faker-js/faker` | Gerar leads/telefones/mensagens |
| E2E | `supertest` + `better-sqlite3` in-memory | Roda o Express completo |
| Coverage | `c8` / `nyc` | Cobertura |
| CI | GitHub Actions | Gratuito, roda em PR |

**O que testar primeiro (por ROI)**

**Prioridade 1 — Core de dinheiro/risco**

| Teste | O que valida | Evita |
|-------|-------------|-------|
| `orchestrator.processIncoming` happy path | Lead novo -> Sofia -> resposta -> gravacao | Regressao no fluxo principal |
| `orchestrator.processIncoming` idempotencia | Mesma mensagem 2x nao duplica resposta (C4 fix) | Duplo envio pro lead |
| `orchestrator.transferirAgente` handoff Sofia->Carlos aos 31 | Score baixo vai pra SDR, score alto pra Closer | Handoff quebrado = funil travado |
| `ab-testing.selectVariant` distribuicao 50/50 com seed fixo | Proporcao certa entre variantes | Experimentos invalidos (F2) |
| `followup.scheduleFollowup` calendario | Sequencia 3d/7d/14d | Followup que nunca dispara |
| `claude.generateResponse` mockado com usage capturado | Tokens sao gravados (TD-F3) | Cegueira de custo |

**Prioridade 2 — Seguranca e integracao**

| Teste | O que valida |
|-------|-------------|
| Webhook `/webhook/zapi` rejeita sem HMAC | SEC-01 |
| API `/api/*` rejeita sem auth | SEC-02 |
| Rate limiter bloqueia apos N req | SEC-07 |
| Z-API throttle nao dispara >1 msg / 3s mesmo destinatario | SEC-08 |
| CORS so aceita origens whitelisted | SEC-09 |
| SQL dinamico rejeita colunas fora da whitelist | SEC-06 |

**Prioridade 3 — Edge cases e resiliencia**

| Teste | O que valida |
|-------|-------------|
| Claude timeout -> retry -> resposta fallback | R10 |
| Z-API 500 -> mensagem fica em queue pra retry | R11 |
| DB locked -> retry com backoff | R2 |
| Payload webhook malformado -> 200 ignored | Robustez |
| Mensagem sem texto (foto/audio) -> transcricao ou fallback | Fluxo real |

**Estrutura de pastas proposta**

```
agentes-sistema/tests/
├── unit/
│   ├── services/
│   │   ├── ab-testing.test.js
│   │   ├── orchestrator.test.js
│   │   ├── followup.test.js
│   │   └── claude.test.js
│   └── utils/
├── integration/
│   ├── webhook.test.js         (supertest + DB real em :memory:)
│   ├── api-leads.test.js
│   └── flow-sofia-to-carlos.test.js
├── e2e/
│   └── full-funnel.test.js     (lead chega -> Diana aprova -> closer fecha)
├── fixtures/
│   ├── leads.js
│   ├── claude-responses.js
│   └── zapi-payloads.js
└── helpers/
    ├── db.js                   (initTestDb, cleanDb)
    └── mocks.js                (mockClaude, mockZApi)
```

**Meta de cobertura**

| Periodo | Unit | Integration | E2E | Cobertura total alvo |
|---------|:---:|:---:|:---:|:---:|
| Sprint 1 | 5 testes | 0 | 0 | 5% |
| Sprint 2 | 30 | 5 | 1 | 25% |
| Sprint 3 | 60 | 15 | 3 | 45% |
| Sprint 4+ | 100+ | 25 | 8 | 65%+ |

**Meta minima para prod:** 60% nos arquivos `services/*.js` (core de negocio).
**Meta minima para aceitar PR:** nenhum drop de cobertura, testes passando.

**Exemplo concreto de teste — AB-testing**

```javascript
// tests/unit/services/ab-testing.test.js
const ab = require('../../../src/services/ab-testing');
const { getDb } = require('../helpers/db');

describe('ab-testing.selectVariant', () => {
  let db;
  beforeEach(() => { db = getDb(':memory:'); db.initialize(); });
  afterEach(() => db.close());

  it('distribui 50/50 entre 2 variantes com trafego balanceado', () => {
    // ... cria experimento, envia 1000 "impressoes", verifica margin of error
  });

  it('nao conta a mesma variante 2x pro mesmo lead na mesma hora', () => {
    // ... fix para F2 (metric inflation)
  });

  it('retorna variante default se experimento expirou', () => {});
});
```

**Exemplo — Integration webhook**

```javascript
// tests/integration/webhook.test.js
const request = require('supertest');
const nock = require('nock');
const app = require('../helpers/app');

describe('POST /webhook/zapi', () => {
  it('rejeita payload sem HMAC', async () => {
    await request(app).post('/webhook/zapi').send({phone:'55119...'}).expect(401);
  });

  it('processa mensagem nova e retorna resposta', async () => {
    nock('https://api.anthropic.com').post(/.*/).reply(200, { content:[{text:'Oi!'}], usage:{input_tokens:10,output_tokens:5}});
    nock('https://api.z-api.io').post(/.*/).reply(200, {sent:true});

    const res = await request(app)
      .post('/webhook/zapi')
      .set('X-Z-API-Token', process.env.ZAPI_WEBHOOK_SECRET)
      .send({ phone:'5511999999999', text:{message:'tenho interesse'}, messageId:'ABC' })
      .expect(200);

    expect(res.body.agente).toBe('sofia');
  });
});
```

**CI/CD proposto (GitHub Actions)**

```yaml
# .github/workflows/ci.yml
name: CI
on: [pull_request, push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - uses: codecov/codecov-action@v4
```

**Testes que NAO fazem sentido agora**

- Testar o dashboard com Cypress/Playwright — muito caro, muda demais, ROI baixo.
- Load testing com k6 — so quando passar de 10 msg/s.
- Mutation testing — luxo, deixar pra > 60% coverage.

**Responsavel por escrever o kit inicial**: o dev que for tocar cada feature, ou 1 dia dedicado de setup de toolchain.

**Checklist de Sprint 1 (so o setup de testing)**

- [ ] Adicionar `jest`, `supertest`, `nock`, `@faker-js/faker` como devDeps
- [ ] Criar `tests/helpers/db.js` + `tests/helpers/app.js`
- [ ] Criar `jest.config.js` com coverage thresholds
- [ ] Escrever 5 testes unitarios em `ab-testing` e `followup`
- [ ] Criar `.github/workflows/ci.yml`
- [ ] `npm test` no README

### 2.3 Legal Compliance (LGPD + WhatsApp Business)

> **Disclaimer:** este material nao substitui orientacao juridica. As recomendacoes abaixo sao baseadas nos textos normativos (Lei 13.709/18 LGPD, Resolucoes CD/ANPD, Politicas WhatsApp Business / Meta). Validar com advogado antes de virar politica oficial.

**1. LGPD — estado de conformidade**

| Artigo | Exigencia | Status hoje | Acao |
|--------|-----------|-------------|------|
| Art. 6 III | Finalidade especifica e informada | **Nao conforme**: nao ha aviso ao lead sobre por que estamos tratando os dados | LGPD-01 |
| Art. 7 I / II | Base legal: consentimento ou execucao de contrato | **Parcial**: se o lead inicia a conversa (webhook from inbound), ha interesse legitimo; se a gente dispara broadcast, precisa consentimento | LGPD-02 |
| Art. 8 | Consentimento livre, informado, especifico | **Nao conforme**: nao ha captura de consentimento | LGPD-02 |
| Art. 9 | Informacao ao titular | **Nao conforme**: nao ha politica de privacidade, nem aviso no primeiro contato | LGPD-03 |
| Art. 15 | Termino do tratamento — retencao so pelo necessario | **Nao conforme**: nao ha politica de retencao, dados ficam para sempre | LGPD-04 |
| Art. 18 | Direitos do titular (acesso, correcao, exclusao, portabilidade, anonimizacao) | **Nao conforme**: nao ha endpoint/processo | LGPD-05 |
| Art. 37 | Registro das operacoes de tratamento | **Nao conforme**: nao existe RAT (Registro das Atividades de Tratamento) | LGPD-06 |
| Art. 41 | Encarregado (DPO) | **Nao designado** | LGPD-07 |
| Art. 46 | Seguranca tecnica e administrativa | Parcial — ver secao 1.4 Security | ver SEC-* |
| Art. 48 | Comunicacao de incidente a ANPD em 3 dias uteis | **Sem processo** | LGPD-08 |

**Acoes LGPD priorizadas**

| ID | Acao | Prazo | Esforco |
|----|------|-------|---------|
| LGPD-01 | Aviso no primeiro contato WhatsApp: "Ola, aqui e o assistente virtual do Consulta ISP. Ao continuar voce concorda com nossa politica de privacidade: [link]. Para opt-out responda SAIR." | Esta semana | 2h |
| LGPD-02 | Tabela `consent_events` (lead_id, channel, consent_type, given_at, ip, user_agent, text_shown) + fluxo de capture no orchestrator | 2 semanas | 2 dias |
| LGPD-03 | Publicar politica de privacidade em `/privacidade` — dominio, finalidades, bases legais, retencao, direitos, contato DPO | Esta semana | 1 dia (texto + HTML) |
| LGPD-04 | Job de purga: apos X meses (definir: 12? 18? 24?) sem interacao, anonimizar PII | 1 mes | 1 dia |
| LGPD-05 | Endpoints `/api/lgpd/direitos`: acesso, correcao, exclusao, portabilidade (CSV do historico), anonimizacao. Autenticado por telefone + codigo enviado via WA | 1 mes | 3 dias |
| LGPD-06 | RAT em doc Confluence/Notion: lista de quais dados sao tratados, por que, por quanto tempo, com quem compartilhamos (Anthropic, Z-API, Meta) | 2 semanas | 1 dia |
| LGPD-07 | Designar DPO. Se < 250 pessoas envolvidas, pode ser interno | 2 semanas | — |
| LGPD-08 | Runbook de incidente: detectar, conter, comunicar ANPD em 3 dias uteis, notificar titulares | 1 mes | 2 dias |
| LGPD-09 | DPA (Data Processing Agreement) com Anthropic e Z-API. Anthropic tem BAA padrao, Z-API tambem. Revisar e arquivar. | Esta semana | 2h |
| LGPD-10 | Minimizacao: nao pedir CPF se nao usar. Revisar campos capturados. | 2 semanas | 4h |

**Subagentes e LGPD**

- Claude (Anthropic): opera em EUA; ha adequacao via clausulas contratuais. **Nao habilitar Data Use Policy que permita treinamento com dados** — por default a Anthropic nao treina em dados de API mas confirmar na conta.
- Z-API: opera no Brasil. DPA disponivel no dashboard.
- Meta (Instagram): DPA via Meta for Business.

**2. WhatsApp Business Policy (oficial + API + Z-API)**

WhatsApp tem politicas proprias alem da LGPD. Se o numero e **nao-oficial** (Z-API usa baileys/whatsapp-web), a exposicao e MAIOR — qualquer descumprimento = banimento imediato sem recurso.

| Regra | Fonte | Status | Acao |
|-------|-------|:------:|------|
| Nao enviar mensagem de marketing sem opt-in | WhatsApp Business Policy | **Nao conforme** (sem captura) | WA-01 |
| Template HSM aprovado para broadcast | WhatsApp API oficial | Nao aplicavel no Z-API nao-oficial, mas boa pratica | WA-02 |
| Janela de 24h para mensagens livres | WhatsApp | Nao implementado (a gente pode estar enviando fora da janela) | WA-03 |
| Opt-out respeitado imediatamente ("PARAR", "SAIR", "CANCELAR") | WhatsApp | **Nao conforme** | WA-04 |
| Frequencia razoavel (maximo 1-2 msgs/dia por contato) | Boa pratica | Nao enforced | WA-05 |
| Identificacao clara do remetente | WhatsApp | Parcial — depende do prompt | WA-06 |
| Nao vender/listar numeros | WhatsApp | OK (nao fazemos) | — |
| Nao enviar conteudo proibido (spam, fraude, phishing, golpes) | WhatsApp | OK, mas guardrails no prompt ajudam | R7 |

**Acoes WhatsApp**

| ID | Acao | Prazo | Esforco |
|----|------|-------|---------|
| WA-01 | Opt-in explicito: so broadcast se `consent_marketing = true` | 2 semanas | 1 dia |
| WA-02 | Templates HSM no banco — messages aprovadas, versionadas | 3 semanas | 2 dias |
| WA-03 | Janela 24h: se ultima interacao > 24h, so enviar via template | 3 semanas | 1 dia |
| WA-04 | Parser de opt-out: se mensagem contem PARAR/SAIR/STOP/CANCELAR, setar `consent_marketing=false`, enviar confirmacao, parar todo followup | Esta semana | 4h |
| WA-05 | Rate limit por lead: max 2 msgs/24h nao-resposta | 2 semanas | 4h |
| WA-06 | Prompt de todo agente comeca com "Ola, aqui e a [Sofia/Carlos/...] do Consulta ISP, assistente virtual" no primeiro contato | Esta semana | 1h |

**3. Compliance de marketing (CONAR, Codigo de Defesa do Consumidor)**

| Regra | Aplicacao | Acao |
|-------|-----------|------|
| CDC Art. 6 III | Direito a informacao clara | Copy dos agentes nao pode esconder que e bot — dizer "assistente virtual" |
| CDC Art. 30 | Publicidade vincula | Se Sofia promete desconto, Consulta ISP tem que honrar. Guardrails proibindo promessas nao aprovadas |
| Lei 13.709 + Resoluc. ANPD 15/24 | Uso de IA e profiling | Documentar que ha tomada de decisao automatizada (scoring) e dar direito a revisao humana |

**4. Relatorio de Impacto a Protecao de Dados (RIPD / DPIA)**

Atividade de alto risco (processamento em escala + IA + dados sensiveis = PII + historico de conversa). **Recomenda-se elaborar DPIA antes de ir a producao multi-tenant.**

Estrutura minima:
1. Descricao do tratamento
2. Necessidade e proporcionalidade
3. Riscos aos titulares (lista + severidade)
4. Medidas de mitigacao
5. Consulta ao DPO
6. Aprovacao

**5. Checklist executivo "posso lancar?"**

Antes de broadcast em massa / Fase 3:

- [ ] Politica de privacidade publicada
- [ ] Aviso + link de politica no 1o contato WhatsApp
- [ ] Opt-in granular gravado com prova (texto exibido, timestamp, ip)
- [ ] Parser de opt-out funcional e testado
- [ ] Endpoint para direitos LGPD (acesso/exclusao)
- [ ] DPO designado (mesmo informal, alguem tem que ser responsavel)
- [ ] RAT preenchido
- [ ] Runbook de incidente
- [ ] DPA com Anthropic e Z-API arquivados
- [ ] Rate limit WhatsApp ativo
- [ ] Throttle de envio por lead ativo
- [ ] Janela horaria (9h-21h por fuso do lead) ativa
- [ ] Logs mascarados (PII)
- [ ] Backup criptografado

Enquanto estes 14 itens nao estao todos cumpridos, **nao fazer broadcast >100 destinatarios/dia**. Risco legal/operacional.

### 2.4 Compliance Tracking

**Objetivo**: transformar a lista de exigencias da secao 2.3 em controles rastreaveis, com dono, evidencia e cadencia de revisao.

**Registro de controles (control register)**

| Control ID | Domain | Control | Owner | Evidencia | Frequencia | Status |
|------------|--------|---------|:-----:|-----------|:----------:|:------:|
| CTRL-001 | LGPD Art.8 | Consentimento explicito capturado antes de broadcast | Produto | Registro em `consent_events` | Continuo | 🔴 |
| CTRL-002 | LGPD Art.9 | Politica de privacidade publica em `/privacidade` | Legal | URL acessivel + versao | Revisao anual | 🔴 |
| CTRL-003 | LGPD Art.15 | Retencao maxima: anonimizar lead apos 18 meses sem interacao | Eng | Cronjob `data_retention.js` + log | Diario | 🔴 |
| CTRL-004 | LGPD Art.18 | Endpoint de direitos do titular funcional | Eng | Teste integrado + log de requests | Mensal | 🔴 |
| CTRL-005 | LGPD Art.37 | RAT atualizado | DPO | Doc Confluence versionado | Trimestral | 🔴 |
| CTRL-006 | LGPD Art.41 | DPO designado e contato divulgado | Executivo | Portaria de designacao | Anual | 🔴 |
| CTRL-007 | LGPD Art.48 | Plano de resposta a incidente testado | Seguranca | Drill semestral + ata | Semestral | 🔴 |
| CTRL-008 | WA Policy | Opt-out processado em < 1 min | Eng | Test `opt-out.test.js` em CI | Diario (CI) | 🔴 |
| CTRL-009 | WA Policy | Rate limit por contato 2 msgs/24h | Eng | Log de bloqueios | Diario | 🔴 |
| CTRL-010 | WA Policy | Janela horaria 9h-21h respeitada | Eng | Log de schedule | Diario | 🔴 |
| CTRL-011 | Security SEC-01 | HMAC verificado em 100% dos webhooks | Seguranca | Alerta se request sem HMAC | Continuo | 🔴 |
| CTRL-012 | Security SEC-02 | API autenticada (cobertura 100%) | Seguranca | Teste 401 em CI | Diario | 🔴 |
| CTRL-013 | Security SEC-07 | Rate limit global ativo | Seguranca | Config + alerta de 429 | Continuo | 🔴 |
| CTRL-014 | Security ENC-02 | Backup diario criptografado testado | Ops | Log cronjob + test restore trimestral | Diario (backup), trimestral (restore) | 🔴 |
| CTRL-015 | Finops R4 | Custo Claude < budget diario | Produto | Dashboard + alerta Slack | Diario | 🔴 |
| CTRL-016 | Quality R7 | Diana revisa 100% das mensagens antes de enviar (ou amostra > 10%) | Produto | Campo `supervisor_approved` na tabela | Continuo | 🟡 (existe na estrutura, confirmar uso) |
| CTRL-017 | DR R2 | RTO < 4h, RPO < 24h validado | Ops | Drill semestral | Semestral | 🔴 |
| CTRL-018 | Audit | Audit log de acoes admin (delete lead, disparo broadcast, edicao de prompt) | Seguranca | Tabela `audit_log` com retencao 24 meses | Continuo | 🔴 |

Legenda: 🔴 nao implementado | 🟡 parcial | 🟢 em conformidade

**Dashboard de compliance**

Recomendado colocar no dashboard admin (rota `/compliance`) um painel com:
- Score total (X / 18 controles em 🟢)
- Controles vencidos (CTRL que deveria ter sido revisado e nao foi)
- Ultimas excecoes (opt-outs, requests de direito, incidents)
- Proximos drills / auditorias

**Cadencia de revisao**

| Cadencia | O que | Quem | Output |
|----------|-------|------|--------|
| Diaria | Logs de consentimento, opt-out, rate limit | Ops bot | Relatorio automatico 8h |
| Semanal | Custo de tokens, leads anonimizados, novos opt-ins | Produto | Resumo na reuniao de equipe |
| Mensal | Revisao de 18 controles, status de cada um | DPO + Seguranca | Ata assinada |
| Trimestral | Test de restore, atualizacao do RAT | Ops + DPO | Documento arquivado |
| Semestral | Drill de incidente (simulacao de vazamento) | Seguranca | Postmortem |
| Anual | Auditoria externa de LGPD | Jurídico contratado | Certificado / relatorio |

**KPIs de compliance**

| KPI | Alvo | Formula |
|-----|------|---------|
| % leads com consentimento valido | >= 95% | consent_events ativos / leads totais |
| Tempo medio de resposta a direito do titular | < 15 dias | AVG(resolved_at - requested_at) |
| Taxa de opt-out processado < 1min | >= 99.9% | opt_outs processados em < 60s / total |
| Incidentes nao reportados em 3 dias | 0 | counter |
| Backups com restore testado | 100% trimestre | restored_test_ok / total |
| Controles em 🟢 | >= 16/18 | count(status=green) |

**Ferramentas sugeridas**

Para escala atual (MVP): **planilha compartilhada ou Notion** e suficiente.
Quando passar de 3+ tenants: considerar Vanta, Drata, ou Tugboat Logic para automacao.

**Gap analysis vs. certificacoes**

| Certificacao | Gap atual | Esforco pra obter |
|--------------|-----------|-------------------|
| LGPD basica (conformidade) | 18 controles pendentes | 3 meses |
| SOC 2 Type 1 | Muito longe — precisaria formalizar 40+ controles, processo de change mgmt, etc | 6-9 meses |
| ISO 27001 | Idem SOC 2 + RIPD obrigatorio + ASG | 12+ meses |

Recomendacao: mirar LGPD basica agora, SOC 2 so quando entrar em vendas enterprise.

**Onboarding de novos tenants / clientes**

Se o produto virar plataforma para varios ISPs, cada tenant traz suas proprias obrigacoes. Criar **Tenant Compliance Checklist** que ativa automaticamente no setup:
- [ ] DPA assinado entre Consulta ISP e o ISP (controller-processor)
- [ ] Politica de privacidade do ISP linkada
- [ ] Dados segregados por `tenant_id` (ver ADR-005)
- [ ] Logs de audit acessiveis ao ISP
- [ ] Processo de exportacao de dados definido

---

## Tier 3 - UX e Documentação

### 3.1 Accessibility Review

**Escopo**: dashboard `/` (`public/index.html`). WCAG 2.1 nivel AA.

**Resumo executivo**: varios problemas bloqueantes. Nivel atual ~ AA em 30% dos criterios. Publico B2B com teclado/leitor de tela hoje nao consegue operar o dashboard.

**1. Perceivable**

| ID | Criterio WCAG | Achado | Severidade | Fix |
|----|---------------|--------|:----------:|-----|
| A11Y-01 | 1.1.1 Texto alternativo | Icones e dots de agente (emoji/divs) sem `aria-label` | Alto | `<span role="img" aria-label="Sofia - Marketing">🎯</span>` |
| A11Y-02 | 1.3.1 Info e relacoes | Tabelas sem `<caption>` e sem `scope` nos `<th>` | Medio | Add caption + scope |
| A11Y-03 | 1.3.1 | Estrutura semantica: so um `<h1>` e varios dashboards usam `<div>` como header | Medio | Heading hierarchy coerente |
| A11Y-04 | 1.4.3 Contraste de cor | `--muted: #7a8ba8` sobre `--card: #1a2234` = 4.3:1. OK para AA (>= 4.5:1 AA texto pequeno? Borderline) | Medio | Escurecer fundo OU clarear muted. Testar com Stark/axe |
| A11Y-05 | 1.4.3 | Badges coloridos (b-frio, b-quente) sem texto redundante para daltonicos | Alto | Adicionar icone + texto alem da cor |
| A11Y-06 | 1.4.4 Redimensionar texto | Layout `grid-template-columns:220px 1fr` e px fixos. Zoom 200% quebra layout | Medio | Trocar `px` por `rem`, sidebar colapsavel |
| A11Y-07 | 1.4.11 Contraste nao-texto | Borders com 1.5:1 — nao distinguiveis em monitores fracos | Baixo | Border `#2d3a4f` -> `#3d4a5f` |
| A11Y-08 | 1.4.13 Conteudo em hover/focus | Tooltips e popups que aparecem no hover nao podem ser dispensados com ESC | Medio | Interaction handler para ESC |

**2. Operable**

| ID | Criterio | Achado | Severidade | Fix |
|----|----------|--------|:----------:|-----|
| A11Y-09 | 2.1.1 Teclado | `.nav-item` e `<div>` clicavel sem `tabindex` — nao acessa pelo teclado | **Critico** | Trocar por `<button>` ou add `role="button" tabindex="0"` + keyhandler Enter/Space |
| A11Y-10 | 2.1.1 | Cards do Kanban sem `tabindex` | Critico | idem |
| A11Y-11 | 2.1.2 Sem armadilha de teclado | Modais (se houver) sem trap de foco | Alto | Trap focus no modal, ESC fecha |
| A11Y-12 | 2.4.1 Skip links | Sem link "pular para conteudo" | Medio | `<a href="#main" class="skip-link">Pular</a>` |
| A11Y-13 | 2.4.3 Ordem de foco | Ordem depende da DOM (parece correta), mas confirmar com tab | Medio | Testar |
| A11Y-14 | 2.4.7 Indicador visual de foco | `outline:none` em varios elementos | Alto | Remover `outline:none`, estilizar `:focus-visible` com ring de 2px |
| A11Y-15 | 2.5.3 Label no nome | Botoes com so icone sem `aria-label` | Alto | Add `aria-label` |

**3. Understandable**

| ID | Criterio | Achado | Severidade | Fix |
|----|----------|--------|:----------:|-----|
| A11Y-16 | 3.1.1 Idioma da pagina | `<html lang="pt-BR">` OK | — | — |
| A11Y-17 | 3.2.2 Mudanca ao input | Filtros aplicam sem botao submit — OK se anunciado, nao e | Medio | `aria-live="polite"` na lista de resultados |
| A11Y-18 | 3.3.1 Erros identificados | API mostra erros em banner vermelho. Bom. Mas sem `role="alert"` | Medio | `role="alert" aria-live="assertive"` no banner |

**4. Robust**

| ID | Criterio | Achado | Severidade | Fix |
|----|----------|--------|:----------:|-----|
| A11Y-19 | 4.1.2 Nome, papel, valor | Charts do Chart.js sem textual summary | Alto | Tabela acessivel alternativa (`<table class="sr-only">`) |
| A11Y-20 | 4.1.3 Status messages | Toasts/notifications sem `aria-live` | Medio | Region dedicada |

**Ferramentas para auditoria continua**

- **axe-core** (browser extension) — roda 30s, pega 50% dos bugs automaticamente
- **Lighthouse** (Chrome DevTools) — score de acessibilidade
- **WAVE** (WebAIM) — visual
- **NVDA** (Windows) / **VoiceOver** (Mac) — teste manual com leitor de tela
- **Tab test** — navegar so com teclado. Se nao consegue clicar em X, e bug.

**Plano de remediacao — ordenado**

**Sprint 1 (bloqueadores, 1 semana)**
1. A11Y-09 / A11Y-10 — nav-items e cards ficarem acessiveis por teclado.
2. A11Y-14 — restaurar focus visible.
3. A11Y-15 — aria-label em botoes icone-only.
4. A11Y-19 — alternativa textual para charts.

**Sprint 2 (formato, 2 semanas)**
5. A11Y-01 / A11Y-05 — aria-label em icones + redundancia cor+texto em badges.
6. A11Y-02 / A11Y-03 — estrutura semantica.
7. A11Y-12 — skip link.
8. A11Y-17 / A11Y-18 / A11Y-20 — aria-live e role=alert.

**Sprint 3 (responsividade, 1 semana)**
9. A11Y-06 — zoom e responsive com rem.
10. A11Y-04 / A11Y-07 — ajuste de contraste.
11. A11Y-11 — trap de foco em modais.

**Meta pos-remediacao**

- Lighthouse a11y >= 90
- axe-core sem erros "serious" ou "critical"
- Consegue usar o dashboard so com teclado, sem mouse
- NVDA/VoiceOver narra corretamente dashboard + tabela de leads

**Nota sobre mobile**

Dashboard e desktop-first. Com viewport < 768px o grid de 220px+1fr quebra. Se uso mobile for critico, e um reprojeto maior (ver secao 3.2).

### 3.2 Design Critique

**Contexto**: dashboard web do CRM + Agentes. Usuario primario: equipe comercial do ISP. Operado a partir de desktops em escritorio.

**Overview da UI (inferido do index.html)**

- Sidebar lateral fixa 220px + conteudo principal.
- Top bar com logo, badge de status, botoes.
- Cards de estatisticas (grid auto-fit).
- Paineis com panel-header + panel-body, max-height 400px com scroll interno.
- Kanban de pipeline.
- Tabelas de leads.
- Charts (Chart.js).
- Activity feed.
- Dark-mode fixo (nao ha light mode).

**O que funciona bem**

| # | Ponto forte |
|---|-------------|
| V1 | Paleta coerente e moderna (azul/roxo gradient, dark). Profissional. |
| V2 | Hierarquia visual razoavel (stat cards, paineis). |
| V3 | Componentes reutilizaveis (btn, badge, panel) — CSS bem organizado em classes. |
| V4 | Density alta — muita informacao visivel sem scroll. Bom para uso profissional. |
| V5 | Sidebar como navegacao principal: padrao conhecido pelo publico. |

**Problemas de UX — por severidade**

**CRITICOS (bloqueiam tarefas)**

| ID | Problema | Impacto | Fix |
|----|----------|---------|-----|
| UX-01 | Menus sem funcao (confirmado pelo usuario "todos os menus estao sem funções") | Dashboard inoperante | Corrigido na iteracao anterior via event delegation (defensivo) |
| UX-02 | Nao ha loading state visivel em tabelas — usuario nao sabe se clique funcionou | Confusao | Skeleton loader + spinner |
| UX-03 | Sem feedback pos-acao (ex: enviar mensagem — deu certo?) | Incerteza destrutiva | Toast de confirmacao |
| UX-04 | Banner de erro sobrepoe conteudo sem botao "fechar" | Fica empilhando | X para dispensar + auto-dismiss apos 10s |
| UX-05 | Nao ha empty state com call-to-action — tabela vazia so mostra "sem dados" | Usuario travado | "Nao ha leads. [Importar CSV] [Conectar WhatsApp]" |

**ALTOS (fricao grande)**

| ID | Problema | Fix |
|----|----------|-----|
| UX-06 | Hierarquia tipografica limitada (so h1/h2/small). Dificil escanear secoes | H1 1.4rem / H2 1rem / H3 0.85rem com cores distintas |
| UX-07 | Stat cards todos com o mesmo visual — nenhum destaque para a metrica principal | Hero stat card maior para "leads ativos hoje" |
| UX-08 | Density alta ajuda no uso intenso mas sobrecarrega em primeira vista — nao ha onboarding | Tour de 3 steps na primeira vez |
| UX-09 | Paineis com `max-height:400px` forcam scroll duplo (pagina + painel). Irritante | Remover max-height em monitores grandes ou virar modal |
| UX-10 | Kanban sem drag-and-drop, so mostra leads em colunas | Ou adicionar DnD ou renomear "Pipeline" para "Visao" |
| UX-11 | Charts (Chart.js) sem dados comparativos (mes anterior, meta) — so numero atual | Linha de meta + sparkline no card |
| UX-12 | Nao ha "ultima atualizacao" — usuario nao sabe se os dados sao em tempo real | Timestamp + botao "Atualizar" (com auto-refresh opcional) |
| UX-13 | Badges de status (frio/morno/quente) dependem so de cor. Daltonico nao distingue (ver A11Y-05) | Icone + cor + texto |
| UX-14 | Tabela de leads sem bulk actions (selecionar varios, enviar mensagem em massa, mudar etapa) | Checkbox + action bar |
| UX-15 | Filtros (se existem) nao sao persistidos na URL | Query string para deep-link |

**MEDIOS (refino)**

| ID | Problema | Fix |
|----|----------|-----|
| UX-16 | Charts com cores que colidem com badges — usuario associa errado | Paleta distinta para dados vs status |
| UX-17 | Pulse animation no status nao para quando ha erro | Mudar para vermelho quando ha erro |
| UX-18 | Sidebar agents (7 agentes + Diana) gasta espaco vertical — se tiver mais agentes no futuro, quebra | Group collapse: "Agentes (7) ▶" |
| UX-19 | Nao ha search global | Shortcut `Cmd/Ctrl+K` para command palette |
| UX-20 | Dark theme only — algumas pessoas sao sensiveis | Toggle claro/escuro persistido em localStorage |
| UX-21 | Scrollbar custom muito fina (6px) — dificil de agarrar | 10-12px |
| UX-22 | Nao ha breadcrumb quando clica em um lead (drill-down) | Breadcrumb + back button |

**BAIXOS (polimento)**

| ID | Problema | Fix |
|----|----------|-----|
| UX-23 | Gradients so no logo — poderiam ser usados em stats cards principais | Accent gradient para o hero stat |
| UX-24 | Border-radius inconsistente (8px botoes, 12px cards, 3px scrollbar) | Sistema de radius: sm 4, md 8, lg 12 |
| UX-25 | Sombras praticamente nao existem — cards parecem pouco destacados | Shadow leve em cards |

**Arquitetura de informacao**

Avaliacao do que parece estar no dashboard vs. o que deveria:

**Presente e util**:
- Metricas (stats-grid)
- Pipeline (Kanban)
- Tabela de leads
- Activity feed
- Charts
- Agentes como entrada de menu

**Faltando ou imaturo**:
- View de conversa individual com histórico completo e contexto de agente
- Playground de prompt — testar um agente sem afetar producao
- Gestor de HSM / Templates
- Gestor de audiencias para broadcast
- Tela de consentimento (LGPD)
- Tela de custos (tokens) por agente/dia
- Audit log visivel
- Configuracoes do proprio sistema (env, horarios, limites)

**Padroes de componente recomendados**

Para pagar divida de design e escalar:
1. **Design system leve**: documentar tokens (cores, espacamento, radius, typography) em CSS custom properties — ja existe parcialmente, estender.
2. **Componentes nomeados**: `.ui-card`, `.ui-button--primary`, `.ui-badge--warning`. BEM ou similar.
3. **Storybook**: quando tiver 15+ componentes, criar catalogo.
4. **Reuso real**: hoje `panel` e reaproveitado, mas stat-card e botoes poderiam componentizar mais.

**Usabilidade — fluxos criticos**

| Fluxo | Experiencia hoje | Ideal |
|-------|------------------|-------|
| Entrar e ver situacao | OK (dashboard principal) | OK |
| Encontrar um lead especifico | Precisa scroll — sem search | Cmd+K + filtro global |
| Responder um lead manualmente | Nao esta claro se e possivel | Botao "Assumir conversa" no detalhe |
| Pausar um agente | Nao existe controle visivel | Toggle on/off por agente |
| Criar broadcast | Nao existe UI | Wizard em 3 passos |
| Entender por que agente respondeu X | Nao acessivel | "Ver prompt/raciocinio" no detalhe da mensagem |

**Recomendacoes estrategicas (3-6 meses)**

1. **Personas e jobs-to-be-done**: entrevistar o operador do Consulta ISP (voce) e 2-3 usuarios reais. Documentar tarefas que chegam todo dia.
2. **Heuristic evaluation** (Nielsen) completa — pegar os 10 principios e anotar violacoes.
3. **Metricas de uso**: instrumentar o dashboard com Plausible/Umami — ver quais telas sao usadas.
4. **Redesign incremental**: pegar as 3 telas mais usadas e refinar. Nao redesenhar tudo de uma vez.
5. **Decisao sobre stack**: seguir com HTML monolitico e CSS vanilla, ou migrar para React+Tailwind? Responder ADR-004 da secao 1.2.

**Quick wins (podem ser feitos em 1 dia)**

- [ ] UX-04: X no banner de erro.
- [ ] UX-12: timestamp de "ultima atualizacao" + botao refresh.
- [ ] UX-03: toast de confirmacao apos acoes.
- [ ] UX-19: command palette basico (shortcut Cmd+K).
- [ ] A11Y-09 + A11Y-14: teclado navegavel.

### 3.3 Documentation Plan

**Situacao atual**

| Tipo | Estado |
|------|--------|
| README.md no root | **Ausente** |
| README.md em `agentes-sistema/` | Confirmar (provavelmente ausente) |
| API reference (endpoints) | Nao existe (inferida do codigo) |
| Runbooks operacionais | Apenas `RECUPERACAO-DASHBOARD.md` |
| Guia de setup local | Nao existe |
| Guia de deploy | Parcial em `PROMPT-DEPLOY-DOCKER.md` (prompt, nao doc) |
| ADRs | Nao existem (propostos na secao 1.2) |
| Diagramas de arquitetura | Nao existem |
| Onboarding de novo dev | Nao existe |
| Onboarding de novo cliente/ISP | Nao existe |
| Glossario (agentes, thresholds, scoring) | Espalhado nos `PROMPT-*.md` |

**Estrutura proposta**

```
/docs
├── README.md                         # Visao geral + links
├── onboarding/
│   ├── dev.md                        # Setup local em 15 min
│   ├── produto.md                    # O que cada agente faz
│   └── cliente.md                    # Onboarding de ISP novo (futuro)
├── architecture/
│   ├── overview.md                   # Diagrama + descricao
│   ├── data-model.md                 # Schema SQLite + relacionamentos
│   ├── agent-pipeline.md             # Como scoring/handoff funciona
│   └── adrs/
│       ├── 0001-queue.md
│       ├── 0002-sqlite-vs-postgres.md
│       └── ...
├── api/
│   ├── webhook.md                    # Contratos dos webhooks Z-API/Meta
│   ├── api-rest.md                   # Endpoints /api/*
│   └── openapi.yaml                  # Spec gerada
├── operations/
│   ├── deploy.md                     # Processo de deploy (fix-vps.sh etc)
│   ├── backup-restore.md             # Como fazer, como testar
│   ├── incident-response.md          # O que fazer em incidente
│   ├── monitoring.md                 # Alertas, dashboards, SLO
│   └── runbooks/
│       ├── numero-banido.md
│       ├── vps-caiu.md
│       ├── claude-outage.md
│       ├── backup-restore.md
│       └── deploy-quebrado.md
├── security/
│   ├── threat-model.md               # Top 5 ameacas (secao 1.4)
│   ├── secrets.md                    # Gestao de secrets
│   └── vulnerability-disclosure.md
├── compliance/
│   ├── lgpd.md                       # Politicas, direitos, fluxo
│   ├── whatsapp-policy.md            # Regras Z-API/Meta
│   ├── rat.md                        # Registro de atividades
│   └── privacy-policy.md             # Texto publico
├── product/
│   ├── agents/
│   │   ├── sofia.md
│   │   ├── leo.md
│   │   ├── carlos.md
│   │   └── ... (um por agente)
│   ├── scoring.md
│   ├── ab-testing.md
│   └── followup.md
└── contributing/
    ├── development.md                # Workflow, branches, PR
    ├── testing.md                    # Como escrever testes
    └── code-style.md
```

**Cada documento tem um dono**

| Pasta | Dono |
|-------|------|
| `onboarding/` | Tech Lead |
| `architecture/` | Tech Lead |
| `api/` | Dev que mexe em routes |
| `operations/` | Ops |
| `security/` | Dev + DPO |
| `compliance/` | DPO + Legal |
| `product/` | Produto |
| `contributing/` | Tech Lead |

**Priorizacao**

**Semana 1 (crítico — sem isso equipe nao opera)**
- [ ] `README.md` (root) — 1 pagina: o que e, como rodar, como deployar, quem pergunto
- [ ] `docs/onboarding/dev.md` — setup local do zero ate subir o servidor
- [ ] `docs/operations/deploy.md` — `fix-vps.sh` explicado, troubleshooting
- [ ] `docs/operations/runbooks/numero-banido.md` — numero WA banido, o que fazer
- [ ] `docs/architecture/overview.md` — diagrama atual (copiar de 1.2)

**Semana 2**
- [ ] `docs/api/webhook.md` — contratos dos webhooks com exemplo JSON
- [ ] `docs/api/api-rest.md` — endpoints + auth
- [ ] `docs/architecture/data-model.md` — schema atual + ER diagram
- [ ] `docs/product/agents/*.md` — um por agente, com: objetivo, gatilhos, handoff in/out, system prompt link, metricas

**Semana 3**
- [ ] `docs/operations/backup-restore.md`
- [ ] `docs/operations/incident-response.md`
- [ ] `docs/security/threat-model.md`
- [ ] `docs/security/secrets.md`
- [ ] Primeiros 3 ADRs (queue, dashboard, multi-tenancy)

**Semana 4+**
- [ ] `docs/compliance/lgpd.md`
- [ ] `docs/product/scoring.md`
- [ ] Resto dos runbooks
- [ ] OpenAPI spec gerada automaticamente

**Ferramentas e formato**

| Recomendacao | Por que |
|--------------|---------|
| **Markdown em Git** | Versao controlado junto com codigo |
| **Diagramas com Mermaid** | Texto-como-codigo, versionavel |
| **Docsify ou MkDocs Material** | Se quiser site bonito em `docs.consulta-isp.com.br` |
| **OpenAPI / Swagger** para API | Auto-gerado, sempre sincronizado |

Evitar:
- Confluence/Notion como unica fonte (desacopla do codigo, vira mentira rapido)
- Google Docs como doc oficial (versionamento fraco)
- Arquivos soltos na raiz (como hoje)

**Padroes de escrita**

- Voz ativa, segunda pessoa ("voce faz X") para guias.
- Cada runbook: ao inicio listar **sintomas**, **causa esperada**, **acao**, **verificacao**.
- Cada ADR: usar template da secao 1.2.
- Cada endpoint: request, response, exemplo, status codes, rate limit.
- Datas em toda doc (editada em ...) — sem data, ninguem confia.

**Documentacao gerada vs escrita**

| Tipo | Automatico | Esforco humano |
|------|:----------:|:--------------:|
| JSDoc -> API ref | ✅ | Escrever comentarios |
| OpenAPI -> Swagger UI | ✅ | Anotacoes nas rotas |
| ADRs | ❌ | Discussao humana |
| Runbooks | ❌ | Pos-incidente |
| Onboarding | ❌ | Atualizacao manual |

**Metricas de documentacao**

- % de arquivos em `src/` com JSDoc no topo (alvo: 70%)
- % de endpoints em `api.js` documentados (alvo: 100%)
- Runbook coverage: ha doc para cada alerta/alarme? (alvo: 100%)
- Date staleness: qualquer doc nao editado em 6 meses = sinal de aviso

**Quick win imediato**: criar `README.md` no root copiando este bloco:

```
# Consulta ISP - Sistema de Agentes

CRM + 7 agentes AI (Sofia, Leo, Carlos, Lucas, Rafael, Marcos, Diana) que
conversam via WhatsApp (Z-API) com leads.

## Setup local
1. Node 20+, npm
2. `cd agentes-sistema && npm install`
3. Copiar `.env.modelo` pra `.env` e preencher
4. `npm run dev`
5. Abrir http://localhost:3001

## Deploy
Ver [docs/operations/deploy.md](docs/operations/deploy.md).

## Documentacao
- [Arquitetura](docs/architecture/overview.md)
- [Runbooks](docs/operations/runbooks/)
- [AUDITORIA-COMPLETA.md](AUDITORIA-COMPLETA.md)

## Contato
informaticaecialdn@gmail.com
```

### 3.4 Process Documentation

**Objetivo**: transformar operacao em processos repetitiveis com dono (RACI), criterios de conclusao e ferramentas.

**Processos criticos mapeados**

| ID | Processo | Freq | Criticidade | RACI |
|----|----------|:----:|:-----------:|------|
| P-01 | Deploy em producao | Sob demanda | Critica | R: Eng, A: Tech Lead, C: Ops, I: Time |
| P-02 | Atualizacao de prompt de agente | Semanal | Alta | R: Produto, A: Produto, C: Eng, I: Diana (supervisor) |
| P-03 | Onboarding de novo lead (automatico) | Continuo | Critica | R: Orchestrator, I: Eng (alertas) |
| P-04 | Broadcast / campanha massiva | Sob demanda | Critica | R: Marketing, A: DPO, C: Eng, I: Time |
| P-05 | Resposta a direito LGPD | Sob demanda | Alta | R: DPO, A: DPO, C: Eng, I: Juridico |
| P-06 | Incident response | Sob demanda | Critica | R: On-call, A: Tech Lead, C: Ops+DPO, I: Executivo |
| P-07 | Backup + restore test | Diario / Trimestral | Critica | R: Ops |
| P-08 | Revisao de compliance | Mensal | Alta | R: DPO |
| P-09 | Release notes + changelog | Por release | Media | R: Tech Lead |
| P-10 | Daily operation (monitor + acao) | Diario | Alta | R: Produto + Ops |

**Template comum de processo (SOP)**

Cada processo deve ter um arquivo `docs/processes/<ID>-<nome>.md` com:
```
# P-XX - Nome do processo

## Gatilho
(O que inicia?)

## Dono (RACI)
Responsible / Accountable / Consulted / Informed

## Frequencia e SLA
- Quando acontece
- Tempo maximo de execucao

## Pre-requisitos
(O que precisa estar pronto antes?)

## Passos
1. [ ] Passo 1 — quem faz, o que faz, evidencia
2. [ ] ...

## Criterios de conclusao (Definition of Done)

## Excecoes / escalacao

## Links relacionados
```

**SOPs prioritarios a escrever (detalhes)**

**P-01 Deploy em producao**

Pre-requisitos:
- [ ] PR aprovado por revisor
- [ ] Testes passam na CI
- [ ] `/api/diagnose` em dev retorna summary.failed=0

Passos:
1. Criar tag `vX.Y.Z` no git
2. `git push --tags`
3. SSH na VPS: `cd /opt/consulta-isp-agentes && git fetch --tags && git checkout vX.Y.Z`
4. Rodar `bash fix-vps.sh` (ou `update-vps.sh` se ja validado)
5. Aguardar 1 min e testar:
   - `curl http://localhost:3080/api/health`
   - `curl http://localhost:3080/api/diagnose | jq .summary`
   - Abrir dashboard no browser, clicar em 3 menus
6. Se falhar em 6 -> rollback (passo 9). Se OK:
7. Anotar no `CHANGELOG.md`
8. Anunciar no Slack #deploy

Rollback:
9. `git checkout <tag-anterior>` + `bash fix-vps.sh`
10. Postar incident em #ops se prejudicou operacao

DoD:
- [ ] Health OK
- [ ] Diagnose sem failed
- [ ] Dashboard navega
- [ ] Changelog atualizado

**P-04 Broadcast / campanha massiva**

Pre-requisitos:
- [ ] Audiencia definida com opt-in (consentimento gravado)
- [ ] Template HSM aprovado internamente (e pelo WhatsApp se API oficial)
- [ ] Horario definido (9h-21h fuso do destinatario)
- [ ] Rate limit configurado
- [ ] Diana revisou a mensagem
- [ ] DPO assinou o disparo

Passos:
1. Montar lista CSV com `phone,nome,tenant_id,variavel_*`
2. Criar registro `broadcast_campaigns` com status=rascunho
3. Preview: enviar para 5 numeros internos
4. Revisar entrega e conteudo
5. Aprovar e disparar em lotes de N por minuto
6. Monitorar:
   - Taxa de erro Z-API < 5%
   - Opt-out rate < 1%
   - Resposta rate > 0 (senao algo esta errado)
7. Pausar automaticamente se algum limite for atingido
8. Relatorio final: entregues, lidas, respondidas, opt-outs

DoD:
- [ ] 100% da audiencia processada ou pausada conscientemente
- [ ] Logs de cada envio persistidos
- [ ] Opt-outs atualizados no `consent_events`

**P-05 Resposta a direito LGPD**

SLA: ANPD recomenda 15 dias, Art. 19.

Passos:
1. Recebido request (via endpoint `/api/lgpd/direitos` ou email)
2. Validar identidade do titular (codigo enviado pro WhatsApp cadastrado)
3. Registrar em tabela `lgpd_requests`
4. Tipo:
   - **Acesso**: exportar CSV com todas colunas do lead + historico
   - **Correcao**: atualizar campo(s), registrar antes/depois
   - **Exclusao**: anonimizar (CPF virou hash, nome virou "Lead <id>", telefone zerado)
   - **Portabilidade**: CSV com estrutura documentada
   - **Anonimizacao**: idem exclusao
   - **Oposicao ao tratamento**: setar `consent_marketing=false` e documentar
5. Responder ao titular em prazo
6. Arquivar comprovante

DoD:
- [ ] Identidade validada
- [ ] Acao executada
- [ ] Response enviado ao titular
- [ ] Request registrado com timestamps

**P-06 Incident response**

Niveis:
- **SEV1**: prod totalmente fora (dashboard 500, webhooks falhando)
- **SEV2**: degradacao (lentidao, feature especifica quebrada)
- **SEV3**: bug sem impacto operacional

Passos SEV1:
1. (0-5min) Declarar incidente no #ops, @here
2. (5-10min) Commander nomeado — alguem dirige, nao mete a mao
3. (10-30min) Diagnostico: `/api/diagnose`, `docker compose logs`, status das integracoes
4. Comunicar para stakeholders a cada 30min
5. Mitigar (rollback, desligar feature flag, escalar)
6. Resolver
7. (24-72h pos) Postmortem blameless

Template de postmortem:
- Timeline
- Impacto (quantos leads, qual duracao, custo)
- Causa raiz (5 whys)
- O que foi bem
- O que pode melhorar
- Acao items (dono + prazo)

**P-07 Backup + restore test**

Diario automatico:
1. Cronjob 03:00 em `/opt/consulta-isp-agentes/scripts/backup.sh`
2. Dump SQLite atomicamente (`.backup` command do sqlite)
3. Gzip + criptografia com `openssl aes-256-cbc -k $BACKUP_KEY`
4. Upload pra S3/B2
5. Retencao: 7 diarios, 4 semanais, 12 mensais
6. Log em `backups.log`

Trimestral (manual, 1 dia):
1. Escolher backup aleatorio dos ultimos 30 dias
2. Subir staging com esse backup
3. Rodar `/api/diagnose` — todas tabelas populadas
4. Testar 3 queries chave
5. Documentar em `docs/operations/backup-restore.md`
6. Atualizar RTO/RPO baseado no tempo real

**P-10 Daily operation**

Checklist diario (5 min, quem abre a "loja"):
- [ ] `/api/diagnose` summary.failed == 0
- [ ] Numero Z-API online (checar dashboard Z-API)
- [ ] Custo de tokens de ontem dentro do budget
- [ ] Nao houve opt-out em massa (> 5/dia sinaliza algo)
- [ ] Fila de followups < 500 (senao tem acumulo)
- [ ] Backup de ontem existe em S3

**Gestao de mudanca**

Toda mudanca significativa passa por:
1. Proposta em documento (ADR, RFC, spec)
2. Review por pares
3. Se afeta compliance/seguranca: review DPO
4. Plano de rollback documentado
5. Janela de mudanca definida
6. Comunicacao previa
7. Execucao conforme P-01

**Cadencia semanal sugerida**

| Reuniao | Quando | Pauta |
|---------|--------|-------|
| Stand-up | Diario 9h | Bloqueios, foco do dia |
| Ops review | Segunda 10h | Metricas da semana, incidents, custo |
| Product review | Quarta 14h | Metricas de funil, qualidade de agentes, A/B tests |
| Compliance review | 1a segunda do mes | Controles, opt-outs, requests LGPD |
| Retrospectiva | Fim da sprint | Postmortems, divida tecnica, melhorias |

**Documentacao dos processos**: seguir template + versionar em Git. Revisao semestral obrigatoria (colocar label "stale" se > 6 meses).

---

## Plano de Ação Consolidado

**Método**: cada achado da auditoria foi pontuado por `Impacto (1-5)` × `Urgência (1-5)` menos `Esforço (1-5)`. Agrupei em 5 ondas executáveis.

### Onda 0 — Consertar o que está quebrado (essa semana)
Objetivo: dashboard operacional e sistema seguro para continuar.

| # | Acao | Origem | Esforco | Dono |
|---|------|--------|:-------:|:----:|
| 0.1 | Rodar `fix-vps.sh` na VPS | RECUPERACAO | 15min | Ops |
| 0.2 | Validar /api/diagnose + navegacao dos menus | — | 30min | Ops |
| 0.3 | Confirmar `.env` com chmod 600 | SEC-05 | 5min | Ops |
| 0.4 | Confirmar `.env` fora do git (`git log --all -- .env`) | SEC-05 | 5min | Ops |
| 0.5 | Confirmar Caddy com TLS automatico | ENC-01 | 30min | Ops |
| 0.6 | Backup manual do `data/` pra local fora da VPS | ENC-02 (temp) | 15min | Ops |

### Onda 1 — Bloqueadores de seguranca e compliance (proximas 2 semanas)
Sem isso, nao da para abrir broadcast nem multi-tenant.

| # | Acao | Origem | Esforco | Dono |
|---|------|--------|:-------:|:----:|
| 1.1 | HMAC em `/webhook/zapi` | SEC-01, C1 | 4h | Eng |
| 1.2 | Auth basico (login/senha env) em `/api/*` e `/` | SEC-02/14, C2 | 1 dia | Eng |
| 1.3 | Token Z-API no header (sair da URL) | SEC-04, C5 | 2h | Eng |
| 1.4 | Rate limit express-rate-limit | SEC-07 | 4h | Eng |
| 1.5 | Throttle WhatsApp (token bucket 1 msg/3s) | SEC-08, R1 | 1 dia | Eng |
| 1.6 | USER node no Dockerfile | SEC-11 | 15min | Eng |
| 1.7 | Helmet + CORS por env | SEC-09/10 | 2h | Eng |
| 1.8 | Mascarar PII em logs | SEC-17 | 2h | Eng |
| 1.9 | Backup automatico SQLite criptografado diario | ENC-02, R2 | 1 dia | Ops |
| 1.10 | Idempotencia do webhook (messageId UNIQUE) | C4, R9 | 4h | Eng |
| 1.11 | Parser de opt-out WhatsApp (PARAR/SAIR/STOP) | WA-04 | 4h | Eng |
| 1.12 | Aviso LGPD no 1o contato + politica de privacidade publica | LGPD-01/03 | 1 dia | DPO + Eng |

**Saida esperada**: CTRL-001, CTRL-002, CTRL-008, CTRL-011, CTRL-012, CTRL-013, CTRL-014 verdes.

### Onda 2 — Observabilidade + fundacao tecnica (semanas 3-4)

| # | Acao | Origem | Esforco | Dono |
|---|------|--------|:-------:|:----:|
| 2.1 | Logger Pino estruturado + correlation id | TD-F1/F2 | 1 dia | Eng |
| 2.2 | Gravacao de `token_usage` por conversa | TD-F3, R4 | 4h | Eng |
| 2.3 | Dashboard `/compliance` com 18 controles | CTRL-* | 1 dia | Produto |
| 2.4 | Jest + testes em orchestrator/ab-testing/followup | TD-C, 2.2 | 3 dias | Eng |
| 2.5 | GitHub Actions CI (lint + test) | TD-C4 | 2h | Eng |
| 2.6 | Mover arquivos orfaos root pra `docs/historico/` | TD-A1-3, TD-A6 | 1h | Eng |
| 2.7 | README.md root + docs/onboarding/dev.md | 3.3 | 4h | Tech Lead |
| 2.8 | Runbook: numero-banido, vps-caiu, claude-outage | 3.3 + 3.4 | 1 dia | Ops |
| 2.9 | Consolidar agentes em 1 fonte (config/agents.yaml ou DB) | TD-B1/A4 | 2 dias | Eng |

### Onda 3 — Preparar Broadcast (semanas 5-6)
Antes de ativar Fase 3 do AUDITORIA-E-PLANO.

| # | Acao | Origem | Esforco | Dono |
|---|------|--------|:-------:|:----:|
| 3.1 | Tabela `consent_events` + fluxo de captura | LGPD-02, WA-01 | 2 dias | Eng |
| 3.2 | Templates HSM no banco versionados | WA-02 | 2 dias | Eng |
| 3.3 | Janela 24h (fora = so template) | WA-03 | 1 dia | Eng |
| 3.4 | Rate limit por lead 2 msgs/24h | WA-05 | 4h | Eng |
| 3.5 | Janela horaria 9h-21h enforced | R15 | 4h | Eng |
| 3.6 | Endpoint /api/lgpd/direitos (acesso/exclusao/portabilidade) | LGPD-05 | 3 dias | Eng |
| 3.7 | RAT + DPO designado + DPA Anthropic/Z-API arquivados | LGPD-06/07/09 | 2 dias | DPO |
| 3.8 | Circuit breaker Claude + Z-API (opossum) | A4, R10/R11 | 1 dia | Eng |
| 3.9 | Queue persistente de mensagens pendentes (ver ADR-001) | A3, R11 | 3 dias | Eng |

### Onda 4 — Arquitetura escalavel (semanas 7-10)

| # | Acao | Origem | Esforco | Dono |
|---|------|--------|:-------:|:----:|
| 4.1 | Aprovar 4 ADRs (queue, DB, dashboard, multi-tenancy) | 1.2 | 1 semana | Tech Lead |
| 4.2 | Split server.js em `web` + `worker` containers | A1 | 2 dias | Eng |
| 4.3 | Split api.js em submodulos por dominio | TD-E1 | 1 dia | Eng |
| 4.4 | Camada de repositorio (LeadRepository, ConvRepository) | TD-E5 | 3 dias | Eng |
| 4.5 | Decidir destino de `dist/` (mover/apagar) | TD-A5 | 1 dia | Tech Lead |
| 4.6 | Extrair `services/ads/` para modulo separado | TD-E2 | 2 dias | Eng |
| 4.7 | Meta coverage de testes >= 40% | TD-C | — | Eng |
| 4.8 | DPIA (RIPD) assinado antes de multi-tenant | 2.3 | 1 semana | DPO + Legal |
| 4.9 | Decidir arq de dashboard (manter HTML ou migrar) | UX/A11Y/ADR-004 | — | Tech Lead |

### Onda 5 — UX e polimento (continuo, semanas 8+)

| # | Acao | Origem | Esforco |
|---|------|--------|:-------:|
| 5.1 | Acessibilidade — bloqueadores teclado (A11Y-09/10/14/15/19) | 3.1 | 3 dias |
| 5.2 | Banner de erro X + toast confirmacao + empty states | UX-04/03/05 | 2 dias |
| 5.3 | Search global Cmd+K + timestamp de refresh | UX-19/12 | 2 dias |
| 5.4 | Gestor de audiencias + wizard de broadcast | UX gap | 1 semana |
| 5.5 | View de conversa individual com prompt visivel | UX gap | 1 semana |
| 5.6 | Tela de custos Claude por agente/dia | TD-F3 + UX | 2 dias |
| 5.7 | A11Y completo para WCAG AA >= 90 score | 3.1 | 1 semana |

---

## Resumo executivo da auditoria

**Numero de achados por severidade**
| Severidade | Code review | Arq | Tech-debt | Sec | Risco | Test | Legal | A11Y | UX | **Total** |
|------------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Critico | 10 | 7 | 5 | 8 | 5 | — | — | 2 | 5 | **~42** |
| Alto | 5 | — | 10 | 7 | 7 | — | 10 | 8 | 10 | **~57** |
| Medio | 7 | — | 8 | 5 | 8 | — | 8 | 8 | 7 | **~51** |

**Conclusao**: o sistema tem uma base funcional solida (7 agentes claude, integracao Z-API, scoring) mas esta em estado pre-producao. Faltam os controles basicos de seguranca, compliance e operacao que um sistema com PII precisa ter.

**Ordem recomendada de leitura para o executivo**:
1. Onda 0 + Onda 1 desta secao (o que fazer ja)
2. Secao 2.1 Risk Assessment (top 5 riscos)
3. Secao 1.4 Security Review (o que esta exposto)
4. Secao 2.3 Legal Compliance (checklist de 14 itens antes de broadcast)

**Caminho critico para liberar Fase 3 (broadcast em massa do AUDITORIA-E-PLANO.md)**:
Ondas 0 + 1 + 3. Nao ignorar nenhum item da Onda 1 — cada um dele sozinho pode virar incidente publico.

**Proxima iteracao recomendada**: comecar Onda 0 (fix-vps.sh) enquanto voce aprova/ajusta este plano. Depois Onda 1 item por item em PRs pequenos, cada um com teste.
