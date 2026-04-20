# Fluxogramas dos Agentes

Visao visual de como agentes decidem, conversam e se coordenam.
Cobre 7 fluxos principais.

---

## 1. Pipeline E2E (visao macro)

Como um lead atravessa o sistema do descobrimento ao fechamento.

```
                     ┌──────────────────────────────┐
                     │  PROSPECTOR WORKER (cron)    │
                     │  seg/qua/sex 8h BR           │
                     │  Apify Google Maps scraper   │
                     └──────────────┬───────────────┘
                                    │ items brutos
                                    ▼
                     ┌──────────────────────────────┐
                     │  leads_pending (tabela)      │
                     │  status = pending            │
                     └──────────────┬───────────────┘
                                    │ cron diario 9h
                                    ▼
                     ┌──────────────────────────────┐
                     │  LEAD-VALIDATOR              │
                     │  - DV do CNPJ                │
                     │  - DDD BR valido             │
                     │  - blacklist (igreja, etc.)  │
                     │  - rating/reviews >= min     │
                     │  - dedup                     │
                     │  score 0-1, threshold 0.45   │
                     └──────┬────────────────┬──────┘
                     rejected           approved
                            │                │
                            ▼                ▼
                      ┌─────────┐    ┌────────────────┐
                      │descarte │    │  LEADS         │
                      └─────────┘    │  origem =      │
                                     │  prospector_   │
                                     │  auto          │
                                     └───────┬────────┘
                                             │
                                             ▼
                     ┌──────────────────────────────┐
                     │  OUTBOUND WORKER (cron 2h)   │
                     │  horario comercial BR 9-17h  │
                     │  max OUTBOUND_MAX_COLD_      │
                     │  PER_DAY (default 30)        │
                     └──────────────┬───────────────┘
                                    │
                                    ▼
                     ┌──────────────────────────────┐
                     │  CARLOS (Sonnet-4-6)         │
                     │  envia cold WhatsApp         │
                     │  tool: send_whatsapp         │
                     │  respeita opt-out + window   │
                     └──────────────┬───────────────┘
                                    │ lead responde
                                    ▼
                     ┌──────────────────────────────┐
                     │  CARLOS qualifica BANT       │
                     │  tools: enrich_lead,         │
                     │  check_consent, query_lead_  │
                     │  detail, mark_qualified,     │
                     │  lookup_cnpj (ReceitaWS)     │
                     └──────┬──────────┬────────┬───┘
                  BANT ok   │    frio  │  sem   │
                  score 61+ │  score<31│   dor  │
                            ▼          ▼        ▼
                      ┌─────────┐  ┌───────┐ ┌─────────┐
                      │handoff  │  │Sofia  │ │mark_    │
                      │Lucas    │  │nurtur │ │unqualif │
                      └────┬────┘  └───────┘ └─────────┘
                           │
                           ▼
                     ┌──────────────────────────────┐
                     │  LUCAS (Opus-4-7)            │
                     │  apresenta produto           │
                     │  calcula ROI (skill)         │
                     │  tool: create_proposal       │
                     │  (gera proposta, nao envia   │
                     │   PDF se AUTO_SEND=false)    │
                     └──────────────┬───────────────┘
                                    │ lead aceita principio
                                    ▼
                     ┌──────────────────────────────┐
                     │  RAFAEL (Opus-4-7)           │
                     │  fecha contrato              │
                     │  tool: mark_closed_won       │
                     │  ou mark_closed_lost         │
                     └──────┬──────────────────┬────┘
                       ganho                 perda
                            │                    │
                            ▼                    ▼
                      ┌─────────┐         ┌─────────────┐
                      │etapa=   │         │etapa=perdido│
                      │ganho    │         │+motivo      │
                      │metrica  │         └─────────────┘
                      │+1 contr.│
                      └─────────┘
```

---

## 2. Inbound — WhatsApp mensagem chegando

O que acontece quando o lead manda mensagem.

