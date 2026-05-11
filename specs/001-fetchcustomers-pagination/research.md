# Research — Paginação em fetchCustomers

**Phase**: 0 (Outline & Research)
**Feature**: 001-fetchcustomers-pagination
**Date**: 2026-05-10

---

## Decision 1: Modelo de Entrega de Páginas

**Decision:** Async iteration via `AsyncIterableIterator<ErpPage>`.

**Rationale:**
- Node 20 e TypeScript 5.6 suportam nativamente `for await...of`.
- Padrão idiomático para streaming sem reinventar callbacks ou EventEmitter.
- Cada conector implementa como `async function* fetchCustomersPaged()` —
  cliente pode parar a iteração com `break` para cancelamento limpo.
- Memória controlada: o caller faz `await upsertPage(page)` e a página é
  GC'd antes da próxima.
- Bem testável com vitest (consumir o iterador em teste e validar páginas).

**Alternatives considered:**
- **Callback-based** (`onPage: (page) => Promise<void>`): mais comum no
  Node antigo, mas inversão de controle prejudica composabilidade e
  tratamento de erro. Não-idiomático em TS 5.
- **Node Readable Stream**: mais power mas é over-engineering para
  paginação simples; também menos type-safe.
- **Retornar `Page[]`**: ainda acumula em memória; só atrasa o problema.

**Compatibility shim:** Manter o método legado `fetchCustomers(config) →
Promise<ErpFetchResult>` que internamente consome o async iterator e
acumula — para chamadores que não migraram. Marcar como deprecated.

---

## Decision 2: Persistência de Progresso (Schema Constraint)

**Decision:** Gravar estado de progresso em `erp_sync_logs.payload` (coluna
`jsonb` já existente). **Sem ALTER TABLE.**

**Rationale:**
- Princípio II (Constitution) exige autorização explícita para alterar
  `shared/schema.ts`. A coluna `payload jsonb` cobre o caso de uso.
- Shape do JSON é estável e versionado (campo `version: 1`).
- Permite evolução futura sem migração — adicionar campos é compatible.
- Drizzle suporta `payload: jsonb()` nativamente; o consumer faz cast
  Zod-validado antes de usar.

**Alternatives considered:**
- **Adicionar colunas `current_page`, `total_pages`, etc.**: requereria
  alteração de schema (bloqueada pelo Princípio II) e migração no
  banco de produção. Rejeitado por agora.
- **Cache in-memory**: perdido em restart; quebra FR-008 (retomada).
- **Tabela nova `erp_sync_progress`**: também alteração de schema; mais
  invasivo que usar a coluna existente.

**Shape (resumido)** — definido em `contracts/sync-progress-state.contract.md`:

```jsonc
{
  "version": 1,
  "paginaAtual": 12,
  "totalPaginas": 25,
  "registrosProcessados": 12000,
  "registrosFalhados": 0,
  "ultimoCursor": "20260510-143022-abc",
  "iniciadoEm": "2026-05-10T14:00:00Z",
  "atualizadoEm": "2026-05-10T14:05:30Z",
  "status": "in_progress",  // in_progress | paused | cancelled | failed | completed
  "cancelRequested": false
}
```

---

## Decision 3: Estratégia para ERPs Sem Paginação Nativa

**Decision:** Conector classifica seu modo via metadata
`paginationStrategy: 'native' | 'date-range' | 'single-shot'`.

**Rationale:**
- Vários ERPs (notadamente MK) não paginam tradicionalmente, mas oferecem
  filtros por range (data de alteração, faixa de código). Isso é
  pagination-equivalent.
- ERPs realmente sem paginação (alguns legados como possivelmente
  RadiusNet/Gere) recebem cap de volume seguro: se a chamada única
  exceder o threshold (padrão 5.000 registros), o conector retorna erro
  acionável "Volume excede limite single-shot; contate suporte do ERP
  para aumentar limite ou habilitar paginação".
- Cada conector documenta sua estratégia no campo `description` da
  interface.

**Alternatives considered:**
- **Forçar paginação client-side em todos**: para um ERP single-shot,
  isso significa baixar tudo e fatiar — não resolve o problema, só
  adia.
- **Bloquear conectores single-shot**: muito restritivo; alguns
  provedores pequenos funcionam bem assim.

---

## Decision 4: Tamanho de Página

**Decision:** Default global `pageSize = 1000`, com override por conector
(via constante exportada no módulo do conector). IXC fica em 200 (já
testado em produção); MK calcula via date-range; SGP usa 500 (limite
conhecido da API).

**Rationale:**
- Balance entre número de roundtrips e memória por página.
- 1000 registros normalizados × ~500 bytes médios = ~500 KB por página —
  bem dentro do budget de 500 MB.
- Conectores podem ajustar baseado em limites do ERP.

**Alternatives considered:**
- **`pageSize` ajustável via env var por deploy**: complexidade
  desnecessária; cada conector já sabe seu limite ótimo.
- **Tamanho variável adaptativo** (aumenta se latência baixa, reduz se
  alta): over-engineering para o problema atual.

---

## Decision 5: Detecção de Loop de Paginação

**Decision:** Comparar hash (FNV-1a) dos primeiros N cpfCnpj da página
contra páginas anteriores. Se 3 páginas consecutivas tiverem mesmo hash,
abortar com erro `ErpPaginationLoopError`.

**Rationale:**
- Cobre o edge case em que ERP entra em loop devolvendo a mesma página.
- FNV-1a sobre 10 primeiros CPFs é determinístico, rápido, sem
  dependência nova.
