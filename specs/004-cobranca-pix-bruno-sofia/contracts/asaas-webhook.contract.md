# Contract — Asaas Webhook Receiver

**Direction:** Inbound (Asaas → Provedor.ai)
**Purpose:** Receber eventos de pagamento e disparar Sofia / atualizar `pix_charges`.

## Endpoint
`POST /webhooks/asaas`

Configurado por provedor no painel Asaas → "Integrações → Webhooks". URL fica `https://provedor.ai/webhooks/asaas` (global); identificação de tenant via `externalReference` no payload.

## Headers

- `Content-Type: application/json`
- `User-Agent: asaas-webhook` (informativo)
- `asaas-access-token: <token cadastrado pelo provedor no painel Asaas>`

## Payload (PAYMENT_RECEIVED exemplo)

```json
{
  "id": "evt_xxx",
  "event": "PAYMENT_RECEIVED",
  "dateCreated": "2026-05-14T08:32:11.000Z",
  "payment": {
    "id": "pay_xxx",
    "customer": "cus_xxx",
    "value": 149.90,
    "netValue": 147.91,
    "billingType": "PIX",
    "status": "RECEIVED",
    "dueDate": "2026-05-14",
    "paymentDate": "2026-05-14",
    "externalReference": "provider:42:invoice:9876:attempt:551",
    "pixTransaction": { "endToEndIdentifier": "E18236120..." }
  }
}
```

## Eventos relevantes

| Event | Ação |
|---|---|
| `PAYMENT_RECEIVED` / `PAYMENT_CONFIRMED` | Marca `pix_charges.status='paid'`, atualiza `invoices.status='paga'`, dispara Sofia |
| `PAYMENT_OVERDUE` | Marca `pix_charges.status='expired'` (Pix expirou); fora do escopo Sofia |
| `PAYMENT_DELETED` | Marca `pix_charges.status='cancelled'`; não dispara Sofia |
| `PAYMENT_REFUNDED` | Marca `pix_charges.status='refunded'`; abrir alerta admin |
| `PAYMENT_CHARGEBACK_REQUESTED` | Alerta admin; sem ação automática |
| Outros | Persiste em `payment_events` mas não age |

## Fluxo de processamento

```
1. Parse JSON
2. Extrair externalReference → providerId
3. Carregar asaas_accounts pelo providerId
4. Validar req.headers['asaas-access-token'] === decrypt(webhookTokenEncrypted)
   ↳ falha → 401 + log "auth_failed"
5. INSERT INTO payment_events (...) ON CONFLICT (provider_id, asaas_payment_id, event_type) DO NOTHING
   ↳ se 0 rows afetadas → status='duplicate' (FR-008)
6. Responder 200 imediatamente
7. (async) Se evento qualifica Sofia → enfileirar BullMQ "sofia-thank" {providerId, paymentEventId}
8. (async) Atualizar pix_charges.status e invoices.status conforme evento
```

## Response

- `200` — sempre (mesmo em duplicate; Asaas reenvia até receber 200)
- `401` — auth falhou (Asaas tenta novamente, mas após N falhas considera webhook quebrado)
- `400` — payload mal-formado / `externalReference` impossível de parsear (raro; loga e segue 400 só para alertar misconfig)

## Segurança

- Token estático no header é a forma oficial Asaas (sem HMAC).
- Token é cifrado em repouso (`webhook_token_encrypted` em `asaas_accounts`).
- Decifrar e comparar em **tempo constante** (`crypto.timingSafeEqual`).

## Implementação

`server/routes/webhook.routes.ts` ADD handler. `server/workers/sofia-event-processor.ts` é o consumer BullMQ.
