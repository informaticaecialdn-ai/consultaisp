# Research — Spec 004 (Bruno + Sofia + Pix dinâmico)

**Phase**: 0 (Outline & Research)
**Date**: 2026-05-11
**Note**: Consolida decisões técnicas com base na infra existente (Spec 003) e na integração Asaas atual em `server/services/asaas.ts`.

---

## D1. Chave Asaas Por Tenant (vs. única global)

**Decision:** Cada provedor configura sua **própria chave de API Asaas**, armazenada criptografada em `asaas_accounts` (1:1 com `providers`, AES-256-GCM usando a `ENCRYPTION_MASTER_KEY` da Spec 003).
**Rationale:** FR-017 exige que o crédito do Pix vá direto para a conta Asaas do provedor, sem intermediação da plataforma. Asaas Split Payments adicionaria complexidade contratual (cadastro de "Sub-conta da Plataforma" + repasse) e regulatória; a chave própria do provedor é o caminho mais simples e auditavelmente correto.
**Alternatives considered:**
- Split Payments — rejeitado por complexidade contratual e por colocar a plataforma como intermediário financeiro.
- Chave única global — viola FR-017; fundos cairiam na conta da plataforma.
**Impact:** Refatora `server/services/asaas.ts` para receber `apiKey` como parâmetro (não ler de env). Mantém função `getDefaultAsaasKey()` que devolve a chave global do `.env` apenas para `creditOrders` (cobrança SaaS→provedor da própria plataforma).

## D2. Webhook Asaas: Identificação de Tenant e Assinatura

**Decision:** Todo Pix criado por Bruno inclui `externalReference = "provider:<providerId>:invoice:<invoiceId>:attempt:<attemptId>"`. O webhook Asaas retorna esse campo intacto, então o handler faz parse para identificar o tenant. Validação de autenticidade via `asaas-access-token` header configurável por provedor (Asaas envia o token que o provedor cadastrou no painel deles).
**Rationale:** Asaas não assina HMAC payloads como Meta; o mecanismo oficial é um token estático configurado pelo provedor no painel Asaas e enviado em header. Vincular `externalReference` ao `providerId` em vez de tentar lookup por chave de API (não vai no payload) elimina ambiguidade.
**Alternatives considered:**
- Lookup por API key — Asaas não envia a key no webhook.
- Lookup por `customer.id` (do Asaas) — frágil; um mesmo CPF pode existir em duas contas Asaas distintas.
**Implementation:** `POST /webhooks/asaas` valida `asaas-access-token` contra `asaas_accounts.webhook_token_encrypted`; falha → 401. Sucesso → enfileira evento em BullMQ para Sofia.

## D3. Idempotência: Bruno e Sofia

**Decision:**
- **Bruno**: `outbound_attempts` com unique index `(invoiceId, step, scheduledDate)` onde `step ∈ {D-3, D-1}` e `scheduledDate = data do dia local`. Tentar inserir segundo registro no mesmo dia/passo lança erro → skip.
- **Sofia**: `payment_events` com unique index em `(providerId, externalPaymentId, eventType)`. Webhook duplicado entra no `INSERT ... ON CONFLICT DO NOTHING`; se já existe (duplicate), worker pula Sofia.
**Rationale:** Idempotência na DB > idempotência em memória/cache. Sobrevive a restart, deploy e race condition entre múltiplos workers. Cumpre FR-005 e FR-008.
**Alternatives considered:**
- Redis SETNX — perdido em flush/clear.
- Lock pessimista por fatura — pior throughput, mais complexidade.

## D4. Tabela `outbound_attempts` vs. Reusar `communications`

**Decision:** Criar `outbound_attempts` como tabela de **estado da régua** (intenção + decisão Júlia + retry count) e manter `communications` (Spec 003) apenas para mensagens **efetivamente enviadas**. Quando `outbound_attempts.status = 'SENT'` cria-se a linha correspondente em `communications` com `externalMessageId` (wamid Meta).
**Rationale:** `communications` representa histórico de envio (auditoria); `outbound_attempts` representa o ciclo (varredura, dedupe, compliance, retry). Misturar polui semântica e dificulta queries existentes.
**Alternatives considered:** Acrescentar campos `attemptCount`, `status='pending|vetoed'`, `nextRetryAt` em `communications` — quebra invariante atual de que toda linha = mensagem que saiu.

