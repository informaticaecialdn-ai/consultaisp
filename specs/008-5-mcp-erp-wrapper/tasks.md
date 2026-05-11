# Tasks — Spec 008.5 MCP ERP Wrapper (v2)

4 batches sequenciais. Cada batch valida `npm run check` antes de seguir.

---

## Batch 0 — Status pré-requisitos

- [x] **Autorização de schema** — owner aprovou `mcp_bearer_tokens` (formato simplificado vs draft v1) ✅
- [x] **Dependência:** `@modelcontextprotocol/sdk` instalada ✅
- [x] **`jose` desinstalada** (não precisa JWT) ✅
- [x] **`server/env.ts`** com `getMcpBaseUrl()` + `isMcpEnabled()` ✅
- [x] **`server/mcp/types.ts`** com auth model bearer (não OAuth) ✅
- [x] **Schema `mcpBearerTokens`** em `shared/schema.ts` ✅
- [ ] **Migration:** `npm run db:push` quando dev/prod tiver DATABASE_URL configurada

---

## Batch 1 — Bearer auth foundation (1 dia)

- [ ] B1.1 — `server/mcp/bearer-auth.ts`:
  - `generateBearerToken()` → `{ token: "mcp_xxxxxxxxxxxxxxxx...", prefix: "mcp_xxxxxxxx" }` (32 chars random hex após prefix)
  - `hashBearer(token)` / `verifyBearer(token, hash)` — reusa scrypt de `server/password.ts`
- [ ] B1.2 — `server/mcp/auth-middleware.ts`:
  - `requireMcpAuth` middleware Express que:
    1. Extrai `Authorization: Bearer xxx` (case-insensitive)
    2. Reject se ausente ou não começa com `mcp_` → 401
    3. Extrai prefix → busca em `mcpBearerTokens WHERE tokenPrefix = ? AND revokedAt IS NULL`
    4. Verify scrypt hash → resolve `McpAuthContext` ou 401
    5. UPDATE lastUsedAt = NOW()
    6. Inject em `req.mcpAuth`
  - Test unitário básico
- [ ] B1.3 — Helper SQL pra criar token de teste:
  ```sql
  INSERT INTO mcp_bearer_tokens (provider_id, token_hash, token_prefix, name, allowed_scopes, created_by_user_id)
  VALUES (1, '<scrypt hash>', 'mcp_dev0test', 'Dev test token', '{read,read_pii}', 1);
  ```

**Checkpoint:** middleware funcional via curl manual com token gerado por SQL.

---

## Batch 2 — Tool implementations (1-2 dias)

- [ ] B2.1 — `server/mcp/tools/pii-masking.ts`:
  - `maskCpf(cpf)` → "***.***.789-01"
  - `maskName(name)` → "João ***"
  - `maskPhone(phone)` → "+55 11 **** -1234"
  - `maskAddress(addr)` → cidade/estado apenas
- [ ] B2.2 — `server/mcp/build-config.ts`:
  - `buildConnectorConfig(providerId, erpSource)` busca `erpIntegrations` row e monta `ErpConnectionConfig` (verificar se já existe em `server/services/erp-sync.service.ts` — se sim, reusa)
- [ ] B2.3 — `server/mcp/tools/erp-list-delinquents.ts`:
  - Input schema: `{ erpSource, minValue?, daysOverdue?, limit=50, offset=0 }`
  - Chama `getConnector(source).fetchDelinquents(config)` filtrando por `provider_id`
  - Aplica filtros minValue/daysOverdue em memory
  - Retorna lista mascarada (sempre — agregada, sem detalhes individuais que justifiquem `read_pii`)
- [ ] B2.4 — `server/mcp/tools/erp-get-customer.ts`:
  - Input: `{ erpSource, cpfCnpj, unmasked?: false }`
  - Validação CPF/CNPJ format
  - Multi-tenant gate: cliente precisa estar em `customers` table do tenant
  - PII masking baseado em `hasScope(ctx, 'read_pii') && unmasked === true`
- [ ] B2.5 — `server/mcp/tools/erp-get-invoices.ts`:
  - Lê de `invoices` table local (NÃO chama ERP em tempo real)
  - Filtra por `customer_id` + multi-tenant gate
- [ ] B2.6 — `server/mcp/tools/erp-test-connection.ts`:
  - Wraps `getConnector(source).testConnection(config)`
