---
phase: 07-lgpd-hardening
plan: 02
subsystem: consultas-routes
tags: [lgpd, masking, security, refactor, bug-fix]
dependency_graph:
  requires: [07-01]
  provides: [centralized-lgpd-masking-in-consultas]
  affects: [server/routes/consultas.routes.ts]
tech_stack:
  added: []
  patterns: [centralized-masking-delegation]
key_files:
  modified:
    - server/routes/consultas.routes.ts
decisions:
  - Delegate all cross-provider data masking to maskCrossProviderDetail from lgpd-masking.ts
  - Keep alert creation with full unmasked customer data (alerts go to owning provider)
  - Remove dead code (maskedCep, addrRestricted variables) after delegation
metrics:
  duration: 11m
  completed: 2026-03-31
  tasks: 2/2
  files_modified: 1
---

# Phase 7 Plan 02: Apply Centralized LGPD Masking to Consultas Routes Summary

Replaced all inline ad-hoc masking in consultas.routes.ts with centralized maskCrossProviderDetail calls, fixing a bug where local-DB path leaked unmasked customer names for cross-provider records.

## What Was Done

### Task 1: Refactor ERP-central path to use maskCrossProviderDetail
- **Commit:** 58f1f1e
- Added import for `maskCrossProviderDetail` from `../lgpd-masking`
- Refactored ERP-central providerDetails mapping: builds raw detail objects with full data, then applies `maskCrossProviderDetail(rawDetail, isSame)`
- Refactored ERP address cross-reference matches to use centralized masking instead of inline name/CPF masking
- Refactored CEP fallback history results to use centralized masking instead of inline re-masking logic
- Removed dead code: `maskedCep` variable (no longer computed inline), `addrRestricted` variable (masking now handled by module)

### Task 2: Refactor local-DB path and fix unmasked customer.name bug
- **Commit:** f4bd64a
- **Bug fixed:** `customerName: customer.name` was returned unmasked for cross-provider records in the local-DB path
- Refactored local-DB providerDetails to build raw objects then apply `maskCrossProviderDetail(rawDetail, isSameProvider)`
- Same-provider extras (equipmentDetails, cancelledDate) are added after masking, so they remain visible for own-provider data
- Refactored local-DB address cross-reference matches to use centralized masking (removed inline name split/mask and CPF substring masking)
- Removed unused `getOverdueAmountRange` import from utils (now handled internally by maskCrossProviderDetail)
- Verified alert creation still uses full unmasked customer data (alerts go to the owning provider about their own customers)

## Verification Results

| Check | Expected | Actual |
|-------|----------|--------|
| `maskCrossProviderDetail` occurrences | >= 4 | 6 |
| Inline name masking (`parts[0] ***`) | 0 | 0 |
| Inline address/cep masking | 0 | 0 |
| TypeScript compilation (consultas.routes.ts) | No errors | No errors |

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - all masking is fully wired through the centralized lgpd-masking.ts module.

## Self-Check: PASSED

- server/routes/consultas.routes.ts: FOUND
- 07-02-SUMMARY.md: FOUND
- Commit 58f1f1e: FOUND
- Commit f4bd64a: FOUND
