# Data Model — Spec 004

**Phase**: 1 (Design)
**Date**: 2026-05-11
**Status**: 5 tabelas novas — **autorizadas pelo owner em 2026-05-11** (Princípio II — exceção registrada)
**Schemas (Drizzle):** rascunho completo a ser gerado em `drafts/schemas-drizzle.ts` durante `/speckit-tasks`

## Entidades Novas (5)

### 1. `asaas_accounts` — credenciais Asaas por tenant

| Campo | Tipo | Notes |
|---|---|---|
| id | serial PK | |
| providerId | int FK providers UNIQUE | **1 por tenant** |
| apiKeyEncrypted | text | AES-256-GCM (master key Spec 003) |
| webhookTokenEncrypted | text? | token que o provedor cadastrou no painel Asaas, usado para validar webhook |
| mode | varchar(10) | `sandbox` \| `production` (auto-detect pelo prefixo `$aact_` vs `$aact_test_` ou config explícita) |
| accountStatus | varchar(20) | `pending` \| `verified` \| `revoked` |
| lastUsedAt | timestamp? | última chamada bem-sucedida |
| createdAt, updatedAt | timestamp | |

**Índices:** `providerId UNIQUE`.
**Trigger:** Nenhum especial; chave global do `.env` (`ASAAS_API_KEY`) **continua** existindo para `creditOrders` da plataforma.

### 2. `pix_charges` — Pix gerado por Bruno, vinculado a fatura

| Campo | Tipo | Notes |
|---|---|---|
| id | serial PK | |
| providerId | int FK providers | **Multi-tenant** |
| invoiceId | int FK invoices | |
| customerId | int FK customers | |
| asaasPaymentId | text UNIQUE | id da cobrança no Asaas (`pay_xxx`) |
| value | numeric(12,2) | cópia do valor da fatura no momento da geração |
| dueDate | date | cópia do vencimento |
| pixQrCodeBase64 | text? | QR Code image base64 (cacheado para reenvios sem nova chamada Asaas) |
| pixCopyPaste | text? | código copia-e-cola |
| pixExpiresAt | timestamp? | quando o QR Code expira no Asaas |
| status | varchar(20) | `pending` \| `paid` \| `expired` \| `cancelled` \| `refunded` (refletido do Asaas) |
| paidAt, cancelledAt | timestamp? | preenchidos por webhook |
| createdAt, updatedAt | timestamp | |

**Índices:**
- `(providerId, status)` para painel régua
- `(invoiceId)`
- `(asaasPaymentId) UNIQUE` para idempotência de webhook
- `(providerId, dueDate)` para varredura D-3/D-1

### 3. `payment_events` — webhooks Asaas processados

| Campo | Tipo | Notes |
|---|---|---|
| id | serial PK | |
| providerId | int FK providers | identificado via `externalReference` |
| asaasPaymentId | text | referência cruzada com `pix_charges.asaasPaymentId` |
| eventType | varchar(40) | `PAYMENT_CREATED`, `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`, `PAYMENT_DELETED`, etc. |
| externalEventId | text? | id do evento no Asaas (se enviado no payload) |
| payload | jsonb | snapshot completo do payload recebido |
| receivedAt | timestamp | quando o sistema recebeu |
| processingStatus | varchar(20) | `processed` \| `duplicate` \| `rejected` |
| rejectionReason | text? | se `rejected` |
| sofiaJobId | text? | id do job BullMQ que disparou Sofia |

**Índices:**
- `(providerId, asaasPaymentId, eventType) UNIQUE` — idempotência (FR-008)
- `(receivedAt DESC)` para timeline
- `(processingStatus)` para reprocessamento manual

### 4. `agent_toggles` — config Bruno/Sofia por tenant

| Campo | Tipo | Notes |
|---|---|---|
| id | serial PK | |
| providerId | int FK providers UNIQUE | **1 por tenant** |
| brunoAtivo | boolean | default `false` (opt-in explícito) |
| sofiaAtiva | boolean | default `false` |
| schedulerHoraLocal | time | default `09:00:00` — quando Bruno roda diariamente |
| janelaInicio | time | default `08:00:00` — limite inferior de envios |
| janelaFim | time | default `20:00:00` — limite superior |
| permiteSabado | boolean | default `true` |
| permiteDomingo | boolean | default `false` |
| templateBrunoNome | text? | nome do template HSM aprovado p/ pré-vencimento (ex: `lembrete_prevencimento_v1`) |
| templateSofiaNome | text? | template HSM aprovado p/ agradecimento |
| createdAt, updatedAt | timestamp | |

**Defaults provisionados** ao criar `provider` (via seed/migration backfill): registro com tudo OFF.

### 5. `outbound_attempts` — estado da régua (intenção + retry)

| Campo | Tipo | Notes |
|---|---|---|
| id | serial PK | |
| providerId | int FK providers | **Multi-tenant** |
| customerId | int FK customers | |
| invoiceId | int FK invoices? | nullable (Sofia sem fatura específica? não — Sofia sempre tem fatura paga) |
| pixChargeId | int FK pix_charges? | nullable (Sofia não gera Pix) |
| agentId | varchar(40) | `bruno_v1` \| `sofia_v1` |
| step | varchar(20) | `D-3` \| `D-1` (Bruno) \| `THANK_YOU` (Sofia) |
| scheduledFor | timestamp | quando deveria executar (após janela horária) |
| status | varchar(30) | `scheduled` \| `awaiting_compliance` \| `vetoed` \| `sent` \| `failed` \| `needs_human_review` |
| attemptCount | int | default 0; incrementa em retry |
| nextRetryAt | timestamp? | quando tentar de novo se `failed` |
| complianceCheckId | uuid FK compliance_checks? | decisão Júlia |
| communicationId | int FK communications? | criado quando `status='sent'` |
| failureReason | text? | erro do canal/falha de envio |
| createdAt, updatedAt | timestamp | |

