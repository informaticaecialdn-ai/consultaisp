# Phase 7: LGPD Hardening - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning
**Source:** Auto-generated

<domain>
## Phase Boundary

Systematize data masking for cross-provider queries through centralized middleware. Ensure no API endpoint leaks complete personal data between tenants.

</domain>

<decisions>
## Implementation Decisions

- **D-01:** Create server/lgpd-middleware.ts — Express middleware that intercepts all cross-tenant responses
- **D-02:** Use the existing lgpd-masking.ts functions (from Phase 2) as the masking engine
- **D-03:** Masking rules: partial name (first name + "xxxx"), value range (R$100-R$120 instead of exact), address without number, partial CPF (***.***.xxx-xx)
- **D-04:** Apply masking to ISP consultation results, anti-fraud alerts, and any endpoint that returns data from other providers
- **D-05:** Audit all API endpoints that return cross-provider data to ensure none bypass masking
- **D-06:** The middleware approach: rather than a blanket Express middleware, create a masking utility function called explicitly in each route handler that returns cross-provider data (more precise, less risk of masking own provider's data)

### Claude's Discretion
- Exact implementation approach (middleware vs utility function per route)
- Which specific endpoints need masking review
- Whether to add a masking bypass for superadmin users

</decisions>

<canonical_refs>
## Canonical References

- `server/lgpd-masking.ts` — Existing masking functions (from Phase 2)
- `server/routes/consultas.routes.ts` — ISP consultation results (main cross-provider data)
- `server/routes/antifraude.routes.ts` — Anti-fraud alerts (cross-provider)
- `server/routes/dashboard.routes.ts` — Dashboard stats (may include cross-provider summaries)

</canonical_refs>

<deferred>
## Deferred Ideas

None

</deferred>

---

*Phase: 07-lgpd-hardening*
*Context gathered: 2026-03-31*
