---
description: "Spec 005 — pesquisa profunda sobre Anthropic Platform components, com fontes verificadas"
created: 2026-05-11
sources: docs.claude.com (oficial) + modelcontextprotocol.io
---

# Research — Anthropic Platform Integration

## Sumário das descobertas

Pesquisa via docs oficiais Anthropic (platform.claude.com/docs) e MCP spec (modelcontextprotocol.io). Todas as conclusões abaixo são verificáveis nas URLs ao final de cada seção.

### Decisão crítica: NÃO migrar para Managed Agents

A documentação oficial ([overview](https://platform.claude.com/docs/en/managed-agents/overview)) é explícita:

> "Anthropic offers two ways to build with Claude:
> - **Messages API**: Best for custom agent loops and fine-grained control
> - **Claude Managed Agents**: Best for long-running tasks and asynchronous work"

Managed Agents é um **harness com container Linux** (bash, file ops, code execution, web search) cobrado a:
- Tokens consumidos (mesmas tabelas)
- **+ $0.08/session-hour** enquanto status = `running`

Bruno/Sofia/Helena/Júlia são chamadas LLM de 1-8 turnos com tools custom de negócio (Pix, ERP, Asaas) — **fundamentalmente Messages API**.

## 1. Managed Agents — quando faz sentido (futuro)

Beta header: `managed-agents-2026-04-01` (público).

**Conceitos:**
- **Agent**: model + system prompt + tools + skills + MCP servers (versionado, `agent_id` + `version`)
- **Environment**: container template (packages, networking)
- **Session**: instância rodando, com filesystem persistente
- **Events**: streaming SSE bidirecional

**Quando usar no Provedor.ai (futuro):**
- **Daniel** (recuperação extrajudicial) precisa Computer Use no portal e-Notariado/cartório → Managed Agent
- **Marcos** se evoluir para research agent autônomo (mercado, taxa SELIC, regulação)
- Análises noturnas longas (varredura de fraude cross-tenant, batch ML)

**Quando NÃO usar (Bruno/Sofia/Helena/Júlia):**
- Tarefa dura segundos, não horas
- Tools são de negócio (Pix/Asaas), não bash/code execution
- Pagar $0.08/session-hour por algo que roda 3s é desperdício

Sources: [overview](https://platform.claude.com/docs/en/managed-agents/overview) · [quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart) · [pricing](https://platform.claude.com/docs/en/about-claude/pricing)

## 2. Memory Tool (`memory_20250818`) — adotar

Beta header. **Client-side** — Anthropic não armazena nada, você implementa o backend.

**Comandos:**
- `view` (dir listing ou file content)
- `create` (novo arquivo)
- `str_replace` (substituição exata)
- `insert` (inserir em linha específica)
- `delete` (file ou dir)
- `rename` (move)

**Diretório fixo:** `/memories` (path traversal protection obrigatório).

**Cliente TS:**
```typescript
import { betaMemoryTool } from "@anthropic-ai/sdk";
// Subclassa para implementar backend custom (Postgres no nosso caso)
```

**Trade-off vs `agent_memories` atual:**

| Aspecto | `agent_memories` (Spec 003) | Memory Tool |
|---|---|---|
| Interface | Custom TS (addPromise, addFact, addSentiment, save, load, compactSummary) | API Anthropic (view/create/str_replace/insert/delete/rename) |
| Persistência | Postgres tabela `agent_memories` | Você escolhe (Postgres, Redis, S3, FS) |
| ZDR | N/A (não passa por Anthropic) | ✅ Eligível |
| Schema | Estruturado (facts JSONB, promises JSONB, sentimentHistory JSONB, summary text) | Markdown files (Claude decide estrutura) |
| Multi-tenant | Implementado via customers.providerId | Eu implemento via path prefix (`/memories/provider-{providerId}/customer-{customerId}/...`) |
| Summarization | Custom `compactSummary` (chama LLM extra) | Claude decide quando reorganizar (mais natural) |
| Manutenção | ~200 LOC + 1 tabela | ~80 LOC (handler) + 1 tabela `agent_memory_files` |

**Padrão de implementação recomendado pelas docs ("Multi-session software development pattern"):**

Cada agent-session começa com `view /memories` para descobrir contexto, lê arquivos relevantes, atualiza-os ao longo da conversa. Esse comportamento é injetado automaticamente no system prompt quando o tool é registrado.

Source: [Memory Tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)

## 3. MCP (Model Context Protocol) — adotar para ERPs

**Spec:** 2025-06-18 (JSON-RPC 2.0 over Streamable HTTP ou STDIO)
**SDK TS:** `@modelcontextprotocol/sdk` (mature, 97M downloads/mês)
**Adoção:** Claude, OpenAI, Google, Microsoft, AWS — protocolo universal

**Transport recomendado para servers hospedados:** Streamable HTTP (não SSE legado).

**Auth obrigatório (spec):**
- OAuth 2.1 + PKCE
- Dynamic Client Registration (RFC 7591) opcional
- Protected Resource Metadata (RFC 9728)
- `resource` parameter (RFC 8707) — binding de audiência
- Bearer no `Authorization` header

**Multi-tenant pattern:**
- Token OAuth por provider, claim `provider_id` no JWT
- Server-side: extrai claim → injeta em todas queries Drizzle
- **NUNCA confiar em argumento da tool** (o modelo pode hallucinate `provider_id`)
- Spec explicitamente proíbe **token passthrough** (confused-deputy attack)

**Arquitetura sugerida para Provedor.ai:**

```
[Claude Desktop / Cursor / Managed Agent]
     ↓ HTTPS + OAuth 2.1 (Authorization: Bearer ...)
[provedor.ai/mcp/erp]  (servidor MCP novo, server/mcp/erp-server.ts)
     ↓ extrai provider_id do JWT claim
[server/erp-connector.ts registry]  (reusa código existente)
     ↓
[IXC / MK / SGP / Hubsoft / Voalle / RBX APIs]
```

**Tools expostas:**
- `erp_list_delinquents` (filtros: minValue, daysOverdue, limit, offset)
- `erp_get_customer` (cpfCnpj)
- `erp_get_invoices` (customerId, status, dateRange)
- `erp_sync_test` (verifica conectividade)

**Custo Anthropic:** zero (MCP é open-source, Anthropic só faz a invocação). VPS Hostinger banda <100MB/mês por provider.

**Não-elegibilidade ZDR do MCP connector:** quando Anthropic chama meu MCP server, ela registra o conteúdo da chamada nos logs operacionais (30 dias). Mitigação: para queries com PII (cpfCnpj), aplicar mascaramento OU usar MCP só para queries agregadas (ex: contar inadimplentes, somar valores) que não retornam PII.

Sources: [MCP spec](https://modelcontextprotocol.io/specification/2025-06-18) · [TS SDK](https://github.com/modelcontextprotocol/typescript-sdk) · [Anthropic MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)

## 4. Agent Skills — NÃO adotar (LGPD risk)

Skills oficiais: pptx, xlsx, docx, pdf, claude-api, skill-creator.
Custom Skills: upload via `/v1/skills` API.

**Por que NÃO adotar pra dossiê Procon:**

A doc é categórica: ["Agent Skills is not covered by ZDR arrangements. Skill definitions and execution data are retained according to Anthropic's standard data retention policy."](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview#data-retention)

Dossiê tem CPF, valor, telefone, histórico de comunicações do cliente final. Enviar isso ao PDF Skill = enviar PII para Anthropic com retenção. Risco LGPD não compensa a economia de código vs `pdfkit` local.

**Quando usar Skills (futuro):**
- Casos sem PII — ex: gerar relatório consolidado de mercado (Marcos), tutorial de uso (Pedro/Vendas), análises agregadas.
- Skill custom para padronizar saída interna (logos, footers).

**Requer 3 beta headers + Files API:**
- `code-execution-2025-08-25`
- `skills-2025-10-02`
- `files-api-2025-04-14`

**Runtime constraints (API):**
- Sem network access
- Sem package install em runtime
- Só deps pré-configurados

Source: [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)

## 5. Pricing concreto (verificado May 2026)

[Pricing page](https://platform.claude.com/docs/en/about-claude/pricing):

| Modelo | Input | Output | Cache 5m write | Cache hit |
|---|---|---|---|---|
| Haiku 4.5 | $1/MTok | $5/MTok | $1.25/MTok | $0.10/MTok |
| Sonnet 4.6 | $3/MTok | $15/MTok | $3.75/MTok | $0.30/MTok |
| Opus 4.7 | $5/MTok | $25/MTok | $6.25/MTok | $0.50/MTok |

**Multiplicadores:**
- Cache 1h write: 2x
- Cache hit: 0.1x (90% desconto)
- Batch API: 0.5x (50% desconto, async ≤24h)
- Data residency US-only: 1.1x (Opus 4.6+)

**Managed Agents extras:**
- $0.08/session-hour (running only) — substitui code execution container-hour
- Batch/Fast mode/Data residency NÃO aplicam dentro de sessions

**Tools extras:**
- Web search: $10/1000 searches
- Web fetch: $0 (só tokens do content)
- Code execution standalone: $0.05/container-hour, 1550h grátis/mês/org
- Computer use: tokens + tool overhead 466-499 tokens system prompt
- Memory tool: $0 (client-side)
- MCP connector: $0 (você hospeda o server)

**Worked example Bruno (Haiku 4.5, prompt-cached system 70%, 1.2k input + 300 output):**
- Input fresco: 360 × $1/1M = $0.00036
- Input cached: 840 × $0.10/1M = $0.0000840
- Output: 300 × $5/1M = $0.0015
- **Total por run: ~$0.002**
- 140 runs/dia/tenant × 30 dias = **$8.40/mês/tenant** ✓ alinhado com contrato Bruno

Sources: [pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [data residency pricing](https://platform.claude.com/docs/en/manage-claude/data-residency#pricing)

## 6. ZDR + LGPD

[API and Data Retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention):

**ZDR-eligible (sem retenção pós-response):**
- ✅ Messages API + Token Counting
- ✅ Web search, Web fetch (com qualificação)
- ✅ Memory Tool, Context management, Context editing
- ✅ Fast mode, 1M context, Adaptive thinking, Citations
- ✅ Data residency, Effort, Extended thinking
- ✅ PDF support (inline), Search results
- ✅ Bash, Text editor, Computer use (client-side tools)
- ✅ Structured outputs (qualificado — schemas cacheados 24h, sem PHI)
- ✅ Prompt caching (qualificado — KV cache TTL)

**NÃO ZDR-eligible:**
- ❌ Agent Skills (retenção padrão)
- ❌ MCP connector (retenção padrão)
- ❌ Files API (até deleção explícita)
- ❌ Code execution (30 dias)
- ❌ Batch API (29 dias)
- ❌ Programmatic tool calling (30 dias)
- ❌ Console, Workbench (sempre retém)
- ❌ Claude Managed Agents (stateful, deleção manual)

**Como ativar ZDR:** contato sales@anthropic.com, contrato Enterprise. Não é autoserviço.

**Excepções por lei/abuso:** Anthropic pode reter até 2 anos se sessão for flagged para violação de Usage Policy ou exigência legal.

**HIPAA readiness:** alternativa a ZDR pra PHI, requer BAA. Provedor.ai não precisa (LGPD ≠ HIPAA).

**Data residency:**
- `inference_geo`: `"global"` (default) ou `"us"` (premium 1.1x). EU virá depois.
- `workspace_geo`: apenas `"us"` no momento. Não há Brasil/EU para data at rest.
- Latência BR→US: ~110-200ms RTT (aceitável para outbound async).

**Sub-processadores Anthropic:** AWS (principal), GCP (Vertex), Cloudflare (edge). Lista canônica em [trust.anthropic.com](https://trust.anthropic.com).

**Certificações documentadas:** SOC 2 Type II, ISO 27001, HIPAA-ready (com BAA), GDPR (DPA disponível).

**LGPD aplicação prática (operador-suboperador):**
- Provedor.ai = controlador
- Anthropic = operador (Art. 5º VII)
- Cliente provedor (ISP) = co-controlador
- Cliente final (assinante) = titular
- Art. 33 LGPD (transferência internacional): coberto via SCC do DPA Anthropic + base legal Art. 7º V (execução contrato) e IX (legítimo interesse cobrança)
- Política de privacidade do Provedor.ai DEVE listar Anthropic + sub-processadores + cláusula transferência internacional

**Mitigação adicional (defesa em profundidade):**
- Mascarar PII em prompts quando possível (CPF: últimos 4 dígitos + hash; nome: primeiro nome só)
- Não enviar telefone se não estritamente necessário
- Para queries agregadas (analytics, métricas), mascarar agressivamente

Source: [API and Data Retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) · [Data Residency](https://platform.claude.com/docs/en/manage-claude/data-residency)

## 7. Comparação consolidada vs implementação atual

| Capability | Spec 003+004 atual | Plataforma opção | Recomendação |
|---|---|---|---|
| LLM call Bruno/Sofia/Júlia/Helena | Messages API + tool loop custom | Messages API ✓ (mesma) ou Managed Agents (wrong fit) | **Mantém Messages API** |
| Persistência memória agent | `agent_memories` tabela + ~200 LOC | Memory Tool (client-side, ZDR) | **Migrar para Memory Tool** |
| Audit immutable | `audit_logs` + triggers Postgres | N/A oficial | **Manter custom** (defesa Procon) |
| Compliance Júlia (Anatel/CDC/LGPD) | Layers TS + LLM Haiku | N/A oficial | **Manter custom** |
| Tools de negócio (Asaas, Pix) | Funções TS inline | MCP server externo | **Manter inline** (latência + DX) |
| ERP connectors (6 ERPs) | Funções TS inline + registry | MCP server externo | **Expor como MCP** (US2) |
| Dossiê PDF (12 meses) | pdfkit local | PDF Skill (NÃO ZDR) | **Manter pdfkit** |
| Prompts | Git `server/prompts/*.md` | Console UI versionamento | **Git canônico** |
| Logging/tracing | pino + audit_logs | Console traces (retém) | **Custom + Console ad-hoc** |
| Evals | nenhum (lacuna real) | Console + Workbench | **Adotar gradualmente** (futuro) |
| Long-running agent (Daniel futuro) | N/A | Managed Agents + Computer Use | **Spec 007+ quando vier** |

## 8. Trade-offs LGPD em uma frase

**Sem ZDR:** Bruno envia CPF "12345678901" para Anthropic. Anthropic retém 30 dias em logs operacionais (não usa para treino, mas existe). Em caso de breach Anthropic, CPF do cliente final do ISP fica exposto.

**Com ZDR:** Mesma requisição, mesma resposta — mas Anthropic não retém. Logs apenas em memória durante processing.

**ZDR + mascaramento:** Bruno envia CPF "***.789-01" + `customerToken: "tk_abc123"` (hash determinístico do CPF). Anthropic vê só dados parciais. Provedor.ai resolve `tk_abc123` → CPF real localmente quando precisa. Defesa máxima.

## Conclusão

Spec 005 é uma **refinement layer** sobre Spec 003+004, não migração. Os 3 movimentos (Memory Tool + MCP + ZDR) trazem ganhos concretos sem destruir o que está construído:

- Memory Tool: **menos 200 LOC, oficialmente ZDR**, interface evolutiva com Anthropic
- MCP: **ERPs reusáveis** por agentes futuros + Claude Desktop + ferramentas externas
- ZDR + LGPD: **defesa jurídica completa** (DPA, SCC, política privacidade, sub-processadores)

Os 10 funcionários digitais continuam vivendo no Messages API + Postgres + Express — o caminho oficial recomendado pela própria Anthropic para "custom agent loops".
