# Technology Stack

**Project:** Consulta ISP - Milestone 2 (ERP Integrations, Backend Refactor, Docker)
**Researched:** 2026-03-29
**Overall Confidence:** MEDIUM-HIGH

---

## Current Stack (No Changes)

These technologies remain as-is. No upgrades or replacements recommended.

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| Express | 5.0.1 | HTTP server | Keep |
| React | 18.3 | Frontend UI | Keep |
| PostgreSQL | 16+ | Primary database | Keep |
| Drizzle ORM | 0.39 | Queries and types | Keep |
| Vite | 7.3 | Frontend bundler | Keep |
| Tailwind CSS | 3.4 | Styling | Keep |
| shadcn/ui | new-york | UI components | Keep |
| TanStack Query | 5 | Server state | Keep |
| Wouter | 3 | Routing | Keep |
| Zod | 3.25 | Validation | Keep |
| OpenAI SDK | 6.25 | AI analysis streaming | Keep |
| Resend | 6.9 | Transactional email | Keep |
| p-limit | 7.3 | Concurrency control | Keep |
| p-retry | 7.1 | Retry logic | Keep |

---

## Recommended Stack Additions

### 1. ERP HTTP Client & Resilience

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Native `fetch` (Node 18+) | built-in | HTTP client for ERP APIs | Zero dependencies. Node.js built-in fetch (powered by undici) is production-ready since Node 18. The project already uses ESM. No need for axios or node-fetch -- one less dependency to maintain. For ERP integrations with simple REST calls (POST/GET with JSON), native fetch is sufficient. | HIGH |
| cockatiel | ^4.0.0 | Circuit breaker + retry policies | Replaces ad-hoc retry logic with composable resilience policies (retry, circuit breaker, timeout, bulkhead, fallback). Inspired by .NET Polly. 268K weekly downloads, actively maintained (v4 released 2024). The project already has p-retry but cockatiel provides circuit breakers which are critical for ERP integrations -- when an ERP API is down, you need to stop hammering it. | HIGH |
| bottleneck | ^2.19.5 | Rate limiting outbound ERP calls | 5.5M weekly downloads. Stable since 2019 (no bugs = no releases). Perfect for throttling ERP API calls to respect rate limits (e.g., IXC allows X requests/min). Zero dependencies. NOTE: unmaintained but battle-tested and stable. The alternative (building rate limiting into cockatiel) is more complex. | MEDIUM |

**Why NOT axios:** The project has zero axios usage today. Native fetch does everything needed for ERP REST calls. Adding axios means +400KB of dependencies for features you won't use (interceptors, browser support). The project already works with native APIs.

**Why NOT undici directly:** Native fetch IS undici under the hood in Node.js 18+. Using `fetch()` gives you undici performance without the import.

**Why cockatiel over opossum:** Cockatiel is TypeScript-first, provides composable policies (wrap retry inside circuit breaker inside timeout), and has a smaller footprint. Opossum is callback-oriented and heavier. Cockatiel's API reads like what you'd expect:

```typescript
import { CircuitBreakerPolicy, RetryPolicy, TimeoutPolicy, wrap } from 'cockatiel';

const retry = RetryPolicy.handleAll().retry().attempts(3).exponential();
const circuitBreaker = CircuitBreakerPolicy.handleAll().circuitBreaker(10_000, {
  halfOpenAfter: 30_000,
  breaker: new ConsecutiveBreaker(5),
});
const timeout = TimeoutPolicy.afterResolve(30_000);

const erpPolicy = wrap(timeout, circuitBreaker, retry);

// Use in any connector:
const result = await erpPolicy.execute(() => fetch(erpUrl, options));
```

### 2. Structured Logging

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| pino | ^10.3.1 | Structured JSON logging | 5-10x faster than winston. JSON-native output perfect for Docker log aggregation. Essential for ERP sync debugging -- when a sync fails at 3am, you need structured logs with correlation IDs, ERP source, provider ID, and error details. The project currently has NO logging library (uses console.log). | HIGH |
| pino-http | ^10.0.0 | Express HTTP request logging | Auto-logs every HTTP request with timing, status, and request ID. Drop-in Express middleware. Replaces manual logging in routes. | HIGH |
| pino-pretty | ^13.0.0 | Dev-only log formatting | Makes pino's JSON output human-readable in development. Install as devDependency only. | HIGH |

**Why NOT winston:** Winston is 5-10x slower due to synchronous transports. For a system doing ERP syncs with hundreds of customer records, log performance matters. Pino's async-first design won't block the event loop during heavy sync operations.

