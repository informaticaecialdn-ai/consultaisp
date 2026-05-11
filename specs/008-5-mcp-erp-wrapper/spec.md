# Spec 008.5 — MCP ERP Wrapper

**Status:** Draft v2 (revisada após leitura da doc oficial Anthropic Managed Agents)
**Duração estimada:** 3-4 dias (reduzida de 4-5 — sem OAuth flow)
**Depende de:** Spec 005 contrato (`mcp-erp-server.contract.md`) — ainda válido em estrutura, atualizado em auth
**Bloqueia:** Spec 008.6 (migração 4 agentes), Spec 008 (Bruno+Sofia prod), Spec 009-014 (todos os agentes Managed)

## Mudança crítica vs draft v1

A v1 desenhou OAuth 2.1 + PKCE + JWT signing, baseada em padrão MCP genérico. **Anthropic Platform NÃO consome JWT** — apenas `static_bearer` (token estático no Vault) ou `mcp_oauth` (OAuth 2.0 com refresh, pra apps tipo Slack). Confirmado em `https://platform.claude.com/docs/en/managed-agents/mcp-connector.md` e `vaults.md`.

**Resultado:** auth simplifica DRAMATICAMENTE. ~600 linhas de OAuth + JWT signing eliminadas. Trabalho cai de 4-5 dias pra 3-4.

## Objetivo

Subir servidor **Model Context Protocol (MCP)** que expõe os 10 conectores ERP existentes (`server/erp/connectors/*.ts`) como **tools MCP** via Streamable HTTP transport com auth `static_bearer`. Os 10 agents do Provedor.ai rodam como **Managed Agents na plataforma Anthropic** e precisam acessar dados ERP via MCP — sem este wrapper, nenhum agent funciona em produção.

**Wrap, não rewrite:** zero refactor dos 10 connectors. O servidor MCP usa `getConnector(source).fetchX(config)` exatamente como hoje.

## Workflow operacional (claro com a doc)

```
1. Owner gera token via /admin-sistema (UI nova)
   ↓ token mostrado UMA VEZ: "mcp_a3b9f2..." (32 chars)
2. Owner cria/usa Vault em platform.claude.com/workspaces/{ws}/vaults
3. Owner adiciona credential static_bearer no vault:
     mcp_server_url: https://provedor.ai/mcp/erp
     token: mcp_a3b9f2...
4. Owner cria session do agent (ex: Bruno) com vault_ids: [vaultId]
5. Anthropic chama POST https://provedor.ai/mcp/erp com:
     Authorization: Bearer mcp_a3b9f2...
     Content-Type: application/json
     Body: { jsonrpc: "2.0", method: "tools/call", params: {...} }
6. Nosso servidor:
   a. Extrai bearer
   b. Hash (scrypt) → busca em mcp_bearer_tokens
   c. Resolve providerId
   d. Despacha pra tool handler com providerId no contexto
   e. Tool chama getConnector(source).fetchX(config) filtrado pelo tenant
   f. Retorna resposta JSON-RPC + audit log entry
```

## Stack

- `@modelcontextprotocol/sdk` (oficial Anthropic) — instalado
- Transport: **Streamable HTTP** (MCP spec 2025-06-18, JSON-RPC 2.0)
- Hash de bearer: `crypto.scrypt` (mesmo padrão de `server/password.ts`, sem nova dep)
- Express middleware existente para rate limiting

## URL canônica

```
https://provedor.ai/mcp/erp        # produção (decisão owner futura)
http://localhost:5000/mcp/erp      # dev (default MCP_BASE_URL)
```

## User Stories

**US-001 — Owner cria bearer token pra agent**
Superadmin entra em `/admin-sistema#configuracoes` aba **MCP Tokens**, clica "Novo token", seleciona tenant + nome ("Bruno production agent") + scopes (`read` ou `read,read_pii`). Recebe `mcp_xxxxxxxxxxxx...` (32 chars) **uma vez** com botão "Copiei". Token vai pra credential static_bearer no Vault da Anthropic.

**US-002 — Managed Agent invoca tool MCP**
Agent (criado pelo owner via Claude CoWork) com vault attached chama `erp_list_delinquents({ erpSource: "ixc", limit: 50 })` → MCP server valida bearer (hash scrypt), extrai `provider_id`, chama `getConnector("ixc").fetchDelinquents(buildConnectorConfig(providerId, "ixc"))` → retorna lista mascarada (default).

**US-003 — Agent precisa de PII (consultar cliente específico)**
Agent com scope `read_pii` chama `erp_get_customer({ erpSource, cpfCnpj, unmasked: true })` → retorna CPF/nome/telefone completos. Sem `read_pii` no token, recebe versão mascarada (mesma resposta que sem `unmasked`).

**US-004 — Audit completo cross-tenant**
Cada tool call gera entry em `audit_logs` com `actorType=mcp`, `actorId=token_prefix`, `provider_id` correto, payload completo, base legal LGPD. Superadmin vê tudo (UI futura).

