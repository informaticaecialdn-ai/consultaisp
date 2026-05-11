# Feature Specification: P1 Cobrança — WhatsApp + Júlia (Compliance) + Helena (Reativo)

**Feature Branch**: `003-whatsapp-julia-helena`
**Created**: 2026-05-11
**Status**: Draft (pesquisa concluída em paralelo via 4 agents)
**Input**: User description: "Primeiro slice de valor do módulo Cobrança. Implementar WhatsApp Cloud API (Meta direto) + Compliance Agent (Júlia, Haiku) + Reativo (Helena, Sonnet). Quando pronto: assinante envia WhatsApp → Helena responde em <30s com info correta de fatura; Júlia bloqueia outbound fora horário/CDC 71. Vendable como Standalone Essencial."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Cliente Pergunta Sobre Fatura no WhatsApp e Helena Responde (Priority: P1)

Um cliente do provedor envia uma mensagem WhatsApp para o número oficial do provedor: "Oi, qual o valor da minha conta esse mês?". Em até 30 segundos, recebe resposta da Helena (digital, mas sem se identificar como IA): "Olá Maria! Sua fatura de R$ 99,90 vence em 15/05. Pix copia-cola: [código]. Qualquer dúvida me chama!". A info financeira veio do ERP do provedor (não inventada). Júlia validou a outbound (horário OK, sem termos vexatórios).

**Why this priority**: É o caso de uso MAIS frequente em provedor (~70% das demandas de cobrança). Sem isso, o produto não existe. Resolvê-lo bem provides immediate value visible to end customer.

**Independent Test**: Configurar provedor de teste com 1 cliente, WhatsApp Cloud API conectado, ERP IXC integrado. Enviar mensagem do número do cliente. Verificar: (a) webhook recebido no servidor, (b) tenant identificado, (c) cliente identificado, (d) Helena invocada, (e) tool consulta fatura no IXC, (f) Júlia valida resposta, (g) resposta enviada ao cliente em <30s, (h) tudo registrado em `communications` + `audit_logs`.

**Acceptance Scenarios**:

1. **Given** cliente do tenant Vertical Fibra com fatura aberta no IXC, **When** envia "qual valor da minha fatura?" via WhatsApp, **Then** recebe resposta correta em <30s com valor + data + Pix.
2. **Given** cliente envia mensagem 23:30 (fora do horário Anatel), **When** Helena tenta responder, **Then** Júlia BLOQUEIA outbound (horário inválido) e mensagem fica enfileirada para 08:00 do próximo dia útil. Cliente NÃO recebe nada às 23:30.
3. **Given** cliente envia "já paguei!", **When** Helena consulta tool `consultar_pagamento`, **Then** se confirmado retorna confirmação amigável + agradecimento; se não confirmado, abre task humana com tag "verificar_pagamento".
4. **Given** cliente envia "URGENTE QUERO CANCELAR!!!", **When** Helena detecta intenção + sentiment negativo, **Then** escala humano (retenção) com tag URGENT e summary das últimas interações.

---

### User Story 2 — Sofia Agradece Cliente Após Pagamento (Priority: P2, fora do escopo desta spec)

Reservado para Spec 004. Mencionado aqui porque depende da mesma infra de WhatsApp + AuditLog que esta spec entrega.

---

### User Story 3 — Bruno Envia Lembrete Preventivo D-3 (Priority: P3, fora do escopo desta spec)

Reservado para Spec 004. Depende de mesma infra.

---

### Edge Cases

