# Phase 3: Backend Modularization - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Source:** Auto-generated (user delegated all decisions to Claude)

<domain>
## Phase Boundary

Decompose the monolithic routes.ts (~4350 lines, ~100+ endpoints) and storage.ts (~1800 lines, ~170+ methods) into domain-specific modules. Preserve all existing API behavior and multi-tenant isolation.

</domain>

<decisions>
## Implementation Decisions

### Routes Modularization
- **D-01:** Split routes.ts into ~14 Express Router modules by URL prefix/domain:
  - server/routes/auth.ts — /api/auth/*
  - server/routes/dashboard.ts — /api/dashboard/*, /api/inadimplentes, /api/defaulters, /api/customers
  - server/routes/consultas.ts — /api/isp-consultations/*, /api/spc-consultations/*
  - server/routes/antifraude.ts — /api/anti-fraud/*
  - server/routes/equipamentos.ts — /api/equipamentos/*, /api/equipment
  - server/routes/erp.ts — /api/provider/erp-*, /api/provider/n8n-*, /api/webhooks/erp-*
  - server/routes/heatmap.ts — /api/heatmap/*
  - server/routes/provider.ts — /api/provider/profile, /api/provider/settings, /api/provider/partners, /api/provider/documents, /api/provider/users, /api/provider/webhook-config, /api/provider/trial-status
  - server/routes/creditos.ts — /api/credits/*
  - server/routes/importacao.ts — /api/import/*
  - server/routes/admin.ts — /api/admin/* (superadmin endpoints)
  - server/routes/financeiro.ts — /api/invoices, /api/contracts, /api/admin/invoices, /api/admin/financial/*
  - server/routes/ai.ts — /api/ai/*
  - server/routes/public.ts — /api/public/*, /api/asaas/webhook
- **D-02:** Each module exports an Express Router, registered in a new server/routes/index.ts
- **D-03:** routes.ts is deleted after all routes are migrated (not kept as a wrapper)
- **D-04:** Auth middleware (requireAuth, requireAdmin, requireSuperAdmin) stays in server/auth.ts, imported by each router

### Storage Modularization
- **D-05:** Split storage.ts into domain modules with facade pattern:
  - server/storage/users.ts
  - server/storage/providers.ts
  - server/storage/customers.ts
  - server/storage/consultations.ts
  - server/storage/erp.ts
  - server/storage/antifraude.ts
  - server/storage/equipment.ts
  - server/storage/financeiro.ts
  - server/storage/support.ts
  - server/storage/admin.ts
- **D-06:** Facade in server/storage/index.ts re-exports a single `storage` object with the same IStorage interface
- **D-07:** Existing code using `storage.methodName()` continues working unchanged
- **D-08:** Each storage module gets the shared db instance via import from server/db.ts

### Multi-tenant Preservation
- **D-09:** Every route module must maintain providerId filtering — 84 refs in current routes.ts
- **D-10:** No endpoint should return data from a different provider's tenant after modularization

### Claude's Discretion
- Exact line ranges for splitting (analyze the file and decide)
- Whether to keep utility functions in a shared routes/utils.ts
- Order of migration (which domain first)

</decisions>

<canonical_refs>
## Canonical References

### Source Files
- `server/routes.ts` — Monolithic routes file to decompose (~4350 lines)
- `server/storage.ts` — Monolithic storage file to decompose (~1800 lines)
- `server/auth.ts` — Auth middleware (stays intact, imported by route modules)

### Architecture Research
- `.planning/research/ARCHITECTURE.md` — Module boundaries and decomposition strategy

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- server/auth.ts — requireAuth, requireAdmin, requireSuperAdmin middleware
- server/db.ts — Database connection (shared by all storage modules)
- server/logger.ts — Pino logger (from Phase 2)
- server/score-engine.ts — Already extracted (Phase 2)
- server/lgpd-masking.ts — Already extracted (Phase 2)
- server/geocoding.ts — Already extracted (Phase 2)

### Established Patterns
- Express Router for route grouping
- IStorage interface in storage.ts
- Drizzle ORM for all database queries
- req.session.providerId for tenant isolation

### Integration Points
- server/index.ts registers routes (needs to import from new routes/index.ts)
- All route handlers call storage.* methods (unchanged interface)

</code_context>

<specifics>
## Specific Ideas

None — standard modularization following Express Router pattern.

</specifics>

<deferred>
## Deferred Ideas

None

</deferred>

---

*Phase: 03-backend-modularization*
*Context gathered: 2026-03-30*
