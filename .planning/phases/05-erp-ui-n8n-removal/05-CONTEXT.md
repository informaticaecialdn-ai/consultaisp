# Phase 5: ERP UI & N8N Removal - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning
**Source:** Auto-generated (user delegated all decisions to Claude)

<domain>
## Phase Boundary

Complete ERP management UI for providers (dynamic config forms per ERP type, connection testing, sync controls) and fully eliminate N8N proxy dependency from the codebase. Expand heatmap to all ERPs.

</domain>

<decisions>
## Implementation Decisions

### ERP Config UI
- **D-01:** Dynamic form in the existing ERP configuration page that shows different fields per ERP type (Basic Auth fields for IXC, OAuth fields for Hubsoft, Bearer token for MK, etc.)
- **D-02:** Use shadcn/ui form components (Input, Select, Button) consistent with existing patterns
- **D-03:** ERP type selector drives which credential fields appear
- **D-04:** Connection test button with visual feedback (success/failure toast or inline status)

### Sync Controls
- **D-05:** Manual sync button per configured ERP with progress indication
- **D-06:** Sync logs displayed in a table with status, records synced/failed, timestamps
- **D-07:** Use existing TanStack Query patterns (useMutation for sync, useQuery for logs)

### N8N Removal
- **D-08:** Remove N8N_PROXY_URL and N8N_PROXY_AUTH env var reads from heatmap-cache.ts
- **D-09:** Replace heatmap N8N fetch with connector registry calls
- **D-10:** Remove N8N webhook endpoints from routes (POST /webhooks/erp-sync, /webhooks/erp-inadimplente)
- **D-11:** Remove n8n config routes (/api/provider/n8n-config)
- **D-12:** Remove n8n-related fields from provider UI (n8nWebhookUrl, n8nAuthToken, etc.)

### ERP Catalog
- **D-13:** Update ERP catalog page to show all 6 supported connectors with setup instructions

### Claude's Discretion
- Exact UI layout and form field placement
- Whether to use tabs or accordion for ERP config
- Toast vs inline feedback for connection test results

</decisions>

<canonical_refs>
## Canonical References

- `server/erp/` — Connector engine (from Phase 4)
- `server/routes/erp.routes.ts` — ERP route handlers
- `server/heatmap-cache.ts` — N8N proxy to remove
- `client/src/pages/administracao.tsx` — Provider admin page
- `client/src/pages/painel-provedor.tsx` — Provider settings panel

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- shadcn/ui components in client/src/components/ui/
- TanStack Query hooks pattern
- Existing ERP config UI (likely in administracao.tsx or painel-provedor.tsx)

### Integration Points
- server/erp/index.ts exports getSupportedSources() for catalog
- server/routes/erp.routes.ts already uses connectors for test/sync
- heatmap-cache.ts still uses N8N proxy — needs migration to connectors

</code_context>

<specifics>
## Specific Ideas

None — follow existing UI patterns.

</specifics>

<deferred>
## Deferred Ideas

None

</deferred>

---

*Phase: 05-erp-ui-n8n-removal*
*Context gathered: 2026-03-31*
