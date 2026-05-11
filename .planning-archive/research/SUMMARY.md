# Research Summary

**Project:** Consulta ISP - Milestone 2 (ERP Integrations, Backend Refactor, Docker, LGPD)
**Synthesized:** 2026-03-29
**Research files:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md

---

## Executive Summary

Consulta ISP is a Brazilian ISP credit bureau SaaS that shares delinquency data between internet service providers. Milestone 2 involves four parallel workstreams: (1) replacing the N8N proxy with native ERP connectors for 6-10 ISP billing systems (IXC, MK, SGP, Hubsoft, Voalle, RBX, and others), (2) decomposing a monolithic Express backend (4350-line routes.ts, 1800-line storage.ts) into domain modules, (3) containerizing with Docker for VPS deployment, and (4) hardening LGPD compliance for a system that functionally operates as a credit bureau.

The recommended approach is to treat this as a sequential dependency chain, not as parallel workstreams. The backend modularization must come first because a 4350-line routes file cannot safely absorb ERP connector integrations. The ERP connector system uses a Strategy pattern with a registry, per-ERP implementations, and a shared normalization layer. Docker deployment is straightforward (multi-stage build, Docker Compose with PostgreSQL) but requires coordinating IXC IP whitelisting with every provider. The stack additions are minimal: cockatiel for circuit breakers, pino for structured logging, express-rate-limit for inbound throttling -- net one new production dependency after removing Replit artifacts.

The most serious risk is legal, not technical. The platform shares negative credit data between unrelated companies, which may classify it as a credit bureau under Lei 12.414/2011 and CDC Art. 43, triggering registration and consumer notification obligations. A formal legal opinion must be obtained before scaling to production ISPs. On the technical side, the highest risk is breaking multi-tenant isolation during the routes refactoring -- the file has 84 references to `session.providerId` and zero automated tests verifying tenant boundaries. Tenant isolation tests must be written before any refactoring begins.

---

## Key Findings

### From STACK.md

- **No framework migration needed.** Express 5 with domain-based Router modules is sufficient. Migrating to Fastify/NestJS would be a rewrite of 100+ endpoints for marginal benefit.
- **Native fetch for ERP calls.** No axios or undici import needed; Node 18+ built-in fetch (undici under the hood) handles all REST interactions.
- **Cockatiel for resilience.** Composable circuit breaker + retry + timeout policies, critical for unreliable ERP APIs. Replaces ad-hoc p-retry usage with structured fault tolerance.
- **Pino for logging.** 5-10x faster than winston, JSON-native, essential for Docker log aggregation and ERP sync debugging. The project currently has no logging library.
- **node:20-slim, not alpine.** The `pg` driver and `esbuild` have native bindings that can fail on musl libc. Slim is Debian-based and avoids this.
- **Remove 4 Replit dependencies, add 4 production + 1 dev.** Net change: +1 production dependency.
- **LGPD is architectural, not a library.** No credible Node.js LGPD package exists. Compliance comes from audit logging, masking enforcement, data retention jobs, and documented legal basis.
- **4 of 10 ERP APIs have low-confidence documentation** (TopSApp, RadiusNet, Gere, ReceitaNet). These should be deferred.

### From FEATURES.md

**Table stakes (must-have):**
- Abstract ERP connector interface with per-ERP implementations
- IXC and MK connectors (largest market share)
- Connection test, manual sync, auto-sync scheduler expansion
- ERP-specific config UI (dynamic form per ERP type)
- Sync error logging UI
- Route and storage modularization (unblocks all backend work)
- Dockerfile, docker-compose, health check, graceful shutdown
- Structured logging, env var validation
- LGPD masking middleware, audit trail, data retention, DPA tracking

**Differentiators (should-have):**
- SGP, Hubsoft, Voalle, RBX connectors (4 more ERPs = wider network coverage)
- Automated database migrations (drizzle-kit generate/migrate instead of push)
- Blue-green/rolling deployments

**Defer to v2+:**
- TopSApp, RadiusNet, Gere, ReceitaNet connectors (undocumented APIs)
- Bidirectional ERP sync (write-back is high risk)
- Consumer self-service LGPD portal
- Public API for third parties
- Kubernetes orchestration

