# Spec 009 — Pix Dinâmico com Decay Temporal

**Status:** Proposta — validação técnica Asaas FEITA (viável via workaround)
**Esforço:** 2-3 semanas (10-15 dias úteis)
**Risco execução:** Baixo (técnico) / Médio (validação jurídica)
**Dependências:** Asaas integrado (já temos via Spec 004) + validação jurídica pré-rollout

---

## 1. Contexto

**Disrupção comportamental:** Esqueça Pix copia-cola estático que cliente paga "quando der". Substitui por oferta em camadas temporais com decay agressivo:

```
Nas próximas 2h: R$ 89,90 (10% off)
Próximas 6h: R$ 94,90 (5% off)
Após 6h: R$ 99,90 + multa contratual
```

**Por que funciona (teoria comportamental):**
- **Anchoring (Tversky-Kahneman):** primeiro valor (R$ 89,90) ancora percepção de "preço justo"
- **Loss aversion:** perder 5 reais agora é maior que ganhar 5 depois
- **Tempo escasso:** janela curta + valor decay = decisão imediata, não procrastinação
- **Default option subversion:** invés de "pagar quando der", "pagar agora ou perder desconto"

**Hipótese de retorno (NÃO validada para cobrança ISP brasileiro):**
- +30-50% taxa de pagamento <24h
- Extrapolação de estudos comportamentais em retail, fintech, e-commerce
- **Sem benchmark conhecido** específico de cobrança ISP

---

## 2. Validação técnica Asaas (FEITA 2026-05-12)

### Veredito: VIÁVEL via workaround

**FATO confirmado da doc oficial:**

