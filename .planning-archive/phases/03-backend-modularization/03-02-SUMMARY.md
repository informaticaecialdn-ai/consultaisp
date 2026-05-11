---
phase: 03-backend-modularization
plan: 02
subsystem: backend-routes
tags: [modularization, routes, express-router, domain-modules]
dependency_graph:
  requires: []
  provides: [auth-routes, dashboard-routes, import-routes, consultas-routes, antifraude-routes, equipamentos-routes, heatmap-routes, route-utils]
  affects: [server/routes.ts, server/index.ts]
tech_stack:
  added: []
  patterns: [express-router-modules, register-function-pattern, shared-utils-module]
key_files:
  created:
    - server/routes/utils.ts
    - server/routes/auth.routes.ts
    - server/routes/dashboard.routes.ts
    - server/routes/import.routes.ts
    - server/routes/equipamentos.routes.ts
    - server/routes/consultas.routes.ts
    - server/routes/antifraude.routes.ts
    - server/routes/heatmap.routes.ts
  modified: []
decisions:
  - "Shared helper functions (calculateIspScore, getRiskTier, testErpConnection, fetchErpCustomers) placed in server/routes/utils.ts"
  - "Equipamentos module created as thin wrapper since no dedicated /api/equipamentos/* CRUD routes exist in routes.ts"
  - "Fixed TypeScript strict mode issues in extracted files: Set iteration via Array.from(), explicit type annotations for reduce callbacks"
metrics:
  duration: 14min
  completed: "2026-03-30T09:51:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 8
  files_modified: 0
  total_lines: 2115
---

# Phase 03 Plan 02: Extract Route Modules Group A Summary

Extracted 7 Express Router modules from the monolithic routes.ts (3728 lines), covering auth, dashboard, import, consultas, antifraude, equipamentos, and heatmap domains, plus a shared utils module.

## One-liner

7 route modules extracted from routes.ts with identical handler logic, shared utils for score/ERP functions, TypeScript compiles clean

## Tasks Completed

### Task 1: Extract auth, dashboard, import, and equipamentos routes
**Commit:** cad73a5

Created 4 route modules plus shared utils:
- **server/routes/utils.ts** (213 lines): calculateIspScore, getRiskTier, getDecisionReco, getOverdueAmountRange, getRecommendedActions, testErpConnection, fetchErpCustomers
- **server/routes/auth.routes.ts** (168 lines): 7 endpoints (login, check-subdomain, register, verify-email, resend-verification, logout, me)
- **server/routes/dashboard.routes.ts** (93 lines): 9 endpoints (stats, defaulters, inadimplentes, customers, invoices, equipment, contracts)
- **server/routes/import.routes.ts** (191 lines): 3 CSV import endpoints (customers, invoices, equipment)
- **server/routes/equipamentos.routes.ts** (28 lines): Equipment listing endpoint

### Task 2: Extract consultas, antifraude, and heatmap routes
**Commit:** 204c476

Created 3 route modules:
- **server/routes/consultas.routes.ts** (1237 lines): Full ISP consultation flow (N8N central, legacy N8N, local DB fallback), SPC consultation with simulated bureau data, address cross-reference, CEP fallback
- **server/routes/antifraude.routes.ts** (106 lines): 3 anti-fraud endpoints (alerts list, status update, customer risk analysis)
- **server/routes/heatmap.routes.ts** (79 lines): 4 endpoints (maps-key, provider heatmap, regional heatmap, city ranking)

## Endpoint Coverage

| Module | Endpoints | Lines |
|--------|-----------|-------|
| auth | 7 | 168 |
| dashboard | 9 | 93 |
| import | 3 | 191 |
| equipamentos | 1 | 28 |
| consultas | 4 (ISP GET/POST, SPC GET/POST) | 1237 |
| antifraude | 3 | 106 |
| heatmap | 4 | 79 |
| utils (shared) | N/A | 213 |
| **Total** | **31** | **2115** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript strict mode errors in extracted files**
- **Found during:** Task 2 verification
- **Issue:** Set spread (`[...new Set()]`) and Map iteration (`for...of Map`) fail without downlevelIteration; `reduce` callback parameters need explicit types in strict mode
- **Fix:** Used `Array.from()` for Set/Map iteration, added explicit type annotations for reduce callbacks
- **Files modified:** server/routes/consultas.routes.ts, server/routes/antifraude.routes.ts
- **Commit:** 204c476

**2. [Rule 3 - Blocking] No /api/equipamentos/* CRUD routes exist in routes.ts**
- **Found during:** Task 1
- **Issue:** Plan assumed dedicated equipamentos CRUD routes exist, but routes.ts only has GET /api/equipment (in dashboard section) and POST /api/import/equipment (in import section)
- **Fix:** Created equipamentos.routes.ts as a thin module with the equipment listing endpoint; documented that no dedicated CRUD exists
- **Files modified:** server/routes/equipamentos.routes.ts
- **Commit:** cad73a5

## Decisions Made

1. **Shared utils module**: Helper functions used across multiple routes (score calculation, ERP connection testing) placed in `server/routes/utils.ts` rather than duplicated
2. **Contracts endpoint in dashboard**: GET /api/contracts placed in dashboard.routes.ts since it serves the provider dashboard view
3. **Equipment endpoint dual-registration**: GET /api/equipment exists in both dashboard and equipamentos modules during migration; Plan 03-04 will resolve the final wiring

## Known Stubs

None - all endpoints contain complete handler logic copied verbatim from routes.ts.

## Notes for Plan 03-03

The remaining routes to extract (Group B) include:
- Provider routes (tenant, users, settings, profile, integration, n8n-config, erp-integrations, partners, documents)
- ERP routes (webhooks/erp-sync)
- Admin routes (stats, providers CRUD, users, plan-history, chat, asaas, invoices, credit-orders, erp-catalog, visitor-chats)
- Financial routes (saas-metrics, summary, invoices)
- Credits routes (orders, purchase)
- Chat routes (thread, messages, unread)
- AI routes (analyze-consultation, analyze-antifraud)
- Public routes (erp-catalog, visitor-chat)

## Self-Check: PASSED

All 8 created files verified on disk. Both task commits (cad73a5, 204c476) verified in git log.