**Anti-features (deliberately avoid):**
- Direct ERP database access (always use REST APIs)
- Custom scoring algorithm editor (standardized score IS the value)
- Blockchain audit trail (PostgreSQL audit tables are legally sufficient)
- LGPD consent management platform (credit protection legal basis does not require consent)

### From ARCHITECTURE.md

- **Route decomposition into 14 domain modules** (auth, dashboard, import, consultas, anti-fraude, equipamentos, provider, erp, heatmap, credits, admin, chat, ai, public). Estimated 200-800 lines each.
- **Storage decomposition into 11 domain modules** behind an unchanged IStorage facade. Incremental extraction without breaking existing code.
- **ERP connector Strategy pattern:** minimal interface (testConnection, fetchDelinquents, fetchCustomers), per-connector auth handling, shared normalization layer for CPF/date/amount cleaning.
- **Hubsoft is the only connector requiring OAuth token lifecycle management.** All others use static credentials.
- **Heatmap should read from the customers table** (already synced by scheduler) instead of making direct ERP calls. This is the cleanest path to remove N8N.
- **Build order is dependency-driven:** Foundation (extract scoring, masking, geo utilities) then ERP connectors then route modularization then storage modularization then cleanup.
- **Docker: single app container + PostgreSQL.** No Redis needed initially. Scheduler runs in-process.

### From PITFALLS.md

**Critical (5):**

| # | Pitfall | Prevention |
|---|---------|------------|
| 1 | Operating as unregistered credit bureau under LGPD/Lei 12.414 | Get legal opinion before production scale-up. Implement consumer notification flow. |
| 2 | Current masking is cosmetic, not legally sufficient | Re-identification risk assessment for small cities. Consider k-anonymity suppression. |
| 3 | IXC IP whitelisting breaks after Docker migration | Keep N8N fallback 30+ days. Coordinate per-provider IP whitelist. Static VPS IP. |
| 4 | Route refactoring breaks multi-tenant isolation (84 providerId refs, zero tests) | Write tenant isolation tests BEFORE refactoring. Middleware-injected tenant context. |
| 5 | N8N removal kills heatmap and scheduler without graceful degradation | Feature flag per integration. IXC connector first. N8N removal is the LAST step. |

**Moderate (5):** ERP interface fragility across heterogeneous APIs, Docker session/cache loss, Replit artifacts causing build failures, hardcoded credentials in source, Express 5 path-to-regexp changes.

**Minor (3):** Price divergence between schema and landing page, Nominatim geocoding rate limits, no database migration strategy beyond drizzle-kit push.

**Immediate security action required:** Hardcoded N8N proxy credentials in heatmap-cache.ts must be rotated and moved to env vars before any other work.

---

## Implications for Roadmap

Based on the combined research, I recommend 5 phases ordered by dependency chain and risk mitigation.

### Phase 1: Security Fix and Replit Cleanup

**Rationale:** Hardcoded secrets are an active vulnerability. Replit artifacts create confusion and build noise. This is fast (1-2 days), unblocks everything, and removes technical debt.

**Delivers:** Clean, secure codebase foundation.

**Features:** Remove Replit dependencies (4 packages + directories), rotate hardcoded N8N credentials, move all secrets to env vars, unify price constants.

**Pitfalls to avoid:** Pitfall 8 (Replit artifacts), Pitfall 9 (hardcoded secrets), Pitfall 11 (price divergence).

**Research needed:** None. Standard cleanup patterns.

### Phase 2: Foundation Extraction and Docker

**Rationale:** Extract shared utilities (scoring engine, LGPD masking, geocoding) into independent modules before touching routes. Set up Docker deployment in parallel since it has no code dependencies on modularization. Write tenant isolation tests as a prerequisite for Phase 3.

**Delivers:** Deployable Docker container, extracted core business logic, tenant isolation test suite.

**Features:** Extract `calculateIspScore()` to `server/scoring/`, extract LGPD masking to `server/lgpd/`, extract geocoding to `server/geo/`, Dockerfile (multi-stage), docker-compose.yml, health check endpoint, graceful shutdown, structured logging (pino), env var validation, tenant isolation integration tests.

