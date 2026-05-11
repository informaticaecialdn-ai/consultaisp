---
description: "Spec 005 — Integração incremental com Anthropic Platform (Memory Tool + MCP), mantendo Messages API como runtime canônico"
status: draft
created: 2026-05-11
---

# Spec 005 — Anthropic Platform Integration

## Resumo executivo

Spec 005 é uma **integração incremental** (não migração) com componentes da plataforma Anthropic que agregam valor sem mover Bruno/Sofia/Helena/Júlia para fora do Messages API. A premissa inicial de "migrar tudo pra Managed Agents" foi descartada após pesquisa: as próprias docs da Anthropic recomendam Messages API para "custom agent loops and fine-grained control" — exatamente o caso dos 10 funcionários digitais do Provedor.ai.

**Escopo desta spec:**

1. **Adotar Memory Tool** (`memory_20250818`) substituindo a tabela `agent_memories` custom da Spec 003 — client-side, ZDR-eligible, mesmas operações com menos código de manutenção.
2. **Expor conectores ERP como MCP server** (`@modelcontextprotocol/sdk`) — permite que agentes externos (Claude Desktop do owner, agentes futuros via Managed Agents) consumam IXC/MK/SGP/Hubsoft/Voalle/RBX sem duplicar lógica.
3. **Solicitar ZDR + DPA Anthropic** para conformidade LGPD do Provedor.ai (operador-suboperador, transferência internacional Art. 33).

**Fora de escopo (decisões explícitas):**

- ❌ **Não migrar Bruno/Sofia/Helena/Júlia para Managed Agents** — produto errado (designed para coding tasks long-running em container Linux, com fee de $0.08/session-hour).
- ❌ **Não adotar PDF Skill para dossiê** — Skills NÃO são ZDR-eligible; CPF/valor de cliente sairiam da nossa custódia para Anthropic. Mantém pdfkit local.
- ❌ **Não sincronizar prompts para Console** — git é canônico, Console não tem API estável de sync; podemos usar Console pra eval ad-hoc mas não como source-of-truth.
- ❌ **Não usar Agent Skills, Files API, Code Execution containers** — todos non-ZDR.

## Contexto

Após decisão arquitetural Caminho B (2026-05-11), o stack canônico do Provedor.ai é Drizzle + Express + Postgres direto. Spec 003 + 004 entregaram Bruno + Sofia + Júlia + Helena rodando via Direct API (Messages API) com loop de tool-use custom.

Durante avaliação de "ir tudo pra plataforma Anthropic", pesquisa profunda revelou:

1. **`platform.claude.com/workspaces/default/agents`** = UI do Console para gerenciar prompts/agentes Workbench, NÃO um runtime alternativo.
2. **Managed Agents** = produto separado para tarefas autônomas long-running (coding, research) com container Linux. **Não cabe** para Bruno (1 LLM call + 1 tool, ~3s).
3. **A plataforma agrega VALOR REAL em 2 áreas:**
   - **Memory Tool**: substitui a tabela `agent_memories` com API oficial Anthropic, client-side (você controla onde persiste), ZDR-eligible. Mesma semântica, menos código.
   - **MCP**: protocolo aberto para expor tools — útil para fazer ERP connectors consumíveis por agentes externos sem duplicação.

## User Stories

### US1 (P1) — Memory Tool substitui `agent_memories`

**Como:** desenvolvedor mantendo Helena/Bruno/Sofia/Júlia
**Quero:** usar Memory Tool oficial (`memory_20250818`) em vez de carregar/salvar manualmente em `agent_memories`
**Porque:**
- ZDR-eligible (oficialmente garantido nas docs Anthropic).
- Anthropic mantém a interface — quando lançarem melhorias (semantic search, summarization automática), recebo de graça.
- Reduz ~200 LOC de código custom de mem load/save/extract/compact.
- Cliente-side: ainda armazeno em Postgres (mantém LGPD + audit), mas via interface padronizada.