- Threshold de 3 é conservador (1 ou 2 podem ser falsos positivos
  legítimos em ERPs com poucos registros).

**Alternatives considered:**
- **Comparar set completo de PKs**: mais robusto mas custa memória
  proporcional ao total.
- **Confiar no campo `hasMore`**: já é a fonte primária; loop-detect é
  fail-safe.

---

## Decision 6: Cancelamento de Sync em Andamento

**Decision:** Cancelamento cooperativo via flag no `erp_sync_logs.payload`
(`cancelRequested: true`). O consumer da iteração verifica essa flag entre
páginas via `storage.getSyncProgress(syncId)`.

**Rationale:**
- Não precisa de comunicação inter-process complicada (queues, signals).
- Flag persistida sobrevive a restart.
- Latência máxima de cancelamento = tempo de uma página = 30s no pior
  caso (atende SC-006 de 2 min).

**Alternatives considered:**
- **AbortController in-process**: só funciona se o sync rodar no mesmo
  processo que recebe o request de cancel. Em produção com PM2/cluster,
  pode estar em worker diferente.
- **Mensageria (Redis pub/sub)**: dependência nova; over-engineering.

---

## Decision 7: Retomada de Sync Interrompida (FR-008)

**Decision:** Cada conector aceita parâmetro opcional `resumeFrom` no
async generator (cursor ou número de página). Caller decide se retoma
baseado em (a) idade do `erp_sync_logs` parcial — janela de 4h padrão —
e (b) tipo de cursor disponível.

**Rationale:**
- ERPs page+rp (IXC, SGP) retomam por número de página — trivial.
- ERPs com cursor opaco (Hubsoft talvez) retomam pelo cursor da última
  página confirmada.
- ERPs date-range (MK) retomam pelo último timestamp de alteração
  processado.
- Janela de 4h evita retomar com dados muito desatualizados (preferível
  recomeçar).

**Alternatives considered:**
- **Sempre recomeçar**: viola FR-008.
- **Janela maior (24h+)**: arrisca duplicar trabalho ou perder mudanças
  do ERP no intervalo.

---

## Decision 8: Frontend — Progresso e Cancelamento

**Decision:** Polling via TanStack Query (`useQuery` com
`refetchInterval: 5000`) no endpoint `GET /api/provider/erp-sync/status`.
Botão "Cancelar" dispara `useMutation` para
`POST /api/provider/erp-sync/:syncId/cancel`.

**Rationale:**
- Princípio IV (TanStack Query) — sem fetch direto.
- Polling 5s é suficiente (atende SC-005 de "ao menos a cada 30s").
- Simpler que SSE/WebSocket para esse caso de uso (não precisa de baixa
  latência em tempo real).
- O painel já está aberto pelo operador durante sync manual — polling é
  natural.

**Alternatives considered:**
- **Server-Sent Events**: latência menor, mas requer conexão persistente
  por sync — mais infra para pouco ganho.
- **WebSocket** (já existente para chat): reuso é tentador, mas mistura
  domínios e complica autorização.

---

## Decision 9: Rate Limiting Entre Páginas

**Decision:** Reuso do `getProviderLimiter` existente em
`heatmap-cache.ts`. Cada requisição de página passa pelo limiter do
provedor.

**Rationale:**
- Padrão já estabelecido na codebase (não introduz nova lib).
- Por-provedor isola syncs paralelos de provedores diferentes.
- Backoff em caso de erro é responsabilidade da camada de resilience
  (`server/erp/resilience.ts`) que já existe.

**Alternatives considered:**
- **`bottleneck` global**: limita todos os provedores juntos —
  contrário ao isolamento (Princípio I).
- **Sleep fixo entre páginas**: rude e não-adaptativo.

---

## Decision 10: Métricas e Observabilidade

**Decision:** Loggar via `console.log` estruturado (padrão atual da
codebase) com prefixo `[ERP-SYNC]` e contexto JSON:
`providerId`, `erpSource`, `pageNumber`, `recordsInPage`, `durationMs`.

**Rationale:**
- Mantém consistência com logging existente (sem nova lib).
- JSON estruturado permite parser/grep básico em produção.
- Suficiente para o nível atual de observabilidade (sem APM dedicado).

**Alternatives considered:**
- **Adicionar `pino` ou `winston`**: introduz dependência e mudança de
  padrão amplo — fora de escopo desta feature. Pode ser feature
  futura.
- **Métricas Prometheus**: idem; over-engineering agora.

---

## Open Questions

Nenhuma. Todas as NEEDS CLARIFICATION foram resolvidas via decisões
acima ou explicitadas como assumptions na spec.

---

## Summary Table

| # | Tema | Decisão |
|---|---|---|
| 1 | Modelo de entrega | `AsyncIterableIterator<ErpPage>` + shim compat |
| 2 | Persistência | `erp_sync_logs.payload` (jsonb existente) |
| 3 | ERPs sem paginação | metadata `paginationStrategy` por conector |
| 4 | Page size | 1000 default; override por conector |
| 5 | Loop detect | hash FNV-1a, threshold 3 páginas |
| 6 | Cancelamento | flag em payload, cooperativo entre páginas |
| 7 | Retomada | cursor/page-number; janela 4h |
| 8 | Frontend | TanStack Query polling 5s |
| 9 | Rate limit | `getProviderLimiter` existente |
| 10 | Observabilidade | `console.log` estruturado |
