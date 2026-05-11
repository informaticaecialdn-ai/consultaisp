# Phase 0: Admin SaaS Foundation - Research

**Researched:** 2026-04-01
**Domain:** Authentication, session management, tenant isolation, admin CRUD, seed hygiene
**Confidence:** HIGH

## Summary

Phase 0 is a hardening phase, not greenfield. The codebase already has working auth routes, session middleware, admin CRUD endpoints, and seed logic. The problems are specific and well-understood: (1) session store uses memorystore instead of connect-pg-simple (already installed), (2) superadmin credentials are hardcoded in seed.ts, (3) the `requireAdmin` middleware excludes superadmin from admin-level routes, (4) some admin document routes use `requireAuth` with inline role checks instead of `requireSuperAdmin`, and (5) the seed creates fake providers mixed with real data.

All changes are isolated to specific files. The connect-pg-simple swap touches only `server/auth.ts`. The seed cleanup touches only `server/seed.ts`. The tenant audit touches route files individually. The CNPJ endpoint already has `requireSuperAdmin` protection (contrary to the initial bug report -- this was fixed at some point). The CRUD routes for providers, users, and ERP config already exist and are functional.

**Primary recommendation:** Organize into 3 independent waves: (1) Auth+Session hardening, (2) Tenant isolation audit + CNPJ protection verification, (3) Seed cleanup. Each wave is independently deployable and testable.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Fix login -- scrypt hash must match seed, login/logout/session functional for all roles | Seed creates users with `hashPassword()` which uses scrypt correctly. The superadmin is created via `seedSuperAdmin()` with hardcoded password. Login route in `auth.routes.ts` uses `verifyPassword()` correctly. Issue is likely seed re-run behavior or session loss from memorystore restart. |
| AUTH-02 | Session hardening -- SESSION_SECRET required via env, cookie secure conditional, persistent session store (connect-pg-simple) | `server/auth.ts` currently uses memorystore with fallback secret `"dev-secret-change-me"`. connect-pg-simple ^10.0.0 is installed. Swap is ~15 lines. Guide example exists in `guia-saas-producao-facil.md`. |
| AUTH-03 | Superadmin credentials via env vars (not hardcoded in seed) | `server/seed.ts` line 485-495: email `master@consultaisp.com.br` and password `Master@2024` are hardcoded strings. Must read from `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` env vars. |
| TENANT-01 | Tenant isolation middleware audit -- every route with provider data filters by req.session.providerId | Provider routes (`provider.routes.ts`) correctly use `req.session.providerId!`. Admin routes use `requireSuperAdmin` which is correct for cross-tenant access. Three document routes (lines 418, 440, 454) use `requireAuth` with inline `role !== "superadmin"` check instead of `requireSuperAdmin`. The `requireAdmin` middleware (line 41-45 of auth.ts) checks `role !== "admin"` which EXCLUDES superadmin -- this is a bug. |
| TENANT-02 | CNPJ lookup endpoint protected with requireAuth | Already fixed: `admin.routes.ts` line 47 uses `requireSuperAdmin`. Verify and document as done. |
| CRUD-01 | Admin CRUD providers functional -- create, edit, list, deactivate provider with validation | Already implemented in `admin.routes.ts`: POST/PATCH/DELETE `/api/admin/providers`. Needs verification that validation is sufficient. |
| CRUD-02 | Admin CRUD users per provider -- create, edit, list, remove user linked to provider | Superadmin user CRUD: GET `/api/admin/users`, DELETE `/api/admin/users/:id`, PATCH email. Missing: create user for specific provider from superadmin panel (currently only provider admins can create users via `/api/provider/users`). Provider admin CRUD: GET/POST/DELETE `/api/provider/users`. |
| CRUD-03 | Admin ERP config per provider -- save/test ERP credentials (dynamic fields per type), no N8N mention | Already implemented: PUT `/api/admin/providers/:id/erp-config`, POST `/api/admin/providers/:id/erp-test`, PUT `/api/admin/providers/:id/erp/:source`. Dynamic fields via `ERP_CONFIG_FIELDS` in erp module. |
| SEED-01 | Clean seed -- only superadmin + minimal test data, no fake providers mixed with real | Current seed creates 3 fake providers (NsLink, Vertical Fibra, Speed Telecom) with 7 customers, contracts, invoices, equipment, and ERP integrations. Must be stripped to superadmin only + optional dev-only flag for test data. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

