# Spec 014 — Geo-Monitor Competitivo

**Status:** Proposta
**Esforço:** 3 semanas (12-15 dias úteis)
**Risco execução:** Médio (depende qualidade de API de busca + LLM extraction)
**Dependências:** Nenhuma (independente das outras specs 009-013)

---

## 1. Contexto

**Disrupção operacional:** Hoje o provedor descobre que novo concorrente entrou no bairro **quando o churn começa**. Já é tarde — clientes migraram. Reativo, não estratégico.

**Pivô:** Crawler diário monitora menções a novos provedores na região de cobertura do tenant:
- **Google Search** via Serper API (~$50/mês para 10k queries) — termos como "provedor internet [cidade]", "fibra [bairro]", "internet rural [região]"
- **Meta Ad Library** (API gratuita) — anúncios de provedores filtrados por geo
- **Sites de provedores locais** — web scraping leve, detectar novas páginas de cobertura
- **Reclame Aqui** — reviews recentes que mencionam migração

**LLM extraction** (Haiku, custo baixo): classifica resultados como "novo provedor" vs "provedor existente" vs "ruído".

**Output:** Alerta no dashboard:
> 🚨 Provedor "Fibra-X" anunciou cobertura em Ibiporã/PR ontem. Você tem 47 clientes nessa região. Sugestão: campanha retenção upgrade gratuito por 30 dias.

---

## 2. Hipótese de retorno

**Não validada para ISP brasileiro:**
- Detecção antecipada (14-30 dias antes de churn começar) → janela de retenção ativa
- Provedor age preventivamente: campanha de retenção, upgrade gratuito, contato proativo
- Redução de churn regional: 30-50% comparado a reação tardia

**Como validar:** A/B regional após 60 dias. Bairros com alerta + ação vs bairros sem alerta. Comparar taxa de cancelamento.

---

## 3. Validações técnicas

### Serper API (Google Search programmatic)

**FATO conhecido (validar contratualmente):**
- $50/mês para 10k queries (plano starter)
- $300/mês para 100k queries
- Endpoint REST simples (POST com query string)
- Retorna SERP completa em JSON

**Alternativa:** Bing Web Search API ($3/1k queries, $30 para 10k). Mais barato mas qualidade SERP brasileiro pode ser inferior.

**Volume estimado Vertical Fibra:**
- 10 cidades cobertas × 5 termos × diário × 30 dias = 1.500 queries/mês
- Folgado no plano $50

**Para 100 tenants:**
- ~10k cidades × 5 termos × diário = 1.5M queries/mês
- Inviável no Serper; precisa Bing ou crawler próprio

**Decisão MVP:** Serper para Vertical Fibra + 5 piloto. Reavaliar arquitetura quando escalar para 50+ tenants.

### Meta Ad Library API

**FATO:** Gratuita, retorna ads de pages business com filtro geo. Limitação: só ads "issues, elections or politics" são públicos? **VALIDAR** — pode ser limitação relevante.

### Web scraping

**Atenção legal:** Scraping pode violar ToS de alguns sites. MVP foca em fontes públicas declaradas (Google SERP via Serper é OK), evita scraping direto.

---

## 4. User stories

**US-1 — Owner descobre novo concorrente antes de churn**
Crawler diário detecta nova landing page de "Provedor Fibra-X em Londrina". LLM classifica como "novo provedor regional". Owner recebe email + push: "Novo concorrente detectado. 78 clientes seus moram na área de cobertura."

**US-2 — Marcos sugere ação proativa**
Marcos cross-check geo dos clientes vs região de cobertura do novo provedor. Lista priorizada por LTV. Sugere campanha de retenção segmentada.

**US-3 — Owner valida alerta**
Owner clica no alerta. Vê: prints da landing page do concorrente, lista de clientes afetados, sugestão de ação. Aprova ou rejeita ("não é concorrente real, é vendedor de roteador").

---

## 5. Schema impact (AUTORIZAR)

### Tabela nova: `competitor_signals`

```typescript
export const competitorSignals = pgTable("competitor_signals", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),

  competitorName: text("competitor_name").notNull(),
  competitorWebsite: text("competitor_website"),
  competitorCnpj: text("competitor_cnpj"),  // se identificável

  // Geografia
  regionDetected: jsonb("region_detected"),  // { city, state, neighborhood, lat?, lng? }
  customersAffectedCount: integer("customers_affected_count"),

  // Sinal
  signalSource: text("signal_source").notNull(),  // 'google_search' | 'meta_ads' | 'website' | 'reclame_aqui'
  signalUrl: text("signal_url"),
  signalSnippet: text("signal_snippet"),
  signalScreenshotUrl: text("signal_screenshot_url"),

  // Classificação
  llmClassification: text("llm_classification"),  // 'new_provider' | 'existing_provider' | 'unrelated' | 'noise'
  llmConfidence: decimal("llm_confidence", { precision: 3, scale: 2 }),  // 0-1

  // Review humano
  reviewedByUserId: integer("reviewed_by_user_id"),
  reviewedDecision: text("reviewed_decision"),  // 'real_competitor' | 'false_positive' | 'pending'
  reviewedAt: timestamp("reviewed_at"),

  // Ação tomada
  actionTaken: text("action_taken"),  // 'campaign_launched' | 'monitoring' | 'dismissed'

  detectedAt: timestamp("detected_at").notNull().defaultNow(),
}, (t) => ({
  providerDetectedIdx: index("cs_provider_detected_idx").on(t.providerId, t.detectedAt),
  reviewedIdx: index("cs_reviewed_idx").on(t.reviewedDecision),
}));
```

