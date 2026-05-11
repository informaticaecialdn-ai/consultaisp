# Contract — MCP Server: ERP Connectors

**Direction:** Inbound (Claude Desktop / Anthropic Managed Agents / MCP clients → Provedor.ai)
**Purpose:** Expor conectores ERP via Model Context Protocol (MCP) com OAuth 2.1 multi-tenant.

## URL canônica

```
https://provedor.ai/mcp/erp
```

Transport: **Streamable HTTP** (não SSE). Spec MCP 2025-06-18, JSON-RPC 2.0.

## Auth — OAuth 2.1 + PKCE

### Discovery

`GET /mcp/erp/.well-known/oauth-protected-resource` (RFC 9728)

Response:
```json
{
  "resource": "https://provedor.ai/mcp/erp",
  "authorization_servers": ["https://provedor.ai/mcp/erp/oauth"],
  "scopes_supported": ["read", "read_pii"]
}
```

### Token endpoint

`POST /mcp/erp/oauth/token`

Authorization Code grant + PKCE obrigatório. Client credentials grant para machine-to-machine.

Request (client credentials):
```http
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id={mcp_client_id}
&client_secret={mcp_client_secret}
&audience=https://provedor.ai/mcp/erp
&scope=read
```

Response 200:
```json
{
  "access_token": "eyJhbGc...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "read"
}
```

JWT claims:
```json
{
  "iss": "https://provedor.ai/mcp/erp/oauth",
  "aud": "https://provedor.ai/mcp/erp",
  "sub": "client_xxx",
  "provider_id": 42,
  "scope": "read",
  "exp": 1746...,
  "iat": 1746...,
  "jti": "uuid"
}
```

### Validation (server middleware)

Cada request MCP exige `Authorization: Bearer <jwt>`:

1. Verificar JWT signature (HS256 ou RS256)
2. **Validar `aud === "https://provedor.ai/mcp/erp"`** (RFC 8707, anti-confused-deputy)
3. Validar `iss`, `exp` não expirado, `jti` não revogado
4. Extrair `provider_id` claim → injetar em ctx
5. Rejeitar se token passou por outro endpoint (token passthrough proibido)

## Tools expostas

### `erp_list_delinquents`

```json
{
  "name": "erp_list_delinquents",
  "description": "Lista inadimplentes de um ERP do provider autenticado",
  "inputSchema": {
    "type": "object",
    "properties": {
      "erpSource": { "type": "string", "enum": ["ixc", "mk", "sgp", "hubsoft", "voalle", "rbx"] },
      "minValue": { "type": "number" },
      "daysOverdue": { "type": "number" },
      "limit": { "type": "integer", "default": 50 },
      "offset": { "type": "integer", "default": 0 }
    },
    "required": ["erpSource"]
  }
}
```

Executor: chama `getConnector(args.erpSource).fetchDelinquents(buildConnectorConfig(provider_id, args.erpSource))`. Filtros aplicados em memory por simplicidade no MVP.

Response: lista de `{ cpfCnpj, name, totalOverdueAmount, maxDaysOverdue, erpSource }`.

### `erp_get_customer`

```json
{
  "name": "erp_get_customer",
  "description": "Recupera cliente por CPF/CNPJ no ERP do provider",
  "inputSchema": {
    "type": "object",
    "properties": {
      "erpSource": { "type": "string", "enum": ["ixc","mk","sgp","hubsoft","voalle","rbx"] },
      "cpfCnpj": { "type": "string" },
      "unmasked": { "type": "boolean", "default": false }
    },
    "required": ["erpSource", "cpfCnpj"]
  }
}
```

**Multi-tenant gate:** valida que o cliente pertence ao `provider_id` antes de retornar.

**PII masking default:**
- CPF: `***.***.{last4}-{check}`
- Nome: primeiro nome + `***`
- Telefone: `+55 11 **** -{last4}`
- Endereço: cidade/estado (sem rua/número)

`unmasked: true` requer scope `read_pii` no JWT. Sem scope, ignora flag.

### `erp_get_invoices`

```json
{
  "name": "erp_get_invoices",
  "description": "Lista faturas de um cliente",
  "inputSchema": {
    "type": "object",
    "properties": {
      "customerId": { "type": "integer" },
      "status": { "type": "string", "enum": ["pending","paid","overdue","cancelled"] },
      "from": { "type": "string", "format": "date" },
      "to": { "type": "string", "format": "date" }
    },
    "required": ["customerId"]
  }
}
```

Lê de `invoices` table local (não chama ERP em tempo real — usa cache sync).

### `erp_test_connection`

```json
{
  "name": "erp_test_connection",
  "description": "Valida conectividade do ERP configurado",
  "inputSchema": {
    "type": "object",
    "properties": { "erpSource": { "type": "string" } },
    "required": ["erpSource"]
  }
}
```

Reusa `connector.testConnection`.

### `erp_list_supported`

```json
{
  "name": "erp_list_supported",
  "description": "Lista ERPs configurados ativos para este provider",
  "inputSchema": { "type": "object", "properties": {} }
}
```

Retorna lista de `erpSource` ativos em `erpIntegrations` table do provider.

## Audit logging

Cada chamada MCP gera entry em `audit_logs`:

```typescript
{
  providerId: ctx.provider_id,
  action: "mcp_tool_call",
  resource: "mcp_server_erp",
  resourceId: tool.name,
  actorType: "mcp",
  actorId: jwt.sub,
  payload: { tool, args, unmasked: scopeIncludesPii },
  legalBasis: LEGAL_BASES.EXECUCAO_CONTRATO,
}
```

## Rate limiting

Por provider_id:
- 60 req/min em endpoints write (Asaas, mutations)
- 300 req/min em endpoints read (list, get)

Implementação: middleware express-rate-limit (já no projeto) com key `req.user.provider_id`.

## Errors

Padrão JSON-RPC 2.0:

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "error": {
    "code": -32600,
    "message": "Invalid params",
    "data": { "tool": "erp_get_customer", "reason": "cpfCnpj must be 11 or 14 digits" }
  }
}
```

Auth errors:
- 401 sem token / token inválido
- 403 token válido mas scope insuficiente
- 429 rate limit

## Deploy

1. Caddy reverse-proxy `/mcp/*` → upstream `http://localhost:3000`
2. Express monta `registerMcpErpRoutes()` em `server/routes/index.ts`
3. HTTPS obrigatório (Caddy provê via Let's Encrypt)

## Não-elegibilidade ZDR

Quando Anthropic chama meu MCP server, a chamada e response são registrados em logs operacionais Anthropic (30 dias). Decisão consciente:
- Tools que retornam métricas agregadas (counts, sums): OK
- Tools que retornam PII (`erp_get_customer`): default mascarado, `unmasked` requer scope

## Inspector

Validação durante desenvolvimento:

```bash
npx @modelcontextprotocol/inspector \
  --transport streamable-http \
  --url https://provedor.ai/mcp/erp \
  --header "Authorization: Bearer $JWT_TEST"
```

Confirma: lista tools, executa cada uma, valida response.
