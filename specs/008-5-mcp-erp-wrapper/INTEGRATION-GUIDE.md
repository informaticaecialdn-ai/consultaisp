# Provedor.ai MCP ERP Wrapper — Guia de Integração

Como conectar um Managed Agent da Anthropic Platform ao servidor MCP do Provedor.ai pra ele acessar dados ERP do tenant.

**Áudiencia:** owner do Provedor.ai operando a plataforma Anthropic.

---

## Fluxo end-to-end (5 passos)

```
1. Owner gera bearer token em /admin-sistema#configuracoes
                  │
                  ▼ copia o token UMA VEZ
2. Owner cria/usa Vault em platform.claude.com → Workspaces → {ws} → Vaults
                  │
                  ▼ adiciona credential static_bearer com o token
3. Owner cria/atualiza Agent (Bruno, Helena, Marcos, etc.)
                  │
                  ▼ declara mcp_servers: [{ type: "url", name: "erp", url: "https://provedor.ai/mcp/erp" }]
                  ▼ habilita { type: "mcp_toolset", mcp_server_name: "erp" }
4. Owner cria Session do agent com vault_ids: [vaultId]
                  │
                  ▼ Anthropic injeta bearer token automático nos requests MCP
5. Agent invoca tools (erp_list_delinquents, erp_get_customer, ...)
   → POST https://provedor.ai/mcp/erp com Authorization: Bearer mcp_xxx
   → MCP server valida hash → resolve providerId → chama connector
   → resposta JSON-RPC com PII mascarada (default) ou unmasked (se scope=read_pii)
```

---

## Passo 1 — Gerar bearer token no Provedor.ai

1. Login como superadmin em `https://provedor.ai/admin-sistema`
2. Tab **Configurações**
3. Seção **MCP Tokens (Anthropic Platform)** → botão **"Novo token"**
4. Preencha:
   - **Provedor (tenant):** selecione o tenant (ex: "Vertical Fibra")
   - **Nome descritivo:** algo identificável, ex: `Bruno production agent · Vertical Fibra`
   - **Scopes:**
     - ✅ `read` (sempre necessário) — permite todas as tools de listagem com PII mascarada
     - ⚠️ `read_pii` (opcional) — permite `erp_get_customer` com `unmasked=true` retornar CPF/nome/telefone reais
5. Clique **"Gerar token"**
6. **COPIE O TOKEN AGORA** (formato: `mcp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`, 36 chars). Ele será mostrado **uma única vez**.

**Boas práticas:**
- Crie tokens **por agente** (não compartilhe um token entre Bruno e Helena) — facilita revogação granular se algum vazar
- Use scope mínimo (`read` apenas) por padrão. Só ative `read_pii` em agents que comprovadamente precisam (Helena pra confirmação de pagamento; Sofia/Bruno não precisam de PII completa)
- Use nomes que indiquem agente + tenant + ambiente (`Marcos staging · NSLink`, etc.)

---

## Passo 2 — Cadastrar credential no Vault da Anthropic

Documentação Anthropic: https://platform.claude.com/docs/en/managed-agents/vaults.md

1. Acesse `https://platform.claude.com/workspaces/{workspace_id}/vaults`
   - Substitua `{workspace_id}` pelo workspace dedicado (recomendado: `provedor-ai-prod`)
2. Crie um **Vault** novo (ou use um existente do tenant):
   - **Display name:** `{tenant_name}` (ex: "Vertical Fibra")
   - **Metadata:** `{ tenant_slug: "vertical-fibra", provider_id: 1 }` (opcional, ajuda auditoria)
3. Dentro do Vault, adicione uma **Credential**:
   - **Display name:** o mesmo do token Provedor.ai (ex: `Bruno production · Vertical Fibra`)
   - **Auth type:** `static_bearer`
   - **MCP server URL:** `https://provedor.ai/mcp/erp` (ou `http://localhost:5000/mcp/erp` em dev)
   - **Token:** cole o token copiado no passo 1
4. Salvar — a credential fica pronta pra ser anexada a sessions.