### Stack Constraints (MUST follow)
- Express 5 + TypeScript + Drizzle ORM
- Password hashing: `crypto.scrypt` in `server/password.ts` -- do NOT switch to bcrypt
- Routing: Wouter (NOT React Router)
- Session: express-session + connect-pg-simple (replace memorystore)
- Multi-tenant field: `providerId` (NOT `tenantId`), tenant table: `providers` (NOT `tenants`)
- Every table with provider data has `provider_id` FK, every query filters by `req.session.providerId`
- Package type: ESM (`"type": "module"`)
- Path aliases: `@/` = `client/src/`, `@shared/` = `shared/`

### Middleware Rules
- `requireAuth`: checks `req.session.userId` exists
- `requireAdmin`: checks `role === "admin"` (BUG: excludes superadmin)
- `requireSuperAdmin`: checks `role === "superadmin"`

### Architecture Rules
- Frontend = zero logic, all business logic on server
- Compartmentalized changes -- each fix must be isolated

## Standard Stack

### Core (already installed, no new dependencies needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express-session | ^1.18.1 (registry: 1.19.0) | Session management | Already in use, proven |
| connect-pg-simple | ^10.0.0 | PostgreSQL session store | Already installed, replaces memorystore |
| crypto (node built-in) | N/A | Password hashing (scrypt) | Already working in password.ts |
| drizzle-orm | 0.39 | Database queries | Project standard |

### To Remove
| Library | Reason |
|---------|--------|
| memorystore | Replaced by connect-pg-simple. Sessions lost on restart, memory leak risk in production. |

**Installation:** No new packages needed. connect-pg-simple is already in package.json.

## Architecture Patterns

### Recommended Change Structure (by file)
```
server/
  auth.ts           # Wave 1: Replace memorystore with connect-pg-simple, enforce SESSION_SECRET
  seed.ts           # Wave 3: Read superadmin creds from env, strip fake providers
  routes/
    admin.routes.ts  # Wave 2: Normalize document routes to use requireSuperAdmin
  auth.ts           # Wave 2: Fix requireAdmin to allow superadmin (role === "admin" || role === "superadmin")
```

### Pattern 1: connect-pg-simple Session Store
**What:** Replace memorystore with PostgreSQL-backed sessions
**When to use:** This exact change in server/auth.ts
**Example:**
```typescript
// server/auth.ts -- REPLACE memorystore section
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { Pool } from "pg";

const PgSession = ConnectPgSimple(session);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

export const sessionMiddleware = session({
  store: new PgSession({
    pool,
    tableName: "session",
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: "cid",
  cookie: {
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
  },
  proxy: process.env.NODE_ENV === "production",
});
```

### Pattern 2: Env-based Superadmin Seed
**What:** Read superadmin credentials from environment variables
**Example:**
```typescript
// server/seed.ts -- seedSuperAdmin()
export async function seedSuperAdmin() {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email || !password) {
    console.warn("[seed] SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD env vars not set, skipping superadmin creation");
    return;
  }
  const existing = await storage.getUserByEmail(email);
  if (existing) return;
  await storage.createUser({
    name: "Administrador do Sistema",
    email,
    password: await hashPassword(password),
    role: "superadmin",
    emailVerified: true,
  });
  console.log(`SuperAdmin criado: ${email}`);
}
```

### Pattern 3: Fixed requireAdmin Middleware
**What:** Allow superadmin to access admin-level routes
**Example:**
```typescript
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId || (req.session.role !== "admin" && req.session.role !== "superadmin")) {
    return res.status(403).json({ message: "Acesso negado" });
  }
  next();
}
```

