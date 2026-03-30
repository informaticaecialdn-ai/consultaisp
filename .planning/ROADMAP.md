# Roadmap: Consulta ISP (Milestone: Refactoring + ERP Direto)

## Overview

This milestone transforms a functional-but-monolithic beta into a production-ready, maintainable system with native ERP integrations. The work follows a strict dependency chain: secure the foundation first, extract reusable modules, decompose the monolith, build ERP connectors into the clean codebase, wire up the UI and remove N8N, tackle undocumented ERPs with research, and finally harden LGPD compliance. N8N stays alive as a fallback until connectors are proven in production.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Security & Cleanup** - Remove hardcoded secrets, Replit artifacts, and unify price constants (completed 2026-03-30)
- [ ] **Phase 2: Foundation & Docker** - Extract pure business logic modules and containerize for VPS deployment
- [ ] **Phase 3: Backend Modularization** - Decompose routes.ts (4350 lines) and storage.ts (1800 lines) into domain modules
- [ ] **Phase 4: ERP Connector Engine** - Build abstract connector interface and implement 6 documented ERP connectors
- [ ] **Phase 5: ERP UI & N8N Removal** - Wire ERP config UI, sync controls, and eliminate N8N dependency
- [ ] **Phase 6: Undocumented ERP Connectors** - Research and implement TopSApp, RadiusNet, Gere, ReceitaNet connectors
- [ ] **Phase 7: LGPD Hardening** - Systematize data masking, create centralized middleware, ensure legal compliance

## Phase Details

### Phase 1: Security & Cleanup
**Goal**: The codebase is free of hardcoded secrets, platform-specific artifacts, and data inconsistencies
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, SEC-03, FIX-01
**Success Criteria** (what must be TRUE):
  1. No hardcoded credentials exist in source code -- all secrets come from environment variables
  2. No Replit-specific packages remain in package.json and no Replit directories/files exist in the project
  3. Price values shown on the landing page match the constants used in backend billing logic
  4. The application builds and runs cleanly after all removals
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md -- Remove hardcoded N8N secrets and clean all Replit artifacts
- [x] 01-02-PLAN.md -- Unify price constants and validate full build

### Phase 2: Foundation & Docker
**Goal**: Core business logic is extracted into testable modules and the application runs in Docker on any VPS
**Depends on**: Phase 1
**Requirements**: MOD-01, DOCK-01, DOCK-02, DOCK-03, DOCK-04, DOCK-05
**Success Criteria** (what must be TRUE):
  1. Score engine (calculateIspScore), LGPD masking, and geocoding functions exist as independent modules with their own imports -- not embedded in routes.ts
  2. Running `docker-compose up` starts the full application (app + PostgreSQL) and serves the landing page
  3. The application responds to health check requests and shuts down gracefully on SIGTERM
  4. Missing required environment variables cause a clear error at startup (not a runtime crash)
  5. Application logs are structured JSON (pino) viewable via `docker logs`
**Plans**: 3 plans

Plans:
- [ ] 02-01-PLAN.md -- Extract score engine, LGPD masking, geocoding modules + install pino structured logging
- [ ] 02-02-PLAN.md -- Add health check endpoint, graceful shutdown, and env validation
- [ ] 02-03-PLAN.md -- Create Dockerfile, docker-compose.yml, and deployment config

### Phase 3: Backend Modularization
**Goal**: The monolithic routes.ts and storage.ts are decomposed into maintainable domain modules without breaking any existing functionality
**Depends on**: Phase 2
**Requirements**: MOD-02, MOD-03, MOD-04
**Success Criteria** (what must be TRUE):
  1. routes.ts is replaced by ~14 domain router modules (auth, consultas, erp, admin, financeiro, etc.) each under 800 lines
  2. storage.ts is replaced by domain storage modules behind the unchanged IStorage facade -- existing code using `storage.` continues to work
  3. Every API endpoint that worked before modularization still works identically after (same request/response behavior)
  4. Multi-tenant isolation is preserved -- no endpoint returns data from a different provider's tenant
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD
- [ ] 03-04: TBD