- **Cliente sem fatura aberta envia mensagem** → Helena consulta ERP, retorna "você está em dia, parabéns!" + sugere próxima ação.
- **Múltiplos contratos no mesmo número WhatsApp** → Helena pergunta qual contrato; cliente seleciona via menu interativo (Meta interactive buttons).
- **Cliente envia áudio** → MVP: pede "manda em texto, por favor". Futuro: transcrever via Whisper.
- **Cliente envia foto/imagem** → MVP: pede "manda em texto"; reconhecer que pode ser comprovante de pagamento → escalar humano.
- **Cliente fala palavrão ou ofensa** → manter calma, responder cordialmente. 3+ ofensas → escalar humano.
- **Cliente vulnerável detectado** ("perdi o emprego", "estou doente") → FLAG vulnerabilidade, escalar humano IMEDIATAMENTE, pausar régua.
- **WhatsApp Cloud API fora do ar** → mensagens inbound enfileiradas, outbound retidas; recover quando volta.
- **Token Meta expirado** → alertar admin do tenant; bloquear outbound até reconexão.
- **Webhook Meta com signature inválida** → rejeitar com 403, alertar (possível ataque).
- **Cliente respondeu "PARAR" no passado** → opt-out permanente. NENHUMA outbound, mesmo template, mesmo Júlia aprovou.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST receber webhook de mensagem inbound da Meta WhatsApp Cloud API em endpoint `/webhooks/whatsapp`, validar `X-Hub-Signature-256` HMAC-SHA256 com `META_APP_SECRET` antes de parsear o body, e responder 200 em <4s (limite Meta 5s).
- **FR-002**: O sistema MUST identificar o tenant pelo `phone_number_id` (ou `wabaId`) recebido no payload, consultando `whatsapp_accounts` table.
- **FR-003**: O sistema MUST identificar o cliente pelo número do remetente, cruzando com tabela `customers` do tenant (campo `phone`). Se não identificado, perguntar CPF para localizar.
- **FR-004**: A janela de 24h MUST ser gerenciada por customer — toda inbound atualiza `lastInboundAt` e permite outbound free-form até 24h depois. Fora da janela, apenas templates HSM aprovados.
- **FR-005**: O sistema MUST permitir Embedded Signup OAuth (Meta popup) onde admin do tenant conecta seu WABA. Callback troca code por long-lived token (60 dias), salva criptografado em `whatsapp_accounts.access_token_encrypted` (AES-256-GCM).
- **FR-006**: Toda mensagem outbound MUST passar pela Júlia (Compliance Agent) antes de ser enviada. Júlia retorna JSON `{decision: APPROVED|APPROVED_WITH_ADJUSTMENT|BLOCKED, fundamentacao_legal[], ajustes_sugeridos[]}`. Se BLOCKED, mensagem NÃO é enviada; se APPROVED_WITH_ADJUSTMENT, ajustes são aplicados e revalidados.
- **FR-007**: Júlia MUST validar em 4 camadas: (1) regras determinísticas (horário, frequência, opt-in), (2) timeline Anatel 765, (3) LLM análise semântica do conteúdo (CDC art. 71), (4) detecção de vulnerabilidade do cliente. Latência alvo <500ms p95.
- **FR-008**: Helena MUST atender inbound WhatsApp 24/7 com latência alvo <30s p95 entre receber webhook e enviar resposta.
- **FR-009**: Helena MUST manter memória persistente por `(customerId, agentId)` em tabela `agent_memories`: facts, promises, topics, sentimentHistory, summary. Memória sobrevive a restart do servidor.
- **FR-010**: Helena MUST consultar ERP via tool `erp_adapter.consultar_fatura` para obter valores reais (NUNCA inventar valor financeiro). Se ERP indisponível, responder "não consigo verificar agora, vou pedir ajuda da equipe" + abrir task humana.
- **FR-011**: Helena MUST escalar humano quando: (a) cliente pede explicitamente, (b) sentiment < -0.5 após 2 mensagens hostis, (c) cliente quer cancelar, (d) 8 turnos atingidos sem resolução, (e) vulnerabilidade detectada.
- **FR-012**: Toda ação dos agentes (Júlia validação, Helena resposta, escalação humana) MUST ser registrada em `audit_logs` (tabela imutável via trigger Postgres) com `actorType=AGENT`, `actorName="Helena - Atendente Master"`, `legalBasis`, `legalReferences[]`, `payload`, `notificationProof` (deliveredAt + readAt do WhatsApp).
- **FR-013**: O sistema MUST persistir TODA comunicação (inbound e outbound) em tabela `communications` com canal, direção, status, timestamps (sent/delivered/read), `externalMessageId` (wamid), `agentId` que enviou.
- **FR-014**: Cliente que respondeu "PARAR" 1 vez MUST ser marcado opt-out permanente para WhatsApp. Toda outbound futura para esse número (mesmo template aprovado) MUST ser bloqueada pela Júlia.
- **FR-015**: O sistema MUST suportar rotação automática do `access_token` da Meta (cron a cada 45 dias renova long-lived). Se token expirar, alertar admin do tenant.

### Defesa Multi-Tenant em Profundidade (belt-and-suspenders)

- **FR-016**: Todas as 6 tabelas novas MUST ter Postgres Row-Level Security (RLS) habilitada com policy `provider_id = current_setting('app.current_provider_id')::int`. Mesmo se aplicação esquecer o filtro WHERE, banco bloqueia em nível físico.
- **FR-017**: Middleware Express MUST executar `SET LOCAL app.current_provider_id = ${req.session.providerId}` no início de cada transaction autenticada. Sessões sem `providerId` bloqueiam acesso a tabelas com RLS.
- **FR-018**: Lint customizado MUST falhar build se query em `server/storage/*.ts` para tabela multi-tenant for executada sem `.where(eq(table.providerId, ...))` explícito ou helper `withTenantContext()` aplicado.
- **FR-019**: Audit log MUST conter telemetria de cross-tenant access pattern: alerta admin do Provedor.ai se um usuário do tenant A consulta resourceIds que pertencem ao tenant B (mesmo que retorne vazio por RLS — tentativa é sinal de bug ou intenção maliciosa).

### Key Entities