## D5. Janela 08:00–20:00 No Fuso Do Provedor

**Decision:** Calcular a janela usando `providers.address_state` para resolver fuso (mapa estático estado→IANA timezone, ex: SP→`America/Sao_Paulo`, AM→`America/Manaus`). Bruno só dispara `outbound_attempts` cujo `scheduledFor` cai dentro de [08:00, 20:00] local. Se cair fora, mensagem entra em `status='waiting_window'` com `nextRetryAt` = próxima janela aberta.
**Rationale:** UTC quebraria em estados de fuso -4. Estado primário é dado já cadastrado em `providers.address_state` e suficiente — provedor de internet opera em região geograficamente contida.
**Alternatives considered:**
- Configuração explícita de timezone — sobrecarga sem ganho.
- Fuso de Brasília fixo — quebra Amazonas/Acre.
**Edge case:** feriados nacionais. MVP usa biblioteca leve (ex: `date-holidays`) ou tabela manual; provedor pode marcar feriados regionais via toggle (fora do MVP — default = só feriados nacionais).

## D6. Bruno em Haiku 4.5 (Direct API) + Tool gerar_pix

**Decision:** Bruno é um agente Direct API Haiku 4.5 com **um único tool**: `gerar_pix_dinamico(invoiceId, valor, vencimento)`. O LLM **não decide se envia** — quem decide é o scheduler. Bruno apenas: (1) escolhe o template HSM adequado entre os pré-aprovados pelo tenant, (2) preenche variáveis (nome, valor, data), (3) chama o tool, (4) retorna estrutura `{templateName, variables, pixPayload}` para Júlia validar.
**Rationale:** Determinismo + custo. Haiku 4.5 a R$ 1 por milhão de tokens input + caching = ~R$ 0,02 por execução de Bruno. Sonnet seria 10x mais caro sem ganho perceptível.
**Alternatives considered:** Bruno em código puro (sem LLM) — perderia personalização e a "voz" de marca. Bruno em Sonnet — gasto desproporcional ao escopo (template-based).

## D7. Sofia em Haiku 4.5 (Direct API) Com Acesso à Memória

**Decision:** Sofia é Direct API Haiku 4.5 com tool `consultar_memoria_cliente(customerId)` que devolve `agent_memories` (Spec 003) — fatos relevantes, último tópico discutido, sentimento. Sofia compõe agradecimento dentro de **template HSM aprovado de "agradecimento de pagamento"** (Meta restringe outbound fora da janela 24h, e o webhook de pagamento não abre janela), com variáveis personalizadas.
**Rationale:** Personalização real (não só "Obrigado Fulano!") com custo controlado e dentro das regras do Meta. Caso especial: se cliente está dentro da janela 24h por inbound recente, Sofia pode mandar mensagem free-form mais natural.
**Alternatives considered:** Sofia em texto fixo — perde diferenciação de marca, é exatamente o "chatbot" que o produto rejeita (CLAUDE.md §1).

## D8. Asaas Pix Dinâmico: Parâmetros

**Decision:**
- `billingType: "PIX"` (Asaas gera Pix dinâmico com QR Code embutido)
- `dueDate`: igual ao `dueDate` da fatura
- `value`: igual ao `value` da fatura
- `description`: `"Fatura <invoiceNumber> - <providerName>"` (visível pro cliente final)
- `externalReference`: `"provider:<id>:invoice:<id>:attempt:<id>"` (FR-017 + D2)
- `pixAddressKey`: chave Pix da conta Asaas do provedor (configurada por ele no Asaas; opcional na criação — Asaas usa a default da conta)
- Pix QR Code obtido via `GET /payments/{id}/pixQrCode` → `encodedImage` (base64) + `payload` (copia-e-cola)
**Rationale:** Asaas suporta Pix dinâmico nativamente; QR Code é entregue como imagem base64 que pode ser enviada como template WhatsApp média.
**Source:** Asaas API v3 docs — `POST /payments` e `GET /payments/{id}/pixQrCode`.

## D9. Bruno Scheduler: Cron + BullMQ

