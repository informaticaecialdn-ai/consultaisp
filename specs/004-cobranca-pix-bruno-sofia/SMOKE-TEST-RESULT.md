# SMOKE TEST — Spec 004 (Vertical Fibra)

**Objetivo:** validar end-to-end Bruno + Sofia em produção com 1 cliente teste do owner, antes de habilitar para os demais ISPs.

**Pré-requisitos:**
- Deploy concluído (T064)
- Migrations Spec 004 aplicadas
- VPS com `REDIS_URL`, `ANTHROPIC_API_KEY`, `ENCRYPTION_MASTER_KEY` setadas
- WhatsApp Business Account do Vertical Fibra conectada (Spec 003)
- Chave Asaas Sandbox válida do Vertical Fibra
- 2 templates HSM aprovados pelo Meta OU usar mode produção com cliente teste (preferível: sandbox primeiro)

**Cliente teste:** owner (Emerson) — telefone pessoal, CPF próprio. Acordo: aceita receber 2 mensagens automatizadas de teste.

---

## Roteiro passo-a-passo

### Etapa 1 — Configuração inicial (10 min)

1. Login no painel admin do Vertical Fibra (`https://vertical.provedor.ai/`)
2. Ir em **Cobrança → Conexão Asaas**
3. Colar chave sandbox (`$aact_test_...`) + webhook token (gerar token longo aleatório)
4. Clicar "Testar e Salvar"
   - **Esperado:** badge "Sandbox" verde, chave mascarada
   - **Validar:** `audit_logs` tem entry `asaas_account_connected`
5. No Asaas sandbox: criar webhook apontando para `https://vertical.provedor.ai/webhooks/asaas` com o mesmo token

### Etapa 2 — Templates Bruno + Sofia

**Opção A (recomendada): submeter HSM no Meta primeiro**

Ver T062 deste documento ou `drafts/template-*.json`. Aguarda 24-72h.

**Opção B (atalho): usar templates fake apenas pra validar pipeline**

Se Meta não aprovou ainda, configure em **Configurar Agentes**:
- `templateBrunoNome`: deixe em branco (default `lembrete_prevencimento_v1`)
- `templateSofiaNome`: deixe em branco (default `agradecimento_pagamento_v1`)

Bruno vai falhar no `meta.sendTemplate` se o template não existir no Meta — mas tudo até ali (LLM, Júlia, audit) será validado.

### Etapa 3 — Ativar agentes (3 min)

1. **Cobrança → Configurar Agentes**
2. Ligar toggle **Bruno** e **Sofia**
3. Configurar:
   - Hora do scheduler: `09:00` (ou hora corrente +1 para teste rápido)
   - Janela: `08:00` - `20:00`
   - Permite sábado: ✓
   - Permite domingo: ✗
4. Clicar **Salvar**
5. **Validar:**
   - `audit_logs` tem entry `agent_toggle_updated`
   - `agent_toggles` tem `brunoAtivo=true, sofiaAtiva=true`

### Etapa 4 — Criar fatura D-3 (5 min)

No ERP do Vertical Fibra (ou via `psql` direto pra teste rápido):

```sql
-- Cliente teste = owner (CPF próprio, telefone próprio)
INSERT INTO contracts (provider_id, customer_id, plan, value, status)
VALUES (<vertical_fibra_id>, <emerson_customer_id>, 'Teste', '149.90', 'active')
RETURNING id;

INSERT INTO invoices (provider_id, customer_id, contract_id, value, due_date, status)
VALUES (
  <vertical_fibra_id>,
  <emerson_customer_id>,
  <contract_id>,
  '149.90',
  CURRENT_DATE + INTERVAL '3 days',  -- D-3
  'pending'
);
```

### Etapa 5 — Disparar scheduler manualmente (1 min)

Em vez de esperar a hora configurada, dispare manualmente:

```bash
# SSH na VPS
ssh user@vps
cd /caminho/Consulta-ISP

# Executa um tick do scheduler sem esperar
npx tsx -e "
import { runBrunoSchedulerTick } from './server/workers/bruno-scheduler';
runBrunoSchedulerTick().then(r => { console.log(r); process.exit(0); });
"
```

**Esperado em stdout:**
```json
{ "providersScanned": 1, "jobsEnqueued": 1, "reservationsSkipped": 0 }
```

Se `jobsEnqueued: 0`: checar (a) `agent_toggles.brunoAtivo=true`, (b) `schedulerHoraLocal` casa com hora local atual, (c) janela horária permite agora.

### Etapa 6 — Acompanhar Bruno em ação (2-5 min)

```bash
# Logs do worker (PM2)
pm2 logs worker --lines 50
```

**Sequência esperada em log estruturado pino:**

1. `bruno_scheduler_tick` → providersScanned=1, jobsEnqueued=1
2. `bruno_pix_created` → asaasPaymentId=pay_xxx, providerId=N
3. `bruno_done` → success=true, latencyMs=~2000, tokensInput/Output reais
4. `julia_decision` → decision=APPROVED, camadasValidadas todas true
5. WhatsApp Cloud API responde com `messageId: wamid.xxx`
6. `bruno_send_message` audit registrado

**Validação no banco:**

```sql
-- Pix gerado
SELECT id, asaas_payment_id, value, status FROM pix_charges
WHERE provider_id = <vertical_fibra_id> ORDER BY created_at DESC LIMIT 1;

-- Outbound attempt = sent
SELECT id, step, status, attempt_count FROM outbound_attempts
WHERE provider_id = <vertical_fibra_id> ORDER BY created_at DESC LIMIT 1;

-- Comunicação outbound
SELECT id, channel, direction, content FROM communications
WHERE provider_id = <vertical_fibra_id> AND agent_id = 'agt_preventivo_v1'
ORDER BY created_at DESC LIMIT 1;
```

