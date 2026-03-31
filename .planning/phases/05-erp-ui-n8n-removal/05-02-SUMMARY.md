---
phase: 05-erp-ui-n8n-removal
plan: 02
subsystem: frontend-erp-ui
tags: [n8n-removal, dynamic-forms, erp-config, connector-ui]
dependency_graph:
  requires: [05-01]
  provides: [dynamic-erp-config-ui, n8n-free-frontend]
  affects: [client/src/pages/painel-provedor.tsx]
tech_stack:
  added: []
  patterns: [connector-metadata-driven-forms, per-erp-inline-feedback]
key_files:
  created: []
  modified:
    - client/src/pages/painel-provedor.tsx
decisions:
  - Used connectorMeta from GET /api/erp-connectors as sole source of truth for available connectors and their fields
  - Merged catalog data (logos, gradients) with connector metadata for visual display
  - Stored ERP_SETUP_HINTS as local constant per connector for unconfigured state guidance
  - Password fields use show/hide toggle with Lock/Key icons instead of Eye/EyeOff
metrics:
  duration: 14m
  completed: 2026-03-29
---

# Phase 05 Plan 02: ERP Configuration UI with Dynamic Forms Summary

Dynamic ERP config forms driven by connector metadata with per-type fields, connection test/sync controls, status badges, and complete N8N UI removal.

## Task Results

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | Remove N8N UI code and add dynamic ERP config forms | af1ca3f | Done |
| 2 | Update ERP catalog display with all 6 connectors and setup instructions | af1ca3f | Done (combined with Task 1) |

## Changes Made

### Task 1: Dynamic ERP Config Forms + N8N Removal

**Removed N8N state/queries/mutations:**
- Deleted `n8nForm`, `n8nTestResult`, `n8nPending`, `erpLocalSelection`, `erpChanging` useState calls
- Deleted `n8nConfig` useQuery for `/api/provider/n8n-config`
- Deleted `saveN8nMutation` useMutation for PATCH `/api/provider/n8n-config`
- Deleted `refetchN8n` reference
- Removed unused imports: `Settings2`, `Terminal`

**Added connector metadata query:**
- `useQuery` for `GET /api/erp-connectors` with `staleTime: 10min`
- Returns typed array with `name`, `label`, `configFields[]`

**Added per-ERP config form state:**
- `editingErp` and `erpFormData` for tracking which connector is being edited
- `showPassFields` for password visibility toggles
- `saveErpConfigMutation` using PATCH `/api/provider/erp-integrations/:source`

**Replaced stats section:**
- Derives active ERP count from `erpIntegrationsList.filter(i => i.isEnabled)` instead of `n8nConfig.n8nEnabled`
- Shows comma-separated list of enabled ERP names instead of single `n8nErpProvider`

**Replaced ERP Selection + Integrations cards with unified connector list:**
- All connectors from `connectorMeta` always shown (not just those with integration records)
- Each connector has: logo/icon + label + status badge + enable/disable Switch + expand/collapse
- Expanded section renders dynamic config fields from `connector.configFields`
- Field key mapping: `apiUrl`, `apiToken`, `apiUser` -> direct; `extra.clientId` -> `clientId`; `extra.clientSecret` -> `clientSecret`
- Save/Test/Sync buttons with inline feedback (green success, red error badges)
- Pre-fills form from existing integration data when expanding

### Task 2: ERP Catalog with Status Badges and Setup Hints

**Status badges per connector:**
- "Configurado" (green) - apiUrl/apiToken set and isEnabled true
- "Credenciais pendentes" (amber) - isEnabled but missing credentials
- "Desativado" (gray) - not enabled
- "Erro" (red) - lastSyncStatus is error

**Setup hints for unconfigured connectors:**
- IXC: "Configure usuario e token da API IXC (menu Administracao > Tokens API)"
- MK: "Insira o token JWT do MK Solutions (Configuracoes > API)"
- SGP: "Token API do SGP (Configuracoes > Integracao > API)"
- Hubsoft: "Configure Client ID, Client Secret e credenciais OAuth (Painel Hubsoft > API)"
- Voalle: "Configure usuario de integracao Voalle (Administracao > Integracao)"
- RBX: "Insira a URL do RouterBox e a Chave de Integracao"

## Verification Results

1. `grep n8nConfig|n8nForm|n8nPending|n8n-config` -> empty (no N8N references)
2. `grep erp-connectors` -> found at line 148 (connector metadata query)
3. `tsc --noEmit` -> only pre-existing errors in other files; no new errors in painel-provedor.tsx

## Deviations from Plan

None - plan executed exactly as written. Tasks 1 and 2 were combined into a single commit since both modify the same file and the Task 2 features (status badges, setup hints, all 6 connectors) were naturally integrated into the Task 1 rewrite.

## Known Stubs

None - all data flows are wired to real API endpoints (GET /api/erp-connectors, PATCH /api/provider/erp-integrations/:source, POST test/sync).
