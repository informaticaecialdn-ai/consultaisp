# Phase 2: Foundation & Docker - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Source:** Auto-generated (user delegated all decisions to Claude)

<domain>
## Phase Boundary

Extract core business logic into testable, independent modules (score engine, LGPD masking, geocoding) and containerize the application for VPS deployment with Docker.

</domain>

<decisions>
## Implementation Decisions

### Module Extraction
- **D-01:** Extract `calculateIspScore()` from routes.ts into `server/score-engine.ts` — pure function, no side effects, takes customer data and returns score + penalties + bonuses + risk tier
- **D-02:** Extract LGPD data masking logic into `server/lgpd-masking.ts` — functions to mask name (partial), value (range), address (no number), CPF (partial)
- **D-03:** Extract geocoding helpers from heatmap-cache.ts into `server/geocoding.ts` — ViaCEP + Nominatim lookup, CEP-to-coordinates conversion
- **D-04:** Each extracted module must export typed functions that can be imported by routes.ts, storage.ts, and future ERP connector modules
- **D-05:** Existing callers in routes.ts must be updated to import from new modules (no duplication)

### Docker
- **D-06:** Use node:20-slim (NOT alpine) as base image — pg native bindings need glibc
- **D-07:** Multi-stage Dockerfile: build stage (esbuild + vite) → production stage (node:20-slim)
- **D-08:** docker-compose.yml with app + PostgreSQL 16 + persistent volume for DB data
- **D-09:** Health check endpoint: GET /api/health → 200 OK with { status: "ok", uptime: N }
- **D-10:** Graceful shutdown on SIGTERM: close HTTP server, drain connections, close DB pool
- **D-11:** Env var validation at startup: crash with clear error if DATABASE_URL or SESSION_SECRET missing

### Logging
- **D-12:** Replace console.log with pino structured JSON logging
- **D-13:** pino-http middleware for Express request logging
- **D-14:** pino-pretty for dev mode (human-readable output)

### Claude's Discretion
- Exact pino configuration (log levels, serializers)
- Docker EXPOSE ports (default 3000 for app, 5432 for PG)
- .dockerignore contents
- Whether to add .env.example file

</decisions>

<canonical_refs>
## Canonical References

### Score Engine
- `server/routes.ts` — Contains calculateIspScore() function to extract
- `shared/schema.ts` — Risk tier types and credit constants

### Heatmap / Geocoding
- `server/heatmap-cache.ts` — Contains geocoding helpers to extract

### Docker
- `script/build.ts` — Build script (esbuild backend + vite frontend)
- `package.json` — Scripts: dev, build, start

### Research
- `.planning/research/STACK.md` — Recommended stack additions (pino, cockatiel, etc.)
- `.planning/research/ARCHITECTURE.md` — Module extraction patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `script/build.ts` — Existing build pipeline (esbuild + vite), Docker build stage should reuse this
- `server/db.ts` — Database connection, needs pool close for graceful shutdown

### Established Patterns
- Express middleware pattern for request handling
- process.env for configuration
- ESM modules (type: "module" in package.json)

### Integration Points
- routes.ts calls calculateIspScore() inline — needs to import from score-engine.ts
- heatmap-cache.ts has geocoding logic — needs to import from geocoding.ts
- server/index.ts creates HTTP server — needs health check route and graceful shutdown

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Research recommends pino for logging and node:20-slim for Docker base.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-foundation-docker*
*Context gathered: 2026-03-30*