- **Communications**: tabela existente após esta spec. Cada mensagem inbound/outbound persistida. Schema em `drafts/schemas-drizzle.ts`.
- **AuditLog**: tabela imutável via trigger. Append-only. Schema em drafts. Trigger `raise_immutability_error()`.
- **AgentMemory**: memória persistente Helena (e futuros agentes). Schema em drafts.
- **ComplianceCheck**: cada validação Júlia. Schema em drafts.
- **WhatsappAccount**: configuração Meta por tenant (1:1 com providers). Schema em drafts.
- **Junções com schema atual**:
  - `customers` (existente) — Helena identifica cliente por phone
  - `providers` (existente) — multi-tenant
  - `erp_integrations` (existente) — Helena consulta ERP via connector apropriado

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Cliente envia mensagem WhatsApp e recebe resposta da Helena em <30s em 95% dos casos (medido em ambiente de teste com mock de ERP).
- **SC-002**: Júlia valida outbound em <500ms em 95% dos casos (Haiku 4.5 + prompt caching).
- **SC-003**: Júlia bloqueia 100% das outbound fora de horário CDC (08:00-22:00 dia útil, 09:00-13:00 sábado, bloqueio total domingo/feriado).
- **SC-004**: Júlia bloqueia 100% das outbound com termos vexatórios óbvios (ameaças, exposição, urgência falsa) — medido em suite de 50 casos de teste.
- **SC-005**: Helena resolve autonomamente ≥75% das mensagens inbound sem precisar escalar (medido após 30 dias em Vertical Fibra piloto).
- **SC-006**: Zero erros de informação financeira (valor errado, data errada) — Helena SEMPRE consulta tool, nunca inventa. Auditoria mensal verifica.
- **SC-007**: Audit log contém prova de entrega (delivered + read do WhatsApp) para 100% das outbound enviadas.
- **SC-008**: Custo combinado Júlia + Helena para tenant médio (2k assinantes, ~80 inbound/dia, ~150 compliance checks/dia) ≤ R$ 435/mês (R$ 95 Júlia + R$ 340 Helena conforme estimativas TEAM.md).
- **SC-009**: Cliente que respondeu "PARAR" não recebe NENHUMA mensagem subsequente (100% enforcement).

## Assumptions

- Os 4 agents de pesquisa entregaram briefs completos (em `drafts/`): schemas Drizzle, WhatsApp Cloud API operating manual, Júlia + Helena prompts, Anthropic Managed Agents vs Direct API patterns.
- Stack atual (Drizzle + Express + Postgres direto) é mantido — Caminho B.
- Júlia e Helena rodam via **Direct API** (não Managed Agents) por causa de latência crítica e prompt caching.
- Esta spec adiciona 6 tabelas novas — **autorização para modificar `shared/schema.ts` é parte do escopo desta spec**. Migração será atômica em 1 PR com triggers.
- ERP connector usado nesta spec é IXC (já validado em produção). Outros conectores ficam para spec futura.
- Vertical Fibra é o tenant piloto inicial. Onboarding WhatsApp será manual (Embedded Signup OAuth) na primeira execução.
- Custo Meta WhatsApp Cloud API é negligenciável (~R$ 7/mês para 2k assinantes per cálculo Agent B).

## Dependencies

- Conta Meta Business com app Meta criado (App ID, App Secret, Embedded Signup configurado).
- Tenant Meta verificado (necessário para subir nível de mensagens).
- API key Anthropic com acesso ao Claude Haiku 4.5 e Sonnet 4.6.
- Tabela `customers` atual com `phone` populado (cliente Vertical Fibra já tem).
- ERP IXC integrado com o tenant (já validado, 6331 inadimplentes em 256ms per memória).
- Migrations rodando (`npm run db:push` ou `db:migrate`).
- Variáveis de ambiente novas: `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_REDIRECT_URI`, `ENCRYPTION_MASTER_KEY` (32 bytes para AES-256-GCM), `ANTHROPIC_API_KEY`.

## Artifacts Disponíveis (preparados em paralelo)

Esta spec foi preparada com **4 agents trabalhando em paralelo** para acelerar o desenvolvimento. Outputs salvos:

- **`drafts/schemas-drizzle.ts`** — 6 tabelas novas em sintaxe Drizzle, prontas para colar em `shared/schema.ts` (autorização pendente).
- **`drafts/whatsapp-cloud-api-brief.md`** — manual operacional completo da Meta WhatsApp Cloud API: Embedded Signup, envio de templates/text/interactive, webhook signature validation, janela 24h, anti-banimento, custos Brasil. Salvo em arquivo de output do agent.
- **`drafts/anthropic-agents-integration.md`** — integração com plataforma Anthropic: Managed Agents vs Direct API decision matrix, tool-use loop pattern, prompt caching (60-90% redução custo), memory management, compliance gate pattern, versionamento, observabilidade. Salvo em arquivo de output do agent.
- **`/server/prompts/julia.md`** — Júlia system prompt completo com frontmatter, validação 4-camadas, casos de bloqueio, output JSON, tools, KPIs. **Pronto para copiar na UI Anthropic ou usar via Direct API.**
- **`/server/prompts/helena.md`** — Helena system prompt completo com frontmatter, fluxo conversacional 8-turnos, memória persistente, escalações, situações críticas, exemplos de resposta. **Pronto para usar.**
