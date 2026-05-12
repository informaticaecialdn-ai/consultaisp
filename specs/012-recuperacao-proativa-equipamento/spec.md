# Spec 012 — Recuperação Proativa de Equipamento

**Status:** Proposta — depende de Spec 012.0 (estender ErpConnector) operacional
**Esforço:** 3-4 semanas (15-20 dias úteis)
**Risco execução:** Médio (depende qualidade dados técnicos via Spec 012.0)
**Dependências:** Spec 012.0 (`getOnuStatus` + `getCustomerActivity`) + Lucas funcional (já existe via Spec 004)

---

## 1. Contexto

Hoje, recuperação de equipamento (ONU/ONT, roteador) acontece APÓS cancelamento formal:
- Cliente cancela → Carla/Lucas dispara contato → cliente já mentalmente "saiu" → resistência alta
- Taxa de recuperação em vida (cliente ainda ativo): observada em mercado ~25-40%
- Custo logístico (motoboy, Correios reverso) cresce conforme tentativas

**Pivô disruptivo:** Sistema detecta clientes "sumindo" via sinais técnicos ANTES do cancelamento formal:
- ONU offline > 5 dias consecutivos
- Sem comunicação inbound recente (>30 dias)
- Consumo de banda caiu >80% nos últimos 14 dias

Quando padrão detectado E cliente não em estado crítico (`healthTier != 'critical'`), Lucas dispara contato proativo:

> "Olá [nome]. Notei que sua internet está fora há 8 dias. Tudo bem? Se for mudança ou se quiser cancelar, podemos te ajudar nos próximos passos."

**Hipótese (NÃO validada para ISP brasileiro):**
- 60% dos clientes "sumidos" respondem positivamente quando perguntado no momento certo (extrapolação Sales Reach-Out)
- Taxa de recuperação em vida: 75% (vs 35% pós-cancelamento) — **estimativa, sem benchmark validado**
- Custo logístico: 50% menor (cliente ativo → coleta agendada cordata)

---

## 2. Validações técnicas dependentes

**Pré-requisito hard:** Spec 012.0 implementada com IXC + MK (60% market share).

| Sinal | IXC | MK | Demais |
|---|---|---|---|
| ONU offline >5d | ✅ (radusuarios.online + lastSeen) | ⚠️ Degraded (só Bloqueada) | ❌ |
| Banda caiu >80% | ✅ (download_atual + upload_atual) | ❌ (unavailable) | ❌ |
| Sinal óptico ruim (<-28dBm) | ⚠️ Best-effort (cliente_fibra_onu) | ❌ | ❌ |

**Implicação:** MVP de Spec 012 funciona pleno para tenants IXC, degraded para MK (só pode detectar via flag de bloqueio financeiro, não via dados de rede). Demais ERPs ficam fora até implementação adicional.

---

## 3. User stories

**US-1 — Cliente sumiu mas ainda ativo recebe contato proativo**
Cliente IXC com ONU offline há 8 dias, sem comunicação recente. Lucas dispara WhatsApp via Júlia gate: pergunta-aberta sem cobrança. Cliente responde "ah, mudei pro plano X do concorrente" → Helena assume retenção. Ou responde "minha internet caiu, ninguém respondeu" → Lucas escala suporte técnico humano urgente.

**US-2 — Cliente confirma cancelamento pré-formal**
Cliente confirma intenção de cancelar. Lucas oferece 3 caminhos imediatos:
- Devolução gratuita do equipamento (agenda coleta)
- Compra do equipamento por 70% do valor declarado (Pix)
- Aguardar cancelamento formal + cobrança pós-cancel padrão

**US-3 — Owner vê painel "Clientes sumindo"**
Dashboard mostra lista de clientes com sinais técnicos de "sumindo" em ordem de severidade. Owner pode revisar antes de Lucas atuar (modo manual review por 14 dias antes de full auto).

---

## 4. Schema impact (AUTORIZAR)

### Tabela nova: `silent_disconnect_signals`

