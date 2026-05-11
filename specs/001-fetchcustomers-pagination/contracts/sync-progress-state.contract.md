# Contract: SyncProgressState (JSON em `erp_sync_logs.payload`)

**Type**: JSON shape contract (persistido em coluna jsonb)
**Validador**: Zod schema em `server/storage/erp-sync.storage.ts`

---

## Zod Schema

```typescript
// server/storage/erp-sync.storage.ts
import { z } from "zod";

export const SyncProgressStateSchema = z.object({
  version: z.literal(1),
  paginaAtual: z.number().int().min(0),
  totalPaginas: z.number().int().min(0).optional(),
  registrosProcessados: z.number().int().min(0),
  registrosFalhados: z.number().int().min(0),
  ultimoCursor: z.string().optional(),
  pageSize: z.number().int().min(1),
  iniciadoEm: z.string().datetime(),
  atualizadoEm: z.string().datetime(),
  status: z.enum([
    "in_progress",
    "paused",
    "cancelled",
    "failed",
    "completed",
  ]),
  cancelRequested: z.boolean(),
  erroAtual: z.string().optional(),
});

export type SyncProgressState = z.infer<typeof SyncProgressStateSchema>;
```

---

## JSON Examples

### Sync recém-iniciada (página 1 em curso)

```json
{
  "version": 1,
  "paginaAtual": 0,
  "registrosProcessados": 0,
  "registrosFalhados": 0,
  "pageSize": 200,
  "iniciadoEm": "2026-05-10T14:00:00.000Z",
  "atualizadoEm": "2026-05-10T14:00:00.000Z",
  "status": "in_progress",
  "cancelRequested": false
}
```

### Sync em andamento (página 12 confirmada)

```json
{
  "version": 1,
  "paginaAtual": 12,
  "totalPaginas": 25,
  "registrosProcessados": 12000,
  "registrosFalhados": 3,
  "pageSize": 1000,
  "iniciadoEm": "2026-05-10T14:00:00.000Z",
  "atualizadoEm": "2026-05-10T14:05:30.000Z",
  "status": "in_progress",
  "cancelRequested": false
}
```

### Sync com cancelamento solicitado

```json
{
  "version": 1,
  "paginaAtual": 12,
  "totalPaginas": 25,
  "registrosProcessados": 12000,
  "registrosFalhados": 0,
  "pageSize": 1000,
  "iniciadoEm": "2026-05-10T14:00:00.000Z",
  "atualizadoEm": "2026-05-10T14:05:30.000Z",
  "status": "in_progress",
  "cancelRequested": true
}
```

### Sync concluída com sucesso

```json
{
  "version": 1,
  "paginaAtual": 25,
  "totalPaginas": 25,
  "registrosProcessados": 24987,
  "registrosFalhados": 13,
  "pageSize": 1000,
  "iniciadoEm": "2026-05-10T14:00:00.000Z",
  "atualizadoEm": "2026-05-10T14:08:42.000Z",
  "status": "completed",
  "cancelRequested": false
}
```

### Sync falha irrecuperável

```json
{
  "version": 1,
  "paginaAtual": 7,
  "registrosProcessados": 7000,
  "registrosFalhados": 0,
  "pageSize": 1000,
  "iniciadoEm": "2026-05-10T14:00:00.000Z",
  "atualizadoEm": "2026-05-10T14:03:15.000Z",
  "status": "failed",
  "cancelRequested": false,
  "erroAtual": "ERP retornou 403 Forbidden — credenciais possivelmente expiradas"
}
```

---

## Invariants

1. **`paginaAtual >= 1`** sempre que `status === "in_progress" |
   "completed"`. Pode ser `0` apenas em estado inicial antes da primeira
   página.

2. **`registrosProcessados >= paginaAtual * 0`** (trivial) e
   **`registrosProcessados <= paginaAtual * pageSize`** (cota máxima).

3. **`cancelRequested === true`** só é válido quando `status ===
   "in_progress" | "paused"`. Quando a sync entrar em estado terminal,
   `cancelRequested` pode permanecer `true` (histórico) mas é ignorado.

4. **Quando `status === "completed"`**: `paginaAtual === totalPaginas`
   se `totalPaginas` foi conhecido; caso contrário,
   `paginaAtual === última página retornada`.

5. **`atualizadoEm >= iniciadoEm`** sempre.

6. **`erroAtual` só presente** quando `status === "failed"` ou houve
   erro recente em página individual.

---

## Persistence Rules

1. **Após cada página confirmada** (upserts aplicados ao banco), o caller
   chama `storage.updateSyncProgress(syncId, partialState)` que faz
   merge sobre o JSON atual.

2. **Updates são atômicos** — usar `UPDATE ... SET payload = ... WHERE
   id = ?` em uma única transação.

3. **Verificação de cancelamento** acontece ANTES de buscar próxima
   página: `storage.getSyncProgress(syncId).cancelRequested` —
   se `true`, encerra com `status: 'cancelled'`.

4. **Janela de retomada**: ao iniciar sync, se há linha em
   `erp_sync_logs` para o mesmo `(provider_id, erp_source)` com status
   `in_progress` ou `paused` e `iniciadoEm` < 4h atrás, oferece retomada
   via `resumeFrom`. Caso contrário, marca a antiga como `failed` com
   `erroAtual: "Sync abandonada (timeout de 4h)"` e cria nova.

---

## Multi-Tenant Isolation (Princípio I)

Toda função que lê/escreve `SyncProgressState` MUST receber `providerId`
como parâmetro e MUST validar que `erp_sync_logs.provider_id = providerId`
antes de retornar/atualizar. Tentativa de acessar sync de outro provedor
retorna `null` (não throw — caller decide entre 404 e silêncio).
