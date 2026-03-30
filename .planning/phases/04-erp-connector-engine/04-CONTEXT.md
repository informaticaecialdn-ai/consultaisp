# Phase 4: ERP Connector Engine - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Source:** Auto-generated (user delegated all decisions to Claude)

<domain>
## Phase Boundary

Build an abstract ERP connector system with native implementations for 6 documented ERPs (IXC, MK, SGP, Hubsoft, Voalle, RBX), replacing the N8N proxy dependency. Each connector fetches delinquent customers and normalizes them into a standard format. Includes retry/circuit breaker resilience and rate limiting.

</domain>

<decisions>
## Implementation Decisions

### Connector Architecture
- **D-01:** Create server/erp/ directory with:
  - server/erp/types.ts — ErpConnector interface, ErpConfig, ErpCustomer types
  - server/erp/registry.ts — Dynamic connector registry (Record<string, ErpConnector>)
  - server/erp/resilience.ts — Cockatiel retry + circuit breaker + timeout policies
  - server/erp/rate-limiter.ts — Per-provider rate limiting using bottleneck or p-limit
- **D-02:** ErpConnector interface: testConnection(config) → {ok, message}, fetchDelinquents(config) → ErpCustomer[], fetchCustomers(config) → ErpCustomer[]
- **D-03:** ErpConfig: { apiUrl, apiUser?, apiToken, extra?: Record<string, string> } — extra for OAuth fields (Hubsoft)
- **D-04:** ErpCustomer normalized format: { cpfCnpj, name, email?, phone?, address?, city?, state?, cep?, totalOverdueAmount, maxDaysOverdue, erpSource }

### Individual Connectors
- **D-05:** server/erp/connectors/ixc.ts — Basic Auth (Base64 user:token), POST with ixcsoft:"listar" header, fn_areceber + cliente endpoints, pagination
- **D-06:** server/erp/connectors/mk.ts — Bearer JWT, GET, financeiro/inadimplentes + clientes
- **D-07:** server/erp/connectors/sgp.ts — Token+App or Basic Auth, GET/POST, clientes + financeiro
- **D-08:** server/erp/connectors/hubsoft.ts — OAuth2 (client_id/secret → Bearer token), token refresh, financeiro module
- **D-09:** server/erp/connectors/voalle.ts — Integration User auth, financeiro module
- **D-10:** server/erp/connectors/rbx.ts — ChaveIntegracao in POST body, SQL-like filters, pendencias financeiras

### Resilience
- **D-11:** Use cockatiel for circuit breaker + retry with exponential backoff
- **D-12:** Default policy: 3 retries, 1s/2s/4s backoff, circuit breaker opens after 5 consecutive failures, half-open after 30s
- **D-13:** Use native fetch (Node 18+) for all HTTP calls — no axios

### Integration
- **D-14:** Update server/routes/erp.routes.ts to use connectors for test/sync endpoints
- **D-15:** Keep existing n8n webhook endpoints working (backward compat until Phase 5 removes them)

### Claude's Discretion
- Exact error handling patterns per ERP
- Whether to add npm packages (cockatiel, bottleneck) or use existing p-limit/p-retry
- Connector-specific pagination strategies
- How to handle ERPs with incomplete API documentation

</decisions>

<canonical_refs>
## Canonical References

### ERP API Documentation (from CLAUDE.md Section 7)
- IXC: https://wikiapiprovedor.ixcsoft.com.br/
- MK: https://postman.mk-auth.com.br/
- SGP: https://bookstack.sgp.net.br/books/api
- Hubsoft: https://docs.hubsoft.com.br/
- Voalle: https://wiki.grupovoalle.com.br/APIs
- RBX: https://www.developers.rbxsoft.com/

### Existing Code
- `server/routes/erp.routes.ts` — Current ERP route handlers
- `server/routes/utils.ts` — Shared route utilities including ERP helpers
- `server/storage/erp.storage.ts` — ERP storage methods
- `shared/schema.ts` — erpIntegrations, erpSyncLogs, erpCatalog tables
- `server/scheduler.ts` — Auto-sync scheduler (uses ERP functions)
- `server/heatmap-cache.ts` — Heatmap cache (fetches from N8N proxy)

### Research
- `.planning/research/STACK.md` — Cockatiel, bottleneck recommendations
- `.planning/research/ARCHITECTURE.md` — ERP connector pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- server/routes/utils.ts has testErpConnection and fetchErpCustomers helpers — refactor into connector pattern
- p-limit and p-retry already installed — can use instead of bottleneck/cockatiel if simpler
- Native fetch available (Node 18+, ESM project)

### Established Patterns
- Express Router for route modules
- Storage facade for DB operations
- Pino logger for structured logging

### Integration Points
- erp.routes.ts POST /:source/test → connector.testConnection()
- erp.routes.ts POST /:source/sync → connector.fetchDelinquents() → storage.syncErpCustomers()
- scheduler.ts → connector.fetchDelinquents() for auto-sync
- heatmap-cache.ts → connector.fetchDelinquents() for cache refresh (Phase 5)

</code_context>

<specifics>
## Specific Ideas

None — follow CLAUDE.md Section 7 architecture proposal.

</specifics>

<deferred>
## Deferred Ideas

None

</deferred>

---

*Phase: 04-erp-connector-engine*
*Context gathered: 2026-03-30*
