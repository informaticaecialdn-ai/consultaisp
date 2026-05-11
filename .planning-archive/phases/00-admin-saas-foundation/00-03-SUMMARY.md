---
phase: 00-admin-saas-foundation
plan: 03
subsystem: admin-routes
tags: [security, middleware, access-control]
dependency_graph:
  requires: []
  provides: [consistent-requireSuperAdmin-middleware]
  affects: [server/routes/admin.routes.ts]
tech_stack:
  added: []
  patterns: [middleware-based-access-control]
key_files:
  modified:
    - server/routes/admin.routes.ts
decisions:
  - Remove requireAuth import entirely since no admin route uses it after normalization
metrics:
  duration: 83s
  completed: 2026-04-01
---

# Phase 00 Plan 03: Normalize Admin Document Routes to requireSuperAdmin Summary

Replace inline role checks with requireSuperAdmin middleware on 3 document routes, ensuring consistent access control across all admin endpoints.

## What Was Done

### Task 1: Replace inline role checks with requireSuperAdmin on 3 document routes
**Commit:** 4886db1

Changed 3 document routes from `requireAuth` + inline `if (req.session.role !== "superadmin")` to `requireSuperAdmin` middleware:

1. **PATCH** `/api/admin/providers/:id/documents/:docId/status` - document status review
2. **GET** `/api/admin/providers/:id/documents` - documents list
3. **GET** `/api/admin/providers/:id/documents/:docId/download` - document download

Also removed the `requireAuth` import since no admin routes use it after this change.

**TENANT-02 confirmed:** CNPJ lookup endpoint at line 47 already uses `requireSuperAdmin`.

## Verification Results

- `requireAuth` occurrences: 0 (was 4: 1 import + 3 routes)
- Inline `role !== "superadmin"` checks: 0 (was 3)
- `requireSuperAdmin` occurrences: 25 (was 22, +3 from converted routes)
- CNPJ route: confirmed protected with `requireSuperAdmin`

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- [x] server/routes/admin.routes.ts exists
- [x] 00-03-SUMMARY.md exists
- [x] Commit 4886db1 exists in git log
