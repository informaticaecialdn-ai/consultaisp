# Quickstart — Migrando um Conector para Paginação

**Feature**: 001-fetchcustomers-pagination
**Audiência**: desenvolvedor implementando a feature

---

## Visão Geral

Esta feature converte os 10 conectores ERP de `fetchCustomers(): Promise<full-array>`
para `fetchCustomersPaged(): AsyncIterableIterator<ErpPage>`, processando em
páginas para evitar OOM em provedores grandes.

**Cada conector segue o mesmo padrão de migração** — este documento mostra
o passo-a-passo aplicável a qualquer um deles.

---

## Pré-requisitos

1. Ler `data-model.md` (este diretório) para entender `ErpPage` e
   `SyncProgressState`.
2. Ler `contracts/erp-connector-paginated.contract.md` para entender o
   contrato e as obrigações de cada conector.
3. Conhecer a estratégia do ERP alvo (ver tabela em `data-model.md`).

---

## Passo 1: Atualizar `server/erp/types.ts`

Adicionar os tipos novos (`ErpPage`, `ErpFetchOptions`, `ErpResumeToken`,
`ErpConnectorPaginationMetadata`) — definidos no contract.

Estender `ErpConnector` com:
- `readonly pagination: ErpConnectorPaginationMetadata`
- `fetchCustomersPaged(...): AsyncIterableIterator<ErpPage>`
- `fetchDelinquentsPaged(...): AsyncIterableIterator<ErpPage>`

Manter `fetchCustomers` e `fetchDelinquents` como deprecated.

---

## Passo 2: Criar `server/erp/pagination.ts` (helpers compartilhados)

Implementar:
- `fnv1aHash(values: string[]): string` — para `loopGuardHash`
- `checkPaginationLoop(currentHash, previousHashes): boolean` — true se
  3 últimos hashes iguais
- `legacyFetchAdapter<T>(generator): Promise<ErpFetchResult>` — consome
  iterator e acumula (para o shim deprecated)

---

## Passo 3: Migrar Um Conector (exemplo: IXC)

### 3a. Definir metadata

```typescript
// server/erp/connectors/ixc.ts
readonly pagination: ErpConnectorPaginationMetadata = {
  paginationStrategy: "native-page-rp",
  defaultPageSize: 200,
  maxPageSize: 1000,
  supportsResume: true,
};
```

### 3b. Reescrever `fetchCustomersPaged`

```typescript
async *fetchCustomersPaged(
  config: ErpConnectionConfig,
  options: ErpFetchOptions = {}
): AsyncIterableIterator<ErpPage> {
  const rp = Math.min(options.pageSize ?? this.pagination.defaultPageSize, this.pagination.maxPageSize);
  let page = options.resumeFrom?.kind === "page" ? options.resumeFrom.pageNumber : 1;
  const hashHistory: string[] = [];

  while (true) {
    if (options.signal?.aborted) return;

    const payload = { page: String(page), rp: String(rp), /* filters */ };
    const response = await this.callIxcEndpoint(config, "fn_areceber", payload);

    const records: NormalizedErpCustomer[] = response.registros.map(normalizeIxcRow).filter(Boolean);
    const total = Number(response.total ?? 0);
    const hasMore = records.length === rp && page * rp < total;

    const loopGuardHash = fnv1aHash(records.slice(0, 10).map(r => r.cpfCnpj));
    hashHistory.push(loopGuardHash);
    if (checkPaginationLoop(loopGuardHash, hashHistory)) {
      throw new ErpPaginationLoopError(page, loopGuardHash);
    }

    yield {
      pageNumber: page,
      records,
      hasMore,
      totalEstimate: total || undefined,
      loopGuardHash,
    };

    if (!hasMore) return;
    page++;
  }
}
```

### 3c. Manter shim legado

```typescript
async fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult> {
  return legacyFetchAdapter(this.fetchCustomersPaged(config));
}
```

### 3d. Repetir para `fetchDelinquentsPaged`

Mesma lógica, mas com filtros adicionais (ex: IXC usa `qtype:
fn_areceber.status, query: "A"`).

---

## Passo 4: Adaptar `server/services/erp-sync.service.ts`