```typescript
export const silentDisconnectSignals = pgTable("silent_disconnect_signals", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),

  // Sinais técnicos (snapshot no momento da detecção)
  onuOfflineSinceDays: integer("onu_offline_since_days"),
  bandwidthDropPercent: integer("bandwidth_drop_percent"),  // 0-100
  signalRxDbm: decimal("signal_rx_dbm", { precision: 5, scale: 2 }),
  lastInboundDays: integer("last_inbound_days"),

  // Score
  disconnectRiskScore: integer("disconnect_risk_score"),  // 0-100

  // Ação tomada
  actionTaken: text("action_taken"),  // 'proactive_contact' | 'awaiting_review' | 'no_action'
  outboundCommunicationId: integer("outbound_communication_id"),

  // Outcome (validação após 30 dias)
  customerResponded: boolean("customer_responded"),
  customerOutcome: text("customer_outcome"),  // 'cancelled_voluntary' | 'retained' | 'tech_issue_resolved' | 'no_response'
  outcomeMeasuredAt: timestamp("outcome_measured_at"),
}, (t) => ({
  providerDetectedIdx: index("sds_provider_detected_idx").on(t.providerId, t.detectedAt),
  customerIdx: index("sds_customer_idx").on(t.customerId),
}));
```

---

## 5. Lógica de detecção (cron diário 06:00 BRT)

```typescript
async function detectSilentDisconnects(providerId: number) {
  const activeCustomers = await getActiveCustomers(providerId);
  const connector = await getConnector(providerId);

  if (connector.capabilities.onuStatus === 'unavailable') {
    return; // tenant não suporta detecção técnica
  }

  for (const customer of activeCustomers) {
    const onuStatus = await connector.getOnuStatus(config, customer.erpId);
    if (!onuStatus.lastSeen) continue;

    const offlineDays = daysSince(onuStatus.lastSeen);
    if (offlineDays < 5) continue;  // não detecta ainda

    const activity = await connector.getCustomerActivity(config, customer.erpId, 30);
    const lastInbound = await getLastInbound(customer.id);
    const lastInboundDays = lastInbound ? daysSince(lastInbound) : 999;

    const score = calcDisconnectRiskScore({
      offlineDays,
      bandwidthDropPercent: calcBandwidthDrop(activity, baseline),
      lastInboundDays,
      signalRx: onuStatus.signalRxDbm,
    });

    if (score >= 70 && !await isCriticalTier(customer.id)) {
      await createSignal({ customerId, score, ... });
      await dispatchLucas({ customerId, mode: 'proactive_contact' });
    } else if (score >= 50) {
      await createSignal({ customerId, score, actionTaken: 'awaiting_review' });
    }
  }
}
```

**Score determinístico:**
```
score = 0
+ 40 se offlineDays >= 10
+ 25 se offlineDays >= 5 (cumulativo com anterior se 10+)
+ 20 se bandwidthDropPercent >= 80
+ 10 se bandwidthDropPercent >= 50
+ 15 se lastInboundDays >= 60
+ 10 se signalRxDbm < -28 (sinal ruim, pode ser causa técnica)
clamp 0-100
```

**Exclusões automáticas:**
- Cliente em estado `critical` (Spec 010A) → vai pro fluxo C3 (Spec 011)
- Cliente em incidente técnico massivo no POP (Spec 010A geo-cluster signal) → pausa detecção, pode ser problema do provedor
- Cliente vulnerável (Júlia flag) → escala humano direto, sem auto-contato

---

## 6. Mensagem inicial (Lucas, validada por Júlia)

**Tom: cordial, perguntinha aberta, sem cobrança.**

```
"Olá [primeiro nome]. Notei que sua internet está fora desde [data].

Tudo bem? Pode ser problema técnico, mudança de plano ou outra coisa.

Pode me contar pra eu te ajudar a resolver?

1️⃣ Tive problema técnico, ninguém me ajudou
2️⃣ Mudei pra outro provedor
3️⃣ Vou cancelar mesmo
4️⃣ Outro motivo

Responde 1, 2, 3 ou 4 — sem compromisso."
```

**Fluxo de resposta:**