1. **`POST /v3/payments`** (que usamos hoje em [server/services/asaas-multi-tenant.ts:83](server/services/asaas-multi-tenant.ts#L83)) — único campo de prazo é `dueDate` em formato `YYYY-MM-DD`. **Sem expiração horária nativa.**
2. **`POST /v3/pix/qrCodes/static`** — aceita `expirationDate` datetime (`YYYY-MM-DD HH:mm:ss`) OU `expirationSeconds` numérico. **Suporta expiração horária nativa.**
3. **`DELETE /v3/payments/{id}`** — cancela payment. Síncrono na resposta, mas QR Code já copiado pelo cliente pode ainda ser pago se PSP do pagador não revalidar.
4. **Rate limits:**
   - Global: 25.000 req / 12h rolling por conta (HTTP 429)
   - 50 GETs concorrentes
   - Headers `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` expostos
   - Para nossa escala (1k clientes × 3 tiers × create+cancel ≈ 6k req/dia): folgado

### Arquitetura escolhida

**Workaround "tier por tier" via `POST /v3/payments`** (mantém vínculo com `invoices` + webhooks Spec 004):

- Worker temporal cria charge tier-1 com `dueDate=hoje` + `externalReference` codificando `tier:1`
- T+2h: worker dispara `cancelCharge(id)` (idempotente) + cria charge tier-2 com novo valor + `tier:2`
- Webhook `PAYMENT_RECEIVED` (já parseado em [server/services/asaas-multi-tenant.ts](server/services/asaas-multi-tenant.ts)) invalida todos os tiers pendentes da mesma invoice
- Crítico: cancelamento **não garante** que QR-Code copiado anteriormente não pague. Mitigar com:
  - Exibir aviso "oferta válida até HH:MM" no canal de entrega
  - Tolerar pagamento tardio no valor antigo (registrar como aceito — não devolver)
  - Race-condition handling no webhook

**Alternativa rejeitada:** `POST /v3/pix/qrCodes/static` com `expirationSeconds=7200`. Vantagem: expira nativamente no PSP. Desvantagem: perde vínculo automático com `payments` e `pixQrCodeId` precisa ser correlacionado manualmente — quebraria nosso `pix_charges/external_reference`. Não recomendado.

---

## 3. Validação jurídica (PRÉ-ROLLOUT obrigatória)

Antes de A/B test em produção, **validar com advogado especializado consumidor/Anatel**:

| Norma | Risco | Argumento defensivo |
|---|---|---|
| **CDC Art. 6º** (direito à informação clara) | Desconto progressivo poder soar "manipulativo" | Transparência total: aviso explícito de valores em cada faixa antes do cliente decidir |
| **CDC Art. 39** (práticas abusivas) | Prazo apertado pode ser "abusivo" | Faixa final ainda é o valor contratual padrão (não há cobrança acima) |
| **CDC Art. 71** (constrangimento) | Pressão temporal = constrangimento? | Tom respeitoso, sem ameaça, oferta de desconto = benefício ao consumidor |
| **Anatel 765/2023** | Não impede precificação dinâmica de cobrança | OK |
| **Lei 14.181/2021** (superendividamento) | Cliente vulnerável pode aceitar sob coerção | Júlia bloqueia para `flags.vulnerable=true` |

**Decisão de produto:** Spec 009 só implementada após parecer jurídico positivo. Sem isso, fica em parking lot.

---

## 4. User stories

**US-1 — Cliente A2/B1/B2 em D+1 recebe oferta dinâmica**
Cliente recebe WhatsApp via Helena/Rafael com 3 tiers visíveis ("Pague nas próximas 2h por R$ 89,90 e ganhe 10% off..."). Clica no link, ve QR code do tier atual, paga.

**US-2 — Worker gerencia transição de tier automaticamente**
A cada 2h, worker checa offers ativas, expira tier atual, gera novo charge no próximo valor, atualiza link.

**US-3 — Cliente recebe lembrete de transição**
1h antes de mudar tier: WhatsApp "⏰ Em 1h o desconto cai para 5%. Pague agora pelo Pix: [link]"

**US-4 — Owner vê A/B test no dashboard**
Painel mostra taxa de pagamento <24h: grupo controle (Pix estático) vs grupo experimento (Pix dinâmico). Estatística mensal.

---

## 5. Escopo

### Dentro
- Tabela `pix_dynamic_offers` (autorizar)
- Worker temporal de transição (BullMQ ou similar)
- Endpoints API para criar/consultar/cancelar oferta
- Componente WhatsApp template "pix dinâmico"
- A/B test infra (feature flag por tenant + divisão automática 50/50)
- Dashboard com métricas de A/B test

### Fora
- Aplicação a clientes vulneráveis (Júlia bloqueia)
- Aplicação ao perfil C3 alto-risco (vai pra Spec 011 confissão direta)
- Aplicação fora da janela horária (Júlia bloqueia)
- Webhook custom da Asaas para tier transitions (não tem, usamos cron interno)

---

## 6. Schema impact (AUTORIZAR)

### Tabela nova: `pix_dynamic_offers`

```typescript
export const pixDynamicOffers = pgTable("pix_dynamic_offers", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id),

  // Tiers — array JSON
  tiers: jsonb("tiers").notNull(),
  // Schema: [{
  //   index: number,
  //   amountCents: number,
  //   discountPercent: number,
  //   validUntil: ISO string,
  //   asaasPaymentId: string | null,
  //   qrCodeBase64: string | null,
  //   copyPaste: string | null,
  //   status: 'pending' | 'active' | 'expired' | 'cancelled' | 'paid'
  // }]

  currentTierIndex: integer("current_tier_index").notNull().default(0),
  status: text("status").notNull(),  // 'active' | 'paid' | 'expired' | 'cancelled'
  finalAmountPaidCents: integer("final_amount_paid_cents"),
  finalTierIndexPaid: integer("final_tier_index_paid"),

  // A/B test
  experimentGroup: text("experiment_group"),  // 'control' | 'treatment'

  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),  // após último tier
  paidAt: timestamp("paid_at"),
}, (t) => ({
  providerStatusIdx: index("pdo_provider_status_idx").on(t.providerId, t.status),
  invoiceIdx: index("pdo_invoice_idx").on(t.invoiceId),
  experimentIdx: index("pdo_experiment_idx").on(t.experimentGroup, t.status),
}));
```

### Modificações em `pix_charges` (já existe Spec 004)

Adicionar coluna opcional:
- `pixDynamicOfferId: integer references pix_dynamic_offers.id` — vincula charge a sua offer parent

---

## 7. Worker temporal de transição

**Stack:** BullMQ + Redis (validar se já temos infra; se não, alternativa node-cron simples)

**Jobs:**
1. **Create offer** — gera os 3 charges Asaas em sequência, mas só o primeiro fica "ativo"; outros 2 ficam "pending"
2. **Transition tier** — agendado para `validUntil` do tier atual:
   - Cancela charge atual via DELETE
   - Ativa próximo tier criando novo charge com valor maior
   - Atualiza `currentTierIndex`
   - Dispara mensagem WhatsApp via Helena: "Desconto reduzido. Novo Pix: [link]"
3. **Pre-transition warning** — agendado para `validUntil - 1h`:
   - Envia WhatsApp: "⏰ Em 1h o desconto reduz. Pague agora: [link]"
4. **Expire final tier** — quando último tier vence:
   - Marca offer como `expired`
   - Cliente cai no fluxo padrão de cobrança (Rafael/Bruno régua tradicional)

**Idempotência crítica:** worker pode rodar 2x. Verificar `currentTierIndex` antes de transicionar.

**Race condition:** webhook `PAYMENT_RECEIVED` chega entre check e cancel. Mitigação:
- Antes de cancelar tier atual, refetch status da offer
- Se status='paid', abortar transition
- Lock pessimista via Redis durante transition

---

## 8. UI

### Página de pagamento (público, sem login)

Link único enviado ao cliente: `provedor.ai/pix/[token]`

- Card hero: valor atual em destaque + countdown visual ("Oferta válida por: 1h 42min")
- QR code + copia-cola do tier atual
- Texto explícito: "Próximas faixas: R$ 94,90 (5% off) das 14h às 20h. Após: R$ 99,90 + multa."
- Botão "Pagar via app do banco" (deep link)

### Dashboard A/B test

- Card "Pix Dinâmico — A/B test"
- Métricas: taxa pagamento <24h (controle vs experimento), valor médio recebido, NPS pós-cobrança (Pedro mede)
- Filtros por perfil (A1-C3), valor da fatura, período
- Significância estatística automática (chi-square test)

---

## 9. A/B test setup

**Feature flag por tenant:** `PIX_DYNAMIC_ENABLED=true|false` (default false)

**Divisão automática:** quando tenant ativa:
- 50% das faturas D+1 elegíveis → grupo controle (Pix estático tradicional via Spec 004)
- 50% → grupo experimento (Pix dinâmico)
- Hash determinístico via `customerId` para garantir cliente sempre cai no mesmo grupo

**Critério de elegibilidade (gate antes de cada offer):**
```typescript
isEligibleForPixDynamic(customer, invoice): boolean {
  return (
    !customer.flags?.vulnerable &&
    !customer.flags?.essentialService &&
    !hasActiveProconCase(customer) &&
    customer.healthTier !== 'critical' &&  // C3 vai pra Spec 011
    invoice.amount >= 50 &&  // Pix dinâmico só faz sentido em valor mínimo
    isWithinBusinessHours()
  );
}
```

**Duração mínima do teste:** 30 dias, ≥500 clientes em cada braço

**Métricas:**
- Primária: taxa de pagamento <24h
- Secundárias: valor médio recebido, NPS pós-cobrança, taxa de reclamação Procon
- Análise: chi-square + Bayesian estimation

---

## 10. KPIs após 30 dias produção

**Validar hipóteses não-validadas:**
- Lift real em pagamento <24h: alvo +30% (mínimo aceitável +15%)
- Impacto em NPS pós-cobrança: alvo neutro ou positivo (não pode ser -10 ou pior)
- Reclamações Procon por "cobrança coercitiva": alvo 0
- Taxa de erro técnico (tier não transitou, cancel falhou): alvo <1%

**Se KPIs primários atingidos:**
- Lift ≥15%: rolar pra todos tenants com flag
- Lift ≥30%: tornar default e desabilitar Pix estático para perfis elegíveis

**Se KPIs não atingidos:**
- Voltar para parking lot, análise post-mortem com Pedro
- Considerar variações: 2 tiers em vez de 3? Tempos diferentes? Descontos maiores/menores?

---

## 11. Plano de execução — 4 batches

### Batch 1 — Schema + worker base (3-4 dias)
- [ ] `shared/schema.ts`: adicionar `pixDynamicOffers` (autorizar)
- [ ] Coluna nova em `pixCharges.pixDynamicOfferId`
- [ ] `server/services/pix-dynamic/offer-builder.ts` — cria offer com 3 tiers via Asaas
- [ ] Tests unit cobrindo casos: customer elegível, não elegível, valor mínimo

### Batch 2 — Worker de transição (3-4 dias)
- [ ] Setup BullMQ (validar se já temos Redis em produção)
- [ ] Jobs: create-offer, pre-transition-warning, transition-tier, expire-final
- [ ] Lock pessimista via Redis para race condition
- [ ] Webhook handler `PAYMENT_RECEIVED` cancela offer pendente
- [ ] Tests integração: simular pagamento entre tiers

### Batch 3 — UI público + integração WhatsApp (3-4 dias)
- [ ] Página `provedor.ai/pix/[token]` (renderiza tier atual)
- [ ] Componente countdown + QR atualizando
- [ ] Templates WhatsApp para 3 cenários: initial offer, pre-warning, tier-transition
- [ ] Júlia validation gate em cada envio

### Batch 4 — A/B test infra + dashboard (2-3 dias)
- [ ] Feature flag `PIX_DYNAMIC_ENABLED` por tenant
- [ ] Lógica de assignment 50/50 baseada em hash determinístico
- [ ] Dashboard com métricas comparativas
- [ ] Chi-square test automatizado para significância

---

## 12. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Cliente paga tier 1 mas charge já foi cancelado | Média | Médio | Race-condition handling + tolerar pagamento tardio (registrar aceito) |
| Worker falha durante transition, offer fica órfã | Baixa | Médio | Job retry + monitoring + reconciliation cron |
| Asaas rate limit excedido em rollout massivo | Baixa | Alto | Bottleneck por providerId + cockatiel circuit breaker |
| Procon questiona "pressão temporal coercitiva" | Média | Alto | Parecer jurídico ANTES de rollout + tom respeitoso na mensagem + Júlia gate |
| Cliente vulnerável recebe oferta | Baixa | Alto | Gate explícito em `isEligibleForPixDynamic` + Júlia revalida |
| Cliente fica confuso com múltiplos QR codes | Média | Médio | UI clara mostrando que QR muda + countdown visual |

---

## 13. Out of scope

- Aplicação a perfil C3 alto-risco (vai pra Spec 011)
- Faturas <R$50 (não vale o overhead)
- Cobrança fora horário comercial (Júlia bloqueia)
- Tier customizável por tenant (MVP usa 3 tiers fixos: 0h, 2h, 6h com 10%, 5%, 0% off)
- Pagamento parcelado dinâmico (Spec separada)

---

## 14. Próximos passos

1. **Validação jurídica** com advogado consumerista — sem isso, não inicia (bloqueante)
2. **Autorizar schema** `pix_dynamic_offers`
3. **Confirmar infra Redis/BullMQ** ou alternativa
4. **Iniciar Batch 1** — schema + offer builder

Tempo estimado: 2-3 semanas após validação jurídica positiva.
