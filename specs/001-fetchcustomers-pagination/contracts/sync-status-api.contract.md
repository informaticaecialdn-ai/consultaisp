# Contract: Sync Status / Cancel HTTP API

**Type**: HTTP REST API contract (server → cliente do frontend)
**Routes file**: `server/routes/erp.routes.ts`
**Auth**: `requireAuth` middleware; usuário só vê syncs do seu próprio `providerId`

---

## GET `/api/provider/erp-sync/status`

Retorna o status atual de syncs em andamento ou recentes para o provedor
autenticado.

### Query Parameters

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `source` | string | ⚪ | (todos) | Filtra por ERP (`ixc`, `mk`, etc.) |
| `includeCompleted` | boolean | ⚪ | `false` | Inclui syncs concluídas das últimas 24h |

### Response 200

```jsonc
{
  "syncs": [
    {
      "syncId": 12345,                                  // erp_sync_logs.id
      "providerId": 7,
      "erpSource": "ixc",
      "syncType": "manual",                             // "manual" | "auto"
      "status": "in_progress",                          // SyncProgressState.status
      "paginaAtual": 12,
      "totalPaginas": 25,                               // optional
      "registrosProcessados": 12000,
      "registrosFalhados": 0,
      "pageSize": 200,
      "iniciadoEm": "2026-05-10T14:00:00Z",
      "atualizadoEm": "2026-05-10T14:05:30Z",
      "cancelRequested": false,
      "erroAtual": null
    }
  ]
}
```

### Response 401 / 403

Sessão inválida ou tentativa de acessar provedor que não é o seu.

### Behavior

- MUST filtrar por `req.session.providerId` — Princípio I.
- MUST retornar array vazio se não há syncs (`200 OK`, não 404).
- MUST serializar timestamps em ISO 8601 UTC.

---

## POST `/api/provider/erp-sync/:syncId/cancel`

Solicita cancelamento cooperativo de uma sync em andamento.

### Path Parameters

| Param | Type | Notes |
|---|---|---|
| `syncId` | integer | `erp_sync_logs.id` |

### Request Body

Vazio (nenhum corpo necessário).

### Response 200

```jsonc
{
  "ok": true,
  "syncId": 12345,
  "status": "cancel_requested",
  "mensagem": "Cancelamento solicitado. A sync será encerrada após a página atual completar."
}
```

### Response 404

```jsonc
{ "error": "Sync não encontrada" }
```
- Sync com esse id não existe, OU
- Sync pertence a outro provedor (não revelar — devolve 404, não 403).

### Response 409

```jsonc
{ "error": "Sync já está em estado terminal (completed | failed | cancelled)" }
```

### Behavior

- MUST validar `syncId` pertence ao `providerId` da sessão antes de
  qualquer outra coisa — Princípio I.
- MUST setar `cancelRequested: true` no `erp_sync_logs.payload`.
- MUST retornar imediatamente — não esperar a sync efetivamente parar.
- MUST ser idempotente: chamar 2× retorna sucesso ambas as vezes.

---

## POST `/api/provider/erp-integrations/:source/sync` (existente, sem mudança de contrato externo)

Dispara uma sync manual. **A semântica externa não muda** — continua
retornando `200 OK` com `syncId` quando aceita. O que muda é a
implementação interna: agora processa páginas em vez de tudo-de-uma-vez.

### Response 200 (existente)

```jsonc
{
  "syncId": 12346,
  "mensagem": "Sincronização iniciada"
}
```

O cliente acompanha progresso via `GET /api/provider/erp-sync/status`.

---

## Frontend Contract (TanStack Query)

### Hook: `useErpSyncStatus(options?)`

```typescript
// client/src/hooks/use-erp-sync-status.ts
export function useErpSyncStatus(options?: {
  source?: string;
  includeCompleted?: boolean;
  refetchInterval?: number;  // default 5000ms
}): UseQueryResult<{ syncs: SyncStatusItem[] }>
```

**Comportamento:**
- `refetchInterval: 5000` por padrão (atende SC-005 — atualização ≤ 30s).
- Polling para quando todas as syncs visíveis estão em estado terminal.
- Cache key inclui `providerId` da sessão (implícito via cookie).

### Hook: `useCancelSync()`

```typescript
export function useCancelSync(): UseMutationResult<
  CancelResponse,
  Error,
  { syncId: number }
>
```

**Comportamento:**
- Invalida cache de `useErpSyncStatus` ao sucesso.
- Mostra toast (via `useToast`) com mensagem retornada.
