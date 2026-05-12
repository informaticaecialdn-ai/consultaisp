# ROADMAP V2 — Provedor.AI

**Criado:** 2026-05-12
**Status:** Canônico — substitui o plano de 3 meses anterior (`cuddly-churning-dijkstra.md`) nas Specs 009-014.
**Mantém intacto:** Specs 003-008.6 já commitadas. Esta é a **próxima onda**.

---

## 1. Por que esse pivô existe

A análise estratégica revelou que o roadmap original construía um "Neofin vertical de ISP" — defensável por 12-18 meses, depois empata. Não justifica o produto vs. cobradores humanos competentes.

Para o provedor não cancelar em 3 meses, o sistema precisa **saber coisas que humano não consegue saber** e **agir em timing que humano não consegue executar**. O pivô foca em capacidades **preditivas + proativas** em vez de reativas + procedurais.

---

## 2. Princípios deste roadmap

1. **Distinguir fato / hipótese / validar.** Toda afirmação não-trivial é marcada explicitamente.
2. **Cada spec destrava produto vendável.** Sem 6 meses de infra invisível.
3. **Heurística antes de ML.** ML sem dados rotulados é gambiarra. Bootstrap com regras explícitas; evolui quando dados existirem.
4. **Manter v1 intacta.** Specs 003-008.6 são fundação, não jogamos fora.
5. **Anti-hype.** Números de "X% lift" são hipóteses extrapoladas de outras indústrias até validados com A/B test real no piloto Vertical Fibra.

---

## 3. O que mantém intacto

| Spec | Status | Função |
|------|--------|--------|
| 003 | ✅ Implementada | Helena + Júlia + memory + audit (Direct API) |
| 004 | ✅ Implementada | Bruno + Sofia + Asaas + outbound régua |
| 006 | ✅ Implementada | Rebrand Consulta ISP → Provedor.ai |
| 007 | ✅ Implementada | Sidebar 9 grupos + /time + admin tab |
| 008.5 | ✅ Implementada | MCP ERP wrapper + 5 tools + bearer auth |
| 008.6 | ✅ Implementada | Managed Agents migration (4 agents shadow-ready) |

Ações pendentes do owner (fora desse roadmap):
- Criar 10 agents na plataforma Anthropic + colar env vars + `db:push agent_invocations`
- Ativar `AGENT_RUNTIME_JULIA=shadow` em staging por 24h e validar paridade
- Aprovação HSM Meta para Bruno + Sofia em produção
- DPA Anthropic (paralelo, não-bloqueante)

---

## 4. Sprint paralelo — Prompts v2 (CoWork)

Não é spec — é trabalho de prompt engineering aplicando técnicas reais (Voss + OARS + Kahneman + Régua DNA operacional como matriz 3×3 com decisões binding por célula).

**Pipeline:**
1. CoWork reescreve os 10 prompts (Júlia, Marcos, Bruno, Sofia, Helena, Rafael, Carla, Daniel, Lucas, Pedro)
2. Code review técnico (gaps, contradições, oversights)
3. MD versionados em `server/prompts/v2/{nome}.md` (paralelo, não substitui v1)
4. Wire-up via shadow mode da Spec 008.6 — roda v1 + v2 em paralelo
5. Cutover por agente quando paridade ≥99% **E** v2 ganha em pelo menos 1 KPI mensurável (ex: NPS pós-cobrança, taxa fechamento de acordo)

**Tamanho alvo:** 4-6KB por prompt (vs ~1-2KB atual). Estrutura padronizada com input schema JSON contextual + fallbacks declarados.

---

## 5. Specs 009-016 — Próxima onda

### Spec 009 — Pix Dinâmico com Decay Temporal

**Esforço:** 2-3 semanas
**Risco execução:** Baixo
**Dependências:** Validar Asaas API

**Contexto:** Esquece Pix copia-cola estático. Cliente recebe charge com múltiplas faixas temporais:
- Próximas 2h: R$ 89,90 (10% off)
- Próximas 6h: R$ 94,90 (5% off)
- Após 6h: R$ 99,90 + multa contratual