```
  Lead envia WhatsApp
         │
         ▼
  ┌────────────────────────┐
  │ Z-API webhook          │
  │ POST /webhook/zapi     │
  │ HMAC validation (opc.) │
  └────────────┬───────────┘
               │
               ▼
  ┌────────────────────────┐
  │ detectOptOutFromMsg?   │───── sim ──► markOptOut + return
  │ ex: "STOP", "SAIR"     │
  └────────────┬───────────┘
               │ nao
               ▼
  ┌────────────────────────┐
  │ markOptIn (automatico) │
  │ + insert/update lead   │
  │ + insert conversa      │
  └────────────┬───────────┘
               │
               ▼
  ┌────────────────────────┐
  │ cancelFollowups(leadId)│
  │ + recordResponse(A/B)  │
  └────────────┬───────────┘
               │
               ▼
  ┌────────────────────────┐
  │ USE_TOOL_CALLING_      │
  │ AGENTS = true ?        │
  └──────┬──────────┬──────┘
      sim│          │nao (legado)
         ▼          ▼
   ┌───────────┐  ┌─────────────────────┐
   │ Platform  │  │ claude.analyzeAnd   │
   │ Agent     │  │ Decide (JSON)       │
   │ Client    │  │ shape legado        │
   │ invoke    │  └──────────┬──────────┘
   │ (loop     │             │
   │ tool_use) │             │
   └─────┬─────┘             │
         │                   │
         ▼                   ▼
  ┌────────────────────────────┐
  │ Processa resultado:        │
  │ - _sendByChannel (se nao   │
  │   enviou via tool)         │
  │ - handoff por score        │
  │ - _processAction           │
  │ - training.evaluate        │
  │ - schedule followup        │
  └────────────────────────────┘
```

---

## 3. Loop de Tool Calling (internals do platform-agent-client)

Como agentes chamam tools recursivamente ate responder.

```
  invokeAgent(agente, message, ctx)
         │
         ▼
  ┌──────────────────────────────┐
  │ build system prompt          │
  │ + skill injection            │
  │ + lead context               │
  │ + tools definitions          │
  │   (getDefinitionsForAgent)   │
  └─────────────┬────────────────┘
                │
                ▼
       ╭────────────────────╮
       │  iteration = 0     │
       ╰──────────┬─────────╯
                  │
                  ▼
       ╭────────────────────╮
       │  iteration < MAX   │────── nao ──► break (return text)
       ╰──────────┬─────────╯
                  │ sim
                  ▼
       ╭────────────────────╮
       │ messages.create    │
       │ com tools array    │
       │ (claudeWrapper ja  │
       │  tracka custo)     │
       ╰──────────┬─────────╯
                  │
                  ▼
       ╭────────────────────╮
       │ stop_reason ==     │
       │ "tool_use" ?       │────── nao ──► break (return text)
       ╰──────────┬─────────╯
                  │ sim
                  ▼
       ╭──────────────────────────────╮
       │ para cada tool_use block:    │
       │   isAllowed(agente, tool)?   │── nao ──┐
       │   → handler(input, ctx)      │         │
       │   → log agent_tool_calls     │         │
       │   → tool_result block        │         │
       ╰──────────┬───────────────────╯         │
                  │                             ▼
                  │                       ╭──────────╮
                  │                       │ blocked  │
                  │                       │ agent_   │
                  │                       │ tool_    │
                  │                       │ calls    │
                  │                       │ status=  │
                  │                       │ blocked  │
                  │                       ╰──────────╯
                  ▼
       ╭──────────────────────────────╮
       │ messages.push assistant      │
       │   content (tool_use blocks)  │
       │ messages.push user           │
       │   content (tool_results)     │
       │ iteration++                  │
       ╰──────────┬───────────────────╯
                  │
                  └──► loop
```

**Max iterations = 6** — guardrail contra loop infinito.

---

## 4. Iani supervisora (cron 1h)

O que Iani faz a cada hora.

```
  Cron 1h em 1h (worker process)
         │
         ▼
  ┌────────────────────────┐
  │ isKilled('supervisor') │── sim ──► skip + log
  └────────────┬───────────┘
               │ nao
               ▼
  ┌────────────────────────┐
  │ USE_TOOL_CALLING_      │
  │ AGENTS = true ?        │── nao ──► skip (precisa tools)
  └────────────┬───────────┘
               │ sim
               ▼
  ┌────────────────────────┐
  │ buildSnapshot():       │
  │ - por_etapa            │
  │ - por_agente           │
  │ - parados_7d por agent │
  │ - mensagens_hoje       │
  │ - erros_unresolved     │
  │ - custo_hoje_usd       │
  └────────────┬───────────┘
               │
               ▼
  ┌────────────────────────┐
  │ invokeAgent('iani',    │
  │   IANI_PROMPT+snapshot,│
  │   maxIterations: 4)    │
  └────────────┬───────────┘
               │
               ▼
       ╭─────────────────╮
       │ Iani decide:    │
       ╰─────────┬───────╯
                 │
       ┌─────────┼────────────────────────┐
       │         │          │             │
       ▼         ▼          ▼             ▼
  reassign_  notify_    pause_       handoff_
  stuck_     operator   campaign     to_agent
  leads      (warn/     (se taxa     (realoca
  (>7d)      critical)  falha>30%)   especifico)
       │         │          │             │
       └─────────┴──────────┴─────────────┘
                     │
                     ▼
              ┌──────────────┐
              │ lastResult   │
              │ salvo em     │
              │ status()     │
              └──────────────┘
```

