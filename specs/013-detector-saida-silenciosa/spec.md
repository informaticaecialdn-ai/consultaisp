# Spec 013 — Detector de Saída Silenciosa

**Status:** Proposta
**Esforço:** 3-4 semanas (15-20 dias úteis)
**Risco execução:** Médio (precisa instrumentação adicional)
**Dependências:** Spec 010A operacional + Spec 012.0 ideal (banda) + UTM tracking no portal

---

## 1. Contexto

**Disrupção comportamental:** Cliente que vai cancelar dá sinais semanas antes da decisão formal. Sistemas tradicionais agem só DEPOIS do pedido de cancelamento — quando psicologicamente já decidiu, taxa de reversão cai drasticamente.

Sinais combinados de "saída silenciosa" (cliente psicologicamente saindo, mas ainda ativo):
1. **Queda de banda >40%** nos últimos 14 dias vs baseline 90d (Spec 012.0)
2. **Login portal aumentou 3x+** (cliente consultando conta, simulando cancelamento)
3. **Buscou Pix 2ª via 2+ vezes** recentemente (sinal "vou usar último mês e cancelar")
4. **Redução de tickets** (já desistiu de reclamar — sintoma de abandono)
5. **UTM referrer com termos competidores** no portal cliente
6. **Plan downgrade recente** + healthTier piorando
7. **Tempo desde último login app/portal > 60 dias** (desengajou)

**Hipótese (não validada para ISP brasileiro):**
- Cliente detectado em "saída silenciosa" tem 50-70% probabilidade de cancelar nos próximos 60 dias
- Intervir ANTES da decisão psicológica formal → retenção 2-3x maior que pós-decisão
- Inspirado em SaaS B2B churn prediction, **sem benchmark validado em ISP brasileiro**

---

## 2. Validações dependentes

### Necessárias para Spec 013 plena

| Sinal | Disponibilidade hoje |
|---|---|
| Queda de banda | Depende Spec 012.0 + ERP IXC (full) ou outro |
| Tickets / sentiment | ✅ Temos (Spec 003 — communications) |
| Plan downgrade | ✅ Temos (Spec 004 — contracts history) |
| Buscas Pix 2ª via | ✅ Temos (audit_logs do portal) |
| Login portal frequência | ⚠️ Precisa instrumentar (não temos hoje) |
| UTM referrer competidor | ⚠️ Precisa instrumentar (não temos hoje) |
| Tempo sem login | ⚠️ Precisa instrumentar |

**Versão MVP (sem instrumentação nova):** funciona com 4 sinais que já temos (tickets, downgrade, Pix 2ª via, healthTier piorando). Adiciona banda quando Spec 012.0 IXC entra. Adiciona UTM/login quando portal cliente for instrumentado.

---

## 3. User stories

**US-1 — Marcos detecta saída silenciosa em cliente A2**
Cliente Maria, A2 historicamente, perfil A1-C3 manteve mas healthScore caiu de 75 para 58. Sinais: -45% banda + buscou 2ª via 3x últimos 30 dias. Marcos dispara Helena com contexto "modo retenção proativa": "Oi Maria, faz um tempo que não conversamos. Tá tudo OK com nossa internet?"

**US-2 — Pedro coleta motivo via pesquisa proativa**
Cliente responde "tá lenta de noite". Pedro classifica sentiment + topic. Marcos cross-check com NMS: confirma saturação no POP. Dispara técnico ao invés de cobrança.

**US-3 — Owner vê pipeline de risco churn**
Dashboard "Em risco de saída silenciosa" com 30 clientes ordenados por exit risk score. Click → drill-down com sinais combinados visualizados.

---

## 4. Schema impact (AUTORIZAR)

### Tabela nova: `silent_exit_signals`

```typescript
export const silentExitSignals = pgTable("silent_exit_signals", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  providerId: integer("provider_id").notNull().references(() => providers.id),

  // Snapshot dos sinais no momento da detecção
  signals: jsonb("signals").notNull(),
  // Schema: {
  //   bandwidthDropPercent?: number,
  //   portalLoginCount30d?: number,
  //   portalLoginCountBaseline?: number,
  //   secondViaSearches30d?: number,
  //   ticketCount30d?: number,
  //   ticketCountBaseline?: number,
  //   utmCompetitorReferrer?: string,
  //   daysWithoutLogin?: number,
  //   recentPlanDowngrade?: boolean,
  //   healthScoreTrend?: 'declining' | 'stable',
  // }

  riskScore: integer("risk_score").notNull(),  // 0-100

  // Ação
  status: text("status").notNull().default("detected"),
  // 'detected' | 'survey_sent' | 'retention_offer_sent' | 'retained' | 'cancelled' | 'expired'

  triggeredAgent: text("triggered_agent"),  // 'pedro' | 'helena' | 'marcos' | 'human'
  surveyResponse: text("survey_response"),
  retentionOfferType: text("retention_offer_type"),

  // Outcome (validação após 60 dias)
  cancelledAt: timestamp("cancelled_at"),
  retainedAt: timestamp("retained_at"),
  outcomeMeasuredAt: timestamp("outcome_measured_at"),

  detectedAt: timestamp("detected_at").notNull().defaultNow(),
}, (t) => ({
  providerStatusIdx: index("ses_provider_status_idx").on(t.providerId, t.status),
  customerIdx: index("ses_customer_idx").on(t.customerId),
  riskScoreIdx: index("ses_risk_score_idx").on(t.riskScore),
}));
```

### Instrumentação adicional (portal cliente)

