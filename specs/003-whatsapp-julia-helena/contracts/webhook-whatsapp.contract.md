# Contract: POST /webhooks/whatsapp

**Type:** HTTP endpoint (público, Meta Cloud API callback)
**File:** `server/communications/whatsapp/webhook.ts`

## Verify (GET)

Meta valida URL via GET com query params: `hub.mode=subscribe`, `hub.challenge`, `hub.verify_token`.
- Validar `hub.verify_token === META_VERIFY_TOKEN` (env)
- Retornar `hub.challenge` como text/plain
- Else 403

## Receive (POST)

### Headers
- `X-Hub-Signature-256: sha256=<hex>` — HMAC-SHA256 do raw body com `META_APP_SECRET`

### Multi-Tenant Resolution
1. Parse payload
2. Extract `entry[0].changes[0].value.metadata.phone_number_id`
3. Lookup `whatsapp_accounts.phone_number_id` → `providerId`
4. Se não encontrado: log + responder 200 + alertar admin (NÃO bloquear Meta)

### Processing
1. Validar signature ANTES de parsear (raw body)
2. Responder **200 imediatamente** (<4s — Meta exige <5s)
3. Enfileirar payload em BullMQ queue `whatsapp-webhook`
4. Worker processa async: identificar customer → carregar AgentMemory → invocar Helena via orquestrador

### Payload Shape (inbound message)
```json
{
  "entry": [{
    "id": "{wabaId}",
    "changes": [{
      "field": "messages",
      "value": {
        "metadata": { "phone_number_id": "{phoneNumberId}" },
        "contacts": [{ "wa_id": "{customerPhone}", "profile": { "name": "..." }}],
        "messages": [{
          "from": "{customerPhone}",
          "id": "wamid.xxx",
          "timestamp": "1699999999",
          "type": "text",
          "text": { "body": "..." }
        }]
      }
    }]
  }]
}
```

### Status Update Payload (delivered, read, failed)
```json
{
  "entry": [{
    "changes": [{
      "field": "messages",
      "value": {
        "statuses": [{
          "id": "wamid.xxx",
          "status": "delivered | read | failed",
          "timestamp": "...",
          "recipient_id": "..."
        }]
      }
    }]
  }]
}
```

Worker atualiza `communications.deliveredAt` / `readAt` / `status='failed'`.

## Audit

Toda recepção: registrar em `audit_logs` com `action='whatsapp_inbound'`, `actorType='SYSTEM'`, `providerId`, `payload={messageId, from, type}`.

## Errors

- 403 signature inválida
- 200 sempre quando signature OK (mesmo se tenant não identificado — apenas logar)
- 500 nunca para o Meta (resulta em retry massivo)
