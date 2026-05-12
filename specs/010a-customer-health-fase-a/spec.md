# Spec 010A — Customer Health Score 360º (Fase A)

**Status:** Proposta — aguardando autorização schema novo
**Esforço:** 2-3 semanas (15-23 dias úteis)
**Risco execução:** Baixo
**Dependências:** Nenhuma técnica (usa só dados existentes no DB)

---

## 1. Contexto

Hoje, a tabela `customers` é puramente operacional (CPF, endereço, status). Falta uma **camada analítica derivada** que responda em qualquer momento: "esse cliente está saudável?"

Sem isso:
- **Marcos** não pode otimizar ROI (não sabe valor esperado por cliente)
- **Rafael** não pode calibrar concessão de desconto (não conhece valor do cliente)
- **Helena** não pode escolher tom (cliente fiel ≠ cliente crônico)
- **Owner** não pode priorizar atenção humana

Fase A constrói essa camada usando **apenas dados já presentes** no DB. Sem dependência externa, sem ML. Heurística determinística auditável.

Fase B (CAC/LTV/Payback) e Fase C (ML treinado) vêm depois — ver ROADMAP-V2.md.

---

## 2. User stories

**US-1 — Owner vê lista priorizada de clientes em risco esta semana**
Owner acessa dashboard e vê card "20 clientes em risco esta semana" com nome + tier + recomendação de ação. Click → drill-down no cliente.

**US-2 — Operador investiga saúde de um cliente específico**
Operador abre `/clientes/[id]` → vê tab "Saúde" com score atual (0-100) + componentes do cálculo + evolução gráfica dos últimos 90 dias.

**US-3 — Marcos consulta healthScore antes de despachar ação**
Marcos (orquestrador), ao decidir cobrar cliente em D+1, consulta `customer_health_snapshots` mais recente. Se `healthTier='gold'`, despacha Sofia (tom extra-cordial). Se `healthTier='critical'` + brokenAgreements ≥ 3, despacha confissão direta (Spec 011).

**US-4 — Rafael recebe healthScore no input**
Rafael (negociador), ao receber handoff, lê `customer_health_snapshots.healthTier` + `inadimplenciaRisk30dPercent` no contexto. Calibra desconto máximo conforme tier.

---

## 3. Escopo

### Dentro (Fase A)
- Tabela `customer_health_snapshots` (novo schema)
- Cron noturno recalcula score para clientes ativos
- API endpoints (health atual, histórico, lista at-risk)
- UI: tab "Saúde" no cliente + card no dashboard

### Fora (Fase B e C — ROADMAP-V2)
- CAC, Payback, LTV, LTV/CAC ratio
- Custos do provedor (config tenant)
- Sinais técnicos (banda, ONU status) — depende de Spec 012.0
- ML treinado — depende de 6+ meses de dados
- Configuração de pesos por tenant via UI

---

## 4. Schema impact (AUTORIZAR)

### Tabela nova: `customer_health_snapshots`

