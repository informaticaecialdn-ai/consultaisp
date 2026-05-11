# Domain Pitfalls

**Domain:** ISP Credit Bureau SaaS (Brazilian telecom delinquency sharing platform)
**Researched:** 2026-03-29

## Critical Pitfalls

Mistakes that cause rewrites, legal liability, or production failures.

---

### Pitfall 1: Operating as an Unregistered Credit Bureau Under LGPD

**What goes wrong:** The system shares delinquency data between ISPs (CPF, overdue status, amounts) in a model functionally identical to SPC/Serasa. Under Brazilian law, this may classify the platform as a "gestor de banco de dados" under Lei 12.414/2011 (Cadastro Positivo) and CDC Art. 43, which imposes specific registration and operational requirements that informal sharing systems do not meet.

**Why it happens:** Developers treat credit data sharing as a standard SaaS feature, not realizing that sharing negative credit data between unrelated companies triggers specific legal obligations under CDC Art. 43 ss2 (mandatory prior consumer notification before inclusion in any delinquency register) and LGPD Art. 7 X (credit protection basis requires demonstrating compliance with ALL LGPD principles, not just citing the legal basis).

**Consequences:**
- LGPD administrative sanctions: up to 2% of annual revenue, capped at R$50M per infraction
- Civil damages: courts have recognized "dano moral presumido" (presumed moral damages) for notification failures
- Joint liability: LGPD Art. 39 makes the platform and every ISP sharing data co-responsible for violations
- Platform shutdown risk if ANPD determines operations require authorization not obtained

**Prevention:**
1. Hire a specialized data protection lawyer (DPO/advogado LGPD) to issue a formal legal opinion on the platform's classification under Lei 12.414 and LGPD before scaling beyond beta
2. Implement mandatory consumer notification flow: before any ISP marks a customer as delinquent, verify that consumer was notified (CDC Art. 43 ss2 requires written communication)
3. Create and maintain a RIPD (Relatorio de Impacto a Protecao de Dados Pessoais) for the entire data sharing operation
4. Implement ROPA (Record of Processing Activities) documenting every data flow between tenants
5. Add consumer rights portal: data subjects must be able to access, correct, and request deletion of their data (LGPD Art. 18)

**Detection:** No legal opinion on file. No RIPD document. No consumer notification mechanism. No data subject rights portal.

**Phase mapping:** Must be addressed in LGPD compliance phase (early priority). Legal review should happen before expanding beta to production ISPs.