**US-005 — Dev valida com MCP Inspector**
```bash
npx @modelcontextprotocol/inspector \
  --transport streamable-http \
  --url http://localhost:5000/mcp/erp \
  --header "Authorization: Bearer mcp_dev_token..."
```
Inspector lista 5 tools, executa cada uma com payload de teste, valida response shape.

## Critérios de sucesso

- [ ] `mcp_bearer_tokens` table criada via `npm run db:push`
- [ ] `npm run build` passa
- [ ] 5 tools registradas: `erp_list_delinquents`, `erp_get_customer`, `erp_get_invoices`, `erp_test_connection`, `erp_list_supported`
- [ ] Bearer token validation: hash scrypt match + verificar `revokedAt IS NULL`
- [ ] Multi-tenant gate: `providerId` do bearer filtra todas as queries
- [ ] PII masking default em `erp_get_customer`; `unmasked: true` ignorado se token sem `read_pii`
- [ ] Cada tool call gera audit log com `actorType=mcp`
- [ ] Rate limiting: 60 req/min write, 300 req/min read por `providerId`
- [ ] Superadmin tab pra criar/listar/revogar bearer tokens
- [ ] MCP Inspector funcional contra localhost
- [ ] `lastUsedAt` atualizado a cada request bem-sucedido
- [ ] Zero regressões TS (baseline 112)

## Edge cases

- **EC-1:** Bearer ausente → 401 com `WWW-Authenticate: Bearer` header.
- **EC-2:** Bearer mal formatado (não começa com `mcp_`) → 401 sem revelar formato esperado pra atacante.
- **EC-3:** Token revogado (`revokedAt IS NOT NULL`) → 401 "token revogado".
- **EC-4:** Token de outro recurso (alguém testou bearer de outro service) → 401 hash mismatch.
- **EC-5:** Tool name não permitida pelo `allowedTools` do token → 403 "tool não autorizada para este token".
- **EC-6:** ERP source não configurado pro tenant → tool retorna `{ ok: false, message: "ERP não configurado" }`, não erro 500.
- **EC-7:** ERP timeout/erro (IXC fora do ar) → tool retorna `{ ok: false }` graceful.
- **EC-8:** `erp_get_customer` chamado com cpfCnpj de cliente de OUTRO tenant → tool retorna `{ ok: false, message: "cliente não encontrado neste provedor" }` (não vaza existência).

## Schema NOVO — JÁ AUTORIZADO ✅

Owner aprovou em mensagem prévia. Schema simplificado (vs draft v1):

```typescript
mcpBearerTokens: {
  id: serial,
  providerId: integer references providers.id,  // multi-tenant
  tokenHash: text,                              // scrypt salt:key (igual password.ts)
  tokenPrefix: text,                            // "mcp_xxxxxxxx" público (8 chars após "mcp_")
  name: text,                                   // "Bruno production agent · Vertical Fibra"
  allowedScopes: text[] default '{read}',       // ['read'] ou ['read','read_pii']
  allowedTools: text[],                          // null = todas
  createdByUserId: integer references users.id,
  createdAt: timestamp,
  lastUsedAt: timestamp,                         // detecta tokens dormentes
  revokedAt: timestamp,                          // soft delete
}
```

Indexes: `(providerId)`, `(tokenPrefix)`. **Não há unique no token completo** porque ele não está no DB — só o hash.

## Não-objetivos

- Tools de mutation (`erp_create_payment_promise`, `erp_register_agreement`). Mutations virão como **Custom HTTP Tools** (não MCP) na Spec 008.6+, conforme padrão recomendado pela doc Anthropic (leitura via MCP, escrita via Custom HTTP).
- OAuth flow (`mcp_oauth` type) — só faz sentido pra apps com user consent (Slack/GitHub). Não cabe pra B2B SaaS interno.
- Cache Redis pra hash validation — scrypt é caro mas request rate é baixo no MVP.
- Refresh tokens — bearer não expira (revogação manual via UI).
- Authorization Code grant + PKCE — não suportado pela Anthropic Platform pra MCP servers.
- Deploy em produção (Caddy config, DNS) — owner decide quando expor publicamente.
- UI cliente final pra gerar tokens — apenas superadmin gera.

## Referências canônicas

- `specs/005-platform-integration/contracts/mcp-erp-server.contract.md` — contrato base (estrutura tools/audit ainda válida; auth section obsoleta)
- `~/.claude/projects/c--ClaudeCode/memory/reference_anthropic_managed_agents.md` — auth model + lifecycle confirmados
- MCP spec: https://spec.modelcontextprotocol.io/
- Anthropic Vaults (auth para MCP): https://platform.claude.com/docs/en/managed-agents/vaults.md
- Anthropic MCP Connector: https://platform.claude.com/docs/en/managed-agents/mcp-connector.md

## Plano de execução

Ver [tasks.md](./tasks.md). 4 batches sequenciais (reduzido de 5).
