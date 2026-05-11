# Contract — Memory Tool Backend

**Direction:** Internal (Anthropic Messages API → Provedor.ai backend handler)
**Purpose:** Implementar handler client-side da Memory Tool oficial Anthropic, substituindo `AgentMemoryStorage` custom.

## Tool registration

Adicionar nos arrays `tools` de Helena, Bruno, Sofia, Júlia:

```typescript
import { betaMemoryTool } from "@anthropic-ai/sdk";

const memoryToolBeta = {
  type: "memory_20250818" as const,
  name: "memory",
};

// Em createMessage:
tools: [...existingTools, memoryToolBeta]
```

Beta header `memory_20250818` é adicionado automaticamente pelo SDK quando esse tool type é detectado.

## Backend handler

Localização: `server/agents/memory-tool-backend.ts`

```typescript
export interface MemoryToolContext {
  providerId: number;
  customerId: number;
  agentId: string;
}

export async function handleMemoryToolCall(
  ctx: MemoryToolContext,
  input: MemoryToolInput,
): Promise<MemoryToolResult>
```

Comandos suportados (todos do spec):

- `view` (dir ou file content + optional view_range)
- `create` (novo file, falha se existe)
- `str_replace` (replace exact string; falha se não único ou ausente)
- `insert` (insert text at line N)
- `delete` (file ou dir recursivo)
- `rename` (move; falha se destination existe)

## Path namespace

Path absoluto começa sempre com `/memories`. Backend impõe namespace por tenant + agente:

```
/memories/
  provider-{providerId}/
    customer-{customerId}/
      agent-{agentId}/
        facts.md
        promises.md
        summary.md
        sentiment.md
        ...
```

Quando Claude chama `view /memories`, retornamos apenas arquivos do contexto atual `(providerId, customerId, agentId)` — Claude vê seus arquivos como se fossem `/memories/facts.md` etc. (path mostrado é virtual).

**Multi-tenant gate:** validar TODA operação contra `ctx`. Se Claude tentar acessar `/memories/provider-42/...` quando `ctx.providerId=43`, retornar erro `path does not exist`.

## Path traversal protection

```typescript
function validatePath(path: string): string {
  if (!path.startsWith("/memories")) throw new Error("path must start with /memories");
  if (path.includes("..") || path.includes("%2e%2e")) throw new Error("traversal denied");
  // canonical check
  const canonical = posix.resolve("/memories", path.slice("/memories".length));
  if (!canonical.startsWith("/memories")) throw new Error("traversal denied");
  return canonical;
}
```

## Persistência (Postgres)

Tabela nova `agent_memory_files`:

```sql
CREATE TABLE agent_memory_files (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  agent_id VARCHAR(40) NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, agent_id, path)
);

CREATE INDEX agent_memory_files_provider_customer_agent ON agent_memory_files
  (provider_id, customer_id, agent_id);
```

## Limites defensivos

- Max file size: 50KB (Claude paginação se precisar mais)
- Max files per (customer × agent): 100
- View dir result max 2 levels deep, exclui hidden (`.`)
- Linhas com mais de 999.999 → retorna erro spec-defined
- Content sanitization: remover null bytes, validar UTF-8

## Audit log

Cada operação cria entry em `audit_logs`:

```typescript
{
  action: "memory_tool_call",
  resource: "memory_file",
  resourceId: path,
  actorType: "agent",
  actorId: ctx.agentId,
  payload: { command, providerId: ctx.providerId, customerId: ctx.customerId, sizeBytes }
}
```

## Bootstrap migration

Script `scripts/migrate-agent-memories-to-files.ts`:

Para cada row em `agent_memories`:

1. Resolve provider_id via `customers.providerId` (agent_memories não tem direto)
2. Cria arquivos:
   - `facts.md`: `# Facts\n\n{JSON.stringify(facts, null, 2)}`
   - `promises.md`: `# Promises\n\n{table format}`
   - `summary.md`: `# Summary\n\n{summary text}`
   - `sentiment.md`: `# Sentiment History\n\n{timeline}`
3. `INSERT INTO agent_memory_files ... ON CONFLICT DO NOTHING`

Idempotente. Pode rodar várias vezes.

## Compatibilidade durante migração

Feature flag `process.env.USE_MEMORY_TOOL`:

- `false` (default): Helena/Bruno/Sofia usam `AgentMemoryStorage` legado
- `true`: Memory Tool ativo. Backend lê de `agent_memory_files`. `AgentMemoryStorage` writes ainda acontecem em paralelo (defensive).

Após 30 dias estável: flip default → `true`, remove writes legados.

## Latency

- View dir: <50ms (1 SELECT)
- View file: <50ms (1 SELECT)
- Create/insert/str_replace: <100ms (1 INSERT/UPDATE + audit)
- Delete: <100ms (1 DELETE + audit)
