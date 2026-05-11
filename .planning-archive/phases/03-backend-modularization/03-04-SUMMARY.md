---
phase: 03-backend-modularization
plan: 04
subsystem: api
tags: [express, modularization, barrel-pattern, routes]

requires:
  - phase: 03-01
    provides: "11 storage domain modules + facade in server/storage/"
  - phase: 03-02
    provides: "8 route modules extracted from monolithic routes.ts"
  - phase: 03-03
    provides: "7 more route modules + utils.ts with shared helpers"
provides:
  - "server/routes/index.ts barrel that registers all 15 route modules"
  - "Monolithic routes.ts (3639 lines) deleted"
  - "storage.ts replaced with 6-line re-export shim"
  - "Clean modular backend ready for new feature additions"
affects: [04-erp-connectors, admin-core, any-new-routes]

tech-stack:
  added: []
  patterns: [barrel-import-pattern, route-module-registration, thin-re-export-shim]

key-files:
  created:
    - server/routes/index.ts
  modified:
    - server/index.ts
    - server/storage.ts
    - server/routes/utils.ts
  deleted:
    - server/routes.ts

key-decisions:
  - "Routes barrel uses app.use(registerXRoutes()) pattern for all 15 modules"
  - "storage.ts kept as thin re-export shim (6 lines) to preserve all existing import paths"
  - "Score-engine functions re-exported from utils.ts to fix consultas.routes.ts imports"

patterns-established:
  - "Barrel pattern: server/routes/index.ts imports and mounts all domain routers"
  - "Re-export shim: server/storage.ts re-exports from server/storage/index.ts"

requirements-completed: [MOD-02, MOD-03, MOD-04]

duration: 6min
completed: 2026-03-30
---

# Phase 03 Plan 04: Route Barrel Integration and Monolith Deletion Summary

**Routes barrel wires 15 domain modules via registerRoutes(), deletes 3639-line monolith, replaces storage.ts with 6-line shim**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-30T10:00:36Z
- **Completed:** 2026-03-30T10:06:00Z
- **Tasks:** 2 (1 implementation + 1 verification)
- **Files modified:** 5 (1 created, 3 modified, 1 deleted)

## Accomplishments

### Task 1: Create routes barrel, update index.ts, delete old monolithic files

- Created `server/routes/index.ts` that imports all 15 route modules and exports `registerRoutes(httpServer, app)`
- Updated `server/index.ts` to import from `./routes/index` instead of `./routes`
- Replaced `server/storage.ts` (1552 lines with merge conflicts) with a 6-line re-export shim
- Deleted `server/routes.ts` (3639 lines) via `git rm`
- Added re-exports of `calculateIspScore`, `getRiskTier`, `getDecisionReco` from `../score-engine` in `utils.ts`

### Task 2: Full build verification

- `npm run build` passes (client + server)
- 15 route module files in `server/routes/` (+ index.ts + utils.ts)
- 11 storage module files in `server/storage/` (+ index.ts)
- `server/routes.ts` confirmed deleted
- `server/storage.ts` confirmed as 6-line shim
- Only `app.get("/api/health")` found outside route modules (expected, in server/index.ts)
- No orphan routes detected

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing score-engine re-exports in utils.ts**
- **Found during:** Task 1 build verification
- **Issue:** `consultas.routes.ts` imports `calculateIspScore`, `getRiskTier`, `getDecisionReco` from `./utils` but they only exist in `server/score-engine.ts`
- **Fix:** Added re-export line in `server/routes/utils.ts`: `export { calculateIspScore, getRiskTier, getDecisionReco } from "../score-engine";`
- **Files modified:** server/routes/utils.ts
- **Commit:** a611c34

**2. [Rule 1 - Bug] Resolved merge conflicts in storage.ts**
- **Found during:** Task 1
- **Issue:** `server/storage.ts` on main had unresolved merge conflict markers (1552 lines with `<<<<<<< HEAD` markers)
- **Fix:** Replaced entire file with the intended 6-line thin re-export shim
- **Files modified:** server/storage.ts
- **Commit:** a611c34

## Known Stubs

None -- all routes are fully wired and functional.

## Verification Results

| Check | Result |
|-------|--------|
| npm run build | PASS |
| Route modules count (15) | PASS |
| Storage modules count (11) | PASS |
| routes.ts deleted | PASS |
| storage.ts is shim (<10 lines) | PASS |
| No orphan routes outside modules | PASS |
| server/index.ts imports from routes/index | PASS |

## Self-Check: PASSED