- [ ] B2.7 — `server/mcp/tools/erp-list-supported.ts`:
  - Query `erpIntegrations WHERE provider_id = ? AND is_enabled = true`
- [ ] B2.8 — `server/mcp/audit.ts`:
  - `logMcpToolCall(ctx, toolName, args, result)` insert em `audit_logs` com `actorType=mcp`, payload completo, `legalBasis=execucao_contrato`

**Checkpoint:** unit/integration test de cada tool com tenant mock. Sem dados sensíveis vazando.

---

## Batch 3 — MCP server setup + routes registration (1 dia)

- [ ] B3.1 — `server/mcp/erp-server.ts`:
  - Instancia `Server` do `@modelcontextprotocol/sdk`
  - Registra as 5 tools com schemas JSON
  - Handlers chamam `server/mcp/tools/*` passando `req.mcpAuth`
  - Exporta `createMcpServer()` factory
- [ ] B3.2 — `server/routes/mcp.routes.ts`:
  - `registerMcpErpRoutes()` retorna router
  - `POST /mcp/erp` handler:
    1. `requireMcpAuth` middleware
    2. `express-rate-limit` por `req.mcpAuth.providerId` (60/min write, 300/min read)
    3. Despacha pra `createMcpServer().handle(req, res)` (Streamable HTTP transport do SDK)
- [ ] B3.3 — `server/routes/index.ts`: importar e montar `registerMcpErpRoutes()` (apenas se `isMcpEnabled()`)
- [ ] B3.4 — Smoke test E2E: MCP Inspector aponta pra `http://localhost:5000/mcp/erp`, lista tools, executa cada uma com bearer dev.

**Checkpoint:** Inspector mostra 5 tools verdes, executa `erp_list_supported` retornando lista do tenant.

---

## Batch 4 — Superadmin UI + docs (1 dia)

- [ ] B4.1 — `server/routes/admin.routes.ts`: 4 endpoints novos (requireSuperAdmin):
  - `GET /api/admin/mcp/tokens?providerId=N` — lista tokens do tenant (sem hash, só prefix + metadata)
  - `POST /api/admin/mcp/tokens` — cria novo token, retorna `{ token, prefix, ... }` UMA VEZ
  - `PATCH /api/admin/mcp/tokens/:id/revoke` — soft delete (set revokedAt)
  - `GET /api/admin/mcp/tokens/stats` — agregados (total ativos, revogados, lastUsed nos últimos 30d)
- [ ] B4.2 — `client/src/components/admin/tabs/ConfiguracoesTab.tsx`: nova seção "MCP Tokens (Anthropic Platform)"
  - Tabela: tenant | nome | prefix | scopes | createdAt | lastUsedAt | status (ativo/revogado) | ações
  - Modal "Novo token" — selecionar tenant, nome, scopes (checkbox read/read_pii)
  - **Após criar:** modal mostra token completo UMA VEZ com botão "Copiei e guardei" + aviso destacado
- [ ] B4.3 — `specs/008-5-mcp-erp-wrapper/INTEGRATION-GUIDE.md`:
  - Como criar Vault na platform.claude.com
  - Como cadastrar credential static_bearer com token Provedor.ai
  - Como vincular vault à session do agent
  - Lista das 5 tools + exemplos de uso
  - Troubleshooting (401, 403, "ERP não configurado", etc.)

**Checkpoint final:** owner cria token via UI Provedor.ai → cadastra na Anthropic platform → agent invoca `erp_list_supported` com sucesso → audit_logs mostra entry.

---

## Critérios de pronto pra commit final

- ✅ `npm run build` passa
- ✅ `npm run check` mantém baseline 112
- ✅ MCP Inspector valida 5 tools com bearer
- ✅ Audit log tem entries com `actorType=mcp`
- ✅ `cuddly-churning-dijkstra.md` plan file marcando 008.5 como completed
- Commit: `feat(spec008.5): MCP ERP wrapper — 5 tools + bearer auth + superadmin UI`

---

## Não faz parte (parking lot)

- Tools de mutation (`erp_create_payment_promise`, `erp_register_agreement`) — virão como Custom HTTP Tools nas Specs 008.6+
- Cache Redis pra bearer hash validation
- OAuth `mcp_oauth` type (apps tipo Slack)
- SSE transport (Streamable HTTP é o canônico Anthropic)
- Deploy Caddy + DNS — owner faz quando estiver pronto
- Métricas Prometheus do servidor MCP
- Webhooks pra invalidar bearer remotamente
