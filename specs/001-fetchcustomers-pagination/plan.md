# Implementation Plan: Paginação em fetchCustomers dos Conectores ERP

**Branch**: `001-fetchcustomers-pagination` (atualmente sob `heatmap-fix`)
**Date**: 2026-05-10
**Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/001-fetchcustomers-pagination/spec.md`

## Summary

A interface atual `ErpConnector.fetchCustomers(config) → Promise<ErpFetchResult>`
retorna **todos os registros em uma única estrutura na memória**. Mesmo no IXC,
que já pagina internamente, o conector acumula tudo num array antes de devolver
ao chamador. Em provedores grandes (>10k clientes), isso causa picos de memória,
travamentos de event loop e timeouts.

A solução: **converter `fetchCustomers` e `fetchDelinquents` para um modelo de
async iteration** que entrega páginas conforme chegam, permitindo ao chamador
fazer upsert e descartar memória entre páginas. O estado de progresso é
persistido em `erp_sync_logs.payload` (coluna `jsonb` já existente) — sem
alteração de schema. A UI ganha um endpoint de status para polling.

## Technical Context

**Language/Version**: TypeScript 5.6 + Node.js 20 (ESM, type: "module")
**Primary Dependencies**: Drizzle ORM 0.39, Express 5, `p-limit` 7.3, `p-retry` 7.1, vitest 1.x
**Storage**: PostgreSQL — tabelas `erp_sync_logs` (existente), `customers`, `erp_integrations`
**Testing**: vitest (já configurado em `vitest.config.ts`); testes existentes em `*.test.ts` ao lado dos arquivos
**Target Platform**: Linux server (VPS Hostinger) + Vite dev server local
**Project Type**: web-service (Express backend + React frontend monorepo)
**Performance Goals**: 50.000 clientes em < 10 min; < 500 MB de memória adicional por sync; atualização de progresso a cada 30s no painel
**Constraints**: respeitar rate limits ERP (bottleneck por provedor); manter isolamento multi-tenant absoluto; idempotência de upsert obrigatória; sem mudanças em `shared/schema.ts`
**Scale/Scope**: 10 conectores (IXC, MK, SGP, Hubsoft, Voalle, RBX, TopSApp, RadiusNet, Gere, ReceitaNet), centenas de provedores, 10k–50k clientes por provedor grande

## Constitution Check

*Gates avaliados contra `.specify/memory/constitution.md` v1.0.0.*

| Princípio | Verificação | Status |
|---|---|---|
| **I. Isolamento Multi-Tenant** | Toda iteração paginada carrega `providerId` no contexto; rate limiter é per-provider; logs incluem `providerId` | ✅ |
| **II. Schema Imutável** | Progresso de sync gravado em `erp_sync_logs.payload` (jsonb, existente). Sem ALTER TABLE. | ✅ |
| **III. Repository via Drizzle** | Upsert de páginas via `storage.upsertCustomer*` existente; sem SQL raw. | ✅ |
| **IV. TanStack Query** | Frontend polla status via `useQuery` com `refetchInterval`; cancel via `useMutation`. | ✅ |
| **V. LGPD** | Nada muda sobre mascaramento — fluxo é interno ao tenant. | ✅ |
| **VI. Português BR** | Mensagens de log/erro e variáveis de domínio (`paginaAtual`, `registrosProcessados`) em pt-BR. | ✅ |
| **VII. Incremental Verificável** | Refactoring de 10 conectores. Estratégia: shim de compatibilidade + migração 1-por-1, validando métricas a cada conector. | ✅ |

**Gate verdict:** PASS — nenhuma violação. Sem entradas em Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-fetchcustomers-pagination/
├── plan.md                                     # Este arquivo
├── research.md                                 # Phase 0 (este comando)
├── data-model.md                               # Phase 1
├── quickstart.md                               # Phase 1 — guia de migração de conector
├── contracts/
│   ├── erp-connector-paginated.contract.md     # Phase 1 — contrato TS da interface
│   ├── sync-status-api.contract.md             # Phase 1 — endpoints HTTP
│   └── sync-progress-state.contract.md         # Phase 1 — shape do JSON em erp_sync_logs.payload
├── checklists/
│   └── requirements.md                         # já existe
└── tasks.md                                    # Phase 2 (gerado por /speckit-tasks)
```

### Source Code (repository root)

```text
server/
├── erp/
│   ├── connectors/                # 10 conectores a migrar
│   │   ├── ixc.ts                 # já pagina internamente — adaptar para async iteration
│   │   ├── mk.ts                  # NÃO pagina — implementar paginação por range
│   │   ├── sgp.ts
│   │   ├── hubsoft.ts
│   │   ├── voalle.ts
│   │   ├── rbx.ts
│   │   ├── topsapp.ts
│   │   ├── radiusnet.ts
│   │   ├── gere.ts
│   │   └── receitanet.ts
│   ├── types.ts                   # adicionar AsyncIterable signatures + manter Promise legado
│   ├── normalize.ts               # sem mudanças
│   ├── resilience.ts              # sem mudanças
│   └── pagination.ts              # NOVO — helpers (loop-detect, page-size negotiation, progress emit)
├── services/
│   ├── erp-sync.service.ts        # consumir AsyncIterable; persistir progresso a cada página
│   ├── heatmap-cache.ts           # consumir AsyncIterable; agregar geocodificação por página
│   └── realtime-query.service.ts  # inalterado (single-record APIs)
├── routes/
│   └── erp.routes.ts              # NOVO endpoint GET /api/provider/erp-sync/status; POST /api/provider/erp-sync/:source/cancel
└── storage/
    └── erp-sync.storage.ts        # NOVO helper para read/write de progresso em payload

client/src/
├── pages/
│   └── administracao.tsx          # adicionar painel de progresso/cancel
├── hooks/
│   └── use-erp-sync-status.ts     # NOVO — useQuery polling
└── components/
    └── erp/
        └── SyncProgressPanel.tsx  # NOVO — barra de progresso + cancel
```

**Structure Decision:** Mantida a separação atual (web-service com `server/` +
`client/`). Mudanças são primariamente em `server/erp/` (conectores e tipos),
`server/services/` (consumidores), `server/routes/` (status/cancel), e UI
mínima em `client/src/`. Nenhum diretório novo no nível de projeto.

## Complexity Tracking

> Não aplicável — nenhuma violação da Constitution; nada a justificar.
