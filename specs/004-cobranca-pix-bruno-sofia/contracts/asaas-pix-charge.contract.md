# Contract — Asaas Dynamic Pix Charge

**Direction:** Outbound (Provedor.ai → Asaas)
**Purpose:** Bruno cria cobrança Pix dinâmica para uma fatura do provedor.

## Endpoint
`POST https://{sandbox|api}.asaas.com/api/v3/payments`

## Auth
Header `access_token: <decifrar asaas_accounts.apiKeyEncrypted do provedor>`.
`{sandbox|api}` resolvido por `asaas_accounts.mode`.

## Request Body

```json
{
  "customer": "cus_xxx",
  "billingType": "PIX",
  "value": 149.90,
  "dueDate": "2026-05-14",
  "description": "Fatura NF-2026-000123 - Provedor X Telecom",
  "externalReference": "provider:42:invoice:9876:attempt:551",
  "postalService": false
}
```

**Notas:**
- `customer` é o `id` do customer **no Asaas do provedor**. Se ainda não existir, criar via `POST /customers` (já existe helper `findOrCreateCustomer` em `server/services/asaas.ts`).
- `value` e `dueDate` copiam do `invoice` original.
- `externalReference` é o vínculo crítico para identificação no webhook (formato fixo: `provider:<id>:invoice:<id>:attempt:<id>`).

## Response (201)

```json
{
  "id": "pay_xxx",
  "customer": "cus_xxx",
  "value": 149.90,
  "billingType": "PIX",
  "status": "PENDING",
  "dueDate": "2026-05-14",
  "externalReference": "provider:42:invoice:9876:attempt:551",
  "pixQrCodeId": "pixqr_xxx"
}
```

## Buscar QR Code (chamada subsequente)

`GET /payments/{id}/pixQrCode`

```json
{
  "encodedImage": "iVBORw0KGgoAAAANSUhEUgAA... (base64 PNG)",
  "payload": "00020126580014BR.GOV.BCB.PIX0136...",
  "expirationDate": "2026-05-14T23:59:59"
}
```

`encodedImage` é a imagem do QR Code; `payload` é o copia-e-cola. Ambos vão para `pix_charges`.

## Erros tratados

| HTTP | Razão | Ação |
|---|---|---|
| 401 | Chave Asaas inválida ou revogada | Marca `asaas_accounts.accountStatus='revoked'`, abre alerta admin, suspende régua do tenant |
| 400 | `customer` não existe / CPF inválido | Loga; tenta `findOrCreateCustomer` e refaz; se ainda 400 → marca `outbound_attempts.status='failed'` |
| 429 | Rate-limit | Re-enfileira com backoff exponencial (BullMQ retry) |
| 500-503 | Indisponibilidade Asaas | Retry com backoff; após N falhas → alerta admin |

## Idempotência (lado da plataforma)

Antes de chamar Asaas, checar se já existe `pix_charges` com `(invoiceId, step=D-3|D-1, dateScheduled=hoje)` — se sim, pular criação e reusar QR Code.

## Implementação esperada

Função nova `createDynamicPix(apiKey, params)` em `server/services/asaas.ts`, refatorada para receber `apiKey` em vez de ler do env. Wrapper `createPixForInvoice(providerId, invoiceId, attemptId)` em `server/services/asaas-multi-tenant.ts` que: decifra a chave do provedor, faz a chamada, persiste em `pix_charges`.
