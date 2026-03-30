---
phase: 04-erp-connector-engine
plan: 03
subsystem: erp-connectors
tags: [erp, hubsoft, voalle, rbx, oauth2, connectors]
dependency_graph:
  requires: [04-01]
  provides: [hubsoft-connector, voalle-connector, rbx-connector]
  affects: [erp-registry, store-config]
tech_stack:
  added: []
  patterns: [oauth2-token-caching, post-body-auth, session-fallback-auth]
key_files:
  created:
    - server/erp/connectors/hubsoft.ts
    - server/erp/connectors/voalle.ts
    - server/erp/connectors/rbx.ts
  modified: []
decisions:
  - "D-08: Hubsoft OAuth2 tries JSON first, falls back to form-urlencoded"
  - "D-09: Voalle uses direct Bearer with session-auth fallback on 401"
  - "D-10: RBX uses single endpoint URL with modulo/acao in POST body"
metrics:
  duration_seconds: 196
  completed: 2026-03-30T16:10:00Z
  tasks_completed: 2
  tasks_total: 2
---

# Phase 04 Plan 03: ERP Connectors Wave 2 (Hubsoft, Voalle, RBX) Summary

Three ERP connectors with complex auth patterns: Hubsoft OAuth2 with token caching and auto-refresh, Voalle Integration User with session fallback, RBX POST-body ChaveIntegracao with SQL-like filters.

## Tasks Completed

### Task 1: Hubsoft Connector with OAuth2 Token Lifecycle
- **Commit:** ab8de65
- **Files:** server/erp/connectors/hubsoft.ts (313 lines)
- **Details:**
  - OAuth2 password grant with client_id, client_secret, username, password
  - Token cache keyed by apiUrl with TTL and 60-second safety buffer
  - Dual format support: JSON body first, form-urlencoded fallback
  - Automatic token invalidation and single retry on 401 responses
  - testConnection validates OAuth token acquisition
  - fetchDelinquents/fetchCustomers with full normalization pipeline
  - Own CircuitBreaker instance; data calls wrapped in withResilience

### Task 2: Voalle and RBX Connectors
- **Commit:** 2a8ee9a
- **Files:** server/erp/connectors/voalle.ts (266 lines), server/erp/connectors/rbx.ts (281 lines)
- **Voalle Details:**
  - Integration User Bearer token auth with session-based fallback on 401
  - LOW CONFIDENCE annotations on endpoint paths (limited docs)
  - Fallback from /financeiro/inadimplentes to /titulos?status=vencido
  - Graceful "formato de resposta inesperado" error messages
- **RBX Details:**
  - ChaveIntegracao in POST body (not headers) — all requests to single URL
  - SQL-like filters via condicao parameter (e.g., "status = 'vencido'")
  - Fallback from listar_inadimplentes to pendencias_financeiras acao
  - Error detection in response body (erro field)

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

1. **D-08 (Hubsoft OAuth format):** Try JSON Content-Type first for token requests, fall back to form-urlencoded. Some Hubsoft instances require one or the other.
2. **D-09 (Voalle auth strategy):** Direct Bearer token first, then attempt POST /api/v1/auth session login on 401. Annotated all endpoint paths as LOW CONFIDENCE.
3. **D-10 (RBX endpoint pattern):** Single POST endpoint with modulo/acao differentiation. Added fallback acao for delinquents (listar_inadimplentes -> pendencias_financeiras).

## Known Stubs

None. All connectors are fully implemented against the ErpConnector interface. Actual API endpoint paths for Voalle are best-effort and annotated as such (this is inherent to the limited documentation, not a stub).

## Verification

- All three files compile without TypeScript errors
- All three connectors implement ErpConnector interface
- All three register themselves in the connector registry on import
- Hubsoft has OAuth token caching with TTL and 1-min buffer
- RBX sends ChaveIntegracao in POST body, not headers
- All connectors normalize output to NormalizedErpCustomer