**Independent test:** Helena conversa 5x com o mesmo cliente, cada vez consultando memória via Memory Tool. `/memories/{customerId}/facts.md` é criado e atualizado. Reinício do worker mantém persistência. Spec 003 testes E2E continuam passando.

**Trade-off:** preciso implementar backend Memory Tool (subclassar `betaMemoryTool` no TS SDK) que mapeia comandos (view/create/str_replace/insert/delete/rename) para INSERT/UPDATE em uma nova tabela `agent_memory_files` (substitui `agent_memories` ou coexiste por migração).

### US2 (P2) — ERP connectors expostos como MCP server

**Como:** owner / arquiteto
**Quero:** ERP connectors (IXC/MK/SGP/Hubsoft/Voalle/RBX) acessíveis via MCP, hospedados na VPS Hostinger em `https://provedor.ai/mcp/erp`
**Porque:**
- Permite que **futuros agentes Managed** (Daniel, Marcos quando vierem) consumam ERPs sem reimplementar.
- Permite que **eu** use Claude Desktop com o MCP server pra fazer queries operacionais ad-hoc (ex: "quantos inadimplentes >R$500 no IXC do Vertical Fibra?").
- Padroniza interface para qualquer ferramenta MCP-compatível (Cursor, Replit, etc).
- Open source, não cria lock-in.

**Independent test:** rodar `npx @modelcontextprotocol/inspector` apontando para `https://provedor.ai/mcp/erp` autenticado com token de provider Vertical Fibra. Listar tools (`erp_list_delinquents`, `erp_get_customer`). Executar `erp_list_delinquents` retorna mesma lista que o painel atual.

**Multi-tenant pattern (spec MCP 2025-06-18):** OAuth 2.1 + PKCE, claim `provider_id` validada server-side, NUNCA argumento da tool (spoofable pelo modelo).

### US3 (P2) — ZDR + DPA Anthropic para LGPD

**Como:** Provedor.ai (controlador LGPD)
**Quero:** contrato Enterprise Anthropic com ZDR ativado + DPA assinado
**Porque:**
- Sem ZDR, conversas Bruno/Sofia (incluindo CPF, valor, telefone do cliente final) ficam em logs Anthropic até 30 dias.
- LGPD Art. 33 exige cláusula de transferência internacional — DPA Anthropic cobre via SCC (Standard Contractual Clauses GDPR, aceito por equivalência material LGPD).
- Defensor jurídico: na hora de defender em Procon/MP, posso provar "dados não foram retidos pela Anthropic".

**Independent test:** contrato Enterprise ativo no Console, ZDR confirmado em settings, DPA assinado em PDF, política de privacidade Provedor.ai atualizada listando Anthropic como suboperador (com SCC referenciada).

## Success Criteria

- **SC-001 (Memory Tool):** Helena/Bruno/Sofia/Júlia chamam Memory Tool em vez de `memStorage.appendFact/addPromise/save`. `agent_memories` table deprecada (mantida por 90 dias durante migração, removida no Spec 008+).
- **SC-002 (Migration zero-downtime):** existe migração que copia dados de `agent_memories` para `agent_memory_files` (1 arquivo por (customerId, agentId)). Helena/Bruno/Sofia continuam funcionando durante migração.
- **SC-003 (MCP server local):** `https://provedor.ai/mcp/erp` autentica via OAuth 2.1 + retorna lista de tools dos 6 ERPs. Inspector valida.
- **SC-004 (MCP multi-tenant):** owner de provider A NÃO consegue chamar `erp_list_delinquents` com provider_id de B (validação por claim).
- **SC-005 (ZDR):** contrato Enterprise Anthropic ativo. Console mostra ZDR enabled. DPA assinado em pasta `docs/legal/`.
- **SC-006 (LGPD docs):** política de privacidade Provedor.ai atualizada + cláusula contrato ISP↔Provedor.ai listando Anthropic como suboperador + manual interno descrevendo fluxo de PII.
- **SC-007 (Regressão zero):** todos testes Spec 003 + 004 continuam passando após migração Memory Tool.