**Validação no WhatsApp do owner:** mensagem do template chegou no celular.

### Etapa 7 — Idempotência (2 min)

Disparar scheduler de novo no mesmo dia:

```bash
npx tsx -e "import { runBrunoSchedulerTick } from './server/workers/bruno-scheduler'; runBrunoSchedulerTick().then(r => console.log(r));"
```

**Esperado:**
```json
{ "providersScanned": 1, "jobsEnqueued": 0, "reservationsSkipped": 1 }
```

UNIQUE em `outbound_attempts(invoice_id, step, scheduled_for::date)` impede duplicação.

### Etapa 8 — Simular pagamento + Sofia (3 min)

Opção A — pagar o Pix no app do banco usando o copy-paste recebido:
1. Pagamento cai no sandbox Asaas
2. Asaas envia webhook para `/webhooks/asaas`
3. Sofia dispara

Opção B — simular webhook via curl:

```bash
# Pegar o asaasPaymentId real do banco
ASAAS_PAYMENT_ID=$(psql $DATABASE_URL -tAc "SELECT asaas_payment_id FROM pix_charges WHERE provider_id=<vertical_id> ORDER BY created_at DESC LIMIT 1")

# Webhook token configurado na conta
TOKEN="<webhook_token_que_configurou>"

# Disparar
curl -X POST https://vertical.provedor.ai/webhooks/asaas \
  -H "Content-Type: application/json" \
  -H "asaas-access-token: $TOKEN" \
  -d "{
    \"id\": \"evt_test_001\",
    \"event\": \"PAYMENT_RECEIVED\",
    \"payment\": {
      \"id\": \"$ASAAS_PAYMENT_ID\",
      \"value\": 149.90,
      \"paymentDate\": \"$(date +%Y-%m-%d)\",
      \"externalReference\": \"provider:<vertical_id>:invoice:<invoice_id>:attempt:<attempt_id>\"
    }
  }"
```

**Esperado:**
- HTTP 200
- Logs: `asaas_webhook_handled` → `sofia_done` → `sofia_send_thanks`
- WhatsApp do owner: 2ª mensagem chega (agradecimento)
- `pix_charges.status` = `paid`
- `invoices.status` = `paid`
- `payment_events` tem 1 row
- `outbound_attempts` step=`THANK_YOU` status=`sent`

### Etapa 9 — Idempotência webhook (1 min)

Disparar o mesmo curl novamente. Esperado:
- HTTP 200 com `{ duplicate: true }`
- **NENHUM** novo job Sofia enfileirado
- `payment_events` continua 1 row
- WhatsApp do owner: NÃO recebe 3ª mensagem

### Etapa 10 — Dossiê (2 min)

1. UI: **Cobrança → Régua → clicar no cliente teste → Ver Dossiê** (ou ir direto a `/cliente/<id>/dossie`)
2. Selecionar período: últimos 30 dias
3. Clicar **Baixar PDF**

**Esperado:**
- Download `dossie-<customerId>-<from>-<to>.pdf`
- Conteúdo contém: cabeçalho Vertical Fibra, resumo (1 comunicação, 1 compliance approved, 1 pix paid), seção compliance, seção comunicações com texto WhatsApp, seção pix, timeline audit
- Latência: <30s para período de 30 dias com poucos dados (SC-006)

### Etapa 11 — Regressão Spec 003 (5 min)

Garantir que Helena e Júlia continuam funcionando:

1. Enviar mensagem inbound de WhatsApp para o número do Vertical Fibra
2. **Esperado:** Helena responde em <30s, gerando audit `helena_done` + `compliance_check`
3. Validar `communications` tem inbound + outbound novos

---

## Resultado do smoke test

**Data execução:** ___________
**Operador:** ___________
**Versão (git sha):** ___________

| Etapa | Status | Observação |
|---|---|---|
| 1. Configuração inicial Asaas | ⬜ | |
| 2. Templates Meta | ⬜ | |
| 3. Ativar agentes | ⬜ | |
| 4. Criar fatura D-3 | ⬜ | |
| 5. Disparar scheduler | ⬜ | |
| 6. Bruno gera Pix + WhatsApp | ⬜ | |
| 7. Idempotência scheduler | ⬜ | |
| 8. Simular pagamento + Sofia | ⬜ | |
| 9. Idempotência webhook | ⬜ | |
| 10. Dossiê PDF | ⬜ | |
| 11. Regressão Spec 003 (Helena) | ⬜ | |

**Decisão final:** ⬜ Liberado para outros providers · ⬜ Bloqueado · ⬜ Liberado com observações

**Bugs encontrados:** (issues abertas durante o teste)

---

## SC-005 monitoring (T063)

Durante 1 semana de smoke test, validar zero duplicatas Sofia:

```sql
-- Não deve ter nenhuma linha com count > 1
SELECT
  provider_id,
  asaas_payment_id,
  event_type,
  COUNT(*) as duplicates
FROM payment_events
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1;

-- Comunicações Sofia por cliente — não deve ter mais de 1 por pagamento
SELECT
  c.provider_id,
  c.customer_id,
  c.created_at::date as dia,
  COUNT(*) as msg_sofia_no_dia
FROM communications c
WHERE c.agent_id = 'agt_relacionamento_v1'
  AND c.direction = 'outbound'
  AND c.created_at > NOW() - INTERVAL '7 days'
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1;
```

Anote resultado aqui após 1 semana:

**Duplicatas detectadas:** ___________
**Total comunicações Sofia na semana:** ___________
**SC-005 atendido (zero duplicatas):** ⬜ Sim · ⬜ Não