### Phase 4: ERP Connector Engine
**Goal**: Providers can connect directly to their ERP systems (IXC, MK, SGP, Hubsoft, Voalle, RBX) without any intermediary proxy
**Depends on**: Phase 3
**Requirements**: ERP-01, ERP-02, ERP-03, ERP-04, ERP-05, ERP-06, ERP-07, ERP-12, ERP-13, ERP-14
**Success Criteria** (what must be TRUE):
  1. A provider admin can configure their ERP connection (API URL, credentials) and run a successful connection test for any of the 6 supported ERPs
  2. Each connector fetches delinquent customers and normalizes them into the shared ErpCustomer format
  3. Failed ERP API calls retry with backoff and trigger circuit breaker protection after repeated failures
  4. Connectors are registered in a dynamic registry -- adding a new ERP requires only implementing the interface and registering it
  5. Rate limiting prevents any single provider from overwhelming an ERP API
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD
- [ ] 04-03: TBD
- [ ] 04-04: TBD

### Phase 5: ERP UI & N8N Removal
**Goal**: Providers have a complete UI for managing ERP integrations, and the N8N proxy dependency is fully eliminated
**Depends on**: Phase 4
**Requirements**: ERPUI-01, ERPUI-02, ERPUI-03, ERPUI-04, N8N-01, N8N-02, N8N-03, N8N-04, N8N-05
**Success Criteria** (what must be TRUE):
  1. The ERP configuration screen shows different form fields depending on the selected ERP type (Basic Auth fields for IXC, OAuth fields for Hubsoft, etc.)
  2. A provider can test their ERP connection and see success/failure feedback directly in the UI
  3. A provider can trigger manual sync and see progress and sync logs in the UI
  4. The ERP catalog page displays all available connectors with setup instructions
  5. The scheduler and heatmap use direct ERP connectors -- no N8N webhook URLs are called anywhere in the codebase
  6. The heatmap displays delinquency data from all configured ERPs, not just IXC
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD
- [ ] 05-03: TBD

### Phase 6: Undocumented ERP Connectors
**Goal**: The platform supports TopSApp, RadiusNet, Gere, and ReceitaNet ERPs after researching their undocumented APIs
**Depends on**: Phase 4
**Requirements**: ERP-08, ERP-09, ERP-10, ERP-11
**Success Criteria** (what must be TRUE):
  1. Each of the 4 ERPs has a working connector that passes connection test with valid credentials
  2. Each connector fetches and normalizes delinquent customer data into the standard ErpCustomer format
  3. If any ERP proves to have no usable API, it is documented as unsupported with the reason and deferred to v2
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: LGPD Hardening
**Goal**: Cross-provider data sharing is systematically masked through centralized middleware with no bypass paths
**Depends on**: Phase 3
**Requirements**: LGPD-01, LGPD-02, LGPD-03
**Success Criteria** (what must be TRUE):
  1. A centralized masking function/middleware processes ALL cross-tenant query responses -- no direct data paths bypass it
  2. ISP consultations for customers of other providers show only: partial name, value range (not exact), street without number, and provider name
  3. No API endpoint returns complete personal data (full name, full CPF, exact address) of customers belonging to a different provider
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 (and 6 in parallel with 5) -> 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security & Cleanup | 2/2 | Complete   | 2026-03-30 |
| 2. Foundation & Docker | 0/3 | Not started | - |
| 3. Backend Modularization | 0/4 | Not started | - |
| 4. ERP Connector Engine | 0/4 | Not started | - |
| 5. ERP UI & N8N Removal | 0/3 | Not started | - |
| 6. Undocumented ERP Connectors | 0/2 | Not started | - |
| 7. LGPD Hardening | 0/2 | Not started | - |
