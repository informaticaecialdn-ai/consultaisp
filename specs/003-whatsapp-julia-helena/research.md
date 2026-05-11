# Research — Spec 003 (WhatsApp + Júlia + Helena)

**Phase**: 0 (Outline & Research)
**Date**: 2026-05-11
**Note**: Pesquisa consolidada de 4 agents em paralelo (schemas, WhatsApp, prompts, Anthropic integration). Outputs completos em `drafts/` e em arquivos de output dos agents.

---

## D1. Direct API vs Managed Agents

**Decision:** Direct API para Júlia (Haiku 4.5) e Helena (Sonnet 4.6).
**Rationale:** Latência crítica (<500ms Júlia, <30s Helena) + prompt caching reduz custo 60-90%. Managed Agents adiciona 200-500ms inter-cloud + não suporta cache.
**Alternatives:** Managed Agents — rejeitado para esta spec; será reavaliado para Marcos/Daniel/Lucas/Pedro (workflows longos).

## D2. WhatsApp via Meta Cloud API Direto

**Decision:** Meta Cloud API oficial via Embedded Signup OAuth. Multi-tenant: cada provedor tem seu próprio WABA conectado.
**Rationale:** Anti-banimento, compliance Anatel, suporte oficial. Cada tenant onboarda seu próprio número via popup OAuth.
**Alternatives:** Evolution API / Z-API — rejeitado (risco banimento, decisão final CLAUDE.md §8.1).

## D3. Janela 24h Gerenciada Por (Tenant × Customer)

**Decision:** Tabela `customer_windows` (ou flag em `customers.lastInboundAt` + `whatsappWindowExpiresAt`). Atualizar a cada inbound. Fora da janela → templates HSM aprovados.
**Rationale:** Política Meta para messaging gratuito service-window.
**Implementation:** Worker cron horário fecha janelas expiradas (set `isActive = false`).

## D4. Validação Compliance em 4 Camadas (Júlia)

**Decision:** (1) regras determinísticas <100ms, (2) Anatel timeline, (3) LLM semântica via Haiku <300ms, (4) detecção vulnerabilidade. Output JSON `{decision, fundamentacao_legal[], ajustes_sugeridos[]}`.
**Rationale:** SC-002 alvo <500ms p95. Camadas 1-2 podem evitar chamada LLM em casos óbvios.
**Cache:** Prompt caching agressivo para referência legal (LGPD/CDC/Anatel) = 60-90% redução de input tokens.

## D5. Audit Log Append-Only via Trigger Postgres

**Decision:** Trigger `raise_immutability_error()` BEFORE UPDATE OR DELETE em `audit_logs`. Aplicação não consegue alterar registros, nem com `service_role`.
**Rationale:** Princípio III não-negociável. Defesa jurídica.
**Implementation:** SQL bruto em migration separada (drizzle-kit não gera triggers).

## D6. Memória Persistente Helena: Postgres + Redis Cache

**Decision:** `agent_memories` tabela (Postgres = source of truth) + Redis cache TTL 5min. Carrega ao iniciar conversa, persiste após cada turno. Compactação via LLM a cada 5 interações em `summary`.
**Rationale:** Cross-restart, cross-process. Cache reduz read latency. Compactação evita prompt explosion.

## D7. Webhook Processing Assíncrono via BullMQ + Redis

**Decision:** POST /webhooks/whatsapp responde 200 imediatamente, enfileira em BullMQ. Worker processa async (identificação tenant + cliente + Helena + Júlia + envio).
**Rationale:** Meta exige ack <5s p99. Processamento real (Helena + ERP + Júlia + Meta) leva 5-30s.

## D8. Identificação Tenant Por phoneNumberId

**Decision:** Webhook recebe `entry[0].changes[0].value.metadata.phone_number_id`. Lookup em `whatsapp_accounts.phone_number_id` → `provider_id`. Sem lookup = log + 200 (não bloquear Meta) + alerta admin Provedor.ai.
**Rationale:** Multi-tenant (Princípio I). Sem essa identificação inicial, qualquer mensagem pode parar no tenant errado = vazamento crítico.

## D9. Token Meta Em AES-256-GCM, Rotação 45 Dias

**Decision:** `access_token_encrypted` no banco usando `crypto.createCipheriv('aes-256-gcm', ENCRYPTION_MASTER_KEY, iv)`. Long-lived token (60d Meta) rotacionado em cron 45d. Se expirar, alerta admin tenant.
**Rationale:** LGPD + Princípio V. Vazamento de banco não compromete WhatsApp dos tenants.

## D10. Opt-Out "PARAR" Por Tenant, Permanente

**Decision:** Tabela `whatsapp_optouts` (provider_id, phone, optedOutAt, reason). Júlia consulta ANTES de aprovar qualquer outbound. Match → BLOCKED, mesmo se template aprovado.
**Rationale:** LGPD + boas práticas anti-banimento Meta. Sem expiração (cliente pode pedir reentrada via humano).

## D11. Vertical Fibra Como Tenant Piloto

**Decision:** Onboarding manual no Vertical Fibra (Embedded Signup + ERP IXC já integrado). Smoke test com 5 clientes reais antes de GA.
**Rationale:** Princípio VII (incremental verificável). Risk de bug em produção = sandbox no próprio tenant do owner.

## D12. Observabilidade Estruturada

**Decision:** Logs JSON com campos obrigatórios: `tenantId`, `agentId`, `customerId`, `action`, `correlationId`, `latencyMs`, `tokensInput`, `tokensOutput`, `cacheHit`. Tabela `agent_logs` (opcional MVP, usar console.log JSON).
**Rationale:** Observabilidade multi-tenant — operador tenant A não vê logs tenant B; admin Provedor.ai vê agregado.

---

## Summary

12 decisões resolvidas. Zero NEEDS CLARIFICATION restantes. Pronto para Phase 1 (data-model + contracts).