### 3. Backend Modularization

No new libraries needed. This is a structural refactor using Express Router (already available in Express 5).

**Pattern: Domain-based feature modules**

```
server/
  modules/
    auth/
      auth.routes.ts      # Express.Router() with auth endpoints
      auth.controller.ts   # Request handling logic
      auth.service.ts      # Business logic (extracted from routes.ts)
    consultas/
      consultas.routes.ts
      consultas.controller.ts
      consultas.service.ts
    erp/
      erp.routes.ts
      erp.controller.ts
      erp.service.ts
      connectors/
        base.connector.ts  # Abstract ErpConnector interface
        ixc.connector.ts
        mk.connector.ts
        sgp.connector.ts
        hubsoft.connector.ts
        voalle.connector.ts
        rbx.connector.ts
        topsapp.connector.ts
        radiusnet.connector.ts
        gere.connector.ts
        receitanet.connector.ts
        registry.ts         # Connector registry map
    admin/
      admin.routes.ts
      admin.controller.ts
      admin.service.ts
    financeiro/
      financeiro.routes.ts
      financeiro.controller.ts
      financeiro.service.ts
    antifraude/
      antifraude.routes.ts
      antifraude.controller.ts
      antifraude.service.ts
    heatmap/
      heatmap.routes.ts
      heatmap.controller.ts
      heatmap.service.ts
      heatmap.cache.ts     # Extracted from server/heatmap-cache.ts
    suporte/
      suporte.routes.ts
      suporte.controller.ts
      suporte.service.ts
    webhooks/
      webhooks.routes.ts
      webhooks.controller.ts
  middleware/
    auth.middleware.ts      # requireAuth, requireAdmin, requireSuperAdmin
    tenant.middleware.ts    # providerId injection
    error.middleware.ts     # Global error handler
    rate-limit.middleware.ts
  index.ts                  # Server bootstrap
  router.ts                 # Aggregates all module routers
  storage.ts                # Kept as shared data access layer (Drizzle)
  db.ts                     # Database connection
```

**Why this pattern:** Domain-based organization maps 1:1 to the existing route groups in routes.ts. Each module is independently testable. The 4350-line routes.ts splits into ~8-10 files of 200-500 lines each. Controllers handle HTTP concerns (req/res), services handle business logic, making future testing possible.

**Why NOT NestJS/Fastify migration:** The codebase has 100+ Express endpoints, established patterns, and Express 5 is current. A framework migration would be a rewrite, not a refactor. Express 5 with proper modularization is production-grade.

### 4. API Rate Limiting (Inbound)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| express-rate-limit | ^8.3.1 | Rate limit incoming API requests | 15.6M weekly downloads, actively maintained. Prevents abuse of credit-consuming endpoints (ISP/SPC consultations). Essential for a SaaS with per-credit billing -- without rate limiting, a compromised API key could drain all credits in seconds. | HIGH |

### 5. Docker & Deployment

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Docker | 27+ | Containerization | Industry standard. Required for VPS deployment per project requirements. | HIGH |
| Docker Compose | 2.x (v2 spec) | Multi-container orchestration | Manages app + PostgreSQL + optional Redis in a single `docker-compose.yml`. Simpler than Kubernetes for single-VPS deployment. | HIGH |
| node:20-slim | 20 LTS | Base Docker image | Node 20 is LTS until April 2026. Use `-slim` variant (not alpine) because: (1) Alpine uses musl libc which can cause issues with native Node modules, (2) slim is Debian-based with glibc compatibility, (3) still small (~200MB vs ~1GB for full image). The project uses `pg` which has native bindings. | HIGH |
| PostgreSQL 16 | 16.x | Database container | Latest stable LTS. Use official `postgres:16-alpine` image (Alpine is fine for Postgres, no Node native module concerns). | HIGH |

**Why NOT Alpine for Node:** The `pg` driver and `esbuild` (used in build) have native bindings that can fail on musl libc. The `-slim` variant avoids this while still being small. Multiple production guides recommend slim over alpine for Node.js apps with native dependencies.

**Why NOT Kubernetes:** Single VPS target. Docker Compose is the right tool. K8s adds operational complexity with zero benefit at this scale (single server, <1000 concurrent users expected).

**Dockerfile strategy: Multi-stage build**

```dockerfile
# Stage 1: Build
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-slim AS production
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "dist/index.cjs"]
```

### 6. LGPD Compliance

No new libraries needed. LGPD compliance is an architectural concern, not a library concern.

