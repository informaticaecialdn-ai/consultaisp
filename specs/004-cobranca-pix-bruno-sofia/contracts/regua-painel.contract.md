# Contract — Painel "Régua Pré-Vencimento" + Configurações

**Direction:** Inbound (Browser do admin → Provedor.ai)
**Auth:** Todos endpoints usam middleware `requireAuth` + `requireAdmin`. Multi-tenant filter por `req.session.providerId`.

---

## 1) GET `/api/regua/pre-vencimento`

Lista faturas-alvo dos próximos 3 dias + status.

### Query params

| Param | Tipo | Default | Notes |
|---|---|---|---|
| `from` | date | hoje | início da janela |
| `to` | date | hoje+3 | fim da janela |
| `status` | enum? | (todos) | filtro `pix_charges.status` |
| `step` | enum? | (todos) | `D-3` \| `D-1` |
| `page`, `limit` | int | 1, 50 | paginação |

### Response (200)

```json
{
  "items": [
    {
      "invoiceId": 9876,
      "invoiceNumber": "NF-2026-000123",
      "customer": { "id": 12, "name": "João da Silva", "phone": "+5511..." },
      "value": 149.90,
      "dueDate": "2026-05-14",
      "step": "D-3",
      "pixCharge": { "asaasPaymentId": "pay_xxx", "status": "pending", "expiresAt": "..." },
      "outboundAttempt": {
        "id": 551,
        "status": "sent",
        "complianceDecision": "APPROVED",
        "attemptCount": 1,
        "sentAt": "2026-05-11T09:02:33-03:00",
        "communicationId": 2341
      }
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 192 }
}
```

---

## 2) GET `/api/regua/agente-config`

Devolve `agent_toggles` do provedor (cria default se não existe).

### Response (200)

```json
{
  "brunoAtivo": true,
  "sofiaAtiva": true,
  "schedulerHoraLocal": "09:00",
  "janelaInicio": "08:00",
  "janelaFim": "20:00",
  "permiteSabado": true,
  "permiteDomingo": false,
  "templateBrunoNome": "lembrete_prevencimento_v1",
  "templateSofiaNome": "agradecimento_pagamento_v1"
}
```

## 3) PATCH `/api/regua/agente-config`

Atualiza toggles + horários + templates escolhidos. Validação Zod.

### Request body (parcial; só campos enviados são atualizados)

```json
{ "brunoAtivo": false }
```

### Response (200) — devolve config completa atualizada.

### Side-effects

- `brunoAtivo: false` → cancela jobs BullMQ "bruno-process-invoice" pendentes do provedor (marca como `cancelled`).
- `sofiaAtiva: false` → bloqueia handler webhook de enfileirar novos jobs Sofia (eventos continuam sendo registrados em `payment_events`).
- Toda mudança é registrada em `audit_logs` com `actorType='HUMAN', actorId=<userId>`.

---

## 4) GET `/api/asaas/account`

Status da chave Asaas conectada do provedor.

### Response (200)

```json
{
  "connected": true,
  "mode": "production",
  "accountStatus": "verified",
  "lastUsedAt": "2026-05-11T09:00:01-03:00",
  "maskedApiKey": "$aact_prod_******abcd"
}
```

## 5) POST `/api/asaas/account`

Salva chave Asaas + webhook token. Servidor decifra/cifra; nunca devolve plaintext.

### Request body

```json
{
  "apiKey": "$aact_prod_...abcd",
  "webhookToken": "umToken123Bem-Longo"
}
```

### Validação

1. Tentar `GET /myAccount` no Asaas com a chave para validar que funciona.
2. Detectar `mode` pelo prefixo da chave.
3. Cifrar e salvar.
4. Responder 201 com response idêntica ao GET acima.

### Erros

- 400: chave Asaas inválida (Asaas retornou 401 no `myAccount`).
- 422: `webhookToken` deve ter ≥ 16 caracteres.

## 6) DELETE `/api/asaas/account`

Remove conexão Asaas do provedor. Marca `accountStatus='revoked'`, NÃO apaga `pix_charges` históricos.
Suspende `brunoAtivo` e avisa o admin.

### Response: 204

---

## Notas de segurança

- Nenhum endpoint devolve plaintext de credenciais (`apiKeyEncrypted` ou `webhookTokenEncrypted`).
- Multi-tenant: middleware aplica `WHERE provider_id = req.session.providerId` em **toda** query. Resposta vazia é o comportamento correto para tentar acessar tenant alheio.
- Rate-limit em `POST /api/asaas/account` (max 5 tentativas / 15min / IP) para evitar enumeração.
