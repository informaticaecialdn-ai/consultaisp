# Contract — Bruno (Direct API, Haiku 4.5)

**Direction:** Internal (Provedor.ai → Anthropic Direct API)
**Purpose:** Bruno escolhe template HSM + preenche variáveis para um lembrete pré-vencimento, e chama a tool de geração de Pix.

## Modelo
`claude-haiku-4-5-20251001`

## System Prompt
Carregado de `server/prompts/bruno.md` (rascunho em `drafts/`). Caracteres-chave:

- Identidade: "Bruno — Atendente Preventivo do <nomeProvedor>".
- Objetivo: lembrar cliente de fatura a vencer, oferecer Pix de pagamento imediato, com tom cordial e profissional.
- Regras: respeitar opt-out (Júlia barra antes), não pressionar, nunca afirmar "você está inadimplente" (cliente ainda não venceu).
- Idioma: português brasileiro.

## Input do usuário (programático)

```json
{
  "providerName": "Provedor X Telecom",
  "providerSupportPhone": "+55 11 4002-8922",
  "customerName": "João da Silva",
  "invoiceNumber": "NF-2026-000123",
  "invoiceValue": 149.90,
  "invoiceDueDate": "2026-05-14",
  "step": "D-3",
  "availableTemplates": [
    { "name": "lembrete_prevencimento_v1", "variables": ["nome_cliente","valor","data_vencimento"], "hasMediaQrCode": true }
  ],
  "memoryFacts": [
    { "key": "preferred_pix_key", "value": "joaosilva@email.com" },
    { "key": "last_topic", "value": "questionou aumento na fatura em abril" }
  ]
}
```

## Tools

### `gerar_pix_dinamico`

```json
{
  "name": "gerar_pix_dinamico",
  "description": "Cria cobrança Pix dinâmica no Asaas do provedor para uma fatura específica. Retorna QR Code base64 + copia-e-cola.",
  "input_schema": {
    "type": "object",
    "properties": {
      "invoiceId": { "type": "integer" },
      "value": { "type": "number" },
      "dueDate": { "type": "string", "format": "date" }
    },
    "required": ["invoiceId", "value", "dueDate"]
  }
}
```

Implementação: `server/agents/tools/gerar-pix-bruno.ts` chama `asaas-multi-tenant.createPixForInvoice(providerId, invoiceId, attemptId)`.

## Output esperado de Bruno

Após `tool_use` + `tool_result`, Bruno emite resposta final em JSON estruturado (forced via `response_format` ou parse pós-resposta):

```json
{
  "templateName": "lembrete_prevencimento_v1",
  "variables": {
    "nome_cliente": "João",
    "valor": "R$ 149,90",
    "data_vencimento": "14/05/2026"
  },
  "pix": {
    "asaasPaymentId": "pay_xxx",
    "qrCodeBase64": "iVBORw0KGgoAAAANSUhEU...",
    "copyPaste": "00020126580014BR.GOV..."
  },
  "freeFormText": null
}
```

`freeFormText` é null quando estamos fora da janela 24h Meta (default Bruno; quase sempre); só populado se cliente teve inbound nas últimas 24h e a estratégia escolhida for mensagem livre.

## Latência

- p95 alvo: < 4s por execução (Haiku 4.5 + cache + 1 tool round-trip)
- Caching: system prompt + lista de templates cacheados (prompt cache Anthropic).

## Custo estimado

- Input médio: 1.2k tokens (~70% cacheados após 1ª chamada do dia)
- Output médio: 300 tokens
- Custo: ~R$ 0,01–0,02 por execução. 140 execuções/dia/tenant ≈ R$ 60/mês/tenant.

## Validação por Júlia (Spec 003)

Output de Bruno é passado **inteiro** para Júlia via `invokeJulia(tenantId, { proposedAction })`. Júlia retorna `{decision: APPROVED|APPROVED_WITH_ADJUSTMENT|BLOCKED}`. Bruno não envia diretamente — quem envia é o worker após decisão de Júlia.