> **NB:** o vault da Anthropic NÃO armazena o token em forma reversível pro user — apenas usa internamente. Você nunca mais vai vê-lo pelo console deles depois de salvar.

---

## Passo 3 — Configurar o Agent

Via SDK Node.js (`@anthropic-ai/sdk` v0.89+):

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Criar (ou atualizar) o agent Bruno:
const bruno = await client.beta.agents.create({
  name: "Bruno — Lembrador Pré-Vencimento",
  model: "claude-haiku-4-5",
  system: fs.readFileSync("server/prompts/bruno.md", "utf-8"),
  tools: [
    { type: "agent_toolset_20260401" },  // bash, read, write, web_fetch, etc.
    { type: "mcp_toolset", mcp_server_name: "provedor_erp" },
  ],
  mcp_servers: [
    {
      type: "url",
      name: "provedor_erp",
      url: "https://provedor.ai/mcp/erp",
    },
  ],
});

console.log("Bruno agent_id:", bruno.id);
```

Via Console: cole as mesmas configurações manualmente em `platform.claude.com/workspaces/{ws}/agents/new`.

---

## Passo 4 — Iniciar uma Session por invocação

Cada execução do Bruno pra um tenant = 1 Session nova com o Vault do tenant attached:

```typescript
const session = await client.beta.sessions.create({
  agent: bruno.id,                       // mesmo agent reutilizado
  environment_id: environment.id,        // env compartilhado
  vault_ids: [verticalFibraVault.id],    // ← bearer specific deste tenant
  title: `Bruno run · Vertical Fibra · ${new Date().toISOString()}`,
});

// Disparar o agent
await client.beta.sessions.events.send(session.id, {
  events: [
    {
      type: "user.message",
      content: [
        { type: "text", text: "Liste inadimplentes da Vertical Fibra com mais de 10 dias de atraso." },
      ],
    },
  ],
});

// Stream eventos
for await (const ev of client.beta.sessions.stream(session.id)) {
  if (ev.type === "agent.mcp_tool_use") {
    console.log("MCP tool call:", ev.name, ev.input);
  }
  if (ev.type === "agent.mcp_tool_result") {
    console.log("MCP result:", ev.output);
  }
  if (ev.type === "session.status_idle") break;
}
```

Quando o agent invocar `erp_list_delinquents`, Anthropic Platform automaticamente:
1. Resolve a credential `static_bearer` do vault attached
2. Faz `POST https://provedor.ai/mcp/erp` com header `Authorization: Bearer mcp_xxxxx`
3. Recebe response JSON-RPC e devolve pro agent como `agent.mcp_tool_result`

---

## Passo 5 — Tools disponíveis (referência)

Todas as 5 tools são read-only no MVP. Mutations virão como Custom HTTP Tools em Specs futuras (008.6+).

### `erp_list_supported`
Lista os ERPs ativos pro tenant.

**Input:** `{}`
**Output:** `{ ok: true, data: { erpSources: ["ixc", "mk"] } }`

Use **antes** de qualquer outra tool pra descobrir o que está configurado.

### `erp_test_connection`
Valida conectividade com um ERP.

**Input:** `{ erpSource: "ixc" }`
**Output:** `{ ok: true, data: { ok: true, message: "OK", latencyMs: 234 } }`

Use pra diagnosticar quando outras tools falham (credencial inválida vs ERP off).

### `erp_list_delinquents`
Lista inadimplentes (sempre PII mascarada).

**Input:**
```json
{
  "erpSource": "ixc",
  "minValue": 100,
  "daysOverdue": 10,
  "limit": 50,
  "offset": 0
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "total": 1247,
    "customers": [
      {
        "cpfCnpj": "***.***.789-01",
        "name": "João ***",
        "totalOverdueAmount": 450.50,
        "maxDaysOverdue": 15,
        "city": "Londrina",
        "state": "PR",
        "erpSource": "ixc"
      }
    ]
  }
}
```

### `erp_get_customer`
Recupera UM cliente por CPF/CNPJ.

