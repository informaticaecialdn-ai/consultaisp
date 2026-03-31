---
phase: "06-undocumented-erp-connectors"
plan: "01"
subsystem: "erp-connectors"
tags: [erp, stubs, topsapp, radiusnet, gere, receitanet]
dependency_graph:
  requires: [04-erp-connector-engine]
  provides: [stub-connectors-for-undocumented-erps]
  affects: [erp-catalog, erp-ui-dropdown]
tech_stack:
  added: []
  patterns: [stub-connector-pattern]
key_files:
  created:
    - server/erp/connectors/topsapp.ts
    - server/erp/connectors/radiusnet.ts
    - server/erp/connectors/gere.ts
    - server/erp/connectors/receitanet.ts
  modified:
    - server/erp/index.ts
decisions:
  - "Stub connectors have empty configFields since API is unknown"
  - "testConnection returns ok:false with Portuguese message directing to vendor support"
  - "fetch methods throw Error rather than returning ok:false to match expected exception handling"
metrics:
  duration: "8m"
  completed: "2026-03-31"
---

# Phase 06 Plan 01: Undocumented ERP Stub Connectors Summary

Stub connectors for TopSApp, RadiusNet, Gere, and Receita Net with clear "API nao documentada" messaging, registered in the 10-connector barrel index.

## What Was Done

### Task 1: Create 4 stub connector files (7ae8c94)
Created 4 new connector files in `server/erp/connectors/`, each implementing the `ErpConnector` interface:

- **TopsappConnector** (`topsapp.ts`) - name="topsapp", label="TopSApp"
- **RadiusnetConnector** (`radiusnet.ts`) - name="radiusnet", label="RadiusNet"
- **GereConnector** (`gere.ts`) - name="gere", label="Gere"
- **ReceitanetConnector** (`receitanet.ts`) - name="receitanet", label="Receita Net"

Each stub:
- Has empty `configFields` array (no known API config)
- `testConnection()` returns `{ ok: false, message: "API nao documentada..." }`
- `fetchDelinquents()` and `fetchCustomers()` throw `Error("Conector [label] nao implementado...")`
- No network calls, no resilience/normalize imports

### Task 2: Register stubs in barrel index (9518e4a)
Updated `server/erp/index.ts`:
- Added imports for all 4 stub connector classes
- Added `registerConnector()` calls for each
- Updated JSDoc comment from "6 connector modules" to "10 connector modules"
- Total registered: 10 connectors (IXC, MK, SGP, Hubsoft, Voalle, RBX + TopSApp, RadiusNet, Gere, ReceitaNet)

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

These stubs are intentional per the plan. They exist because these ERPs have no public API documentation. Each stub will be replaced with a real implementation when vendor API docs become available:

| File | Stub Type | Reason |
|------|-----------|--------|
| server/erp/connectors/topsapp.ts | Full connector stub | No public API docs for TopSApp |
| server/erp/connectors/radiusnet.ts | Full connector stub | No public API docs for RadiusNet |
| server/erp/connectors/gere.ts | Full connector stub | No public API docs for Gere |
| server/erp/connectors/receitanet.ts | Full connector stub | No public API docs for Receita Net |

## Verification Results

- TypeScript compilation: PASSED (no errors in erp files)
- All 4 stub files exist: CONFIRMED
- Each exports class implementing ErpConnector: CONFIRMED
- Barrel imports and registers all 4: CONFIRMED
- Total registerConnector calls: 7 manual + 3 self-registering = 10 connectors

## Self-Check: PASSED

All files found. All commits verified (7ae8c94, 9518e4a).
