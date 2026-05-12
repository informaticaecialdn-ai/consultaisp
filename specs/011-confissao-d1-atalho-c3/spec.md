# Spec 011 — Confissão D+1 Atalho Perfil C3

**Status:** Proposta — depende de Spec 010A operacional
**Esforço:** 1-2 semanas (5-10 dias úteis)
**Risco execução:** Baixo
**Dependências:** Spec 010A (`healthTier='critical'` + `brokenAgreementsCount`) + Spec 004 (Confissão de Dívida via ZapSign já implementada)

---

## 1. Contexto

Hoje, cliente perfil C3 (crônico crônico — atrasos frequentes, fiel ao provedor) passa pelo fluxo padrão:

```
D+1: Bruno lembrete
D+5: Bruno lembrete
D+10: Rafael negociação inicial
D+15: Carla suspensão parcial (Anatel)
D+30: Carla suspensão total
D+60: Carla rescisão → Daniel recuperação financeira → Lucas equipamento
```

**Custo operacional:** ~6 meses de régua + suspensão + notificações + Júlia compliance gates. Fricção emocional alta. Provedor gasta tempo de operador. NPS pós-cobrança despenca.

**Pivô:** No D+1, sistema identifica cliente que **claramente** vai precisar de confissão de dívida ao final do ciclo (`healthTier='critical' + brokenAgreementsCount ≥ 3 + score Consulta ISP < 300`). Atalha direto para oferta de confissão com desconto agressivo. Resolve em 1 ato vs 6 meses de fricção.

---

## 2. Hipótese de retorno (NÃO validada — explicitamente)

- **Taxa de fechamento confissão D+1 para C3 alto:** ≥40%
  - Baseline atual (confissão após 60+ dias de régua, R5 do RESOURCES.md): ~15-25%
  - Hipótese baseada em: cliente C3 reconhece o padrão, valoriza não passar pela humilhação da régua, aceita acordo cartorial

- **Custo operacional cobrança C3 alto:** redução de 60-70%
  - Sem 6 meses de cron + Compliance gates + audit + Júlia validações

- **Recuperação líquida:** +25% em valor absoluto
  - Mesmo com desconto de 30%, recebe-se em 1-3 meses vs 6+ meses

- **NPS pós-cobrança:** +10 a +20 pontos vs régua tradicional
  - Cliente reconhece dignidade da abordagem direta

**Como validar:** A/B test 60 dias. Grupo A (50% dos C3 elegíveis): fluxo tradicional. Grupo B (50%): atalho D+1. Comparar fechamento, tempo médio, NPS.

---

## 3. Critério de elegibilidade (gate determinístico)

Cliente entra no atalho D+1 SE TODAS as condições:

```typescript
isC3HighRisk(customer): boolean {
  const snapshot = await customerHealthService.latest(customer.id);
  return (
    snapshot.healthTier === 'critical' &&
    snapshot.brokenAgreementsCount >= 3 &&
    snapshot.invoicesOverdueCurrent >= 1 &&
    (consultaIspScore ?? 1000) < 300 &&
    customer.contractMonths >= 6  // não fazer com cliente novo
  );
}
```

E condições negativas (sai do atalho):

```typescript
shouldExclude(customer): boolean {
  return (
    customer.flags?.vulnerable === true ||           // vulnerabilidade declarada
    customer.flags?.proconActive === true ||          // caso Procon aberto
    customer.flags?.essentialService === true ||      // home office, dispositivo médico
    hasActiveAgreement(customer) ||                   // já em acordo
    hasRecentHumanContact(customer, days: 7)         // humano já está cuidando
  );
}
```

---

## 4. Fluxo operacional

### Trigger (cron 09:00 BRT)

```
1. Listar invoices em D+1 (vencidas ontem)
2. Para cada cliente:
   a. Snapshot do customer-health (Spec 010A)
   b. Aplicar isC3HighRisk() + shouldExclude()
   c. Se elegível: dispara Marcos com flag `atalho_confissao_d1`
   d. Marcos: invoca Rafael (que normalmente cobraria D+1) com instrução especial
3. Pular esses clientes do fluxo padrão Bruno/Rafael até resposta ou expiração 5 dias
```

