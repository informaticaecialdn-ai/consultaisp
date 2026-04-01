---
plan: 03-01
phase: 03-remocao-sync-centralizado
status: complete
started: 2026-04-01T18:10:00Z
completed: 2026-04-01T18:15:00Z
---

## Summary

Removed all ERP-to-customers sync logic. Deleted POST /api/provider/erp-integrations/:source/sync endpoint, syncErpCustomers storage method, and cleaned up orphaned imports. The customers table now only receives writes via createCustomer (CSV import / manual creation, own-provider scoped).

## Tasks

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | Remove sync endpoint + syncErpCustomers | Done | a9700b7 |
| 2 | Verify build + audit write paths | Done | (no commit needed — verification only) |

## Self-Check: PASSED

- [x] syncErpCustomers removed from storage interface, implementation, and route
- [x] POST sync endpoint removed from erp.routes.ts
- [x] Only createCustomer writes to customers table (verified via grep)
- [x] CSV import and manual creation untouched
- [x] ERP test/config endpoints untouched
- [x] No new TS errors introduced (80 pre-existing)

## Key Files

### Modified
- `server/routes/erp.routes.ts` — Removed sync endpoint (41 lines)
- `server/storage/customers.storage.ts` — Removed syncErpCustomers (79 lines), cleaned imports
- `server/storage/index.ts` — Removed syncErpCustomers from interface and delegation

## Lines Removed: 127

## Requirements Addressed

- NOSYNC-01: No sync endpoint exists
- NOSYNC-02: No upsert logic inserts cross-provider data
- NOSYNC-03: customers table contains only own-provider data