**Pitfalls to avoid:** Pitfall 7 (Docker session/cache loss), Pitfall 13 (no migration strategy -- switch to drizzle-kit generate/migrate).

**Research needed:** Phase-level research recommended for Docker deployment specifics (cookie domain migration, database export/import from Replit).

### Phase 3: Route and Storage Modularization

**Rationale:** The 4350-line routes.ts is the bottleneck for all backend changes. Must be decomposed before ERP connectors can be cleanly integrated. Storage follows routes because changing both layers simultaneously doubles regression risk.

**Delivers:** 14 route modules, 11 storage modules, maintainable codebase.

**Features:** Route modularization (14 domain modules), storage modularization (11 domain modules with IStorage facade), middleware extraction (auth, tenant, error handling, rate limiting).

**Pitfalls to avoid:** Pitfall 4 (tenant isolation regression -- tests from Phase 2 catch this), Pitfall 10 (Express 5 path-to-regexp changes).

**Research needed:** None. Architecture research provides complete decomposition plan with line estimates.

### Phase 4: ERP Connector Engine and N8N Removal

**Rationale:** With a modular codebase, ERP connectors slot cleanly into `server/erp/`. IXC first (largest market, existing behavior to validate against), then MK, then secondary ERPs. N8N removal is the last step after all providers confirm direct connections work.

**Delivers:** Native ERP integration for 6 ERPs, N8N dependency eliminated, heatmap using database queries instead of proxy calls.

**Features:** ERP connector interface and registry, IXC connector (refactor from N8N), MK connector, SGP connector, Hubsoft connector (OAuth), Voalle connector, RBX connector, scheduler update to use registry, heatmap-cache update to read from customers table, connection test endpoint, manual sync trigger, ERP config UI (dynamic form), sync error logging UI, inbound rate limiting (express-rate-limit).

**Pitfalls to avoid:** Pitfall 3 (IXC IP whitelisting -- keep N8N fallback 30+ days), Pitfall 5 (N8N removal without fallback -- feature flag per integration), Pitfall 6 (interface fragility -- per-connector config schemas).

**Research needed:** Phase-level research strongly recommended. Hubsoft OAuth flow needs validation. Voalle API details are low confidence. SGP dual-auth modes need clarification.

### Phase 5: LGPD Hardening

**Rationale:** Legal compliance is the highest-risk area but does not block technical delivery. A legal opinion should be commissioned in parallel with Phases 2-4, and the technical LGPD work (audit logging, retention policies, masking enforcement) lands in this final phase informed by that opinion.

**Delivers:** Legally defensible data handling, audit trail, retention enforcement, consumer rights documentation.

**Features:** Systematic masking middleware (all cross-provider queries pass through it), masking validation tests (regression safety), audit trail completeness (log every cross-tenant data access), data retention policy with background purge job, DPA tracking per provider, LGPD subject rights documentation page, consumer notification tracking (CDC Art. 43 ss2), re-identification risk assessment for small markets.

**Pitfalls to avoid:** Pitfall 1 (operating without legal basis -- legal opinion must be obtained), Pitfall 2 (cosmetic masking -- formal risk assessment needed).

**Research needed:** Phase-level research strongly recommended. Legal requirements depend on DPO/lawyer opinion. Re-identification risk assessment methodology needs research.

---

## Research Flags