```typescript
async function syncProviderCustomers(providerId: number, erpSource: string) {
  const connector = getConnector(erpSource);
  const config = buildConnectorConfig(await getIntegration(providerId, erpSource));

  // Cria ou retoma linha em erp_sync_logs
  const syncId = await storage.createOrResumeSyncLog(providerId, erpSource);
  const resumeToken = await storage.getResumeToken(syncId);

  const abortController = new AbortController();
  const pages = connector.fetchCustomersPaged(config, {
    resumeFrom: resumeToken,
    signal: abortController.signal,
  });

  try {
    for await (const page of pages) {
      // Upsert idempotente
      const { upserted, failed } = await storage.upsertCustomersBatch(providerId, page.records);

      // Persistir progresso
      await storage.updateSyncProgress(syncId, {
        paginaAtual: page.pageNumber,
        totalPaginas: page.totalEstimate ? Math.ceil(page.totalEstimate / 1000) : undefined,
        registrosProcessados: { increment: page.records.length },
        registrosFalhados: { increment: failed },
        atualizadoEm: new Date().toISOString(),
      });

      // Verificar cancelamento cooperativo
      const progress = await storage.getSyncProgress(syncId);
      if (progress.cancelRequested) {
        abortController.abort();
        await storage.finalizeSyncLog(syncId, "cancelled");
        return;
      }
    }
    await storage.finalizeSyncLog(syncId, "completed");
  } catch (err) {
    await storage.finalizeSyncLog(syncId, "failed", err.message);
    throw err;
  }
}
```

---

## Passo 5: Adaptar `server/services/heatmap-cache.ts`

Substituir o consumo do `fetchDelinquents` por `fetchDelinquentsPaged` e
acumular geocodificação por página em vez de tudo de uma vez. Cache em
memória final permanece o mesmo formato (sem mudança de contrato com a
camada superior).

---

## Passo 6: Adicionar Rotas em `server/routes/erp.routes.ts`

```typescript
// GET /api/provider/erp-sync/status
router.get("/erp-sync/status", requireAuth, async (req, res) => {
  const syncs = await storage.listActiveSyncs(req.session.providerId, req.query);
  res.json({ syncs });
});

// POST /api/provider/erp-sync/:syncId/cancel
router.post("/erp-sync/:syncId/cancel", requireAuth, async (req, res) => {
  const result = await storage.requestCancel(
    req.session.providerId,
    Number(req.params.syncId)
  );
  if (!result) return res.status(404).json({ error: "Sync não encontrada" });
  res.json(result);
});
```

---

## Passo 7: Frontend — Hook e Componente

```typescript
// client/src/hooks/use-erp-sync-status.ts
export function useErpSyncStatus(opts = {}) {
  return useQuery({
    queryKey: ["erp-sync-status", opts],
    queryFn: () => fetch("/api/provider/erp-sync/status?..." + new URLSearchParams(opts)).then(r => r.json()),
    refetchInterval: 5000,
  });
}

// client/src/components/erp/SyncProgressPanel.tsx
export function SyncProgressPanel() {
  const { data } = useErpSyncStatus();
  const cancel = useCancelSync();
  // renderiza barra de progresso, botão de cancelar
}
```

---

## Passo 8: Testes

Para cada conector migrado, criar testes em
`server/erp/connectors/<nome>.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("IxcConnector paginated", () => {
  it("entrega páginas até hasMore=false", async () => {
    const connector = new IxcConnector();
    const mockConfig = { /* ... */ };
    // mock fetch / responses

    const pages: ErpPage[] = [];
    for await (const page of connector.fetchCustomersPaged(mockConfig)) {
      pages.push(page);
    }
    expect(pages[pages.length - 1].hasMore).toBe(false);
  });

  it("respeita AbortSignal", async () => { /* ... */ });
  it("retoma de resumeFrom", async () => { /* ... */ });
  it("loop detection dispara após 3 hashes iguais", async () => { /* ... */ });
});
```

---

## Ordem Recomendada de Implementação

1. **types.ts + pagination.ts** (sem mudar comportamento ainda).
2. **IXC** primeiro — já pagina internamente, é a migração mais simples.
3. **SGP + Voalle + RBX** — paginação nativa parecida.
4. **MK** — date-range, requer pensar em chunks por timestamp.
5. **Hubsoft** — cursor, requer testar com instância real ou mock fiel.
6. **TopSApp, RadiusNet, Gere, ReceitaNet** — pesquisar API e implementar.
7. **erp-sync.service.ts** — adaptar para consumir o iterator.
8. **heatmap-cache.ts** — adaptar.
9. **Rotas + Frontend** — UX de progresso e cancel.
10. **Remoção dos métodos legados** — release seguinte (depois de
    confirmar que nada interno usa mais).

---

## Validação de Aceitação

Após implementar, rodar:

```powershell
# Type check
npm run check

# Testes
npx vitest run server/erp/

# Smoke test manual: configurar IXC de teste com >5000 clientes, disparar sync
# manual, observar logs e painel.
```

E confirmar Success Criteria da spec:
- SC-001: 50k em <10min
- SC-002: <500MB de memória adicional
- SC-005: atualização ≤30s no painel
- SC-007: zero duplicatas após retomada
