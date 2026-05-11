# Phase 1: Regionalizacao - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning
**Source:** Auto-generated

<domain>
## Phase Boundary

Add coverage area (cities served) to providers. When a CPF is queried, the system identifies all providers in the same region to know which ERPs to search.

</domain>

<decisions>
## Implementation Decisions

- **D-01:** Add `cidadesAtendidas` column (text array) to providers table in shared/schema.ts
- **D-02:** Create UI in admin panel (provider detail) to configure cities with autocomplete
- **D-03:** Use BrasilAPI or static list of Brazilian cities for autocomplete
- **D-04:** Create server function `getRegionalProviders(providerId)` that returns all providers serving overlapping cities
- **D-05:** "Grande regiao" logic: if provider serves "Londrina", also include providers that serve cities in the metropolitan area (configurable radius or explicit list)
- **D-06:** Provider registration wizard should ask for coverage cities

### Claude's Discretion
- Whether to use a static JSON of Brazilian cities or an API
- Metropolitan area grouping logic
- UI component choice for city multi-select

</decisions>

<canonical_refs>
## Canonical References

- `shared/schema.ts` — providers table
- `server/routes/admin.routes.ts` — provider management
- `client/src/pages/admin-sistema.tsx` — admin UI

</canonical_refs>

<deferred>
## Deferred Ideas

None

</deferred>

---
*Phase: 01-regionalizacao*
