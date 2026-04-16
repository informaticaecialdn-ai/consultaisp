# Design Spec: 5 Features — agentes-sistema

**Data:** 2026-04-16
**Status:** Aprovado
**Projeto:** C:\ClaudeCode\Consulta_ISP\agentes-sistema\
**Stack:** Node.js + Express + better-sqlite3 + @anthropic-ai/sdk (JavaScript puro)

---

## Feature 1: Follow-up Automatico

Quando lead nao responde em X horas, o agente envia follow-up via WhatsApp.

### Tabela: followups
| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | INTEGER PK | |
| lead_id | INTEGER NOT NULL | |
| agente | TEXT NOT NULL | |
| mensagem_original | TEXT | Ultima mensagem enviada |
| tentativa | INTEGER DEFAULT 1 | 1, 2 ou 3 |
| proximo_envio | DATETIME NOT NULL | Quando enviar |
| status | TEXT DEFAULT 'pendente' | pendente/enviado/cancelado |
| criado_em | DATETIME | |

### Service: src/services/followup.js
- `scheduleFollowup(leadId, agente)` — agenda 1o follow-up em 24h
- `cancelFollowups(leadId)` — cancela pendentes (quando lead responde)
- `processFollowups()` — verifica pendentes com proximo_envio <= now, envia via Z-API
- Regras: tentativa 1 = 24h, 2 = 48h, 3 = 72h. Max 3.
- Mensagem gerada via Claude (curta, referencia ultima conversa)

### Integracao
- orchestrator.processIncoming: quando lead responde → cancelFollowups(leadId)
- orchestrator.processIncoming: apos enviar resposta → scheduleFollowup se lead nao esta em followup ativo
- server.js: setInterval(followup.processFollowups, 5 * 60 * 1000) — verifica a cada 5 min

### Endpoint
- GET /api/followups — listar followups pendentes
- DELETE /api/followups/:leadId — cancelar followups de um lead

---

## Feature 2: Multi-canal (Instagram DM + Email)

### Service: src/services/instagram.js
- Instagram Graph API Messaging
- sendDM(userId, message) — envia DM
- Precisa: META_PAGE_ACCESS_TOKEN, META_PAGE_ID

### Service: src/services/email-sender.js
- Resend API (ja tem no Consulta ISP principal)
- sendEmail(to, subject, body) — envia email
- Precisa: RESEND_API_KEY

### Tabela leads: novo campo
- canal_preferido TEXT DEFAULT 'whatsapp' — detectado pelo canal de entrada

### Webhook
- POST /webhook/instagram — recebe DMs do Instagram

### Integracao
- orchestrator ganha parametro canal
- Ao enviar resposta: usa zapi/instagram/email conforme canal_preferido
- Ao receber: webhook detecta canal e passa pro orchestrator

---

## Feature 3: Relatorios PDF

### Dependencia npm
- pdfkit (gerar PDF)

### Service: src/services/pdf-report.js
- generatePerformanceReport(periodo, agente) → Buffer PDF
- Conteudo: KPIs, funil, performance agentes, top leads, notas supervisor
- Diana gera analise narrativa via Claude pra incluir no PDF

### Endpoint
- GET /api/relatorios/performance?periodo=mensal&agente=todos → download PDF

---

## Feature 4: Webhook Status Z-API

### Tabela conversas: novo campo
- status_entrega TEXT DEFAULT 'enviado' — enviado/entregue/lido

### Webhook atualizado
- POST /webhook/zapi/status — parseia payload Z-API, atualiza status_entrega

### Metricas
- Taxa de leitura por agente no /api/stats
- GET /api/metricas/entrega — taxa entregue/lido por agente

---

## Feature 5: A/B Testing

### Tabela: ab_tests
| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | INTEGER PK | |
| agente | TEXT NOT NULL | |
| tipo_mensagem | TEXT NOT NULL | prospeccao/followup/demo |
| variante_a | TEXT NOT NULL | |
| variante_b | TEXT NOT NULL | |
| envios_a | INTEGER DEFAULT 0 | |
| envios_b | INTEGER DEFAULT 0 | |
| respostas_a | INTEGER DEFAULT 0 | |
| respostas_b | INTEGER DEFAULT 0 | |
| vencedor | TEXT | 'a' ou 'b' ou null |
| min_envios | INTEGER DEFAULT 20 | Envios minimos por variante |
| status | TEXT DEFAULT 'ativo' | ativo/concluido |
| criado_em | DATETIME | |

### Service: src/services/ab-testing.js
- createTest(agente, tipo, varianteA, varianteB, minEnvios) — cria teste
- getVariant(agente, tipo) — retorna A ou B (round-robin)
- recordSend(testId, variante) — incrementa envios
- recordResponse(testId, variante) — incrementa respostas
- checkWinner(testId) — se ambas >= minEnvios, calcula vencedor por taxa resposta
- Vencedor → training.learn(agente, 'frase_converte', varianteVencedora)

### Integracao
- orchestrator: antes de enviar mensagem de prospeccao/followup, verifica A/B test ativo
- Quando lead responde: identifica qual variante recebeu, incrementa respostas

### Endpoints
- GET /api/ab-tests — listar testes
- POST /api/ab-tests — criar teste (Leo gera 2 variantes via Claude)
- GET /api/ab-tests/:id — detalhe com taxas
- POST /api/ab-tests/:id/conclude — forcar conclusao

---

## Arquivos novos
- src/services/followup.js
- src/services/instagram.js
- src/services/email-sender.js
- src/services/pdf-report.js
- src/services/ab-testing.js

## Arquivos modificados
- src/models/database.js (+3 tabelas: followups, ab_tests + campos em leads e conversas)
- src/services/orchestrator.js (followup + multi-canal + A/B)
- src/routes/api.js (+endpoints followups, relatorios, metricas entrega, ab-tests)
- src/routes/webhook.js (instagram webhook + status Z-API melhorado)
- src/server.js (scheduler followup)
- package.json (+pdfkit)

## Ordem de implementacao
1. Feature 4 (webhook status) — menor, desbloqueia metricas
2. Feature 1 (follow-up) — core value, usa metricas de entrega
3. Feature 5 (A/B testing) — depende de followup pra testar variantes
4. Feature 3 (relatorios PDF) — independente
5. Feature 2 (multi-canal) — mais complexo, requer credenciais externas