### Anti-Patterns to Avoid
- **Inline role checks instead of middleware:** Three routes in admin.routes.ts use `requireAuth` + `if (req.session.role !== "superadmin")`. Use `requireSuperAdmin` directly.
- **Fallback secrets:** `process.env.SESSION_SECRET || "dev-secret-change-me"` silently works without proper secret. Throw on missing secret instead.
- **Creating a separate pg Pool for sessions:** Use the same `DATABASE_URL` but a separate Pool instance (connect-pg-simple needs a raw `pg` Pool, not Drizzle's connection).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session storage | Custom DB session table management | connect-pg-simple `createTableIfMissing: true` | Handles table creation, cleanup, expiry automatically |
| Password hashing | Custom hash comparison | Existing `server/password.ts` (scrypt) | Already working correctly, battle-tested |
| CNPJ validation | Custom CNPJ digit validator | Existing 3-source fallback in admin.routes.ts | Already implemented with ReceitaWS + BrasilAPI + CNPJ.ws |

## Common Pitfalls

### Pitfall 1: connect-pg-simple Needs Raw pg Pool
**What goes wrong:** Trying to use Drizzle's connection object with connect-pg-simple
**Why it happens:** Drizzle uses its own connection management, connect-pg-simple expects a `pg.Pool`
**How to avoid:** Create a separate `new Pool({ connectionString: process.env.DATABASE_URL })` for the session store
**Warning signs:** "pool.query is not a function" errors

### Pitfall 2: resave/saveUninitialized Settings
**What goes wrong:** Current auth.ts has `resave: true, saveUninitialized: true` which is deprecated behavior
**Why it happens:** Copied from old config
**How to avoid:** Set `resave: false, saveUninitialized: false` with connect-pg-simple (it implements the `touch` method)
**Warning signs:** Excessive session writes, performance degradation

### Pitfall 3: requireAdmin Excludes Superadmin
**What goes wrong:** Superadmin cannot access admin-level routes that use `requireAdmin`
**Why it happens:** Middleware checks `role !== "admin"` strictly, superadmin is a different role string
**How to avoid:** Check for both roles: `role !== "admin" && role !== "superadmin"`
**Warning signs:** 403 errors when superadmin tries to do provider admin actions

### Pitfall 4: Seed Idempotency
**What goes wrong:** Seed creates duplicate data or skips needed updates on re-run
**Why it happens:** Current `seedDatabase()` checks `providers.count > 0` and skips entirely. `seedSuperAdmin()` checks by email.
**How to avoid:** Keep idempotency check but ensure superadmin seed works independently of provider seed
**Warning signs:** Login fails after fresh DB because seed skipped superadmin

### Pitfall 5: Breaking Existing Sessions During Migration
**What goes wrong:** All users get logged out when switching from memorystore to connect-pg-simple
**Why it happens:** memorystore sessions are in-memory and lost on restart anyway, but the switch changes the storage backend
**How to avoid:** This is actually acceptable -- memorystore sessions are already lost on every restart. Document this as expected behavior.
**Warning signs:** None -- this is the desired outcome

## Code Examples

### Current Auth Flow (working)
```typescript
// auth.routes.ts login handler -- this works correctly
const user = await storage.getUserByEmail(email);
const valid = user ? await verifyPassword(password, user.password) : false;
if (!user || !valid) {
  return res.status(401).json({ message: "Email ou senha incorretos" });
}
req.session.userId = user.id;
req.session.providerId = user.providerId || 0;
req.session.role = user.role;
await new Promise<void>((resolve, reject) => {
  req.session.save((err) => err ? reject(err) : resolve());
});
```

### Tenant Isolation Pattern (provider routes -- correct)
```typescript
// All provider routes use req.session.providerId! for isolation
const providerUsers = await storage.getUsersByProvider(req.session.providerId!);
```

### Admin Document Routes (need fixing -- use requireAuth with inline check)
```typescript
// BEFORE (inconsistent):
router.patch("/api/admin/providers/:id/documents/:docId/status", requireAuth, async (req, res) => {
  if (req.session.role !== "superadmin") {
    return res.status(403).json({ message: "Apenas superadmin pode revisar documentos" });
  }
  // ...
});

// AFTER (consistent):
router.patch("/api/admin/providers/:id/documents/:docId/status", requireSuperAdmin, async (req, res) => {
  // ...
});
```

## Existing Code Inventory

### What Already Works (do NOT rewrite)
| Feature | File | Status |
|---------|------|--------|
| Login/logout/session | server/routes/auth.routes.ts | Working -- scrypt hash + verify correct |
| Password hashing | server/password.ts | Working -- crypto.scrypt, salt:hash format |
| Admin provider CRUD | server/routes/admin.routes.ts | Working -- create, edit, delete, list |
| Admin user management | server/routes/admin.routes.ts | Partial -- list, delete, edit email. Missing: create user for provider |
| ERP config per provider | server/routes/admin.routes.ts + erp.routes.ts | Working -- save, test, dynamic fields |
| CNPJ lookup | server/routes/admin.routes.ts | Working -- 3 fallback sources, already has requireSuperAdmin |
| Provider tenant isolation | server/routes/provider.routes.ts | Working -- uses req.session.providerId consistently |

### What Needs Changing
| Issue | File | Lines | Change |
|-------|------|-------|--------|
| memorystore -> connect-pg-simple | server/auth.ts | 1-24 | Replace store initialization |
| Fallback SESSION_SECRET | server/auth.ts | 10 | Throw if not set |
| resave/saveUninitialized | server/auth.ts | 12-13 | Set both to false |
| cookie.secure hardcoded false | server/auth.ts | 17 | Conditional on NODE_ENV |
| requireAdmin excludes superadmin | server/auth.ts | 41-45 | Add superadmin check |
| Hardcoded superadmin creds | server/seed.ts | 484-495 | Read from env vars |
| Fake providers in seed | server/seed.ts | 8-383 | Remove or gate behind DEV flag |
| Document routes inconsistent middleware | server/routes/admin.routes.ts | 418, 440, 454 | Use requireSuperAdmin |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.2 |
| Config file | vitest.config.ts (includes `server/**/*.test.ts`) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Login with scrypt hash matches for all roles | unit | `npx vitest run server/auth.test.ts -t "login"` | Wave 0 |
| AUTH-02 | Session store is PgSession, throws without SESSION_SECRET | unit | `npx vitest run server/auth.test.ts -t "session"` | Wave 0 |
| AUTH-03 | Superadmin seed reads from env vars | unit | `npx vitest run server/seed.test.ts -t "superadmin"` | Wave 0 |
| TENANT-01 | All admin routes enforce tenant isolation | unit | `npx vitest run server/routes/admin.routes.test.ts -t "tenant"` | Wave 0 |
| TENANT-02 | CNPJ endpoint requires auth | unit | `npx vitest run server/routes/admin.routes.test.ts -t "cnpj"` | Wave 0 |
| CRUD-01 | Provider CRUD operations work | integration | Manual verification via UI | N/A |
| CRUD-02 | User CRUD per provider works | integration | Manual verification via UI | N/A |
| CRUD-03 | ERP config save/test works | integration | Manual verification via UI | N/A |
| SEED-01 | Clean seed creates only superadmin | unit | `npx vitest run server/seed.test.ts -t "clean"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/auth.test.ts` -- covers AUTH-01, AUTH-02, TENANT-01
- [ ] `server/seed.test.ts` -- covers AUTH-03, SEED-01
- [ ] `server/routes/admin.routes.test.ts` -- covers TENANT-02
- [ ] Test infrastructure: vitest config exists but no test files exist yet

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| memorystore | connect-pg-simple | Already decided | Sessions persist across restarts |
| Hardcoded secrets in seed | Env vars | This phase | Production-safe deployment |
| Inline role checks | Consistent middleware | This phase | Maintainable auth patterns |

## Open Questions

1. **Should seedDatabase() be completely removed or gated behind NODE_ENV=development?**
   - What we know: Production needs only superadmin. Dev/test needs sample data.
   - Recommendation: Keep `seedSuperAdmin()` always running. Move `seedDatabase()` behind `if (process.env.SEED_DEMO_DATA === "true")` flag.

2. **Should superadmin be able to create users for providers from the admin panel?**
   - What we know: Currently only provider admins can create users (POST `/api/provider/users`). Superadmin has no equivalent endpoint.
   - Recommendation: Add POST `/api/admin/providers/:id/users` endpoint in admin.routes.ts for CRUD-02 completeness.

3. **Does the `pg` package need separate installation for connect-pg-simple?**
   - What we know: `pg` is a transitive dependency of `drizzle-orm/node-postgres`. It should be available.
   - Recommendation: Verify `pg` is accessible. If not, `npm install pg`.

## Sources

### Primary (HIGH confidence)
- Direct code inspection of server/auth.ts, server/seed.ts, server/routes/*.routes.ts
- guia-saas-producao-facil.md -- connect-pg-simple usage pattern
- CLAUDE.md -- stack constraints, architecture rules
- package.json -- dependency versions verified

### Secondary (MEDIUM confidence)
- npm registry -- verified connect-pg-simple@10.0.0, express-session@1.19.0, vitest@4.1.2

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all packages already installed, versions verified against registry
- Architecture: HIGH - changes are surgical to specific files, patterns documented in project guide
- Pitfalls: HIGH - based on direct code reading, all issues confirmed in source

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable stack, no expected breaking changes)