**Input:**
```json
{
  "erpSource": "ixc",
  "cpfCnpj": "12345678901",
  "unmasked": false
}
```

**Output (masked default):**
```json
{
  "ok": true,
  "data": {
    "cpfCnpj": "***.***.789-01",
    "name": "João ***",
    "totalOverdueAmount": 450.50,
    "masked": true
  }
}
```

**Output (unmasked, requer scope `read_pii`):**
```json
{
  "ok": true,
  "data": {
    "cpfCnpj": "12345678901",
    "name": "João Silva Santos",
    "email": "joao@example.com",
    "phone": "+55 43 99999-1234",
    "address": "Rua das Flores, 123",
    "masked": false
  }
}
```

### `erp_get_invoices`
Lista faturas de um cliente (do cache local, não ERP em runtime).

**Input:** `{ customerId: 42, status: "overdue", limit: 20 }`
**Output:** `{ ok: true, data: { customerId: 42, total: 3, invoices: [...] } }`

---

## Troubleshooting

| Sintoma | Causa provável | Solução |
|---|---|---|
| `401 Unauthorized` em todas as tool calls | Vault sem credential static_bearer correto | Verifique URL + token na credential do Vault |
| `401 unknown_prefix` | Token revogado ou não existe mais no Provedor.ai | Gere novo token via UI e atualize vault |
| `401 hash_mismatch` | Token foi truncado ao copiar | Gere novo, copie o valor completo de 36 chars |
| `403 Tool não autorizada` | Token criado com `allowedTools` restritivo | Crie novo token com `allowedTools: null` (todas) |
| `erp_get_customer.masked=true` quando esperava false | Token sem scope `read_pii` OU `unmasked=false` no input | Regenerar com `read_pii` + passar `unmasked: true` |
| `ok: false, message: "ERP \"xxx\" não configurado"` | Tenant não tem essa integração ativa em `erpIntegrations` | Configure ERP no painel do tenant |
| `429 Rate limit exceeded` | 300+ tool calls em 60s pra este tenant | Esperar 1 min ou abrir ticket pra aumentar limite |

---

## Auditoria

Cada tool call gera entry em `audit_logs` com:
- `actor_type = "mcp"`
- `actor_id = tokenPrefix` (8 chars públicos do token)
- `actor_name = tokenName` (descrição que o owner deu)
- `provider_id` (tenant)
- `resource = "mcp_server_erp"`
- `resource_id = nome da tool`
- `payload = { tool, args, result, masked, latencyMs, error? }`
- `legal_basis = "Execução de contrato (LGPD art. 7º V)"`

Consulta SQL:
```sql
SELECT actor_id, action, resource_id, payload->>'tool' AS tool,
       payload->>'masked' AS masked, occurred_at
FROM audit_logs
WHERE actor_type = 'mcp' AND provider_id = 1
ORDER BY occurred_at DESC
LIMIT 50;
```

---

## Validação local (sem Anthropic)

Use o MCP Inspector pra testar suas tools antes de configurar agent:

```bash
# 1. Gere token via UI superadmin local (http://localhost:5000)

# 2. Rode o Inspector
npx @modelcontextprotocol/inspector \
  --transport streamable-http \
  --url http://localhost:5000/mcp/erp \
  --header "Authorization: Bearer mcp_xxxxxxxxxxxx..."

# 3. Browser abre — lista as 5 tools, executa cada uma com payload de teste
```

---

## Referências

- Spec local: [specs/008-5-mcp-erp-wrapper/spec.md](./spec.md)
- Tasks: [tasks.md](./tasks.md)
- Memória canônica auth: `~/.claude/projects/c--ClaudeCode/memory/reference_anthropic_managed_agents.md`
- Docs Anthropic:
  - https://platform.claude.com/docs/en/managed-agents/overview.md
  - https://platform.claude.com/docs/en/managed-agents/mcp-connector.md
  - https://platform.claude.com/docs/en/managed-agents/vaults.md
- MCP Spec: https://spec.modelcontextprotocol.io/
