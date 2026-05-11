# Contract — Dossiê de Auditoria (Defesa Procon/Anatel)

**Direction:** Inbound (Browser do admin → Provedor.ai)
**Auth:** `requireAuth` + `requireAdmin` + multi-tenant gate verifica `customer.providerId === req.session.providerId`.

## GET `/api/dossie/cliente/:customerId`

### Query params

| Param | Tipo | Default | Notes |
|---|---|---|---|
| `from` | date | hoje-365d | início do período auditado |
| `to` | date | hoje | fim |
| `format` | enum | `pdf` | `pdf` \| `json` |

### Response (200) — formato JSON

```json
{
  "customer": {
    "id": 12,
    "name": "João da Silva",
    "cpfCnpj": "***.***.789-00",
    "phone": "+55 11 ***-1234"
  },
  "provider": { "id": 42, "name": "Provedor X Telecom", "cnpj": "12.345.678/0001-90" },
  "period": { "from": "2025-05-11", "to": "2026-05-11" },
  "communications": [
    {
      "id": 2341,
      "channel": "WHATSAPP",
      "direction": "OUTBOUND",
      "agentId": "bruno_v1",
      "templateName": "lembrete_prevencimento_v1",
      "content": "Olá João, ...",
      "sentAt": "2026-05-11T09:02:33-03:00",
      "deliveredAt": "2026-05-11T09:02:35-03:00",
      "readAt": "2026-05-11T09:14:01-03:00",
      "complianceDecision": "APPROVED",
      "complianceCheckId": "uuid..."
    }
  ],
  "complianceChecks": [
    {
      "id": "uuid...",
      "agentId": "bruno_v1",
      "decision": "APPROVED",
      "legalBasis": "Cobrança preventiva pré-vencimento (CDC art. 71 a contrario sensu)",
      "legalReferences": ["CDC art. 71", "Anatel 765/2023 art. 9"],
      "createdAt": "2026-05-11T09:02:30-03:00"
    }
  ],
  "pixCharges": [
    { "id": 887, "asaasPaymentId": "pay_xxx", "value": 149.90, "status": "paid", "paidAt": "2026-05-14T08:32:11-03:00" }
  ],
  "paymentEvents": [
    { "eventType": "PAYMENT_RECEIVED", "receivedAt": "2026-05-14T08:32:13-03:00", "processingStatus": "processed" }
  ],
  "auditLogs": [
    {
      "action": "send_whatsapp",
      "resource": "Communication",
      "resourceId": "2341",
      "actorType": "AGENT",
      "actorId": "bruno_v1",
      "actorName": "Bruno - Atendente Preventivo",
      "legalBasis": "Execução contrato (LGPD art. 7º V)",
      "occurredAt": "2026-05-11T09:02:33-03:00"
    }
  ],
  "summary": {
    "totalCommunications": 18,
    "totalApprovedByCompliance": 17,
    "totalVetoedByCompliance": 1,
    "totalPaymentsConfirmed": 11
  }
}
```

### Response (200) — formato PDF

Header `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="dossie-<customerId>-<from>-<to>.pdf"`. Mesmo conteúdo renderizado com cabeçalho do provedor, índice, e seções por categoria. Use `pdfkit` (já no projeto).

### Erros

- 404: `customer` não pertence ao tenant da sessão.
- 403: usuário não é admin.

### Performance

- Alvo SC-006: <30s p95 para `to-from <= 12 meses`.
- Query estratégica: 6 SELECTs paralelos (1 por tabela) com `WHERE provider_id=? AND customer_id=? AND <data range>`. Índices em `(provider_id, customer_id, occurred_at DESC)`.
- PDF rendering: stream para não materializar tudo em memória.

## Audit do próprio dossiê

Cada chamada gera entrada em `audit_logs` com `action='generate_dossie', actorType='HUMAN', actorId=<userId>` — audit de quem auditou.