### Mensagem inicial (Rafael, validada por Júlia)

```
"Olá [primeiro nome]. Aqui é o Rafael, do [tenant].

Olhei seu histórico aqui com cuidado.
Vimos que esse momento tem sido difícil — você tem várias parcelas em atraso e alguns acordos que não conseguimos cumprir.

Quero te propor algo direto: consolidar TUDO em uma confissão de dívida única, com 30% de desconto, em até 6x. Assinatura digital, sem cartório (ou com cartório se preferir, mais formal).

Vantagens pra você:
✓ Para a régua de cobrança agora (sem mais lembretes constantes)
✓ Reduz total devido em 30%
✓ Mantém serviço ativo enquanto paga o acordo
✓ Quita CPF se já está negativado

Quer que eu te mostre os números exatos? Responde SIM e te mando."
```

Tom: respeitoso, direto, sem julgamento. Reconhecimento da dificuldade. Apresentação objetiva.

### Continuação (se cliente responde SIM)

Rafael compõe segunda mensagem com:
- Valor total atual da dívida (soma de `invoices.overdue`)
- Valor com desconto 30%
- Opção de parcelas (1x, 3x, 6x)
- Data da 1ª parcela (próximo dia útil ou data acordada)
- Link ZapSign para assinatura

### Se cliente aceita (assina termo)

1. ZapSign webhook → backend
2. Cria `confessional_debts` row (já existe do Spec 004)
3. Marca invoices originais como "consolidated" (não cobra mais via régua normal)
4. Cria invoices novas para as parcelas
5. **Pausa rÃ©gua de cobranÃ§a** desse cliente atÃ© data da 1Âª parcela
6. Sofia notifica cliente: "Tudo certo! 1Âª parcela em [data]. Vou avisar 3 dias antes."
7. Audit log com `actionType='confissao_d1_atalho'`

### Se cliente nÃ£o responde (5 dias)

Volta ao fluxo padrÃ£o (Bruno D+5 ou Rafael D+5 conforme polÃ­tica atual). Nenhuma penalidade adicional. NÃ£o repetir oferta no mesmo ciclo (anti-fadiga).

### Se cliente recusa explicitamente

- Helena assume conversa
- Tom muda para "entendo, vamos no caminho regular"
- Marca `customers.flags.rejected_confessao_d1=true` (não oferecer no próximo ciclo)

---

## 5. Schema impact (MÍNIMO — reusa existentes)

### Modificações em tabelas existentes (NÃO criar tabelas novas)

**`customers`**: adicionar coluna opcional
- `flags: jsonb` — armazena flags arbitrários incluindo `rejected_confessao_d1`, `vulnerable`, `proconActive`, `essentialService`
- (Se já existe, apenas usar)

**`confessional_debts`**: marcar origem
- `triggerType: text` (novo opcional) — valores: 'manual' | 'atalho_d1_c3' | 'rafael_negotiated'

**`invoices`**: marcar consolidação
- `consolidatedByConfessionalDebtId: integer references confessional_debts.id` (novo opcional)

Schema novo: zero tabelas. Apenas extensões mínimas.

---

## 6. Plano de execução — 3 batches

### Batch 1 — Lógica de elegibilidade + trigger (3-4 dias)
- [ ] `server/services/atalho-confissao-d1/eligibility.ts` — função pura `isC3HighRisk` + `shouldExclude`
- [ ] `server/workers/atalho-confissao-d1.ts` — cron 09:00 BRT
- [ ] Schema: adicionar `flags`, `triggerType`, `consolidatedByConfessionalDebtId`
- [ ] Tests unit + cron manual trigger

### Batch 2 — Integração agente Rafael + ZapSign (3-4 dias)
- [ ] Modificar prompt Rafael v2 (do CoWork) com seção "modo atalho confissão D+1"
- [ ] Input contextual: flag `atalhoConfessaoD1=true` no JSON do contexto
- [ ] Reusar fluxo ZapSign do Spec 004 (sem retrabalho)
- [ ] Webhook handler: marcar invoices como `consolidated` + criar parcelas novas
- [ ] Sofia mensagem confirmação pós-assinatura