**Hipótese (não validada):** +30-50% taxa de pagamento <24h. Baseado em estudos comportamentais Kahneman/Thaler em outras indústrias (e-commerce, fintech). **Não há benchmark conhecido para cobrança ISP brasileiro.**

**Validação juridica obrigatória antes de implementar:**
- CDC Art. 6º (direito à informação clara) — desconto progressivo é OK se transparente
- Anatel 765 — não impede precificação dinâmica de cobrança
- Não pode ser interpretado como cobrança vexatória CDC Art. 71

**Validação técnica obrigatória antes de implementar:**
- Asaas API permite charge com expiração em **horas**, não só `dueDate` em dias?
- Se sim: criar 3 charges sequenciais com diferentes valores e expirações
- Se não: simular via webhook + cancelamento programado

**Schema impact:** Nova tabela `pix_dinamic_offers` (autorizar):
```
- id, providerId, customerId, invoiceId
- tiers: JSON [{ amount, validUntil, discountPercent }]
- currentTier, finalAmountPaid
- expiresAt, paidAt
- createdAt
```

**KPIs de validação (A/B test):**
- Grupo A (50%): Pix estático tradicional
- Grupo B (50%): Pix dinâmico decay
- Métrica primária: % pago em <24h
- Métrica secundária: NPS pós-cobrança (Pedro mede)
- Duração mínima: 30 dias, 500+ clientes em cada grupo

---

### Spec 010A — Customer Health Score 360º (Fase A)

**Esforço:** 2-3 semanas
**Risco execução:** Baixo
**Dependências:** Autorização schema novo

**Contexto:** Camada analítica derivada que responde: "esse cliente está saudável?". Sem isso, Marcos não pode otimizar ROI, Rafael não pode calibrar desconto, Helena não pode escolher tom.

Fase A usa **apenas dados que já temos no DB**:
- `contracts.startedAt` → tempo de casa
- `invoices.status + paidAt + dueDate` → histórico pagamento, média atraso
- `payment_events` → frequência, regularidade
- `communications` (inbound) → tickets, sentiment
- `agreements + brokenAt` → quebras de acordo
- `audit_logs` → interações
- `customers` → metadata

**FATO:** Não temos dados de banda/RADIUS hoje (validado em §6).

**Cálculo:** healthScore (0-100) determinístico, soma ponderada de:
- Pontualidade de pagamento (peso 35%)
- Tempo de casa / fidelidade (15%)
- Quebras de acordo recentes (15%)
- Sentiment de tickets (10%)
- Frequência de interação suporte (10%)
- Score Consulta ISP (15%)

Pesos configuráveis por tenant (próxima fase, MVP usa default).

**Schema impact (autorizar):**
```
customer_health_snapshots (recalculado diariamente via cron)
├── id, customerId, providerId, snapshotDate
├── contractMonths
├── invoicesPaid, invoicesLate, invoicesOverdueCurrent
├── avgDaysLate30d, avgDaysLate90d, avgDaysLate365d
├── totalRevenueAccumulatedCents
├── brokenAgreementsCount
├── ticketCount30d
├── lastInteractionDays
├── healthScore (0-100)
├── healthTier ENUM ('gold', 'healthy', 'warning', 'critical')
├── inadimplenciaRisk30d (heurística inicial)
├── churnRisk60d (heurística inicial)
├── recommendedAction TEXT
└── computedAt
```

**UI:**
- Tab "Saúde" em `/clientes/[id]` com gráfico de evolução do healthScore (90 dias)
- Dashboard: lista priorizada "Clientes em risco esta semana" (top 20)
- Filtro por healthTier na listagem geral

**KPIs:**
- Recall: % de clientes que viraram inadimplentes que estavam em `warning` ou `critical` 30 dias antes (alvo: ≥70%)
- Precision: % de clientes em `critical` que de fato atrasaram (alvo: ≥60%)
- Comparar com baseline: classificação por A1-C3 simples (precision esperada ~40%)