```typescript
export const customerHealthSnapshots = pgTable("customer_health_snapshots", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  snapshotDate: date("snapshot_date").notNull(),

  // Componentes — pontualidade
  contractMonths: integer("contract_months").notNull(),
  invoicesTotal: integer("invoices_total").notNull().default(0),
  invoicesPaid: integer("invoices_paid").notNull().default(0),
  invoicesLate: integer("invoices_late").notNull().default(0),
  invoicesOverdueCurrent: integer("invoices_overdue_current").notNull().default(0),
  avgDaysLate30d: decimal("avg_days_late_30d", { precision: 5, scale: 2 }),
  avgDaysLate90d: decimal("avg_days_late_90d", { precision: 5, scale: 2 }),
  avgDaysLate365d: decimal("avg_days_late_365d", { precision: 5, scale: 2 }),

  // Receita acumulada
  totalRevenueAccumulatedCents: integer("total_revenue_accumulated_cents").notNull().default(0),

  // Comportamento
  brokenAgreementsCount: integer("broken_agreements_count").notNull().default(0),
  ticketCount30d: integer("ticket_count_30d").notNull().default(0),
  ticketCount90d: integer("ticket_count_90d").notNull().default(0),
  lastInteractionDays: integer("last_interaction_days"),

  // Sentiment (derivado de AgentMemory + Communication NLP)
  avgSentimentScore90d: decimal("avg_sentiment_score_90d", { precision: 3, scale: 2 }),

  // Score final
  healthScore: integer("health_score").notNull(),  // 0-100
  healthTier: text("health_tier").notNull(),       // 'gold' | 'healthy' | 'warning' | 'critical'

  // Predições heurísticas
  inadimplenciaRisk30dPercent: integer("inadimplencia_risk_30d_percent"),
  churnRisk60dPercent: integer("churn_risk_60d_percent"),

  // Recomendação humano-legível
  recommendedAction: text("recommended_action"),
  recommendedAgent: text("recommended_agent"),  // 'sofia' | 'bruno' | 'rafael' | 'human_marcos' | 'none'

  computedAt: timestamp("computed_at").notNull().defaultNow(),
}, (t) => ({
  providerDateIdx: index("chs_provider_date_idx").on(t.providerId, t.snapshotDate),
  providerTierIdx: index("chs_provider_tier_idx").on(t.providerId, t.healthTier),
  customerDateIdx: index("chs_customer_date_idx").on(t.customerId, t.snapshotDate),
  uniqueCustomerDate: uniqueIndex("chs_unique_customer_date").on(t.customerId, t.snapshotDate),
}));
```

Schema mantém intacto: `customers`, `contracts`, `invoices`, `payment_events`, `communications`, `agreements`, `audit_logs`, `agent_memories`.

---

## 5. Cálculo do healthScore (função pura, determinística)

```
healthScore (0-100) = soma ponderada:
  35% × pontualidade   ← derivado de avgDaysLate90d + invoicesLate/invoicesTotal
  15% × fidelidade     ← derivado de contractMonths
  15% × confiabilidade ← inverso de brokenAgreementsCount + sazonalidade
  10% × sentiment      ← derivado de avgSentimentScore90d (-1 a +1 → 0-100)
  10% × engajamento    ← inverso de lastInteractionDays (saturação 180 dias)
  15% × score externo  ← Score Consulta ISP normalizado (0-1000 → 0-100)
```

### Sub-funções

**Pontualidade (0-100):**
- 100: zero atrasos nos últimos 90 dias OU avgDaysLate90d ≤ 1
- 80: avgDaysLate90d ≤ 3 e invoicesLate/invoicesTotal ≤ 0.10
- 60: avgDaysLate90d ≤ 7
- 40: avgDaysLate90d ≤ 15
- 20: avgDaysLate90d ≤ 30
- 0: avgDaysLate90d > 30 OU invoicesOverdueCurrent ≥ 3

**Fidelidade (0-100):**
- 0-3 meses: 30
- 4-6 meses: 50
- 7-12 meses: 70
- 13-24 meses: 85
- 24+ meses: 100

**Confiabilidade (0-100):**
- 0 quebras de acordo: 100
- 1 quebra: 70
- 2 quebras: 40
- 3+ quebras: 10

**Sentiment (0-100):**
- avgSentimentScore90d null (sem interação) → 50 (neutro)
- avgSentimentScore90d = +1.0 → 100
- avgSentimentScore90d = 0.0 → 50
- avgSentimentScore90d = -1.0 → 0
- Linear entre as faixas

**Engajamento (0-100):**
- lastInteractionDays ≤ 7: 100
- ≤ 30: 80
- ≤ 90: 60
- ≤ 180: 40
- > 180: 20

**Score externo (0-100):**
- Score Consulta ISP / 10
- Null (sem consulta): assume 50 (neutro)

### healthTier (categorização)

| Faixa | Tier | Ação default |
|---|---|---|
| 80-100 | **gold** | Proteger, considerar upsell sutil, alerta forte se cair para healthy |
| 60-79 | **healthy** | Cobrança preventiva normal (Bruno D-1) |
| 40-59 | **warning** | Atenção, tom mais cordial, Marcos analisa |
| 0-39 | **critical** | Intervenção humana OU confissão direta (Spec 011 trigger) |

### Predições heurísticas (Fase A — sem ML)

