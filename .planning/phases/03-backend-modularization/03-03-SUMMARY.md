---
phase: 03-backend-modularization
plan: 03
subsystem: server/routes
tags: [route-extraction, modularization, express-router]
dependency_graph:
  requires: []
  provides: [provider-routes, erp-routes, admin-routes, financeiro-routes, credits-routes, chat-routes, ai-routes, public-routes]
  affects: [server/routes.ts]
tech_stack:
  added: []
  patterns: [express-router-modules, domain-grouped-routes]
key_files:
  created:
    - server/routes/provider.routes.ts
    - server/routes/erp.routes.ts
    - server/routes/admin.routes.ts
    - server/routes/financeiro.routes.ts
    - server/routes/credits.routes.ts
    - server/routes/chat.routes.ts
    - server/routes/ai.routes.ts
    - server/routes/public.routes.ts
    - server/routes/utils.ts
  modified: []
decisions:
  - "Admin document review endpoints (status, list, download) placed in admin.routes.ts alongside other admin operations"
  - "Asaas webhook (POST /api/asaas/webhook) placed in financeiro.routes.ts as payment domain"
  - "Visitor chat endpoints grouped into chat.routes.ts rather than separate module"
  - "utils.ts created here (also created by Plan 03-02) to unblock parallel execution"
metrics:
  duration: ~11min
  completed: "2026-03-30T09:49:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 9
---

# Phase 03 Plan 03: Route Extraction Group B Summary

8 Express Router modules extracted covering 94 endpoints across provider, ERP, admin, financial, credits, chat, AI, and public domains.

## What Was Done

### Task 1: Extract provider, erp, chat, ai, and public routes
- **provider.routes.ts** (20 endpoints): tenant resolve, user management, settings, profile, integration/webhook token, n8n config, partners CRUD, documents CRUD
- **erp.routes.ts** (7 endpoints): ERP integrations CRUD, test connection, sync, sync logs, stats, webhook-based sync
- **chat.routes.ts** (15 endpoints): admin support chat (threads, messages, status), provider support chat (thread, messages, unread), visitor chat (start, messages, unread, admin management)
- **ai.routes.ts** (2 endpoints): consultation analysis and anti-fraud analysis with SSE streaming
- **public.routes.ts** (2 endpoints): public ERP catalog (no auth) and authenticated ERP catalog
- **utils.ts**: shared helpers (testErpConnection, fetchErpCustomers, getOverdueAmountRange, getRecommendedActions)

### Task 2: Extract admin, financeiro, and credits routes
- **admin.routes.ts** (24 endpoints): system stats, providers CRUD, resend verification, plan/credits management, provider detail, integration/n8n config, ERP admin, users CRUD, plan history, document review, ERP catalog admin
- **financeiro.routes.ts** (14 endpoints): Asaas status/charge/sync/cancel/PIX, webhook (NO auth), SaaS metrics, financial summary, invoices CRUD, monthly generation
- **credits.routes.ts** (10 endpoints): provider purchase/orders/PIX, admin credit orders CRUD/release/charge/sync/PIX

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created utils.ts for parallel execution**
- **Found during:** Task 1
- **Issue:** erp.routes.ts imports testErpConnection/fetchErpCustomers from ./utils, but Plan 03-02 (running in parallel) also creates this file
- **Fix:** Created utils.ts with full helper functions to unblock compilation
- **Files created:** server/routes/utils.ts

**2. [Rule 2 - Missing functionality] Added admin document review endpoints to admin.routes.ts**
- **Found during:** Task 2
- **Issue:** Three admin document endpoints (status review, list, download) at lines 2441-2492 of routes.ts were not listed in plan but belong to admin domain
- **Fix:** Included them in admin.routes.ts under "Admin document review" section
- **Files modified:** server/routes/admin.routes.ts

## Verification Results

- All 8 route files export a register function returning Express Router
- Combined endpoint count: 94 (20+7+15+2+2+24+14+10)
- TypeScript compilation: all errors are pre-existing (Express 5 string|string[] param types, n8nErpProvider missing from type)
- No new errors introduced by extraction
- Asaas webhook endpoint has NO auth middleware (confirmed)
- All requireSuperAdmin middleware preserved on admin/financial routes
- Original routes.ts left untouched (Plan 03-04 handles cleanup)

## Known Stubs

None - all route handlers are verbatim copies from routes.ts.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | f096000 | Extract provider, erp, chat, ai, public routes + utils |
| 2 | 1578461 | Extract admin, financeiro, credits routes |