**Decision:** Cron diário (default 09:00 local do provedor) em `server/workers/bruno-scheduler.ts`. Para cada tenant com `agent_toggles.bruno_ativo=true`: query faturas vencendo D-3 e D-1 → enfileira jobs em BullMQ ("bruno-process-invoice") com `{providerId, invoiceId, step}`. Consumer separado executa um job por vez por tenant (rate-limit por provider para não estourar Asaas).
**Rationale:** Desacopla iteração de tenants do processamento individual; BullMQ já em uso na Spec 003; rate-limit nativo do BullMQ por job key.
**Alternatives considered:** Tudo síncrono em `setInterval` — viola separação de concerns + risco de bloqueio se uma chamada Asaas trava.

## D10. Sofia: Trigger Por Webhook Asaas

**Decision:** Webhook handler `POST /webhooks/asaas`:
1. Valida `asaas-access-token` header.
2. Identifica tenant via `externalReference` parse.
3. Insere em `payment_events` com `ON CONFLICT DO NOTHING` (idempotência).
4. Se evento novo e `eventType in ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']` → enfileira job "sofia-thank" em BullMQ.
5. Responde 200 imediatamente.

Worker `sofia-event-processor.ts` consome o job: invoca Sofia → Júlia → envia via WhatsApp.
**Rationale:** Asaas exige ack rápido; mesmo padrão Spec 003. Idempotência DB-level.

## D11. Retry de Falha de Envio (FR-020)

**Decision:** Cron `outbound-retry.ts` (a cada 15min): seleciona `outbound_attempts` com `status='failed' AND attempt_count < 2 AND next_retry_at <= now()`. Reagenda para próxima janela permitida + reenfileira. Após `attempt_count >= 2`: marca `status='needs_human_review'` e cria alerta para admin do tenant.
**Rationale:** Espelha FR-020 literalmente. Sem fallback SMS/email (decisão do usuário).

## D12. Dossiê de Auditoria — Geração

**Decision:** Endpoint `GET /api/dossie/cliente/:customerId?from=YYYY-MM-DD&to=YYYY-MM-DD&format=pdf|json` que:
1. Verifica `req.session.providerId` === `customers.providerId` (multi-tenant gate).
2. Faz JOIN entre `audit_logs`, `compliance_checks`, `communications`, `payment_events`, `outbound_attempts`, `pix_charges` filtrando por `providerId + customerId + range`.
3. Renderiza PDF via `pdfkit` (já no projeto via `contract-pdf.js`) ou retorna JSON estruturado.
**Rationale:** Tudo já em `audit_logs` é suficiente; é só apresentação. PDF reutiliza biblioteca existente. SC-006 = <30s para 12 meses → JOIN com índice em `(providerId, customerId, occurredAt)` é trivial.
**Index a criar:** `audit_logs_provider_customer_time_idx ON (provider_id, (payload->>'customerId'), occurred_at DESC)` — payload é jsonb, então índice expression.

## D13. Templates HSM WhatsApp

**Decision:** Esta spec depende de 2 templates aprovados pelo Meta no Business Manager do tenant:
- `lembrete_prevencimento_v1` (categoria UTILITY): variáveis `{nome_cliente}`, `{valor}`, `{data_vencimento}` + componente IMAGE (QR Code).
- `agradecimento_pagamento_v1` (categoria UTILITY): variáveis `{nome_cliente}`, `{valor}`, `{data_pagamento}`.
**Rationale:** Templates UTILITY são gratuitos no Meta; categoria correta evita rejeição.
**Implementation:** Spec entrega **rascunhos JSON** dos templates em `drafts/`; tenant submete no seu próprio Business Manager (manual). Sistema valida em runtime via `GET /v20.0/{wabaId}/message_templates` que template existe + status=APPROVED antes de cada envio.

## D14. Observabilidade Bruno/Sofia

**Decision:** Reusar logger estruturado JSON da Spec 003 (campos `tenantId`, `agentId`, `customerId`, `action`, `correlationId`, `latencyMs`, `tokensInput`, `tokensOutput`, `cacheHit`). Métricas mínimas no MVP:
- Bruno: nº de Pix gerados/dia/tenant, nº de envios/dia, taxa de veto Júlia.
- Sofia: latência webhook→envio (p50, p95), nº de duplicatas rejeitadas.
**Alternatives:** Prometheus/Grafana — fora do MVP, log estruturado é suficiente para o piloto.

---

## Summary

14 decisões registradas. Zero NEEDS CLARIFICATION em research. **Único bloqueio pendente é externo: autorização do owner para as 5 tabelas novas (Princípio II).** Pronto para Phase 1 (data-model + contracts) assim que autorização for emitida.