---

### Spec 011 — Confissão D+1 Atalho C3

**Esforço:** 1-2 semanas
**Risco execução:** Baixo
**Dependências:** Spec 010A (precisa de healthScore + healthTier calculado)

**Contexto:** Cliente C3 (crônico, fiel) hoje passa por D+1, D+5, D+10, D+15 (suspende), D+30, D+60 → 6 meses de régua humilhante + custo operacional alto + fricção emocional.

**Pivô:** No D+1, sistema reconhece padrão `healthTier=critical + brokenAgreementsCount≥3 + score Consulta ISP <300` e atalha direto para oferta de **Confissão de Dívida com 30% off em 6x via ZapSign cartorial**. Resolve em 1 ato vs 6 meses de fricção.

**Hipótese (não validada):**
- Taxa de fechamento de confissão D+1 para perfil C3 alto: ≥40% (vs ~15% após 60 dias de régua)
- Custo operacional cobrança C3: redução de 70% vs caminho atual
- Recuperação líquida (após desconto): +25% em valor absoluto

**Implementação:**
- Reusa `confessional_debts` table (já existe na Spec 004 / R5 do RESOURCES.md)
- Reusa ZapSign integration
- Modifica Marcos (orquestrador): trigger D+1 cheka healthTier e desvia para Rafael com mensagem "confissão direto, não negociação progressiva"

**Validação juridical:** Confissão de dívida com desconto é OK (CPC Art. 784). Cliente precisa ter ciência clara de que está renunciando direito de discutir dívida — texto do termo deve ser explícito.

**KPIs:**
- Taxa fechamento confissão D+1 vs D+60 (baseline)
- Tempo médio resolução (do D+1 ao pagamento da 1ª parcela)
- NPS pós-confissão (Pedro mede)

---

### Spec 010B — Customer Health 360º (Fase B — CAC/LTV/Payback)

**Esforço:** 3-4 semanas
**Risco execução:** Médio (depende de dados que tenant precisa inserir)
**Dependências:** Spec 010A + tela de config de tenant

**Contexto:** Saúde do cliente **financeira** real — CAC, Payback, LTV, LTV/CAC ratio, Gross Margin. Métricas SaaS clássicas aplicadas ao vertical ISP.

**Dados que precisam ser inseridos pelo tenant:**

| Variável | Onde inserir | Status no tenant médio |
|---|---|---|
| Custo médio equipamento (ONU/ONT) por modelo | Cadastro de modelos | Fato (sabem) |
| Comissão por instalação | Config tenant | Fato (sabem) |
| Custo mão de obra instalação | Config tenant | Fato (sabem) |
| CAC marketing (média) | Config tenant | Calculável |
| Custo direto rede (R$ / cliente / mês) | Config tenant | Hipótese (alguns calculam, outros não) |

**Schema impact (autorizar):**
```
tenant_unit_economics (config singleton por tenant)
├── avgEquipmentCostCents
├── avgInstallationCommissionCents
├── avgInstallationLaborCents
├── avgMarketingCacCents
├── avgNetworkCostPerCustomerCents
├── grossMarginTargetPercent
└── updatedAt

customer_economics (calculado por cliente, recalc mensal)
├── customerId, providerId
├── cacTotalCents (soma das parcelas acima)
├── monthlyArpuCents
├── monthlyGrossMarginCents
├── paybackAchievedAt (data ou null)
├── ltvRealizedCents (lucro bruto acumulado até hoje)
├── ltvProjectedCents (projeção via regressão linear simples do comportamento)
├── ltvCacRatio
├── netPositionCents (cancelar agora = lucro/prejuízo)
└── computedAt
```

**UI:**
- Gráfico "Vida do Cliente": linha do tempo mostrando receita acumulada vs CAC vs Gross Margin
- Simulador de cancelamento: "Cliente quer cancelar. CAC R$ 380. Recuperado R$ 240. Net loss R$ 140. Sugestão: downgrade R$ 49,90 (recupera em 4 meses)."
- Cards no dashboard: "% base com Payback achieved", "LTV/CAC médio", "Top 20 clientes com LTV mais alto"

