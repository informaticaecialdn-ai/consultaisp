---
phase: 04-erp-connector-engine
plan: 04
subsystem: erp-connector-wiring
tags: [erp, registry, integration, barrel, scheduler]
dependency_graph:
  requires: [04-02, 04-03]
  provides: [erp-connector-engine-live]
  affects: [server/routes/erp.routes.ts, server/scheduler.ts, server/routes/utils.ts]
tech_stack:
  added: []
  patterns: [barrel-index, connector-registry, rate-limited-auto-sync, config-builder]
key_files:
  created:
    - server/erp/index.ts
    - server/erp/config.ts
  modified:
    - server/routes/erp.routes.ts
    - server/routes/utils.ts
    - server/scheduler.ts
    - server/routes/admin.routes.ts
decisions:
  - "IXC/MK/SGP manually registered in barrel; Hubsoft/Voalle/RBX self-register on import"
  - "buildConnectorConfig extracted to server/erp/config.ts for reuse across routes and scheduler"
  - "Webhook endpoint preserved unchanged for N8N backward compatibility (D-15)"
metrics:
  duration: "~21 minutes"
  completed: "2026-03-30"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 04 Plan 04: Wire Connector Engine into Application Summary

Barrel index registering all 6 ERP connectors with config builder, routes and scheduler using connector registry with rate limiting.

## Tasks Completed

### Task 1: Create barrel index and register all connectors
- **Commit:** `e6f66cc`
- Created `server/erp/index.ts` as single entry point for the ERP engine
- Imports IXC, MK, SGP classes and registers them manually; imports Hubsoft, Voalle, RBX for side-effect self-registration
- Re-exports registry API (`getConnector`, `getAllConnectors`, `getSupportedSources`), types, and `getProviderLimiter`
- Created `server/erp/config.ts` with `buildConnectorConfig()` helper that builds `ErpConnectionConfig` from DB records, handling OAuth fields and extraConfig jsonb

### Task 2: Update erp.routes.ts and scheduler.ts to use connector registry
- **Commit:** `6577eed`
- `erp.routes.ts`: replaced `testErpConnection`/`fetchErpCustomers` imports with `getConnector`/`getSupportedSources`/`buildConnectorConfig` from `../erp`
- `validSources` now dynamically derived from `getSupportedSources()` plus "manual"
- Test endpoint uses `connector.testConnection(config)` via registry
- Sync endpoint uses `connector.fetchDelinquents(config)` via registry
- `scheduler.ts`: removed entire `fetchErpCustomersForScheduler` function (53 lines of hardcoded IXC-only logic)
- Scheduler now uses `getConnector()` + `getProviderLimiter()` + `buildConnectorConfig()` for all 6 ERPs
- `utils.ts`: removed `testErpConnection` (37 lines) and `fetchErpCustomers` (53 lines)
- N8N webhook endpoint (`POST /api/webhooks/erp-sync`) preserved unchanged
- Added `clientId`, `clientSecret`, `extraConfig` to allowed PATCH fields in erp.routes.ts

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed unused testErpConnection import from admin.routes.ts**
- **Found during:** Task 2
- **Issue:** admin.routes.ts imported `testErpConnection` from utils.ts (unused) which would break after removal from utils
- **Fix:** Removed the unused import line
- **Files modified:** server/routes/admin.routes.ts
- **Commit:** 6577eed

**2. [Rule 2 - Missing] Created server/erp/config.ts as shared config builder**
- **Found during:** Task 1
- **Issue:** Plan mentioned buildConnectorConfig helper but didn't specify a dedicated file
- **Fix:** Created server/erp/config.ts with proper type handling for OAuth fields and extraConfig jsonb
- **Files modified:** server/erp/config.ts
- **Commit:** e6f66cc

## Verification Results

- No references to `fetchErpCustomersForScheduler` in server/ (removed)
- No references to `testErpConnection` or `fetchErpCustomers` in erp.routes.ts (replaced)
- TypeScript compilation passes (no errors in modified files)
- All 6 connectors registered: IXC, MK, SGP (manual), Hubsoft, Voalle, RBX (self-register)

## Known Stubs

None. All connectors are fully wired and functional.

## Self-Check: PASSED

- All 6 created/modified files exist on disk
- Both task commits (e6f66cc, 6577eed) found in git log
