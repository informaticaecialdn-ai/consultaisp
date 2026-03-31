---
phase: 05-erp-ui-n8n-removal
plan: 01
subsystem: backend-erp
tags: [n8n-removal, heatmap, connector-registry, api-cleanup]
dependency_graph:
  requires: [04-erp-connector-engine]
  provides: [n8n-free-backend, erp-connectors-endpoint, multi-erp-heatmap]
  affects: [server/heatmap-cache.ts, server/routes/erp.routes.ts, server/routes/provider.routes.ts, server/routes/admin.routes.ts, server/routes/consultas.routes.ts, server/storage/providers.storage.ts, server/storage/index.ts]
tech_stack:
  added: []
  patterns: [connector-registry-for-heatmap, rate-limited-erp-fetch]
key_files:
  created: []
  modified:
    - server/heatmap-cache.ts
    - server/routes/erp.routes.ts
    - server/routes/provider.routes.ts
    - server/routes/admin.routes.ts
    - server/routes/consultas.routes.ts
    - server/storage/providers.storage.ts
    - server/storage/index.ts
decisions:
  - Replaced N8N provider data source in consultas.routes.ts with getAllEnabledErpIntegrationsWithCredentials instead of getAllProvidersWithN8n
  - Kept the central consultation webhook URL (n8n.aluisiocunha.com.br) as it is the ISP query orchestrator endpoint, just changed data source for credentials
  - Removed legacy per-provider N8N fallback block from consultation flow
  - Retained webhook token management routes (provider/integration) since tokens may serve future API access
metrics:
  duration: 15m
  completed: 2026-03-31
---

# Phase 05 Plan 01: N8N Backend Removal and Connector Heatmap Summary

Multi-ERP heatmap cache via connector registry with full N8N proxy/route/storage removal and new connector metadata endpoint.

## Task Results

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | Rewrite heatmap-cache.ts to use connector registry | c479768 | Done |
| 2 | Add connector metadata endpoint, remove N8N routes/storage | 2958d54 | Done |

## Changes Made

### Task 1: Heatmap Cache Rewrite
- Removed all N8N proxy code: `N8N_PROXY_URL`, `N8N_PROXY_AUTH`, `fetchPageFromN8nProxy`, `fetchPageDirectFromIxc`, `fetchIxcDelinquents`, `processRows`, `finalise`
- Rewrote `refreshProviderCache` to use `getConnector(erpSource)` + `buildConnectorConfig(intg)` + `getProviderLimiter` for rate-limited fetch
- `refreshAllProviders` now reads exclusively from `erp_integrations` table via `getAllEnabledErpIntegrationsWithCredentials()`
- Heatmap now supports all 6 ERPs (IXC, MK, SGP, Hubsoft, Voalle, RBX) instead of only IXC
- File reduced from 371 lines to 225 lines (net -223 lines, +77 lines)

### Task 2: N8N Route and Storage Cleanup
- Added `GET /api/erp-connectors` endpoint returning `{ name, label, configFields }` for all registered connectors
- Removed `POST /api/webhooks/erp-sync` webhook endpoint from erp.routes.ts
- Removed 3 N8N config routes from provider.routes.ts: GET/PATCH/POST `/api/provider/n8n-config`
- Removed 3 N8N config routes from admin.routes.ts: GET/PATCH/POST `/api/admin/providers/:id/n8n-config`
- Removed 3 storage methods: `getAllProvidersWithN8n`, `getN8nConfig`, `saveN8nConfig` from providers.storage.ts, IStorage interface, and DatabaseStorage facade
- Updated consultas.routes.ts: replaced `getAllProvidersWithN8n()` with `getAllEnabledErpIntegrationsWithCredentials()` for building the integrations array
- Removed legacy N8N per-provider fallback block (~130 lines) from consultation flow
- Renamed all N8N log prefixes and variable names to ERP equivalents

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] consultas.routes.ts N8N central query data source**
- **Found during:** Task 2
- **Issue:** consultas.routes.ts used `getAllProvidersWithN8n()` which was being removed from storage. The central query endpoint still needs ERP credentials, just sourced differently.
- **Fix:** Replaced data source with `getAllEnabledErpIntegrationsWithCredentials()` and mapped fields (providerId, apiUrl->api_url, apiToken->api_key, erpSource->erp). Removed entire legacy per-provider N8N fallback block.
- **Files modified:** server/routes/consultas.routes.ts
- **Commit:** 2958d54

## Decisions Made

1. **Central query endpoint retained**: The `n8n.aluisiocunha.com.br/webhook/isp-consult` URL is the ISP consultation orchestrator. Despite being hosted on N8N infrastructure, it functions as a standard HTTP API. Credentials now come from erp_integrations table instead of N8N config fields.
2. **Webhook token routes kept**: `GET /api/provider/integration` and `POST /api/provider/integration/regenerate-token` still exist. They return a webhook URL pointing to the removed endpoint, but the token mechanism may be reused for future API access.
3. **Schema columns not modified**: As specified in plan, n8n columns in providers table (shared/schema.ts) are left as-is for migration safety (N8N-04).

## Known Stubs

None. All endpoints are fully functional.

## Verification Results

- Zero references to `N8N_PROXY_URL`, `N8N_PROXY_AUTH`, `fetchPageFromN8nProxy`, `fetchIxcDelinquents` in server/
- Zero references to `getAllProvidersWithN8n`, `getN8nConfig`, `saveN8nConfig` in server/
- Zero N8N route handlers (`n8n-config`, `webhooks/erp-sync`) in server/routes/
- TypeScript compilation: no new errors in modified files (pre-existing Express 5 type issues remain across all route files)

## Self-Check: PASSED

All 7 modified files exist. Both commit hashes (c479768, 2958d54) verified in git log.
