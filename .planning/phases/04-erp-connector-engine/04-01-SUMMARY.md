---
phase: 04-erp-connector-engine
plan: 01
subsystem: erp-engine
tags: [erp, types, resilience, rate-limiting, normalization, registry, schema]
dependency_graph:
  requires: []
  provides: [erp-types, erp-resilience, erp-rate-limiter, erp-normalize, erp-registry, hubsoft-oauth-fields]
  affects: [shared/schema.ts]
tech_stack:
  added: []
  patterns: [circuit-breaker, retry-with-backoff, per-provider-rate-limiting, connector-registry]
key_files:
  created:
    - server/erp/types.ts
    - server/erp/normalize.ts
    - server/erp/registry.ts
    - server/erp/resilience.ts
    - server/erp/rate-limiter.ts
  modified:
    - shared/schema.ts
decisions:
  - "Circuit breaker uses manual implementation (not cockatiel) wrapping p-retry for retry logic"
  - "Rate limiter keyed by providerId-erpSource combination for per-provider per-ERP concurrency"
  - "Registry uses Map for dynamic connector registration at import time"
metrics:
  duration: 10min
  completed: 2026-03-30T15:40:48Z
---

# Phase 04 Plan 01: ERP Connector Engine Foundation Summary

ERP connector contracts (ErpConnector interface + 5 supporting types), resilience infrastructure (retry + circuit breaker via p-retry), per-provider rate limiting (p-limit), normalization utilities (CPF, phone, CEP, date, aggregation), dynamic connector registry, and Hubsoft OAuth schema fields (clientId, clientSecret, extraConfig).

## Tasks Completed

### Task 1: Create ERP type definitions, normalization utilities, and registry
**Commit:** 0fb83d4

- Created `server/erp/types.ts` with 6 exported types/interfaces: ErpConnector, ErpConnectionConfig, ErpConfigField, ErpTestResult, ErpFetchResult, NormalizedErpCustomer
- Created `server/erp/normalize.ts` with 5 utility functions: cleanCpfCnpj, cleanCep, cleanPhone, calculateDaysOverdue, aggregateByCustomer
- Created `server/erp/registry.ts` with 4 registry functions: registerConnector, getConnector, getAllConnectors, getSupportedSources
- All files use ESM exports, no default exports

### Task 2: Create resilience module, rate limiter, and migrate schema
**Commit:** f45884c

- Created `server/erp/resilience.ts` with CircuitBreaker class (CLOSED/OPEN/HALF_OPEN states, configurable maxFailures=5 and resetTimeMs=30s) and withResilience wrapper (p-retry with exponential backoff, AbortError on 4xx)
- Created `server/erp/rate-limiter.ts` with getProviderLimiter function using p-limit (default concurrency: 3, keyed by providerId-erpSource)
- Added clientId, clientSecret, extraConfig (jsonb) nullable fields to erpIntegrations table in shared/schema.ts

## Deviations from Plan

None -- plan executed exactly as written.

## Verification

- All 5 files in server/erp/ compile cleanly with `npx tsc --noEmit`
- No new npm dependencies added (uses only p-retry and p-limit already in package.json)
- Schema migration (`drizzle-kit push`) not run (no DATABASE_URL in this environment) -- will apply on deployment

## Known Stubs

None -- all modules are fully implemented with real logic, no placeholder data.

## Self-Check: PASSED

- All 5 created files exist on disk
- Both task commits verified in git log (0fb83d4, f45884c)