**What already exists and is good:**
- Data masking between providers (partial name, value ranges, address without number)
- Provider isolation via `providerId` on every query

**What needs to be added (code patterns, not libraries):**

| Concern | Implementation | Confidence |
|---------|---------------|------------|
| Audit trail for data access | New `audit_logs` table: who queried what CPF, when, from which provider. Use Drizzle, no new lib needed. | HIGH |
| Consent management | Record legal basis for data processing per provider. LGPD Art. 7 requires legitimate interest or consent. For credit bureau data, legitimate interest (Art. 7, IX) applies. Document this in the system. | MEDIUM |
| Data retention policy | Auto-purge consultation logs after configurable period (e.g., 5 years per credit bureau norms). Implement via scheduled job in existing scheduler.ts. | MEDIUM |
| Breach notification | LGPD requires 72h breach notification to ANPD. This is operational, not code. Document the process. | LOW (operational) |
| Right to deletion | Endpoint to anonymize customer data on request. Replace PII with hashes, keep aggregated scores. | MEDIUM |
| Data encryption at rest | PostgreSQL TDE or application-level encryption for CPF/CNPJ fields. Use Node.js built-in `crypto` module, no external library. | MEDIUM |

**Why NOT a "LGPD compliance library":** There is no credible Node.js LGPD library. LGPD compliance is about data handling practices (masking, audit trails, retention, consent), not a drop-in package. The project's existing masking approach is correct. What's missing is audit logging and documented legal basis.

### 7. Dev/Build Tools (Cleanup)

| Action | What | Why | Confidence |
|--------|------|-----|------------|
| REMOVE | `@replit/vite-plugin-cartographer` | Replit-specific, unnecessary outside Replit | HIGH |
| REMOVE | `@replit/vite-plugin-dev-banner` | Replit-specific | HIGH |
| REMOVE | `@replit/vite-plugin-runtime-error-modal` | Replit-specific | HIGH |
| REMOVE | `memorystore` | Replace with connect-pg-simple (already installed) for session storage in production. Memorystore leaks memory in production. | HIGH |
| KEEP | `connect-pg-simple` | PostgreSQL-backed sessions, production-ready | HIGH |

---

## ERP Connector Technical Details

### Authentication Patterns by ERP

| ERP | Auth Method | Required Fields | Confidence |
|-----|------------|-----------------|------------|
| IXC Soft | Basic Auth (Base64 `user:token`) + custom header `ixcsoft: "listar"` | apiUrl, apiUser, apiToken | HIGH (documented, partially implemented) |
| MK Solutions | Bearer JWT Token | apiUrl, apiToken | MEDIUM (API docs at postman.mk-auth.com.br) |
| SGP | Token + App Name in body, OR Basic Auth | apiUrl, apiToken, apiUser (optional) | MEDIUM (docs at bookstack.sgp.net.br) |
| Hubsoft | OAuth2 (client_id, client_secret, username, password) -> Bearer | apiUrl, clientId, clientSecret, apiUser, apiToken (password) | HIGH (docs at docs.hubsoft.com.br, confirmed OAuth flow) |
| Voalle | Integration User credentials | apiUrl, apiUser, apiToken | LOW (wiki.grupovoalle.com.br, limited public docs) |
| RBX ISP | Integration Key in POST body | apiUrl, apiToken (ChaveIntegracao) | MEDIUM (docs at developers.rbxsoft.com) |
| TopSApp | Unknown - needs research during implementation | TBD | LOW |
| RadiusNet | Unknown - needs research during implementation | TBD | LOW |
| Gere | Unknown - needs research during implementation | TBD | LOW |
| Receita Net | Unknown - needs research during implementation | TBD | LOW |

### Shared `erpIntegrations` Schema Needs

The current schema has: `apiUrl`, `apiToken`, `apiUser`. For Hubsoft OAuth, additional fields are needed:

```typescript
// These fields should be added to erpIntegrations table
clientId: text("client_id"),       // Hubsoft OAuth
clientSecret: text("client_secret"), // Hubsoft OAuth
extraConfig: jsonb("extra_config"),  // Catch-all for ERP-specific settings
```

Using a `jsonb` extra_config field avoids schema changes for each new ERP. The `extra` field in the ErpConfig interface maps to this.

### IXC Node.js SDK Assessment

There exists an `ixc-soft-api` npm package (github.com/isacna/ixc-soft-api) -- a TypeScript SDK for IXC. However:

- **DO NOT USE IT.** The package has minimal downloads, unknown maintenance status, and wraps simple HTTP calls. The project should own its connector code for reliability and debugging. Writing a direct fetch-based IXC connector is ~50 lines of code and gives full control over error handling, logging, and retry policies.

---

## Dependency Summary

### New Production Dependencies

```bash
npm install cockatiel@^4.0.0 pino@^10.3.1 pino-http@^10.0.0 express-rate-limit@^8.3.1
```

### New Dev Dependencies

```bash
npm install -D pino-pretty@^13.0.0
```

### Optional (evaluate during implementation)

```bash
# Only if ERP rate limits prove problematic during testing
npm install bottleneck@^2.19.5
```

### Dependencies to Remove

```bash
npm uninstall @replit/vite-plugin-cartographer @replit/vite-plugin-dev-banner @replit/vite-plugin-runtime-error-modal memorystore
```

### Net Dependency Change

- **Added:** 4 production + 1 dev (cockatiel, pino, pino-http, express-rate-limit, pino-pretty)
- **Removed:** 4 (3 Replit plugins + memorystore)
- **Net change:** +1 production dependency

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| HTTP Client | Native fetch | axios | Unnecessary dependency; fetch is built-in since Node 18, powered by undici |
| HTTP Client | Native fetch | undici (direct) | fetch IS undici; direct undici API adds complexity for no gain in this use case |
| Circuit Breaker | cockatiel | opossum | Opossum is callback-oriented, heavier, less composable |
| Rate Limit (outbound) | bottleneck (optional) | p-limit (existing) | p-limit handles concurrency but not time-based rate limits |
| Rate Limit (inbound) | express-rate-limit | rate-limiter-flexible | express-rate-limit is simpler, Express-native, sufficient for this use case |
| Logging | pino | winston | Winston is 5-10x slower; pino is JSON-native, better for Docker/structured logging |
| Docker base | node:20-slim | node:20-alpine | Alpine's musl libc causes issues with pg native bindings and esbuild |
| Backend framework | Express 5 (keep) | Fastify / NestJS | Migration cost is extreme for 100+ endpoints; Express 5 is modern enough |
| Session store | connect-pg-simple (keep) | Redis | Unnecessary complexity; PG sessions work fine at this scale |
| ORM | Drizzle (keep) | Prisma | Drizzle is already deeply integrated; Prisma migration would touch every query |

---

## Environment Variables (New)

```env
# Existing (no changes)
DATABASE_URL=
SESSION_SECRET=
RESEND_API_KEY=
ASAAS_API_KEY=
AI_INTEGRATIONS_OPENAI_API_KEY=
GOOGLE_MAPS_API_KEY=

# New for Docker deployment
NODE_ENV=production
PORT=5000
LOG_LEVEL=info                     # pino log level (debug/info/warn/error)

# No new env vars for ERP -- config stored in erpIntegrations table per provider
```

---

## Sources

### Verified (HIGH confidence)
- [Express Router documentation](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Express_Nodejs/routes)
- [Docker official Node.js guide](https://docs.docker.com/guides/nodejs/containerize/)
- [Cockatiel GitHub - resilience library](https://github.com/connor4312/cockatiel)
- [Pino npm - structured logging](https://www.npmjs.com/package/pino)
- [express-rate-limit npm](https://www.npmjs.com/package/express-rate-limit)
- [IXC Soft API docs](https://wikiapiprovedor.ixcsoft.com.br/)
- [Hubsoft API docs](https://docs.hubsoft.com.br/)
- [MK Auth API Postman](https://postman.mk-auth.com.br/)
- [SGP API docs](https://bookstack.sgp.net.br/books/api)
- [RBX ISP developer docs](https://www.developers.rbxsoft.com/)

### Cross-referenced (MEDIUM confidence)
- [Bottleneck npm - rate limiter](https://www.npmjs.com/package/bottleneck) - Stable but unmaintained since 2019
- [LGPD compliance guide for SaaS](https://complydog.com/blog/brazil-lgpd-complete-data-protection-compliance-guide-saas)
- [Voalle API wiki](https://wiki.grupovoalle.com.br/APIs)
- [Node.js Docker best practices 2026](https://dev.to/axiom_agent/dockerizing-nodejs-for-production-the-complete-2026-guide-7n3)
- [Pino vs Winston comparison](https://betterstack.com/community/comparisons/pino-vs-winston/)

### Single source (LOW confidence - needs validation during implementation)
- TopSApp, RadiusNet, Gere, Receita Net API details -- no public documentation found
- [ixc-soft-api npm package](https://github.com/isacna/ixc-soft-api) - Assessed and rejected