### Batch 3 — UI + A/B test infra (2-3 dias)
- [ ] Tab "Confissões" no `/clientes/[id]` mostrando se há confissão ativa + triggerType
- [ ] Dashboard: card "Confissões D+1 atalho esta semana" com taxa de fechamento
- [ ] Feature flag `ATALHO_CONFISSAO_D1_ENABLED=true|false` por tenant (config)
- [ ] A/B test: divisão automática 50/50 dos C3 elegíveis no primeiro mês

---

## 7. Validações de aceitação

1. Cliente C3 com `healthTier='critical' + brokenAgreementsCount=4 + ispScore=200` em D+1 → Rafael envia mensagem de atalho confissão (validada por Júlia)
2. Cliente C2 (não C3) em D+1 → NÃO entra no atalho, fluxo Bruno normal
3. Cliente C3 com flag `vulnerable=true` → NÃO entra, escala humano
4. Cliente aceita → ZapSign envia link → cliente assina → invoices consolidadas + parcelas novas criadas → régua pausada
5. Cliente não responde 5 dias → fluxo volta ao normal (Bruno D+5)
6. Cliente rejeita explicitamente → flag `rejected_confessao_d1=true` salvo, não repetir
7. A/B test: tenants com `ATALHO_CONFISSAO_D1_ENABLED=true` veem split 50/50; tenants com `false` mantêm 100% no fluxo tradicional

---

## 8. KPIs pós-30 dias produção

**Métrica primária — taxa de fechamento:**
- % de C3 elegíveis que aceitam atalho D+1 vs % que fechariam confissão após 60+ dias de régua
- Alvo: atalho ≥40% vs baseline ~20% (validar baseline real Vertical Fibra)

**Métrica secundária — recuperação financeira:**
- Valor médio recuperado por cliente C3 elegível (com vs sem atalho)
- Tempo até primeiro pagamento (D+1 vs D+60+)

**Métrica de saúde do relacionamento:**
- NPS pós-resolução (Pedro coleta após pagamento 1ª parcela)
- Taxa de re-incidência: % dos que assinaram que voltam a atrasar dentro de 6 meses

**Métrica operacional:**
- Custo operacional (tokens LLM + Júlia checks + agent runs) por caso C3 resolvido
- Comparar: caminho atalho vs caminho tradicional

---

## 9. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Cliente C3 sente que está sendo "tratado como caso perdido" | Tom da mensagem (Rafael v2 + Júlia gate) é cuidadoso. Reconhece dificuldade sem julgar. |
| Falso positivo (cliente classificado C3 erroneamente) | Precision da Spec 010A precisa ≥60% antes de ativar Spec 011 em produção. |
| Cliente vulnerável recebe atalho indevidamente | Gate explícito em `shouldExclude` + Júlia revalida no momento do envio. |
| Procon questiona "cliente coagido a assinar dívida sob pressão" | Termo ZapSign tem cláusula explícita de ciência + 7 dias para arrependimento (CDC art. 49). |
| Atalho substitui retenção legítima | Cliente que demonstra interesse em manter serviço sem confissão (negocia) → escala Rafael normal. Atalho não é compulsório. |

---

## 10. Out of scope

- Confissão para outros perfis (B3, C1, C2) — apenas C3 alto-risco no MVP
- Pagamento via PIX recorrente automático na confissão — fica para fase 2
- Confissão e-Notariado cartorial automatizada — fica para fase 2 (caro, baixo volume)
- Integração com escritório de advocacia externo se confissão quebrar — Spec 014+

---

## 11. Próximos passos

1. **Validar Spec 010A em produção** (precision ≥60% no tier critical)
2. **Confirmar baseline atual** com Vertical Fibra: % atual de C3 que fecha confissão tardia
3. **Receber Prompt v2 do Rafael** (CoWork) com seção atalho D+1 incluída
4. **Iniciar Batch 1** após confirmações

Tempo estimado entrega: 2 semanas após Spec 010A em produção.