**inadimplenciaRisk30dPercent (0-100):**
```
base = 100 - healthScore
modifiers:
  + 20 se invoicesOverdueCurrent ≥ 1
  + 15 se avgDaysLate30d > 5
  + 10 se brokenAgreementsCount ≥ 2 nos últimos 6 meses
  - 10 se contractMonths > 24 e pontualidade > 80
clamp 0-100
```

**churnRisk60dPercent (0-100):**
```
base = (100 - healthScore) × 0.7
modifiers:
  + 25 se lastInteractionDays > 180
  + 20 se avgSentimentScore90d < -0.5
  + 15 se contractMonths < 6
  + 10 se ticketCount30d ≥ 3 com sentiment negativo
clamp 0-100
```

Ambas heurísticas são **explicitamente substituíveis** por modelo ML treinado na Fase C (`010C`). Interface da função permanece.

### recommendedAction (texto)

Gerado a partir do tier + risks + componentes mais fracos:

| Caso | Ação sugerida |
|---|---|
| gold + zero atraso 12m | "Cliente OURO — protege com cuidado. Considerar upsell sutil em pagamentos." |
| gold com queda 30d | "ALERTA: cliente fiel virou warning. Marcos LIGA pessoalmente em 24h." |
| healthy padrão | "Régua normal. Bruno envia D-1 lembrete." |
| warning + tendência piorando | "Atenção. Helena monitora inbound. Rafael calibra desconto até 15%." |
| critical + brokenAgreements ≥ 3 | "Atalho Spec 011: oferecer confissão D+1 com 30% off em 6x." |
| critical + churnRisk ≥ 70 | "Risco churn alto. Retenção humana ANTES de cobrar." |

---

## 6. Cron + persistência

**Schedule:** diário às 02:00 BRT (horário baixa atividade)
**Worker:** `server/workers/customer-health-recalc.ts` (novo)
**Estratégia:** processa por provider em batch, paraleliza com p-limit (concorrência 10)
**Idempotente:** `uniqueIndex(customerId, snapshotDate)` impede duplicação. Re-rodar mesmo dia faz UPDATE.

**Performance target:**
- 10k clientes em provider médio: <30s
- 50k clientes em provider grande: <3min

**Logging:** estruturado JSON. Métricas: total processados, tier breakdown, tempo médio por cliente.

---

## 7. API endpoints

```
GET /api/customers/:id/health
  → último snapshot do cliente
  → resposta: { healthScore, healthTier, components: {...}, predictions: {...}, recommendedAction }

GET /api/customers/:id/health/history?days=90
  → série temporal (1 snapshot por dia, últimos N dias)
  → resposta: array ordenado por snapshotDate

GET /api/dashboard/at-risk
  → lista priorizada (healthTier in ['warning','critical'])
  → ordenada por inadimplenciaRisk30dPercent DESC
  → limit padrão 20
  → resposta: array com customerId, name, healthTier, risks, recommendedAction

GET /api/dashboard/health-distribution
  → contagem por tier (gold | healthy | warning | critical)
  → para gráfico de pizza no dashboard
```

Auth: todos via `requireAuth` middleware. Multi-tenancy via `req.session.providerId`.

---

## 8. UI

### Tab "Saúde" em `/clientes/[id]`

**Layout:**
- Card hero: número grande do healthScore + badge colorido do tier
- Gráfico de linha 90 dias (Recharts) com healthScore + marcações de eventos
- Grid 2×3 de cards menores (pontualidade, fidelidade, confiabilidade, sentiment, engajamento, score externo) — cada um com seu sub-score 0-100
- Texto destacado: "Recomendação atual: [recommendedAction]"
- Tabela de "snapshots" expansível com dados brutos do histórico

### Dashboard

- Novo card "20 clientes em risco esta semana"
- Tabela compacta: avatar + nome + tier (badge) + inadimplenciaRisk% + churnRisk% + ação sugerida (botão)
- Link "Ver todos" → página `/dashboard/clientes-em-risco` com filtros + paginação

### Componente reusable

`<HealthBadge tier="gold|healthy|warning|critical" />` — usado em listas de clientes, dossiês, etc.

---

## 9. Plano de execução — 5 batches

