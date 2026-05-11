# Contract: invokeHelena() — Reativo Loop

**Type:** TS function (internal). Direct API + tool-use manual loop.
**File:** `server/agents/helena.ts`

## Signature

```typescript
export async function invokeHelena(input: HelenaInput): Promise<HelenaResult> {
  // 1. Carregar AgentMemory por (customerId, agt_reativo_v1)
  // 2. Construir contexto enriquecido (customer, contract, faturas, score, status técnico)
  // 3. Loop até 8 turnos: anthropic.messages.create + tool_use handler
  // 4. Cada outbound passa por invokeJulia() antes de enviar
  // 5. Atualizar AgentMemory ao final
  // Latência alvo <30s p95
}

interface HelenaInput {
  tenantId: number;                          // SEMPRE — multi-tenant
  customerId: number;
  messageText: string;                        // mensagem do cliente
  senderPhone: string;                        // E.164
  whatsappMessageId: string;                  // wamid inbound
  correlationId?: string;
}

interface HelenaResult {
  success: boolean;
  outboundMessageId?: string;                 // wamid se enviou resposta
  escalated: boolean;
  escalationType?: 'humano' | 'rafael' | 'julia_blocked';
  escalationReason?: string;
  taskCreated?: { taskId: string; priority: 'urgent' | 'normal' };
  turnsUsed: number;
  toolsCalled: string[];
  memoryUpdated: { facts: string[]; promises: { date: string; value: number }[] };
  complianceCheckIds: string[];               // Júlia decisions
  latencyMs: number;
  tokensInput: number;
  tokensOutput: number;
}
```

## Tools Available

- `consultar_contrato(customerId)` → contract details from ERP
- `consultar_faturas(customerId, limit)` → recent invoices
- `gerar_segunda_via(invoiceId)` → PDF + Pix code
- `gerar_pix(invoiceId)` → copy-paste Pix
- `consultar_pagamento(invoiceId)` → status + paidAt
- `aplicar_desconto_preview(invoiceId, percent)` → ≤5% sem aprovação
- `registrar_promessa(customerId, date, value)` → AgentMemory.promises
- `enviar_whatsapp(content)` → invokes Júlia → Meta API
- `handoff_humano(reason, priority)` → cria task
- `handoff_rafael(reason)` → passa para Negociador

## Escalation Rules

- Sentiment <-0.5 após 2 mensagens hostis → handoff humano URGENT
- "quero cancelar" → handoff humano URGENT (retenção)
- Desconto >5% ou parcelamento → handoff Rafael
- 8 turnos sem resolução → handoff humano com summary
- Vulnerabilidade detectada → handoff humano SENSITIVE + pausar régua

## Memory Update

A cada turno: extrair facts, detectar promessa, adicionar topics, sentiment history. A cada 5 interações: gerar `summary` compacto via Haiku.

## Multi-Tenant

`tenantId` propagado para TODAS as tool calls. AgentMemory lookup via `customerId` (que carrega `provider_id` validado).