| Cliente responde | Lucas ação |
|---|---|
| 1 (tech) | Escala suporte técnico humano urgente |
| 2 (concorrente) | Helena assume retenção (oferta de desconto/plano) |
| 3 (cancel) | Oferece 3 caminhos de equipamento (devolver/comprar/aguardar formal) |
| 4 (outro) | Resposta livre → classificar via Claude, escalar humano |
| Sem resposta 5 dias | Volta ao fluxo normal de pré-cancelamento |

---

## 7. Plano de execução — 4 batches

### Batch 1 — Schema + detector cron (4-5 dias)
- [ ] Schema `silent_disconnect_signals` (autorizar)
- [ ] Worker `server/workers/silent-disconnect-detector.ts`
- [ ] Função pura `calcDisconnectRiskScore`
- [ ] Tests unit cobrindo 9 perfis + edge cases (incidente massivo, vulnerável)

### Batch 2 — Lucas integração + Júlia gate (3-4 dias)
- [ ] Modificar prompt Lucas v2 com modo proativo
- [ ] Templates WhatsApp para 4 cenários de resposta
- [ ] Júlia gate: bloquear envio para vulnerável, fora horário, frequência
- [ ] Tests integração: detector → Lucas → resposta cliente → ação

### Batch 3 — UI manual review + dashboard (3-4 dias)
- [ ] Painel "Clientes sumindo" no dashboard (lista priorizada por riskScore)
- [ ] Modo manual review: feature flag `SILENT_DISCONNECT_AUTO=false` → owner aprova cada caso por 14 dias
- [ ] Card métricas: detectados, contactados, respondidos, outcomes

### Batch 4 — Outcome tracking + A/B test (3-4 dias)
- [ ] Cron 30 dias após detecção: classifica `customerOutcome`
- [ ] A/B test infra: 50% detectados → contato proativo; 50% → grupo controle (sem ação)
- [ ] Dashboard comparativo: retenção com vs sem ação

---

## 8. KPIs após 30 dias produção (Vertical Fibra)

**Métrica primária — retenção pós-detecção:**
- % de detectados que se mantiveram ativos 60 dias depois (treatment vs control)
- Alvo: +25 pontos percentuais vs grupo controle (ex: 65% vs 40%)

**Métrica secundária — taxa de resposta:**
- % dos contatados que responderam (qualquer opção 1-4)
- Alvo: ≥40% (vs ~10-15% mercado para mensagens cobrança comum)

**Métrica de recuperação equipamento:**
- Quando outcome=`cancelled_voluntary` via Lucas: % devolução voluntária do equipamento
- Alvo: ≥75% (vs benchmark 25-40% pós-cancelamento)

**Métrica operacional:**
- Falso positivo: % de detectados que estavam OK (resposta "1" → resolveu) vs total
- Aceitável: <30%

---

## 9. Out of scope (MVP)

- Tenants MK no modo full (só degraded via Bloqueada flag — pode detectar mas com baixa confiança)
- Tenants SGP/Hubsoft/Voalle/RBX — sem dados técnicos
- Detecção via NMS externo (Zabbix, etc.) — adapter próprio fora do `ErpConnector`
- Análise preditiva ML do timing ideal de contato — heurística suficiente no MVP
- Contato via SMS/email — só WhatsApp no MVP (canal mais responsivo)

---

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Detecta cliente cuja ONU caiu por problema técnico do provedor | Cross-check com geo-cluster signal: se >5 clientes no mesmo POP offline simultâneo, pausa detecção, alerta NOC |
| Cliente irritado responde "deixa eu em paz" | Marca `customer.flags.opted_out_proactive=true`, não repete no futuro |
| Procon questiona "contato sem solicitação" | Tom da mensagem é claramente serviço pós-venda, não cobrança. Júlia revalida cada envio |
| Spec 012.0 ainda não em produção | Bloqueio absoluto: Spec 012 não inicia sem 012.0 com IXC operacional |

---

## 11. Próximos passos

1. Garantir Spec 012.0 em produção com IXC funcionando
2. Autorizar schema `silent_disconnect_signals`
3. Iniciar Batch 1
4. Modo manual review primeiros 14 dias antes de full automation

Tempo estimado: 3-4 semanas após Spec 012.0 em produção.