**Índices:**
- `(invoiceId, step, dateScheduled)` UNIQUE onde `dateScheduled = scheduledFor::date` — **idempotência por (fatura × dia × passo)** (FR-005)
- `(providerId, status, scheduledFor)` para scheduler/varredura
- `(status, nextRetryAt)` para retry-cron

> **Nota Drizzle:** o índice único com expressão `(scheduledFor::date)` exige `sql` raw na definição. Será criado via migration SQL.

## Reuso da Spec 003 (sem alteração)

- `communications` — recebe a linha quando `outbound_attempts.status='sent'`; mantém invariante "1 row = 1 mensagem efetivamente enviada".
- `audit_logs` — Bruno e Sofia gravam ações (`bruno_generate_pix`, `bruno_send_message`, `sofia_send_thanks`, `compliance_decision`, etc.) — trigger imutabilidade já cobre.
- `agent_memories` — Sofia consulta para personalizar agradecimento.
- `compliance_checks` — Júlia continua escrevendo aqui; nova `agentId` valor `'bruno_v1' | 'sofia_v1'` aceito.
- `whatsapp_accounts` — credenciais Meta por tenant; reaproveitado para envio.
- `whatsapp_optouts` — consultado antes de cada envio Bruno/Sofia.

## Relacionamentos

```text
providers (1) ──1 asaas_accounts
providers (1) ──< pix_charges (N)        ──> invoices (1), customers (1)
providers (1) ──< payment_events (N)     ──> pix_charges (via asaasPaymentId)
providers (1) ──1 agent_toggles
providers (1) ──< outbound_attempts (N)  ──> customers (1), invoices (0..1), pix_charges (0..1)
outbound_attempts (1) ──0..1 compliance_checks
outbound_attempts (1) ──0..1 communications  (criado ao enviar)
```

## Multi-Tenant Verification (Princípio I)

Toda nova storage function recebe `providerId` como primeiro parâmetro e o aplica em `WHERE`. Padrão obrigatório (idêntico Spec 003):

```ts
// server/storage/pix-charge.storage.ts
async function listPixCharges(providerId: number, filters?: { status?: string; from?: Date; to?: Date }) {
  return db.select().from(pixCharges)
    .where(and(
      eq(pixCharges.providerId, providerId),  // SEMPRE
      filters?.status ? eq(pixCharges.status, filters.status) : undefined,
      filters?.from ? gte(pixCharges.dueDate, filters.from) : undefined,
      filters?.to ? lte(pixCharges.dueDate, filters.to) : undefined,
    ).filter(Boolean) as any);
}
```

Webhook handler:

```ts
// Identifica tenant via externalReference, valida match com asaasPaymentId
const providerId = parseProviderIdFromExternalRef(payload.payment.externalReference);
const account = await asaasAccountStorage.byProviderId(providerId);
const expectedToken = decrypt(account.webhookTokenEncrypted);
if (req.headers['asaas-access-token'] !== expectedToken) return res.status(401).end();
```

**Teste obrigatório `multi-tenant-pix.test.ts`:**
1. Cria tenant A com chave Asaas A; cria tenant B com chave Asaas B.
2. Bruno do tenant A gera Pix para fatura do tenant A → confere que `pix_charges.providerId === A`.
3. Simula webhook chegando com `externalReference` mascarando tenant errado → handler rejeita.
4. Tentativa de ler `pix_charges` do tenant A logado como B → resultado vazio.

## State Transitions — `outbound_attempts`

```text
                 (scheduler cria)
                       │
                       ▼
                   scheduled
                       │ (worker pega job)
                       ▼
              awaiting_compliance
                  │           │
            Júlia veto     Júlia aprova
                  │           │
                  ▼           ▼
               vetoed       (envia via WhatsApp)
                              │
                       sucesso│  falha
                              ▼         ▼
                            sent      failed ──(retry-cron, attempt_count++)──┐
                                        │                                     │
                                        │  attempt_count >= 2                 │
                                        ▼                                     │
                              needs_human_review                              │
                                                                              │
                                        (se attempt_count < 2, volta para)   │
                                                                              ▼
                                                                     awaiting_compliance
```

## Migration Strategy

1. Migration SQL `0XX_spec004_add_tables.sql`:
   - CREATE TABLE para as 5 tabelas com todas as constraints e índices acima.
   - Índices `gin`/expression onde necessário (notavelmente o unique em `(invoiceId, step, scheduledFor::date)`).
   - Sem alteração em tabelas existentes.
2. Backfill `agent_toggles`: `INSERT INTO agent_toggles (provider_id) SELECT id FROM providers ON CONFLICT DO NOTHING` (defaults assumem OFF, sem efeito comportamental).
3. Backfill `asaas_accounts`: **nenhum** automático. Cada provedor cadastra manualmente via UI da Spec.
4. Rollback: drop tables (sem perda de dados em tabelas legadas porque é tudo aditivo).

## LGPD — Minimização e Retenção

- `pix_charges` e `payment_events` contêm dado financeiro do cliente final do provedor (não cross-tenant). Mascaramento entre tenants já é coberto pela invariante multi-tenant; sem necessidade de mascaramento adicional dentro do mesmo tenant.
- Retenção: alinhar com retenção de `audit_logs` da Spec 003 (5 anos, padrão bureau). `pix_charges` deve viver enquanto o `invoice` original viver.
- `asaas_accounts.apiKeyEncrypted`: rotação manual pelo admin (revogar Asaas → cadastrar nova chave); rotação automática fora do MVP.