**Cálculo LTV projetado (heurística):**
Para cliente ativo há N meses:
- Se A2/A3 e healthScore ≥ 70: projetar +24 meses
- Se A1 ou B1/B2: projetar +18 meses
- Se B3/C1/C2: projetar +12 meses
- Se C3 + brokenAgreements ≥ 3: projetar +6 meses
- Pessimista, mas defensável. ML real evolui essa estimativa na Fase C.

**KPIs:**
- Cobertura: % tenants que preencheram config completa
- Acurácia: validar LTV projetado vs LTV realizado 12 meses depois

---

### Spec 012 — Recuperação Proativa Equipamento

**Esforço:** 3-4 semanas + dependência crítica de adapter ERP
**Risco execução:** **Alto** (depende de integração técnica que não temos)
**Dependências:** Estender `ErpConnector` interface + validar disponibilidade por ERP

**Contexto disruptivo:** ONU offline > X dias + cliente não respondeu inbound = sistema dispara contato **antes** do cancelamento. "Notamos que sua internet está fora há 12 dias. Está tudo bem? Se for mudança de plano, podemos atender."

**Hipótese (não validada):**
- 60% dos clientes "sumidos" voltam quando perguntado no momento certo (extrapolação Sales Reach Out)
- Equipamento recuperado em vida (cliente ainda ativo) custa 50% menos que recuperação persecutória (pós-cancel)
- Taxa de recuperação: 75% (vida) vs 35% (pós-cancel) — **hipótese, sem benchmark ISP validado**

