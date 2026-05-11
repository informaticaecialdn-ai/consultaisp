# Data Model — Spec 003

**Phase**: 1 (Design)
**Date**: 2026-05-11
**Schemas:** definição completa em `drafts/schemas-drizzle.ts` (Drizzle syntax)

## Entidades Novas (6)

### 1. `communications`
Toda mensagem inbound/outbound. Multi-tenant via `provider_id`.

| Campo | Tipo | Notes |
|---|---|---|
| id | serial PK | |
| providerId | FK providers | **Multi-tenant** |
| customerId | FK customers | |
| channel | varchar(20) | WHATSAPP \| SMS \| EMAIL |
| direction | varchar(20) | INBOUND \| OUTBOUND |
| templateName | text? | HSM nome se template |
| content | text | conteúdo da mensagem |
| status | varchar(20) | pending/sent/delivered/read/failed |
| externalMessageId | text? | wamid do Meta |
| sentAt, deliveredAt, readAt | timestamp? | timeline |
| agentId | text? | agt_reativo_v1 etc. |
| createdAt | timestamp | |

**Índices:** (providerId, customerId, createdAt DESC), (externalMessageId)

### 2. `audit_logs` — IMUTÁVEL
Append-only via trigger Postgres. Defesa Procon/Anatel.

| Campo | Tipo | Notes |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| providerId | FK providers | **Multi-tenant** |
| action | text | send_whatsapp, approve_agreement, etc. |
| resource | text | Customer, Communication, Agreement |
| resourceId | text | id do recurso |
| actorType | varchar(20) | AGENT \| HUMAN \| SYSTEM |
| actorId, actorName | text? | agt_reativo_v1, "Helena - Atendente Master" |
| payload | jsonb | dados completos |
| legalBasis | text | "Execução contrato (LGPD art. 7º V)" |
| legalReferences | text[] | ["CDC art. 71", "Anatel 765/2023"] |
| notificationProof | jsonb? | { wamid, deliveredAt, readAt } |
| occurredAt, createdAt | timestamp | |

**Trigger:** `audit_logs_immutable_update/delete` raise exception.

### 3. `agent_memories`
Memória persistente por (customer × agent). Multi-tenant implícito via customer.

| Campo | Tipo | Notes |
|---|---|---|
| id | serial PK | |
| customerId | FK customers | |
| agentId | text | agt_reativo_v1 |
| facts | jsonb | [{ key, value, source, extractedAt }] |
| promises | jsonb | [{ promise, promisedDate, status }] |
| topics | text[] | tópicos já discutidos |
| sentimentHistory | jsonb | [{ score, timestamp, context }] |
| summary | text? | resumo compactado LLM |
| lastInteractionAt, updatedAt | timestamp | |

**Unique:** (customerId, agentId)

### 4. `compliance_checks`
Cada validação da Júlia. Auditoria de bloqueios.

| Campo | Tipo | Notes |
|---|---|---|
| id | uuid PK | |
| providerId | FK | **Multi-tenant** |
| customerId | FK | |
| agentId | text? | quem pediu validação |
| proposedAction | jsonb | { actionType, content, channel } |
| decision | varchar(30) | APPROVED \| APPROVED_WITH_ADJUSTMENT \| BLOCKED |
| legalBasis, legalReferences | text/text[] | |
| adjustments | jsonb? | se APPROVED_WITH_ADJUSTMENT |
| blockingReasons | text[]? | se BLOCKED |
| latencyMs | int | observabilidade |
| createdAt | timestamp | |

### 5. `agreements` — fora do escopo P1 (definido para spec futura)
Acordos de pagamento (Rafael cria). Mantida no draft para evitar duas migrations.

### 6. `whatsapp_accounts`
Configuração Meta por tenant (1:1).

| Campo | Tipo | Notes |
|---|---|---|
| id | serial PK | |
| providerId | FK unique | **1 por tenant** |
| wabaId | text unique | WhatsApp Business Account ID |
| phoneNumberId | text unique | identificador no webhook |
| displayName | text? | |
| accessTokenEncrypted | text | AES-256-GCM |
| wabaStatus | varchar(20) | pending/verified/rejected/revoked |
| qualityRating | varchar(10)? | GREEN/YELLOW/RED |
| verifiedAt, tokenExpiresAt | timestamp? | |
| createdAt, updatedAt | timestamp | |

## Tabela Auxiliar Inferida

### `whatsapp_optouts`
Necessária para Júlia enforcement. Adicionar.

```ts
export const whatsappOptouts = pgTable('whatsapp_optouts', {
  id: serial('id').primaryKey(),
  providerId: integer('provider_id').notNull(),
  phoneNumber: text('phone_number').notNull(),
  optedOutAt: timestamp('opted_out_at').defaultNow(),
  reason: text('reason'),
  isPermanent: boolean('is_permanent').default(true),
}, (t) => ({
  uniqueProviderPhone: uniqueIndex('whatsapp_optouts_provider_phone_uq')
    .on(t.providerId, t.phoneNumber),
}));
```

## Relacionamentos

```
providers (1) ──< customers (N) ──< communications (N)
                                 ──< agent_memories (N, por agent)
providers (1) ──< audit_logs (N)
providers (1) ──< compliance_checks (N)
providers (1) ──1 whatsapp_accounts
providers (1) ──< whatsapp_optouts (N)
```

## Multi-Tenant Verification

Toda query MUST incluir `WHERE provider_id = ?` ou referenciar customer cujo providerId é validado. Storage layer:

```ts
// server/storage/communications.storage.ts
async function listCommunications(providerId: number, customerId: number) {
  return db.select().from(communications)
    .where(and(
      eq(communications.providerId, providerId),  // SEMPRE
      eq(communications.customerId, customerId)
    ));
}
```

Teste obrigatório `multi-tenant.test.ts`: criar 2 tenants, inserir dados em cada, verificar isolamento absoluto.