**Confidence:** HIGH -- based on direct reading of the legal analysis from [Chenut law firm](https://chenut.online/compartilhamento-de-dados-de-inadimplentes-os-riscos-legais-nas-listas-internas-sob-a-lgpd-e-o-cdc/) and [Lei 12.414 analysis](https://techcompliance.org/lei-do-cadastro-positivo/).

---

### Pitfall 2: Mascaramento LGPD Insuficiente -- Current Masking is Cosmetic, Not Legal

**What goes wrong:** The current masking approach (partial name "Eduardo xxxx", value range "R$100-R$120", address without number) provides UI-level obfuscation but may not satisfy LGPD data minimization requirements. The system still stores and processes the full CPF across tenants, and the combination of partial name + city + value range + provider name may still allow re-identification of individuals in smaller cities.

**Why it happens:** Masking was implemented as a UX feature ("show partial info") rather than as a legal privacy control with formal threat modeling. No re-identification risk assessment was performed.

**Consequences:**
- ANPD may classify the "masked" data as still constituting personal data (if re-identification is feasible)
- In small cities with few ISPs, partial name + city + amount range can uniquely identify someone
- Competitors could weaponize the system to identify each other's customers despite masking

**Prevention:**
1. Perform a formal re-identification risk assessment for small ISP markets (cities < 50k population)
2. Consider k-anonymity threshold: if fewer than k=5 records match a masked profile, suppress the result
3. Store and expose only score + recommendation for cross-tenant queries; detailed delinquency data stays within the originating tenant
4. Log and audit all cross-tenant data access
5. Add rate limiting on cross-tenant lookups per provider per day to prevent bulk profiling

**Detection:** No re-identification risk assessment exists. No k-anonymity checks. No cross-tenant query audit logs.

**Phase mapping:** Address during LGPD compliance review phase. Should inform the architecture of the ERP connector output normalization.

**Confidence:** MEDIUM -- based on LGPD principles analysis; specific regulatory enforcement posture for ISP-sector data sharing is unclear.

---

### Pitfall 3: IXC Soft IP Whitelisting Breaks Production After Docker Migration

**What goes wrong:** IXC Soft API (the dominant ERP in Brazilian ISP market) requires IP whitelisting for API access. The current system uses an N8N proxy at a fixed IP to bypass this restriction on Replit (which has dynamic IPs). When migrating to Docker/VPS, teams often assume the IP problem is solved because they now have a "fixed IP," but fail to account for: (a) ISP providers must individually whitelist the new server IP in their IXC installation, (b) during migration there is a period where neither the old N8N IP nor the new server IP works, (c) if using cloud providers with elastic IPs, IP can change on infrastructure events.

**Why it happens:** The N8N proxy masked the IP requirement during development. Developers remove N8N without coordinating the IP cutover with every provider's IXC administrator.

**Consequences:**
- All ERP syncs fail silently after migration (401/403 errors)
- Heatmap goes dark, delinquency data goes stale
- Providers lose trust in the platform's reliability during the most critical transition period

**Prevention:**
1. Document every provider's IXC IP whitelist status as a field in `erpIntegrations` table
2. Implement a migration checklist in the admin UI: "Has provider whitelisted IP X.X.X.X? [Yes/No/Pending]"
3. Keep the N8N proxy operational as fallback for 30+ days after Docker migration
4. Implement connection test that runs automatically after IP changes and alerts admin
5. Use a static IP or IP range that is guaranteed not to change (avoid cloud elastic IPs without reserving them)
6. Add the `testConnection` method to the ERP connector interface that is called on every sync attempt, with clear error messages distinguishing auth failures from IP blocks

**Detection:** ERP sync logs showing 401/403 errors. `erpSyncLogs` entries with error status spiking after deployment changes.

**Phase mapping:** Must be planned during Docker migration phase AND the ERP connector implementation phase simultaneously. The connector must have robust error classification.

**Confidence:** HIGH -- directly evidenced by the current N8N proxy workaround in heatmap-cache.ts and IXC API documentation at [IXC Wiki](https://wikiapiprovedor.ixcsoft.com.br/).

---

### Pitfall 4: Refactoring 4350-Line routes.ts Breaks Multi-Tenant Isolation

**What goes wrong:** When splitting a monolithic routes file into domain modules (auth, consultas, erp, admin, financeiro), developers copy-paste route handlers into new files but forget to include `providerId` filtering in some queries. The current file has 84 references to `session.providerId` across 4349 lines. Missing even one creates a data leak where Provider A sees Provider B's customers, invoices, or consultation history.

**Why it happens:** The monolith has implicit context: `providerId` is accessed from session in the same file scope. When extracting to modules, a developer might restructure how the request context is passed and miss a filter. There are no automated tests verifying tenant isolation.

**Consequences:**
- Cross-tenant data exposure (LGPD violation)
- Provider sees competitor's customer data (trust destruction, potential legal action)
- Silent bug: no error thrown, just wrong data returned

**Prevention:**
1. Before refactoring, create integration tests that verify tenant isolation for EVERY endpoint: create two providers, make requests as each, verify zero data leakage
2. Create a middleware that injects `providerId` into a request-scoped context object that modules consume -- never read directly from session in individual route handlers
3. Add a Drizzle query wrapper or base repository that always includes `providerId` filter (fail-closed: if no providerId, query throws)
4. Refactor incrementally: move one domain module at a time, run full test suite between each move
5. Add a linting rule or code review checklist: every Drizzle `where()` clause on a tenant-scoped table MUST include `eq(table.providerId, ctx.providerId)`

**Detection:** Create a script that counts `providerId` references per route module. Any module with tenant-scoped tables but zero `providerId` references is suspect.

**Phase mapping:** The tenant isolation tests MUST be written BEFORE the refactoring begins. This is a prerequisite, not a parallel task.

**Confidence:** HIGH -- directly evidenced by codebase analysis (84 providerId references in 4349 lines, no existing test suite).

---

### Pitfall 5: N8N Removal Without Graceful Degradation Kills Heatmap and Scheduler

**What goes wrong:** The heatmap-cache.ts hardcodes N8N proxy URLs (line 3: `N8N_PROXY_URL`) and auth credentials (line 4: hardcoded Basic auth). The scheduler.ts and routes.ts contain ~90+ N8N references. Removing N8N before ALL ERP connectors are implemented and tested means the heatmap, auto-sync, and manual sync all break simultaneously for every provider.

**Why it happens:** Developers treat "remove N8N" and "add ERP connectors" as the same task. In reality, N8N currently handles IXC only, but removing it affects the scheduler and heatmap which are used by all providers, not just IXC users.

**Consequences:**
- Heatmap shows no data (cache expires after 24h, no new data comes in)
- Auto-sync stops: delinquency data goes stale, scores become inaccurate
- Manual sync button returns errors
- Beta providers lose functionality during the transition

**Prevention:**
1. Implement ERP connectors behind a feature flag: `useDirectConnector: boolean` per `erpIntegration` record
2. Keep N8N proxy as fallback: if direct connector fails, fall back to N8N for IXC
3. Implement connectors one at a time: IXC first (since it has the most users and existing behavior to compare against), then MK, then others
4. Only remove N8N proxy code after 100% of IXC providers have confirmed working direct connections for 2+ weeks
5. Hardcoded credentials in heatmap-cache.ts (line 4) must be moved to environment variables immediately, regardless of N8N removal timeline

**Detection:** N8N proxy still has hardcoded credentials in source code. No feature flag exists for connector routing.

**Phase mapping:** ERP connector implementation phase. N8N removal should be the LAST step, not the first.

**Confidence:** HIGH -- directly observed in heatmap-cache.ts source code.

---

## Moderate Pitfalls

---

### Pitfall 6: ERP API Diversity Makes "One Interface Fits All" Fragile

**What goes wrong:** The proposed `ErpConnector` interface assumes all ERPs expose similar REST APIs. In reality:
- **IXC**: POST-only with custom `ixcsoft: "listar"` header, Basic Auth, SQL-like query syntax
- **Hubsoft**: OAuth2 4-credential flow (client_id, client_secret, username, password), token refresh needed
- **RBX ISP**: Single POST endpoint with `ChaveIntegracao` in body, SQL-like WHERE clause
- **Voalle**: Requires special "Integration user" type created in their UI, variable base URLs
- **SGP**: Two auth modes (Token+App vs Basic Auth)

Each ERP returns different field names, date formats, status codes, and pagination schemes. A generic interface hides this complexity, leading to bugs in edge-case ERPs.

**Prevention:**
1. Make the interface minimal: `testConnection()`, `fetchDelinquents()`, `fetchCustomers()` only
2. Allow each connector to define its own config schema (extra fields beyond apiUrl/apiToken): Hubsoft needs 4 fields, IXC needs 2, RBX needs 1
3. Build a field mapping layer per connector that normalizes ERP-specific responses to `ErpCustomer`
4. Implement per-connector retry logic: IXC may need different timeout/retry than Hubsoft OAuth refresh
5. Store raw ERP response in sync logs for debugging (truncated to reasonable size)

**Detection:** Sync failures concentrated on specific ERPs. Auth errors on Hubsoft after token expiry. Missing data fields on specific ERPs.

**Phase mapping:** ERP connector architecture design, before implementing individual connectors.

**Confidence:** HIGH -- based on documented API differences in CLAUDE.md and official docs ([IXC API](https://wikiapiprovedor.ixcsoft.com.br/), [Hubsoft API](https://docs.hubsoft.com.br/)).

---

### Pitfall 7: Docker Migration Breaks Session Persistence and WebSocket Connections

**What goes wrong:** The current system uses `connect-pg-simple` for session storage (PostgreSQL-backed) and `ws` for WebSocket. In Docker:
- Container restarts kill in-memory state (heatmap cache, geocoding cache)
- If using multiple containers/replicas, WebSocket connections do not survive failover
- Session cookie domain changes from Replit URL to custom domain, logging out all existing users
- The `DATABASE_URL` from Replit's managed PostgreSQL must be migrated to a self-hosted or managed PG instance

**Prevention:**
1. The in-memory heatmap cache (`_cache` Map in heatmap-cache.ts) must be either: persisted to PostgreSQL/Redis, or gracefully rebuilt on container start
2. Pin to single container initially (no replicas) to avoid WebSocket and session complexity
3. Plan the database migration separately: export Replit PG data, import to new PG, verify schema compatibility
4. Update cookie domain configuration in auth.ts when changing domains
5. Add health check endpoint for Docker container orchestration
6. Move geocoding cache (`_cityGeo` Map) to persistent storage or accept cold-start latency

**Detection:** Users report being logged out after deployments. Heatmap empty after container restart. WebSocket chat disconnects.

**Phase mapping:** Docker migration phase. Session and cache persistence must be addressed before going live.

**Confidence:** HIGH -- directly observed in heatmap-cache.ts (in-memory caches on lines 26-27).

---

### Pitfall 8: Replit Artifacts Left Behind Cause Build Failures and Security Risks

**What goes wrong:** The codebase has 62 files referencing "replit" including `server/replit_integrations/`, `.config/replit/`, Replit-specific vite.config.ts entries, and Replit skill/plugin files in `.local/`. These create:
- Build errors when Replit-specific modules are imported but unavailable
- Security risk: `.config/replit/.semgrep/` may contain Replit-specific security rules that mask issues
- Confusion: `.local/skills/` directory contains Replit Agent instructions that may mislead Claude or other AI tools

**Prevention:**
1. Audit all 62 files referencing "replit" -- categorize as "remove", "replace", or "keep"
2. Remove `server/replit_integrations/` directory entirely
3. Remove `.local/skills/` and `.config/replit/` directories
4. Check vite.config.ts for Replit-specific plugins or environment checks
5. Verify package.json has no Replit-specific dependencies
6. Run a full build (`npm run build`) after each removal batch to catch breakage immediately

**Detection:** Build logs contain warnings about missing Replit modules. Directory listing shows `.local/skills/` or `server/replit_integrations/`.

**Phase mapping:** First step of the refactoring phase, before modularizing routes.

**Confidence:** HIGH -- directly observed via grep (62 files with "replit" references).

---

### Pitfall 9: Hardcoded Credentials and Secrets in Source Code

**What goes wrong:** The heatmap-cache.ts contains hardcoded N8N proxy credentials on line 4: `const N8N_PROXY_AUTH = "Basic aXNwX2FuYWxpenplOmlzcGFuYWxpenplMTIzMTIz"`. This is a Base64-encoded username:password committed to the repository. There may be other hardcoded secrets elsewhere in the 4349-line routes.ts.

**Prevention:**
1. Immediately rotate the exposed N8N proxy credentials
2. Move all secrets to environment variables
3. Add a pre-commit hook that scans for Base64-encoded strings and common secret patterns
4. Add `.env` to `.gitignore` (verify it is already there)
5. Audit routes.ts for any hardcoded API keys, tokens, or URLs to external services

**Detection:** `grep -r "Basic " server/` finds hardcoded auth. `grep -r "Bearer " server/` finds hardcoded tokens.

**Phase mapping:** Immediate action, before any other refactoring. This is a security vulnerability.

**Confidence:** HIGH -- directly observed in source code.

---

### Pitfall 10: Express 5 Path-to-Regexp Breaking Changes During Refactoring

**What goes wrong:** The project uses Express 5, which upgraded to path-to-regexp v8. During route refactoring, developers may introduce wildcard routes using `*` syntax (valid in Express 4) instead of `/*splat` (required in Express 5). Additionally, `req.params` types change from `string` to `string | string[]` in TypeScript, which can cause runtime errors in existing code that assumes string-only params.

**Prevention:**
1. During route extraction, test every route individually -- do not batch-move routes without testing
2. Use TypeScript strict mode: the `@types/express@5` type changes will surface `req.params` issues at compile time
3. Avoid catch-all wildcard routes; use explicit route paths
4. Run `npm run check` (tsc) after every route module extraction

**Detection:** Routes returning 404 that previously worked. TypeScript compile errors on `req.params` usage.

**Phase mapping:** Routes refactoring phase.

**Confidence:** MEDIUM -- based on [Express 5 migration guide](https://expressjs.com/en/guide/migrating-5.html). The project already uses Express 5, so existing routes should be compatible, but new routes during refactoring could introduce issues.

---

## Minor Pitfalls

---

### Pitfall 11: Price Divergence Between Schema and Landing Page Causes Billing Disputes

**What goes wrong:** `PLAN_PRICES` in schema.ts says Basic = R$199, Pro = R$399. Landing page shows Basic = R$149, Pro = R$349. If Asaas charges the schema price but the customer saw the landing price, this creates billing disputes and potential CDC (Consumer Defense Code) violations.

**Prevention:**
1. Define prices in a single source of truth (suggest: schema.ts constants, with landing page reading from an API)
2. Unify before going to production -- this is a known issue already flagged in PROJECT.md

**Detection:** Customer complaints about being charged more than advertised. Asaas payment amounts not matching landing page prices.

**Phase mapping:** Should be resolved in any phase that touches billing or the landing page.

---

### Pitfall 12: Nominatim Geocoding Rate Limits and ToS Violations

**What goes wrong:** The heatmap-cache.ts calls Nominatim (OpenStreetMap) for geocoding with a User-Agent but no rate limiting. Nominatim's usage policy requires max 1 request/second and prohibits bulk geocoding. With many providers syncing hundreds of customers, this limit can be exceeded, resulting in IP bans.

**Prevention:**
1. Add per-second rate limiting to geocoding calls (p-limit with 1 concurrency + 1s delay)
2. Persist the geocoding cache (`_cityGeo`) to the database so it survives container restarts and doesn't re-geocode known cities
3. Consider a paid geocoding service (Google Maps API is already in the stack) for production

**Detection:** Nominatim returning 429 errors. Heatmap points missing coordinates.

**Phase mapping:** Heatmap expansion phase (when adding support for all ERPs, geocoding volume will increase significantly).

---

### Pitfall 13: No Database Migration Strategy Beyond drizzle-kit push

**What goes wrong:** The project uses `drizzle-kit push` for schema changes, which directly applies changes to the database without versioned migration files. In production with real customer data, a push that drops a column or changes a type can cause irreversible data loss.

**Prevention:**
1. Switch from `drizzle-kit push` to `drizzle-kit generate` + `drizzle-kit migrate` for versioned, reviewable migrations
2. Always backup the database before schema changes
3. Test migrations against a copy of production data before applying

**Detection:** Using `db:push` in production scripts. No `drizzle/` migrations directory.

**Phase mapping:** Docker/deployment phase -- production deployment must use versioned migrations.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| LGPD Compliance Review | Operating without legal basis (Pitfall 1) | Get legal opinion FIRST, before expanding to production ISPs |
| LGPD Compliance Review | Insufficient masking (Pitfall 2) | Re-identification risk assessment for small markets |
| ERP Connector Implementation | IXC IP whitelist breakage (Pitfall 3) | Keep N8N fallback, coordinate IP whitelist per provider |
| ERP Connector Implementation | Interface fragility across ERPs (Pitfall 6) | Per-connector config schemas and field mapping |
| ERP Connector Implementation | N8N removal without fallback (Pitfall 5) | Feature flag, gradual migration, IXC first |
| Routes Refactoring | Tenant isolation regression (Pitfall 4) | Write isolation tests BEFORE refactoring |
| Routes Refactoring | Express 5 route syntax issues (Pitfall 10) | Test every extracted route individually |
| Replit Cleanup | Build failures from orphaned imports (Pitfall 8) | Audit and remove incrementally with build checks |
| Docker Migration | Session/cache loss (Pitfall 7) | Persist in-memory caches, plan cookie domain change |
| Docker Migration | IXC IP whitelist (Pitfall 3 again) | Static IP, provider coordination, N8N bridge period |
| Security (Immediate) | Hardcoded secrets (Pitfall 9) | Rotate and move to env vars before any other work |

## Sources

- [Chenut: Legal risks of sharing delinquency data under LGPD/CDC](https://chenut.online/compartilhamento-de-dados-de-inadimplentes-os-riscos-legais-nas-listas-internas-sob-a-lgpd-e-o-cdc/)
- [TechCompliance: Lei do Cadastro Positivo and LGPD](https://techcompliance.org/lei-do-cadastro-positivo/)
- [Machado Meyer: Interface between Cadastro Positivo and LGPD](https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/tecnologia/interface-entre-a-nova-lei-do-cadastro-positivo-e-a-lei-geral-de-protecao-de-dados)
- [Camara dos Deputados: PL rules for credit protection data use](https://www.camara.leg.br/noticias/692295-projeto-fixa-regras-para-uso-de-dados-pessoais-do-consumidor-por-empresas-de-protecao-ao-credito/)
- [IXC Soft API Documentation](https://wikiapiprovedor.ixcsoft.com.br/)
- [IXC Wiki: Common API Errors](https://wiki.ixcsoft.com.br/pt-br/API/erros_comuns_API)
- [Hubsoft API Documentation](https://docs.hubsoft.com.br/)
- [Express 5 Migration Guide](https://expressjs.com/en/guide/migrating-5.html)
- [Express 5 Migration Issues on GitHub](https://github.com/expressjs/express/issues/5944)
- [Replit Migration Guide](https://www.arsturn.com/blog/the-complete-guide-to-migrating-your-project-from-replit-hosting)
- [Docker Compose for Node.js + PostgreSQL](https://dev.to/snigdho611/docker-compose-for-a-full-stack-application-with-react-nodejs-and-postgresql-3kdl)