### Batch 1 — Schema + types (3-5 dias)
- [ ] `shared/schema.ts`: adicionar `customerHealthSnapshots` (com autorização)
- [ ] Tipos + insert schema + Zod
- [ ] `npm run db:push` em dev
- [ ] Testes de schema (insert, query por tier, unique constraint)

### Batch 2 — Cálculo do score (4-6 dias)
- [ ] `server/services/customer-health/types.ts` — interfaces puras
- [ ] `server/services/customer-health/score-calculator.ts` — função pura, sem dependência de DB
- [ ] `server/services/customer-health/snapshot-builder.ts` — busca dados via storage + chama calculator
- [ ] `server/services/customer-health/recommendation-engine.ts` — gera recommendedAction + recommendedAgent
- [ ] Testes unit cobrindo 9 perfis (A1-C3) + casos especiais (novo, vulnerável, gold→warning)

### Batch 3 — Cron + persistência (2-3 dias)
- [ ] `server/workers/customer-health-recalc.ts`
- [ ] Integração com sistema de schedule (verificar se existe ou criar via `node-cron`)
- [ ] Idempotência via upsert em `(customerId, snapshotDate)`
- [ ] Logger estruturado + métricas (tempo total, tier breakdown)
- [ ] Manual trigger via `npm run health:recalc` para dev

### Batch 4 — API endpoints (2-3 dias)
- [ ] `server/routes/customer-health.routes.ts`
- [ ] 4 endpoints listados na §7
- [ ] Validação Zod nos params + bodies
- [ ] Tests: integração com DB de teste

### Batch 5 — UI (4-6 dias)
- [ ] `client/src/pages/provedor/cliente-detalhe/saude-tab.tsx`
- [ ] `client/src/components/health-badge.tsx` (reusável)
- [ ] `client/src/components/health-score-chart.tsx`
- [ ] Card no dashboard principal
- [ ] Página `/dashboard/clientes-em-risco`
- [ ] Tests E2E: cliente health flow

---

## 10. Validações de aceitação

1. Cron noturno roda em <30s para 10k clientes em instância de teste
2. Tab "Saúde" carrega em <500ms (consulta 1 snapshot + 90 históricos)
3. Lista at-risk no dashboard reflete fielmente `healthTier IN ('warning','critical')` ordenada por risco
4. healthScore determinístico: re-rodar cron 2x no mesmo dia produz mesmo valor
5. Edge cases: cliente novo (1 fatura), cliente inativo, cliente sem tickets — todos sem erro
6. Multi-tenancy: operador de tenant A não vê snapshots de tenant B (RLS)
7. Logs estruturados rastreáveis por `correlationId`

---

## 11. KPIs após 30 dias em produção (Vertical Fibra)

**Métrica primária:**
- **Recall**: de clientes que viraram inadimplentes (≥5 dias atraso) no período, % que estavam em `warning` ou `critical` 30 dias antes
- Alvo: ≥70%
- Comparativo baseline: classificação A1-C3 simples (esperado ~40%)

**Métrica secundária:**
- **Precision** do tier critical: % dos critical que de fato atrasaram nos 30 dias seguintes
- Alvo: ≥60%
- Falso positivo aceitável (40%): preferimos abordar preventivo cliente bom do que perder cliente C3

**Métricas operacionais:**
- Tempo médio carregamento tab Saúde: p95 < 500ms
- Cron job duração: p95 < 30s para 10k clientes
- Cobertura: 100% dos clientes ativos com snapshot dos últimos 7 dias

---

## 12. Out of scope explicitamente (Fase A)

- CAC, Payback, LTV → Fase B (Spec 010B)
- Sinais técnicos (banda, ONU) → depende de Spec 012.0
- ML preditivo treinado → Fase C (Spec 010C)
- Configuração de pesos por tenant → UI futuro
- Simulador de cancelamento → Fase B (precisa CAC/LTV)
- Comparação cross-tenant (benchmarks) → Q2/2027
- Health score como input para pricing dinâmico → Spec 015+

---

## 13. Próximos passos imediatos

1. **Autorizar schema** `customer_health_snapshots` (esta spec)
2. **Confirmar pesos default** propostos na §5 (ou propor ajustes baseado em conhecimento Vertical Fibra)
3. **Iniciar Batch 1** — schema + types

Tempo estimado para entrega produção: 3 semanas após autorização.
