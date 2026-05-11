# Phase 6: Undocumented ERP Connectors - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning
**Source:** Auto-generated

<domain>
## Phase Boundary

Research and implement connectors for TopSApp, RadiusNet, Gere, and ReceitaNet ERPs. These have no public API documentation. If an ERP proves to have no usable API, document as unsupported.

</domain>

<decisions>
## Implementation Decisions

- **D-01:** For each ERP, attempt web research to find API documentation
- **D-02:** If API exists, implement connector following the same ErpConnector interface from Phase 4
- **D-03:** If no API found, create a stub connector that returns a clear "unsupported" message and document the reason
- **D-04:** Add each connector to the registry in server/erp/index.ts
- **D-05:** All connectors go in server/erp/connectors/ directory

### Claude's Discretion
- Whether to research APIs via web search or create stub connectors directly
- How to handle ERPs with undocumented but discoverable APIs

</decisions>

<canonical_refs>
## Canonical References

- `server/erp/types.ts` — ErpConnector interface
- `server/erp/index.ts` — Registry barrel
- `server/erp/connectors/` — Existing 6 connectors as reference

</canonical_refs>

<deferred>
## Deferred Ideas

None

</deferred>

---

*Phase: 06-undocumented-erp-connectors*
*Context gathered: 2026-03-31*
