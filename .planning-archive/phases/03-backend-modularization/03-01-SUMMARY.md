---
phase: 03-backend-modularization
plan: 01
subsystem: storage
tags: [refactoring, modularization, storage, drizzle, multi-tenant]
dependency_graph:
  requires: []
  provides: [modular-storage, storage-facade]
  affects: [server/storage.ts, server/routes.ts, server/seed.ts]
tech_stack:
  added: []
  patterns: [facade-pattern, domain-module-delegation]
key_files:
  created:
    - server/storage/index.ts
    - server/storage/users.storage.ts
    - server/storage/providers.storage.ts
    - server/storage/customers.storage.ts
    - server/storage/consultations.storage.ts
    - server/storage/antifraude.storage.ts
    - server/storage/financial.storage.ts
    - server/storage/equipment.storage.ts
    - server/storage/erp.storage.ts
    - server/storage/chat.storage.ts
    - server/storage/dashboard.storage.ts
    - server/storage/admin.storage.ts
  modified:
    - server/storage.ts
decisions:
  - IStorage interface moved to storage/index.ts; old storage.ts becomes re-export shim
  - Non-interface methods (getSaasMetrics, updateProviderInvoiceAsaas) kept in domain modules and delegated through facade
  - Plan-mentioned methods that do not exist in codebase (getAntiFraudRules, getEquipamentosByProvider, getNotificationSettings, etc.) were omitted
metrics:
  duration: 8min
  completed: "2026-03-30"
  tasks_completed: 2
  tasks_total: 2
  files_created: 12
  files_modified: 1
---

# Phase 03 Plan 01: Storage Modularization Summary

Decomposed 1395-line monolithic storage.ts into 11 domain-specific storage modules behind an unchanged IStorage facade, preserving all existing imports and multi-tenant providerId filtering.

## What Was Done

### Task 1: Extract domain storage classes (182933a)
Split DatabaseStorage into 11 domain-specific classes, each importing db directly from server/db.ts with no cross-module imports:

| Module | Methods | Lines |
|--------|---------|-------|
| users.storage.ts | 11 | 66 |
| providers.storage.ts | 15 | 131 |
| customers.storage.ts | 5 | 102 |
| consultations.storage.ts | 10 | 95 |
| antifraude.storage.ts | 4 | 34 |
| financial.storage.ts | 28 | 234 |
| equipment.storage.ts | 3 | 19 |
| erp.storage.ts | 12 | 106 |
| chat.storage.ts | 15 | 119 |
| dashboard.storage.ts | 6 | 159 |
| admin.storage.ts | 8 | 174 |

### Task 2: Create storage facade and rewire exports (61b1e4d)
- Created server/storage/index.ts with DatabaseStorage facade class implementing IStorage
- Every method delegates to the appropriate domain module instance
- Converted server/storage.ts into a thin re-export: `export { storage, type IStorage } from "./storage/index"`
- All existing imports (`routes.ts`, `seed.ts`) continue working with zero changes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed updateVisitorChatStatus argument swap in facade**
- Found during: Task 2
- Issue: Facade delegation passed `(status, status)` instead of `(chatId, status)`
- Fix: Corrected argument order in index.ts delegation
- Files modified: server/storage/index.ts

**2. [Rule 1 - Bug] Fixed saveN8nConfig missing n8nErpProvider parameter**
- Found during: Task 2
- Issue: The facade and providers.storage.ts omitted the `n8nErpProvider` optional field from saveN8nConfig signature, causing TS error when routes.ts passed it
- Fix: Added `n8nErpProvider?: string | null` to both the interface and implementation signatures
- Files modified: server/storage/index.ts, server/storage/providers.storage.ts

### Scope Notes

- Plan-mentioned methods that do not exist in the actual codebase were omitted: getAntiFraudRules, upsertAntiFraudRules, seedDefaultRules, toggleAntiFraudRule, getNotificationSettings, saveNotificationSettings, getEquipamentosByProvider, createEquipamento, importEquipamentos, updateEquipamentoStatus, deleteEquipamento, getEquipamentosByCpf, getNetworkConsultationPoints
- Two non-interface methods (getSaasMetrics, updateProviderInvoiceAsaas) exist in the original DatabaseStorage but not in IStorage; these were placed in admin.storage.ts and financial.storage.ts respectively and delegated through the facade

## Verification

- TypeScript compilation: zero new errors (2 pre-existing errors in erp.storage.ts remain, identical to original storage.ts)
- All `import { storage } from "./storage"` consumers resolve correctly
- No storage module imports from another storage module (zero cross-imports)

## Known Stubs

None - all methods are direct copies of working implementations from the original storage.ts.

## Self-Check: PASSED

- All 12 created files verified present
- Both task commits (182933a, 61b1e4d) verified in git log