Adicionar em portal existente (ou criar se não há):
- Tracking de logins (timestamp, userAgent, IP)
- UTM tracking em URLs (capturar `?utm_source=concorrente_X`)
- Eventos: "viewed_invoice", "downloaded_second_via", "viewed_plan_change", "viewed_cancellation"

Tabela `portal_activity_events`:
```typescript
{
  customerId, eventType, eventData jsonb, occurredAt
}
```

---

## 5. Score determinístico

```
riskScore = 0

// Sinais técnicos (peso 35%)
+ 20 se bandwidthDropPercent >= 60
+ 15 se bandwidthDropPercent >= 40

// Sinais comportamentais portal (peso 30%)
+ 15 se portalLoginCount30d >= 5 * baseline
+ 10 se secondViaSearches30d >= 2
+ 5 se utmCompetitorReferrer detectado

// Sinais relacionais (peso 25%)
+ 15 se ticketCount30d < 0.3 * baseline (parou de reclamar)
+ 10 se daysWithoutLogin >= 90

// Sinais contratuais (peso 10%)
+ 10 se recentPlanDowngrade nos últimos 60 dias
+ 5 se healthScoreTrend === 'declining' nos últimos 30d

clamp 0-100
```

Thresholds:
- 70-100: high risk → ação imediata (Helena retenção)
- 50-69: medium risk → Pedro survey proativa
- 30-49: low risk → monitor, não age ainda
- <30: noise

---

## 6. Fluxo de intervenção

### Detectado high risk (≥70)

**Step 1 (D+0):** Pedro envia survey proativa:
```
"Oi [nome], faz um tempinho que não conversamos.
Notamos que você está usando menos a internet ultimamente.
Está tudo bem?
😊 Tudo certo
🤔 Tenho reclamação
😕 Pensando em cancelar
🤝 Quero mudar de plano"
```

**Step 2 (resposta):**
- 😊 → fecha, marca `outcome=tech_or_resolved`
- 🤔 → Helena assume com base na reclamação + Júlia gate
- 😕 → Marcos prepara contexto + Helena assume retenção com **oferta pré-aprovada** (-15% por 3 meses para A2/A3, downgrade para C)
- 🤝 → Comercial humano assume (mudança de plano = oportunidade de upsell ou downsell)

**Step 3 (sem resposta em 7 dias):**
- Helena dispara mensagem amigável follow-up sem pressão
- Se ainda sem resposta após 14 dias: aceita "abandono" — não persegue mais

### Detectado medium risk (50-69)

- Pedro coleta NPS pulse + tópico aberto
- Sem ação retentiva direta
- Atualiza sinal para próximo ciclo (deteriora ou estabiliza?)

---

## 7. Plano de execução — 5 batches

### Batch 1 — Schema + score calculator (3-4 dias)
- Schema `silent_exit_signals` + `portal_activity_events`
- Função pura `calcExitRiskScore`
- Tests unit

### Batch 2 — Instrumentação portal (3-4 dias)
- Capturar login events
- UTM tracking em querystring
- Eventos de interação (boleto, plano, cancelamento)
- Cron mensal: calcular baselines por cliente (logins 90d, tickets 90d)

### Batch 3 — Detector cron + workflow (4-5 dias)
- Worker diário roda detecção
- Pedro survey integration
- Helena retention mode (prompt v2 + Júlia gate)
- Marcos orquestração

### Batch 4 — Dashboard + UI (3-4 dias)
- Painel "Saída silenciosa" com lista priorizada
- Drill-down com sinais visualizados (timeline)
- Filtros por riskScore, perfil, região

### Batch 5 — A/B test + outcome tracking (2-3 dias)
- A/B: 50% detectados → intervenção; 50% → controle (silent observation)
- Outcome cron: 60 dias após detecção, marca cancelled/retained/no_response
- Dashboard comparativo

---

## 8. KPIs após 30 dias produção

**Métrica primária — retention lift:**
- Taxa de cancelamento em grupo treatment vs control (60 dias após detecção)
- Alvo: -25 pontos percentuais (ex: 30% vs 55% cancelando)

**Métrica secundária — true positive rate:**
- % de detectados high-risk que de fato cancelaram nos 60 dias seguintes
- Alvo: ≥50% (validar precisão do score)

**Métrica de saúde:**
- % de detectados que retomaram engajamento ativo (login frequente, banda volta)
- Alvo: ≥30%

**Métrica anti-fadiga:**
- Taxa de opt-out gerada por intervenções de saída silenciosa
- Aceitável: <2% (mensagens são reconhecidas como ajuda, não cobrança)

---

## 9. Out of scope

- Instrumentação de redes sociais externas (Twitter, Reclame Aqui menções)
- Análise de voz/áudio de chamadas (Spec 015+)
- Machine learning preditivo (Fase C do Customer Health — Spec 010C)
- Detecção via redes sociais ("amigo do cliente disse X em grupo do Facebook")

---

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Cliente percebe "stalking" no portal | UTM/login tracking declarado em política de privacidade + LGPD compliance |
| Falsos positivos altos no MVP | Modo "manual review" primeiros 14 dias: owner valida cada detecção antes de ação |
| Survey vira spam (anti-fadiga) | Limite: 1 survey de saída silenciosa por cliente a cada 90 dias |
| Banda não disponível para tenants MK | Score calcula com sinais disponíveis (4-5 vs 7) — eficácia menor mas funciona |
| Cliente diz "deixa quieto, vou ficar" mas cancela em 30d | Outcome tracking captura isso, ajusta thresholds via análise mensal |

---

## 11. Próximos passos

1. Aguardar Spec 010A em produção (healthScore declining é input)
2. Iniciar Batch 1 + Batch 2 em paralelo (independentes)
3. Modo manual review primeiros 14 dias
4. A/B test ativo do dia 1