**Bloqueio técnico (FATO descoberto via validação 2026-05-12):**
A `ErpConnector` interface atual em [server/erp/types.ts:141](server/erp/types.ts#L141) tem APENAS 5 métodos read-only de cliente/fatura. **NÃO TEM:**
- Status ONU em tempo real (online/offline, signal quality)
- Última atividade do cliente na rede
- Suspender/desbloquear serviço (write)

**Pré-requisito de Spec 012 (vira Spec 012.0):**
Estender `ErpConnector` com 2 novos métodos opcionais:
```typescript
interface ErpConnector {
  // ... existentes
  getOnuStatus?(config, customerId): Promise<{ online: boolean; lastSeen: Date; signalDbm?: number }>;
  getCustomerActivity?(config, customerId, sinceDays): Promise<{ bandwidthMbAvg: number; lastActivityAt: Date }>;
}
```

Validar por ERP:
- IXC: doc tem `radius_online` e `monitoramento_online_geral` — **PROVÁVEL SIM**
- MK: doc menciona "ConexõesAtivas" e "ConsumosONU" — **PROVÁVEL SIM**
- SGP, Hubsoft, Voalle, RBX: **VALIDAR** caso a caso na doc oficial

Implementação MVP: cobertura **só IXC + MK** (60% market share ISP brasileiro). Outros 4 entram conforme demanda.

**Schema impact:**
```
onu_status_snapshots (cron 30min recalcula apenas para clientes ativos)
├── customerId, providerId
├── online (bool)
├── offlineSinceMinutes (se offline)
├── signalDbm (se disponível)
├── lastBandwidthMbpsDownload
├── lastBandwidthMbpsUpload
├── lastCheckedAt
└── erpSource
```

**Trigger:** Cliente offline >5 dias + sem inbound nos últimos 30 dias + healthTier != critical → Lucas dispara contato proativo.

**KPIs:**
- Taxa de "cliente sumido" recuperado vs grupo controle (não-contatado)
- Custo de recuperação proativa vs persecutória (R$ por equipamento)

---

### Spec 013 — Detector de Saída Silenciosa

**Esforço:** 3-4 semanas
**Risco execução:** Médio
**Dependências:** Spec 010A + UTM tracking no portal cliente + idealmente Spec 012.0 (dados de banda)

**Contexto disruptivo:** Sinais combinados de cliente "psicologicamente saindo" antes do cancelamento formal:
- Queda de banda >40% nos últimos 14 dias (precisa dados de ERP — vide Spec 012.0)
- Login no portal aumentou 5x (consultando conta) — precisa instrumentar
- Procurou Pix 2ª via 2x recentemente — já temos
- Redução de tickets (já desistiu de reclamar) — já temos
- UTM referrer "outro provedor" via portal — precisa instrumentar
- Idade contrato > 12 meses + Plan downgrade recente — já temos

**Hipótese:** Cliente em "saída silenciosa" detectado tem 50-70% de chance de cancelar nos próximos 60 dias. Intervir ANTES da decisão psicológica formal = retenção 2-3x maior que pós-decisão.

**Schema impact:**
```
silent_exit_signals (recalc diário)
├── customerId, providerId
├── signals: JSON { bandwidth_drop, portal_logins, second_via_searches, ticket_decrease, utm_competitor, plan_downgrade }
├── riskScore (0-100)
├── recommendedAction TEXT
├── triggeredAgent VARCHAR (helena | marcos | rafael)
├── notifiedAt
├── outcomeOutcome ('retained' | 'cancelled' | 'no_action')
└── detectedAt
```

**KPIs:**
- True positive rate: % de detectados que de fato cancelaram nos 60d seguintes (alvo: ≥50%)
- Retention lift: % retidos pós-intervenção vs grupo controle não-detectado (alvo: +25%)

---

### Spec 014 — Geo-Monitor Competitivo

**Esforço:** 3 semanas
**Risco execução:** Médio
**Dependências:** API de busca paga + LLM extraction

**Contexto disruptivo:** Crawler diário monitora menções a novos provedores na região de cobertura do tenant:
- Google Search via Serper API (~$50/mês para 10k queries)
- Anúncios Meta na região (Meta Ad Library API — gratuita)
- Sites de provedores locais (web scraping)
- Redes sociais públicas (menções em grupos Facebook locais)

**Output:** Alerta no dashboard: "Provedor Fibra-X anunciou cobertura em Ibiporã ontem (PR-04). Você tem 47 clientes nessa região. Sugestão: campanha retenção com upgrade gratuito por 30 dias."

**Validações antes:**
- Validar custo real Serper API com volume estimado (10 cidades × diário × 365 dias)
- Validar acurácia LLM extraction ("é novo provedor?" vs falso positivo)
- Considerar Bing Web Search API como alternativa ($3/1k queries vs Serper)

**Schema impact:**
```
competitor_signals
├── providerId
├── competitorName, competitorWebsite
├── regionDetected (city, state, neighborhood)
├── customersAffected (count via geo-filter na nossa base)
├── signalSource (google_search | meta_ad | website | social)
├── signalDate, signalUrl
├── snippetText
└── reviewedByUserId, reviewedDecision
```

**UI:**
- Card no dashboard "Movimentos competitivos esta semana"
- Mapa: pins de detecção + heatmap de clientes afetados
- Lista de ações sugeridas por alerta

**KPIs:**
- Precision dos alertas (validada pelo owner: "é mesmo concorrente novo?")
- Retention lift em regiões com alerta + ação vs regiões sem ação

---

### Spec 015 — Voice Agent (Helena no telefone)

**Esforço:** 4-5 semanas
**Risco execução:** **Alto** (custo, latência, qualidade PT-BR)
**Dependências:** Validações múltiplas antes de comprometer

**Contexto:** 30-40% dos clientes ISP têm 50+ anos e não engajam bem com WhatsApp (não responde, lê tarde, não confia em link). Voice agent liga, conversa natural, resolve.

**Validações OBRIGATÓRIAS antes de iniciar (não-negociável):**

| Pergunta | Resposta esperada | Bloqueio |
|---|---|---|
| Vertical Fibra tem % real de clientes 50+? | Owner valida | Define ROI |
| Anthropic tem API Realtime voice-to-voice em PT-BR? | Doc Anthropic | Define arquitetura |
| Se não: custo real Eleven Labs TTS + STT (Whisper) + Claude streaming + Twilio Brasil em conversa de 5 min? | Teste prático 1 dia | Define viabilidade econômica |
| Custo total /min vs operador humano R$ 25/h ($0.40/min equivalente)? | Cálculo final | Define ROI |

**Hipótese (não validada — explicitamente):**
- ~R$ 0,40/min para voice agent total
- vs ~R$ 0,42/min operador humano (R$ 25/h)
- Vantagem real está em **disponibilidade 24/7** e **escalabilidade**, não em custo unitário

**Arquitetura alternativa (se Anthropic Realtime não existir):**
```
Twilio call connect
  → audio stream
  → Deepgram/Whisper STT (streaming)
  → Claude Sonnet 4.6 (tool-use loop)
  → Eleven Labs TTS PT-BR
  → audio out via Twilio
```

Latência target: <2s end-to-end (similar ao Realtime humano).

**Schema impact:**
```
voice_calls
├── providerId, customerId
├── twilioCallSid
├── direction (inbound | outbound)
├── durationSeconds, costCents
├── transcriptText
├── intentDetected, outcome
└── ...
```

---

### Spec 010C — Customer Health 360º (Fase C — ML treinado)

**Esforço:** 4-6 semanas
**Risco execução:** Médio (depende de qualidade dos dados acumulados)
**Dependências:** 010A + 010B + **6+ meses de dados rotulados de inadimplência via Spec 010A**

**Contexto:** Substitui a heurística determinística da Fase A por modelo ML treinado em features reais (incluindo banda quando Spec 012.0 estiver no ar).

**Algoritmo:**
- Gradient Boosting (XGBoost ou LightGBM) — performa bem em tabular features + interpretable via SHAP
- Random Forest como baseline
- Features: tudo de 010A + 010B + sinais de 012.0 (banda) + 013 (saída silenciosa)
- Target: cliente atrasou >5 dias na fatura do mês N+1 (binary)

**Stack:**
- Python via worker separado (não no Node) — bibliotecas ML maduras
- Cron noturno treina modelo + faz inferência em batch
- Output volta para `customer_health_snapshots.inadimplenciaRisk30d` (substitui heurística)

**KPIs:**
- AUC-ROC ≥ 0.80 (vs heurística esperada ~0.65)
- Recall ≥ 80% para classe positiva (inadimplência confirmada)
- Feature importance reportada (transparência)

---

## 6. Validações técnicas FEITAS em 2026-05-12

Todas as 4 validações técnicas executadas via sub-agentes paralelos contra documentação oficial.

### ✅ FATO: ErpConnector atual é read-only (5 métodos cliente/fatura)
- Confirmado em [server/erp/types.ts:141](server/erp/types.ts#L141)
- Spec 012.0 cria como pré-requisito de Spec 012/013

### ✅ FATO: Asaas API NÃO suporta `dueDate` em horas, mas há workaround viável
- `POST /v3/payments` (que usamos hoje): só `dueDate` em dias
- `POST /v3/pix/qrCodes/static`: aceita `expirationDate` datetime + `expirationSeconds` (mas perde vínculo com `payments`)
- **Escolhido:** workaround com `POST /v3/payments` + worker temporal (create → cancel → create) — mantém vínculo invoices
- Rate limit: 25k req/12h global, 50 GETs concorrentes — folgado para nossa escala
- Risco: QR Code copiado antes do cancel pode ainda ser pago no valor antigo. Mitigação: tolerar e registrar como aceito
- **Spec 009 documenta arquitetura completa**

### ✅ FATO: IXC adapter pode ser estendido (FULL capability)
- `radusuarios.online` (S/N), `ultima_conexao_final`, `download_atual`, `upload_atual` confirmados na wiki
- Sinal óptico Rx/Tx: tabela inferida (`cliente_fibra_onu` ou variações) — discovery em runtime via padrão já estabelecido no connector
- Auth idêntica à atual (zero refactor)
- **Spec 012.0 documenta implementação completa**

### ✅ FATO: MK adapter LIMITADO (degraded capability)
- Sem endpoint REST oficial para RADIUS/ONU/banda
- Proxy degradado via `WSMKConexoesPorCliente.Bloqueada` (binário)
- Banda real e accounting RADIUS vivem em tabela `radacct` do Postgres MK-Auth — fora do contrato `ErpConnector`
- Tenants MK terão Spec 012 com força reduzida
- **Spec 012.0 documenta limitação explícita**

### ✅ FATO: Anthropic Realtime voice API NÃO existe
- Claude Voice é "emerging", sem SDK estável, sem API pública
- Recomendação Anthropic oficial: parceria Hume AI (Empathic Voice Interface)
- Padrão indústria: stitching Twilio ConversationRelay + Deepgram STT + Claude API + ElevenLabs TTS
- Custo estimado: ~R$ 2.100/mês para Vertical Fibra (60 chamadas/dia × 5min)
- ROI defensável: 17% do custo humano efetivo
- **Spec 015 documenta arquitetura stitching completa**

---

## 7. Validações que dependem do owner (Vertical Fibra)

| # | Pergunta | Desbloqueio |
|---|---|---|
| 1 | Quantos clientes ativos hoje? | Dimensionamento cron snapshots Spec 010A |
| 2 | Quantos meses de dados de pagamento históricos no Postgres? | Define se Spec 010C ML é viável Q3 ou Q4 |
| 3 | Custo médio ONU+roteador entregue por novo cliente? | Cobertura econômica Spec 010B |
| 4 | CAC marketing aproximado (mídia / clientes adquiridos)? | Painel ter dado real Spec 010B |
| 5 | Gross margin mensal típica (ARPU - custo direto)? | Validar viabilidade LTV/CAC > 3 |
| 6 | % aproximado de clientes com 50+ anos? | Define ROI Spec 015 (voice agent) |
| 7 | Provedores locais conhecidos em Londrina/Ibiporã pra testar geo-monitor? | Validação Spec 014 |

---

## 8. Vector Store — decisão arquitetural

**Default:** `pgvector` (extensão Postgres). Razões:
- Zero infra nova (Postgres existente em sa-east-1)
- LGPD nativo (dados no Brasil)
- $0 extra custo
- Performance suficiente até ~10M vetores (estimativa: 18-24 meses de operação)

**Quando reabrir:** Spec 016+ (Helena RAG institucional ou Lia knowledge base). Aí benchmark real:
- pgvector vs Pinecone (serverless, us-east) vs Milvus (self-hosted) vs Zilliz Cloud (managed Milvus)
- Critérios: latência real, custo mensal projetado, complexidade ops

**Abstração:** `server/services/vector/types.ts` com interface `VectorStore` e implementações intercambiáveis. Switch via env var. Construída quando primeira spec consumir vetores (Spec 016+).

---

## 9. Parking Lot — itens descartados com razão

| Item | Razão |
|---|---|
| Degradação seletiva de tráfego (Smart Lock por tipo de serviço) | Risco jurídico Anatel 765 — pode ser interpretado como suspensão parcial sem prazo legal de 15 dias. Requer parecer jurídico antes |
| Negativação automatizada com aviso de 24h | CDC Art. 43 §2 exige 10 dias mínimos. Pressão de 24h pode caracterizar coerção |
| Vector DB Pinecone como infra atual | Over-engineering para nossa fase. Sem sa-east-1, complica LGPD |
| API tempo real Serasa | Caro + contrato comercial. Consulta ISP colaborativo é substituto suficiente |
| Microcrédito integrado | Não é código — é parceria comercial com fintech. Trilho paralelo, não-bloqueante |
| Bartering criativo (indicações + bônus) | Funcionalidade dentro do Rafael/Pedro, não spec separada |
| Pricing dinâmico individual | Dentro de R13 do RESOURCES.md — funcionalidade do Rafael, não spec própria |
| Detecção de fraude de uso (compartilhamento ilegal CGNAT) | Depende muito de NMS específico do ISP, fora do core agora |
| Mediação Procon proativa | Operacional + jurídico, não tecnológico |

---

## 10. Cronograma estimado (sequencial + alguns paralelos)

Premissa: solo dev + Claude Code. Com +1 dev, comprime ~30%.

```
Mês 1  │ Spec 009 (Pix dinâmico)            │ ████████░░░░ 2-3 sem
       │ Spec 010A (Health 360 Fase A)      │ ████████░░░░ 2-3 sem (paralelo)
       │
Mês 2  │ Spec 011 (Confissão D+1 atalho C3) │ ████░░░░░░░░ 1-2 sem
       │ Spec 010B (Health 360 Fase B)      │ ████████████ 3-4 sem
       │
Mês 3  │ Spec 012.0 (Estender ErpConnector) │ ████████░░░░ 2-3 sem
       │ Spec 012 (Recuperação proativa)    │ ████████████ 3-4 sem (depois 012.0)
       │
Mês 4  │ Spec 013 (Detector saída)          │ ████████████ 3-4 sem
       │
Mês 5  │ Spec 014 (Geo-monitor)             │ ████████████ 3 sem
       │ Validações Spec 015 (Voice)        │ ░░░░░░░░░░░░ paralelo
       │
Mês 6  │ Spec 015 (Voice agent) — se ROI OK │ ████████████████ 4-5 sem
       │
Mês 7-8│ Spec 010C (Health ML) — quando dados maturarem │ ████████████ 4-6 sem
```

**Total: 6-8 meses (Q3/2026 → Q1/2027).**

Marcos comerciais:
- **Mês 1 fim:** Pix dinâmico + Health 360 Fase A em produção (Vertical Fibra)
- **Mês 3 fim:** Régua C3 30% mais barata (via Spec 011) + Recuperação proativa equipamento ligada
- **Mês 5 fim:** Provedor Index pode mostrar números reais (Inadimplência ↓, Equipamentos ↑, Retenção ↑)
- **Mês 8 fim:** Sistema operando em modo otimização contínua, próximas decisões guiadas por dado real

---

## 11. Próximos passos imediatos

**Para o owner (você):**
1. Responder pelo menos 4 das 7 validações da §7 (números Vertical Fibra)
2. Confirmar essa direção do roadmap, ou propor ajustes

**Para mim (executar essa semana, em paralelo):**
1. ✅ Já validado: ErpConnector é read-only — Spec 012.0 obrigatória antes de 012
2. ⏳ Buscar doc Asaas API para confirmar suporte a `dueDate` horário
3. ⏳ Buscar doc IXC + MK para mapear endpoints de status ONU
4. ⏳ Buscar doc Anthropic para confirmar Realtime API existência
5. Aguardar Prompts v2 do CoWork para iniciar code review

**Para a primeira semana de execução (após confirmação):**
- Iniciar Spec 009 (Pix dinâmico) + Spec 010A (Health Fase A) em paralelo
- Cada uma é independente, não compartilham schema, podem rodar simultaneamente

---

## 12. Mudanças vs roadmap anterior (`cuddly-churning-dijkstra.md`)

| Antes | Agora | Razão |
|---|---|---|
| Spec 009: Rafael Managed Agent | Spec 009: Pix dinâmico decay | Rafael ganha melhoria via Prompts v2 sem spec separada |
| Spec 010: Carla + Religamento Anatel | Spec 010A: Customer Health 360 | Carla = funcionalidade existente, não spec nova |
| Spec 011: Marcos + Provedor Index | Spec 011: Confissão D+1 C3 | Marcos ganha via Prompts v2; Provedor Index sai (parking lot) |
| Specs 012-014: Daniel + Lucas + Pedro | Specs 012-015: Recup proativa + Detector + Geo + Voice | Daniel/Lucas/Pedro = funcionalidades; specs novas são diferenciais |

---

*ROADMAP V2 — fim. Última atualização 2026-05-12. Para mudanças, abrir PR com justificativa técnica/comercial.*
