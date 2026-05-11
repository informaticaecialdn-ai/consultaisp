# Data Model — Paginação em fetchCustomers

**Phase**: 1 (Design & Contracts)
**Feature**: 001-fetchcustomers-pagination
**Date**: 2026-05-10

---

## Entities

### 1. ErpPage (in-memory, transient)

Uma página de resultados retornada por uma iteração paginada do conector.
**Não é persistida** — é descartada após o caller processá-la.

| Field | Type | Required | Notes |
|---|---|---|---|
| `pageNumber` | number | ✅ | 1-indexed |
| `records` | NormalizedErpCustomer[] | ✅ | Tamanho ≤ pageSize do conector |
| `hasMore` | boolean | ✅ | true se há próxima página |
| `totalEstimate` | number? | ⚪ | Apenas se o ERP informar contagem total |
| `cursor` | string? | ⚪ | Cursor opaco para conectores cursor-based (Hubsoft) |
| `loopGuardHash` | string | ✅ | FNV-1a dos primeiros 10 cpfCnpj — para loop detect |

**Validações:**
- `pageNumber >= 1`
- `records.length >= 0` (página vazia válida se `hasMore = false`)
- `totalEstimate >= records.length * pageNumber` quando presente

---

### 2. SyncProgressState (persistido em `erp_sync_logs.payload` como JSON)

Estado intermediário de uma sincronização. Persistido após cada página
concluída para suportar retomada (FR-008) e exibição de progresso (FR-006).

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | number (literal 1) | ✅ | Versão do shape; permite evolução futura |
| `paginaAtual` | number | ✅ | 1-indexed; última página confirmada |
| `totalPaginas` | number? | ⚪ | Estimado a partir de `totalEstimate / pageSize` |
| `registrosProcessados` | number | ✅ | Cumulativo desde o início |
| `registrosFalhados` | number | ✅ | Cumulativo desde o início |
| `ultimoCursor` | string? | ⚪ | Para conectores cursor-based |
| `pageSize` | number | ✅ | Tamanho de página em uso |
| `iniciadoEm` | ISO datetime | ✅ | Timestamp do início |
| `atualizadoEm` | ISO datetime | ✅ | Timestamp da última atualização |
| `status` | enum | ✅ | `in_progress` \| `paused` \| `cancelled` \| `failed` \| `completed` |
| `cancelRequested` | boolean | ✅ | Flag de cancelamento cooperativo |
| `erroAtual` | string? | ⚪ | Mensagem do último erro (limpa em sucesso) |

**State Transitions:**

```text
[criado]
   │
   ▼
in_progress ──────┬────────► completed (hasMore=false, status final)
   │              │
   │              ├────────► failed (erro irrecuperável)
   │              │
   │              └────────► cancelled (cancelRequested=true detectado)
   │
   └─► paused (servidor restart; cliente verá ao retomar)
```

**Validações (via Zod):**
- `paginaAtual >= 1` quando status `in_progress`
- `registrosProcessados >= 0`
- `cancelRequested` só pode ser `true` quando status `in_progress`
- `atualizadoEm >= iniciadoEm`

---

### 3. ErpConnectorMetadata (extensão do `ErpConnector`)

Adicionado à interface `ErpConnector` para que o caller saiba como o
conector pagina e tome decisões adequadas (retomada, page size, fallback).

| Field | Type | Required | Notes |
|---|---|---|---|
| `paginationStrategy` | enum | ✅ | `native-page-rp` \| `native-offset-limit` \| `native-cursor` \| `date-range` \| `single-shot` |
| `defaultPageSize` | number | ✅ | Tamanho ótimo para esse ERP |
| `maxPageSize` | number | ✅ | Limite hard que o ERP suporta |
| `supportsResume` | boolean | ✅ | Se o conector pode retomar de página/cursor arbitrário |
| `singleShotSafeLimit` | number? | ⚪ | Para `single-shot`: aborta se exceder este número de registros |

**Exemplos por conector:**

| Conector | strategy | defaultPageSize | maxPageSize | supportsResume |
|---|---|---|---|---|
| ixc | native-page-rp | 200 | 1000 | ✅ |
| mk | date-range | (n/a) | (n/a) | ✅ (por timestamp) |
| sgp | native-page-rp | 500 | 1000 | ✅ |
| hubsoft | native-cursor | 1000 | 1000 | ✅ |
| voalle | native-offset-limit | 1000 | 5000 | ✅ |
| rbx | native-offset-limit | 500 | 1000 | ✅ |
| topsapp | TBD em implementação | TBD | TBD | TBD |
| radiusnet | TBD em implementação | TBD | TBD | TBD |
| gere | TBD em implementação | TBD | TBD | TBD |
| receitanet | TBD em implementação | TBD | TBD | TBD |

---

### 4. ErpSyncLog (já existe — não alterar schema)

Tabela `erp_sync_logs` permanece **exatamente como está**:

```sql
-- shared/schema.ts (NÃO MODIFICAR)
erp_sync_logs (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES providers(id),
  erp_source text NOT NULL,
  synced_at timestamp DEFAULT now(),
  upserted integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'success',
  ip_address text,
  payload jsonb,                       -- ★ aqui vai SyncProgressState
  sync_type text NOT NULL DEFAULT 'manual',
  records_processed integer NOT NULL DEFAULT 0,
  records_failed integer NOT NULL DEFAULT 0
)
```

**Convenção de uso:**
- Uma linha em `erp_sync_logs` por sincronização.
- `payload` contém `SyncProgressState` enquanto status='in_progress'.
- Quando sync conclui, `payload.status` vira `'completed' | 'failed' |
  'cancelled'` e `records_processed`, `records_failed`, `upserted`,
  `errors` são preenchidos a partir do payload.

---

## Relationships

```text
providers (1) ───────────────── (N) erp_integrations
   │                                   │
   │                                   │ erp_source
   │                                   ▼
   │                              erp_sync_logs ◄─── carrega ───── SyncProgressState (JSON)
   │                                   │
   ▼                                   │
customers ◄───── upsert (por página) ──┘
```

---

## Constraints (Constitution Mapping)

| Princípio | Onde aplica neste modelo |
|---|---|
| I. Multi-tenant | `erp_sync_logs.provider_id` filtra todo acesso |
| II. Schema imutável | Nada de ALTER TABLE; uso de `payload jsonb` existente |
| III. Repository Drizzle | Acesso via `storage.upsertCustomer`, `storage.updateSyncProgress` |
| V. LGPD | Nenhum dado novo de cliente — apenas reorganiza fluxo |
| VI. pt-BR | Campos `paginaAtual`, `registrosProcessados`, `iniciadoEm`, `atualizadoEm`, `cancelRequested` |