## Non-functional Requirements

- **Latência:** Memory Tool adiciona ≤1 round-trip por turn quando Claude decide ler memória. Cache hit-rate deve manter ≥80% no system prompt.
- **Custo:** Memory Tool não tem fee adicional (client-side). MCP server consome banda VPS — estimativa <100MB/mês por provider em produção.
- **Segurança MCP:** OAuth 2.1 obrigatório, audiência (RFC 8707) validada, tokens nunca passados para upstream (Asaas/IXC) — confused-deputy explicitamente proibido pelo spec MCP.
- **Compliance:** todos os fluxos novos seguem isolamento por providerId. MCP audit logs (quem chamou qual tool, quando) vão pra `audit_logs` existente.

## Riscos

| Risco | Mitigação |
|---|---|
| Memory Tool muda interface durante beta | Beta header é `memory_20250818` (estável desde ago/2025); minha implementação backend isola mudanças. |
| OAuth 2.1 + PKCE no MCP é complexo | Usar `@modelcontextprotocol/sdk` que já implementa. Pattern documentado nos exemplos oficiais. |
| ZDR exige Enterprise (custo) | Cotar com sales@anthropic.com. Se custo proibitivo, plano B: mascarar PII em todos prompts (enviar último 4 dígitos CPF + hash) → reduz exposição mesmo sem ZDR. |
| Migração `agent_memories` → Memory Tool quebra Helena/Júlia | Side-by-side por 30 dias. Helena pode ler de ambos (Memory Tool primário, agent_memories fallback) durante transição. |
| Performance MCP HTTP overhead | Hospedar MCP server na mesma VPS dos workers — latência LAN. Se Anthropic agents externos usam, accept ~100ms overhead. |

## Phases (preview — detalhar no plan.md)

- **Phase 1**: Memory Tool backend (3 dias) — handler subclass, schema migration, Helena+Bruno+Sofia+Júlia migrados.
- **Phase 2**: MCP server ERP (4 dias) — `server/mcp/erp-server.ts`, OAuth 2.1 + PKCE, deploy VPS, inspector validation.
- **Phase 3**: ZDR + DPA + LGPD docs (operacional, 1-3 semanas calendário) — cotação sales, assinatura, atualização contratos.
- **Phase 4**: Regressão completa + deprecação `agent_memories` (2 dias).

## Dependências

- Spec 003 (Júlia/Helena) e Spec 004 (Bruno/Sofia/webhook) **devem estar em produção** e validados antes desta spec iniciar.
- US3 Painel da Spec 004 não é bloqueante — pode rodar em paralelo.
- ZDR depende de contrato Enterprise — pode ser bloqueado por orçamento/legal do Provedor.ai.

## Decisões arquiteturais registradas

1. **Não usar Managed Agents para Bruno/Sofia/Helena/Júlia**: produto é para coding/research agents long-running, não cabe no perfil "1 LLM call + 1 tool".
2. **Memory Tool em vez de agent_memories**: API oficial + ZDR > código custom (decisão revertida da Spec 003 que autorizou agent_memories).
3. **MCP só para ERPs**: ferramentas core de domínio (Asaas, Compliance Júlia, audit_logs) permanecem como funções TS inline — mais rápido, sem overhead OAuth, e Júlia é gate determinístico (não cabe em MCP).
4. **pdfkit local mantido**: dossiê tem CPF/PII; Skills não são ZDR → não compensa o trade-off.
5. **Console Anthropic = observação ad-hoc, NÃO source-of-truth**: git mantém autoridade sobre prompts.

## Referências

- [Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)
- [Memory Tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [API and Data Retention (ZDR)](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
- [Data Residency](https://platform.claude.com/docs/en/manage-claude/data-residency)
- [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [MCP Specification 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Anthropic Trust Center](https://trust.anthropic.com/) — SOC2, ISO27001, sub-processadores