---

## 5. Auto-healer (monitor 5min)

Decisao automatica de pausar workers.

```
  setInterval 5min (worker process)
         │
         ▼
  ┌───────────────────────────┐
  │ runCheck()                │
  └───┬───────┬────────┬──────┘
      │       │        │
      ▼       ▼        ▼
  ┌──────┐┌──────┐┌─────────┐
  │custo ││Z-API ││error    │
  │hoje  ││down  ││rate 1h  │
  │> $50?││>30m? ││>5%?     │
  └──┬───┘└──┬───┘└────┬────┘
     │sim   │sim      │sim
     ▼      ▼         ▼
  ┌──────────────────────────┐
  │ setKill('outbound',      │
  │   reason,                │
  │   set_by='auto_healer')  │
  │ persiste em system_flags │
  │ (cross-process DB)       │
  └──────────┬───────────────┘
             │
             ▼
  ┌──────────────────────────┐
  │ Workers no proximo tick  │
  │ consultam isKilled() e   │
  │ fazem skip automatico    │
  └──────────────────────────┘

  Manual override:
  - POST /api/autonomy/kill-switches/:worker
  - DELETE /api/autonomy/kill-switches/all
  - UI: pagina /autonomia "Clear ALL"
```

---

## 6. Handoffs entre agentes (regras)

Fluxo de transferencia entre agentes baseado em score e decisao.

```
  Todo handoff passa pela tool handoff_to_agent
  OU e automatico via orchestrator quando score cruza threshold.

                    ┌─────────────────┐
                    │  LEAD score 0   │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  CARLOS (SDR)   │
                    │  qualifica BANT │
                    └─────────────────┘
                             │
         ┌───────────────────┼────────────────────────┐
         │                   │                        │
    score < 31          score 31-60              score >= 61
         │                   │                        │
         ▼                   ▼                        ▼
    ┌─────────┐       ┌───────────┐            ┌───────────┐
    │ SOFIA   │       │ continua  │            │ LUCAS     │
    │ nurturing       │ com Carlos│            │ negociacao│
    │ (auto)  │       │ (espera)  │            │ (auto ou  │
    └────┬────┘       └───────────┘            │  tool)    │
         │                                     └─────┬─────┘
    apos 30-90d                                      │
         │                             score cruza 81│
         └──► re-engaja via                          │
              follow_up worker                       ▼
                                              ┌───────────┐
                                              │ RAFAEL    │
                                              │ fechamento│
                                              └─────┬─────┘
                                                    │
                                    ┌───────────────┼────────────┐
                                    │                            │
                                 ganho                         perda
                                    │                            │
                                    ▼                            ▼
                             ┌──────────┐              ┌─────────────┐
                             │etapa=    │              │etapa=perdido│
                             │ganho     │              │+motivo      │
                             │+metrica  │              │(concorrente,│
                             │+valor    │              │ preco, etc.)│
                             └──────────┘              └─────────────┘
```

**Handoffs automaticos no orchestrator.js** (linhas 70-73):
- Carlos → Lucas quando `score_total >= 61`
- Lucas → Rafael quando `score_total >= 81`
- Carlos → Sofia quando `score_total < 31 AND > 0` (frio)

**Handoff explicito via tool** (qualquer agente):
- `handoff_to_agent({ to, reason, context_summary })`
- Registra em `handoffs` table + atualiza `agente_atual` + `etapa_funil`
- Iani usa pra realocar leads mal-atribuidos

---

## 7. Mapa de comunicacao entre agentes

Quem invoca quem, quem produz pra quem.

