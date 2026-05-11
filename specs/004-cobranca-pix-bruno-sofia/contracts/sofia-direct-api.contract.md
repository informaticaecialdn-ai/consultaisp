# Contract — Sofia (Direct API, Haiku 4.5)

**Direction:** Internal (Provedor.ai → Anthropic Direct API)
**Purpose:** Sofia personaliza mensagem de agradecimento dentro de template HSM aprovado após confirmação de pagamento.

## Modelo
`claude-haiku-4-5-20251001`

## System Prompt
`server/prompts/sofia.md` (rascunho em `drafts/`). Princípios:

- Identidade: "Sofia — Atendente de Relacionamento do <nomeProvedor>".
- Objetivo: agradecer pagamento, reforçar vínculo, opcionalmente mencionar algo positivo do histórico (tom curto, humano).
- Restrições: nunca pedir nada em troca, nunca fazer upsell, nunca usar gatilho de venda. Apenas agradecer.
- Idioma: pt-BR. Tom cordial, levemente caloroso, profissional.

## Input do usuário (programático)

```json
{
  "providerName": "Provedor X Telecom",
  "customerName": "João da Silva",
  "paidAmount": 149.90,
  "paidAt": "2026-05-14T08:32:11-03:00",
  "isFirstPaymentEver": false,
  "isWithin24hWindow": false,
  "availableTemplates": [
    { "name": "agradecimento_pagamento_v1", "variables": ["nome_cliente","valor","data_pagamento"] }
  ],
  "memoryFacts": [
    { "key": "preferred_pix_key", "value": "joaosilva@email.com" },
    { "key": "tenure_months", "value": "26" },
    { "key": "last_topic", "value": "elogiou estabilidade da fibra" }
  ]
}
```

## Tools
Sofia tem 1 tool **read-only**: `consultar_memoria_cliente` — opcional, fornecido só se `memoryFacts` veio vazio (a chamada anterior já populou via `agent_memories`).

```json
{
  "name": "consultar_memoria_cliente",
  "description": "Retorna fatos consolidados sobre o cliente do banco de memória dos agentes.",
  "input_schema": {
    "type": "object",
    "properties": { "customerId": { "type": "integer" } },
    "required": ["customerId"]
  }
}
```

## Output esperado

```json
{
  "templateName": "agradecimento_pagamento_v1",
  "variables": {
    "nome_cliente": "João",
    "valor": "R$ 149,90",
    "data_pagamento": "14/05/2026"
  },
  "freeFormText": null
}
```

Se `isWithin24hWindow=true`, Sofia pode opcionalmente emitir `freeFormText` em vez de template — mensagem curta personalizada (1-2 frases). O worker decide qual canal usar.

## Latência

- p95 alvo: < 3s (tarefa simples; geralmente 1 chamada sem tool round-trip)
- Caching: system prompt + lista de templates.

## Custo estimado

- Input médio: 800 tokens (cacheados)
- Output médio: 150 tokens
- Custo: ~R$ 0,005–0,01 por execução. 70 execuções/dia/tenant ≈ R$ 18/mês/tenant.

## Validação por Júlia

Idêntico a Bruno: output vai para `invokeJulia` antes do envio.

## Idempotência

Worker `sofia-event-processor.ts` só chama Sofia se conseguiu inserir nova linha em `payment_events` (ON CONFLICT DO NOTHING). Duplicate event = no Sofia call = no message.
