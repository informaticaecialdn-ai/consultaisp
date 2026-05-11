---
phase: 01-regionalizacao
plan: 01
subsystem: regional-providers
tags: [schema, backend, regionalization, api]
dependency_graph:
  requires: []
  provides: [cidadesAtendidas-column, regional-service, regional-api, cities-dataset]
  affects: [providers-table, storage-interface]
tech_stack:
  added: []
  patterns: [postgresql-array-overlap, static-json-dataset]
key_files:
  created:
    - shared/schema.ts (cidadesAtendidas column)
    - shared/data/cidades-brasil.json
    - server/services/regional.service.ts
    - server/routes/regional.routes.ts
  modified:
    - server/storage.ts (IStorage + DatabaseStorage)
    - server/routes.ts (route registration)
    - tsconfig.json (resolveJsonModule)
decisions:
  - Used fs.readFileSync for JSON import in routes instead of ESM import to avoid TS module resolution issues
  - Fetched all 5571 IBGE municipalities (complete dataset, not top-500 subset)
  - Adapted to monolithic storage.ts/routes.ts structure in worktree instead of modularized storage/ directory
metrics:
  duration: ~13 minutes
  completed: 2026-04-01
---

# Phase 01 Plan 01: Schema + Cities Data + Regional Service Summary

PostgreSQL text[] cidadesAtendidas column on providers table with 5571 IBGE cities dataset and regional overlap service using array && operator.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Schema + cities data + regional service | ca673d3 | shared/schema.ts, shared/data/cidades-brasil.json, server/services/regional.service.ts, server/storage.ts |
| 2 | Regional API routes | 45f497d | server/routes/regional.routes.ts, server/routes.ts |

## What Was Built

### 1. Schema Change (cidadesAtendidas)
Added `cidadesAtendidas: text("cidades_atendidas").array().default(sql"'{}'::text[]")` to the providers table. This stores cities as a PostgreSQL native text array, enabling the `&&` (overlap) operator for efficient regional matching.

### 2. Brazilian Cities Dataset
Created `shared/data/cidades-brasil.json` with all 5571 Brazilian municipalities fetched from the IBGE API (`servicodados.ibge.gov.br`). Each entry has `nome`, `uf` (2-letter state code), and `ibge` (IBGE code string).

### 3. Regional Service
`server/services/regional.service.ts` exports `getRegionalProviders(providerId)` which:
1. Fetches the requesting provider's cidadesAtendidas
2. Uses PostgreSQL `&&` array overlap operator to find all other active providers sharing at least one city

### 4. Storage Layer
Added `updateProviderCidades(id, cidades)` to both `IStorage` interface and `DatabaseStorage` class in the monolithic `server/storage.ts`.

### 5. Regional API Routes
`server/routes/regional.routes.ts` exposes 4 endpoints:
- `GET /api/regional/cities?q=&limit=` - City autocomplete with "CityName - UF" format
- `GET /api/regional/providers` - Find providers with overlapping coverage areas
- `PUT /api/regional/cidades` - Update provider's cidadesAtendidas with validation
- `GET /api/regional/my-cidades` - Get authenticated provider's current cities

## Deviations from Plan

### Structural Adaptation

**1. [Rule 3 - Blocking] Adapted to monolithic file structure**
- **Found during:** Task 1-2
- **Issue:** Plan referenced `server/storage/providers.storage.ts` and `server/storage/index.ts` but worktree has monolithic `server/storage.ts`
- **Fix:** Added interface method and implementation directly to `server/storage.ts`
- **Files modified:** server/storage.ts

**2. [Rule 3 - Blocking] Used fs.readFileSync for JSON import**
- **Found during:** Task 2
- **Issue:** Direct ESM JSON import (`import citiesData from "..."`) requires additional TS config and may not work with the bundler setup
- **Fix:** Used `readFileSync` + `JSON.parse` at module load time (one-time cost, same as static import)
- **Files modified:** server/routes/regional.routes.ts

**3. [Rule 2 - Enhancement] Full IBGE dataset instead of top-500**
- **Found during:** Task 1
- **Issue:** Plan mentioned "top 500 Brazilian cities" but also referenced "ALL Brazilian municipalities from IBGE data (~5570 entries)"
- **Fix:** Downloaded complete dataset (5571 cities) for comprehensive coverage
- **Files modified:** shared/data/cidades-brasil.json

## Decisions Made

1. **Complete IBGE dataset**: Used all 5571 municipalities rather than a subset, ensuring no city is missing from autocomplete
2. **fs.readFileSync for JSON**: More reliable than ESM import for JSON files across different bundler configurations
3. **resolveJsonModule in tsconfig**: Added for future JSON import compatibility

## Known Stubs

None - all data sources are fully wired and functional.

## Verification Results

- cidadesAtendidas column present in providers schema definition
- cidades-brasil.json contains 5571 entries with nome/uf/ibge fields
- getRegionalProviders function exported from regional.service.ts
- registerRegionalRoutes function exported and wired into routes.ts
- TypeScript compilation: no errors in modified files (pre-existing errors in unrelated files only)
- drizzle-kit push not executed (no DATABASE_URL in worktree environment)

## Self-Check: PASSED

All 7 files verified present. Both commits (ca673d3, 45f497d) verified in git log.