| Phase | Research Recommendation |
|-------|------------------------|
| Phase 1 (Cleanup) | Skip -- standard patterns, well understood |
| Phase 2 (Foundation + Docker) | Light research -- Docker cookie domain migration, Replit PG export |
| Phase 3 (Modularization) | Skip -- architecture research provides complete decomposition plan |
| Phase 4 (ERP Connectors) | Deep research recommended -- Hubsoft OAuth, Voalle API, SGP dual-auth. TopSApp/RadiusNet/Gere/ReceitaNet deferred entirely due to no documentation |
| Phase 5 (LGPD) | Deep research recommended -- legal classification, re-identification risk methodology, CDC Art. 43 notification requirements |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Minimal additions to proven stack. Native fetch, cockatiel, pino are well-documented with clear rationale. |
| Features | HIGH | Table stakes clearly identified from existing codebase analysis and CLAUDE.md. Feature dependencies mapped. |
| Architecture | HIGH | Based on direct codebase analysis (4350-line routes, 1800-line storage). Decomposition plan has line-level estimates. |
| Pitfalls | HIGH | Critical pitfalls backed by source code evidence and legal references. 3 of 5 critical pitfalls directly observed in code. |
| ERP Auth (IXC, MK, RBX) | HIGH | Public API documentation available and cross-referenced. |
| ERP Auth (Hubsoft, SGP) | MEDIUM | Documentation exists but OAuth flow and dual-auth modes need validation during implementation. |
| ERP Auth (Voalle) | LOW | Limited public documentation. May need vendor contact. |
| ERP Auth (TopSApp, RadiusNet, Gere, ReceitaNet) | VERY LOW | No public documentation found. Deferred to future milestone. |
| LGPD Legal Classification | MEDIUM | Legal analysis sources are credible but no DPO opinion specific to this platform exists. |

### Gaps to Address

1. **Legal opinion on platform classification** under Lei 12.414/2011 and CDC Art. 43. This is the single most important gap -- it could change the entire compliance approach.
2. **Hubsoft OAuth flow validation** -- the documented flow needs testing with real credentials.
3. **Voalle API specifics** -- integration user creation process, exact endpoints, pagination.
4. **Database migration from Replit** -- export/import process, schema compatibility verification.
5. **Cookie domain migration** -- session continuity when moving from Replit URL to custom domain.
6. **Re-identification risk assessment methodology** -- no standard approach identified for k-anonymity thresholds in this specific context.

---

## Sources

### Legal and Regulatory
- [Chenut: Legal risks of delinquency data sharing under LGPD/CDC](https://chenut.online/compartilhamento-de-dados-de-inadimplentes-os-riscos-legais-nas-listas-internas-sob-a-lgpd-e-o-cdc/)
- [TechCompliance: Lei do Cadastro Positivo and LGPD](https://techcompliance.org/lei-do-cadastro-positivo/)
- [Machado Meyer: Cadastro Positivo and LGPD interface](https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/tecnologia/interface-entre-a-nova-lei-do-cadastro-positivo-e-a-lei-geral-de-protecao-de-dados)
- [Camara dos Deputados: Credit protection data use rules](https://www.camara.leg.br/noticias/692295-projeto-fixa-regras-para-uso-de-dados-pessoais-do-consumidor-por-empresas-de-protecao-ao-credito/)
- [PontoISP: LGPD for ISPs guide](https://www.pontoisp.com.br/wp-content/uploads/2020/08/LGPD-Provedores-cartilha.pdf)

### ERP API Documentation
- [IXC Soft API](https://wikiapiprovedor.ixcsoft.com.br/) -- HIGH confidence
- [MK Auth API (Postman)](https://postman.mk-auth.com.br/) -- HIGH confidence
- [SGP API](https://bookstack.sgp.net.br/books/api) -- MEDIUM confidence
- [Hubsoft API](https://docs.hubsoft.com.br/) -- MEDIUM confidence
- [RBX ISP Developers](https://www.developers.rbxsoft.com/) -- MEDIUM confidence
- [Voalle API wiki](https://wiki.grupovoalle.com.br/APIs) -- LOW confidence

### Technical References
- [Cockatiel - resilience library](https://github.com/connor4312/cockatiel) -- circuit breakers, retry, timeout
- [Pino - structured logging](https://www.npmjs.com/package/pino) -- JSON logging for Node.js
- [express-rate-limit](https://www.npmjs.com/package/express-rate-limit) -- inbound rate limiting
- [Docker Node.js guide](https://docs.docker.com/guides/nodejs/containerize/)
- [Express 5 migration guide](https://expressjs.com/en/guide/migrating-5.html)
- [Pino vs Winston comparison](https://betterstack.com/community/comparisons/pino-vs-winston/)
- [Node.js Docker best practices 2026](https://dev.to/axiom_agent/dockerizing-nodejs-for-production-the-complete-2026-guide-7n3)