```
                    ┌───────────────────────────────┐
                    │          IANI                 │
                    │     (Gerente Ops)             │
                    │  cron 1h - supervisao         │
                    │  pode: realocar, alertar,     │
                    │        pausar, reatribuir     │
                    └───────┬──────────────┬────────┘
                            │              │
                       delega             monitora
                            │              │
            ┌───────────────┼──────────────┼─────────────┐
            │               │              │             │
            ▼               ▼              ▼             ▼
      ┌─────────┐     ┌──────────┐   ┌──────────┐  ┌──────────┐
      │ SOFIA   │     │  LEO     │   │  MARCOS  │  │ funil    │
      │ marketg │◄───►│  copy    │   │  midia   │  │ Carlos/  │
      │ estrat  │     │  gera    │   │  Meta/   │  │ Lucas/   │
      │         │     │  texto   │   │  Google  │  │ Rafael   │
      └─────────┘     └──────────┘   └──────────┘  └──────────┘
            │              ▲              ▲
            │              │              │
            │         request_copy   query_campaign
            │         _from_leo      _performance
            │              │              │
            └──────────────┴──────────────┘

                      FUNIL COMERCIAL
                           │
                           ▼
    ┌──────────────────────────────────────────────────┐
    │                                                  │
    │  LEAD inbound WhatsApp                           │
    │         │                                        │
    │         ▼                                        │
    │  ┌─────────┐   score>=61    ┌──────────┐         │
    │  │ CARLOS  │───────────────►│  LUCAS   │         │
    │  │ SDR     │                │  Vendas  │         │
    │  │ Sonnet  │  handoff_to_   │  Opus    │         │
    │  │         │  agent(lucas)  │          │         │
    │  └─────────┘                └────┬─────┘         │
    │       ▲                          │                │
    │       │                   score>=81               │
    │   inbound                        │                │
    │   followup                       ▼                │
    │   (novas                   ┌──────────┐           │
    │    mensagens)              │  RAFAEL  │           │
    │                            │  Closer  │           │
    │                            │  Opus    │           │
    │                            └──────────┘           │
    └──────────────────────────────────────────────────┘
```

---

## 8. Decisao interna de Carlos (exemplo detalhado)

Passo a passo quando Carlos recebe mensagem.

```
  Mensagem chega: "Oi, sou dono da NetFibra em Varginha"
         │
         ▼
  ┌──────────────────────────────┐
  │ platform-agent-client        │
  │ invokeAgent('carlos', msg)   │
  │ skills + 11 tools carregadas │
  └──────────────┬───────────────┘
                 │
                 ▼
  ┌──────────────────────────────┐
  │ Iter 1: Claude responde      │
  │ decide: chamar enrich_lead   │
  │ {nome: "...", provedor:      │
  │  "NetFibra", cidade:         │
  │  "Varginha"}                 │
  └──────────────┬───────────────┘
                 │
                 ▼
  ┌──────────────────────────────┐
  │ handler enrich_lead:         │
  │ UPDATE leads SET nome=...,   │
  │   provedor=..., cidade=...   │
  │ agent_tool_calls INSERT ok   │
  └──────────────┬───────────────┘
                 │
                 ▼
  ┌──────────────────────────────┐
  │ Iter 2: Claude continua.     │
  │ Pode:                        │
  │ a) lookup_cnpj (se tiver)    │
  │ b) send_whatsapp (responder) │
  │ c) query_lead_detail (ler    │
  │    mais contexto)            │
  └──────────────┬───────────────┘
                 │ decide send_whatsapp
                 ▼
  ┌──────────────────────────────┐
  │ handler send_whatsapp:       │
  │ - check_consent (inline)     │
  │ - check_window_24h (inline)  │
  │ - zapi.sendText              │
  │ - INSERT conversas           │
  │ agent_tool_calls INSERT ok   │
  └──────────────┬───────────────┘
                 │
                 ▼
  ┌──────────────────────────────┐
  │ Iter 3: Claude retorna texto │
  │ stop_reason = end_turn       │
  │ texto e repasse ao orchestr. │
  │ mas nao precisa reenviar     │
  │ (_sendByChannel skip porque  │
  │  ja enviou via tool)         │
  └──────────────────────────────┘

  Total: 3 roundtrips com Claude,
         2 tool calls persistidas,
         latencia ~3-5s.
```

---

## Como ver em tempo real

Toda tool call e persistida em `agent_tool_calls`. Pra acompanhar um fluxo:

```sql
-- Ultimos 10 tool calls de um lead
SELECT criado_em, agente, tool_name, status, duracao_ms
FROM agent_tool_calls
WHERE lead_id = 42
ORDER BY id DESC LIMIT 10;

-- Breakdown por agente hoje
SELECT agente, tool_name, COUNT(*) c, AVG(duracao_ms) avg_ms
FROM agent_tool_calls
WHERE DATE(criado_em) = DATE('now')
GROUP BY 1,2 ORDER BY c DESC;

-- Handoffs do funil
SELECT de_agente, para_agente, COUNT(*)
FROM handoffs
WHERE criado_em > DATE('now','-7 days')
GROUP BY 1,2;
```

Ou visual: pagina `/autonomia` no dashboard mostra pipeline E2E + tool calls
24h por agente em tempo real.