### Tabela auxiliar: `competitor_search_terms`

Por tenant, configura termos a monitorar:

```typescript
export const competitorSearchTerms = pgTable("competitor_search_terms", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  term: text("term").notNull(),  // ex: "provedor internet londrina"
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
});
```

---

## 6. Workflow do crawler

### Cron diário 04:00 BRT

```
1. Para cada tenant ativo (com SEARCH_TERMS enabled):
   a. Carrega termos configurados (default: ["provedor internet [cidade]", "fibra [cidade]", ...])
   b. Para cada termo:
      - Serper API: SEARCH_RESULTS = serper.search(termo)
      - Para cada resultado:
        * Verifica se URL já está em competitor_signals (dedup)
        * LLM classifica: "é novo provedor? existente? não-relacionado?"
        * Se 'new_provider' com confidence ≥ 0.6:
          - Geocode região mencionada (city/neighborhood)
          - Cross-check clientes afetados (geo match)
          - Cria competitor_signal
          - Notifica owner (email + dashboard)

2. Meta Ad Library:
   a. Filtra ads de "Internet & Telecommunications" geo-cidade
   b. Compara com lista anterior, detecta novas pages
   c. Mesma pipeline LLM classification
```

### LLM prompt (Haiku, ~50 tokens custo médio)

```
Analise este resultado de busca:

Título: [title]
URL: [url]
Snippet: [snippet]
Contexto da busca: "[search_term]" do provedor [tenant_name] em [region]

Classifique como UM destes:
- new_provider: novo provedor de internet entrando na região
- existing_provider: provedor já conhecido na região
- unrelated: site não-relacionado (loja de roteador, blog técnico, etc.)
- noise: SERP poluído

Retorne JSON: { classification, confidence (0-1), reasoning, competitor_name?, region_detected? }
```

---

## 7. UI

### Dashboard

- Card "Movimentos competitivos esta semana"
- Lista compacta: nome do concorrente | região | clientes afetados | data
- Badge de classificação (new/existing/pending review)

### Página detalhe `/competidores`

- Lista completa filtrada por status
- Cada item expansível: screenshot da landing, snippet, sugestão de ação
- Botões: ✅ Real concorrente (action) / ❌ Falso positivo / 🤔 Monitorar

### Mapa

- Heatmap de clientes afetados + pin do concorrente
- Geo-filter para campanha de retenção segmentada

---

## 8. Plano de execução — 4 batches

### Batch 1 — Setup crawler + Serper integration (3-4 dias)
- Schema `competitor_signals` + `competitor_search_terms`
- Integração Serper API
- Cron diário
- Logging + monitoring de custos (não estourar quota)

### Batch 2 — LLM classification + dedup (2-3 dias)
- Worker classify via Haiku
- Dedup via URL hash + similaridade nome
- Score de confidence + threshold configurável

### Batch 3 — Geo match + cliente cross-check (2-3 dias)
- Geocode região via Nominatim (já temos) ou Google Maps API
- Query clientes afetados (`customers.city` ou raio em torno de lat/lng)
- Lista priorizada por LTV (depende Spec 010B) ou por count

### Batch 4 — UI dashboard + review workflow (3-4 dias)
- Card no dashboard
- Página `/competidores` com filtros
- Workflow de review humano
- Notificação por email + push

---

## 9. KPIs após 30 dias produção

**Métrica primária — precisão:**
- % de alertas classificados como "real_competitor" pelo owner / total alertas
- Alvo: ≥60% (40% falso positivo aceitável)

**Métrica secundária — antecedência:**
- Tempo médio entre detecção do alerta e início observado de churn na região
- Alvo: ≥14 dias de janela de ação

**Métrica de impacto:**
- Bairros com alerta + ação de retenção vs sem ação: comparação de churn 60 dias
- Alvo: -30 pontos percentuais (validar A/B regional)

**Métrica de custo:**
- Custo total mensal Serper + LLM + geocoding
- Alvo: <R$ 500/mês para Vertical Fibra + 5 piloto

---

## 10. Out of scope

- Monitoramento de redes sociais privadas (Facebook grupos privados, WhatsApp comunidades)
- Análise de pricing comparativo automático
- Captura de leads do concorrente (web scraping aggressive)
- Mass mailing automático para clientes afetados (decisão fica com owner)
- Integração com Reclame Aqui API (sem API oficial pública)

---

## 11. Riscos

| Risco | Mitigação |
|---|---|
| Serper retorna resultados ruins para queries pt-BR regionais | Validar com 20 termos iniciais em Vertical Fibra. Se SERP brasileiro fraco, considera Bing |
| LLM classifica errado (muitos falsos positivos) | Modo manual review primeiros 30 dias antes de auto-notificações |
| Custo Serper explode em rollout multi-tenant | Hard limit por tenant + alerta em 80% quota. Reavaliar arquitetura em 50+ tenants |
| Provedor concorrente real percebe monitoramento + retalia | Inevitável. Crawler usa fontes públicas, não há base legal para retaliação |
| Geo match impreciso (cidade vs bairro vs região) | Refinamento iterativo com feedback humano. MVP usa city-level |

---

## 12. Próximos passos

1. Autorizar schema `competitor_signals` + `competitor_search_terms`
2. Validar Serper API com 5 termos teste em Vertical Fibra
3. Configurar termos iniciais (Marcos pode sugerir baseado em conhecimento regional)
4. Iniciar Batch 1
