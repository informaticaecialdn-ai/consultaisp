# Architecture Patterns

**Domain:** ISP credit bureau SaaS - backend modularization and ERP connector system
**Researched:** 2026-03-29

## Recommended Architecture

### Overview

The monolithic Express backend (4350-line `routes.ts`, 1800-line `storage.ts`) must be decomposed into domain modules. Simultaneously, the N8N proxy dependency must be replaced with a native ERP connector system supporting 10+ ISP ERPs with heterogeneous authentication.

The architecture follows two parallel restructuring tracks:
1. **Route/Storage modularization** -- split by business domain into cohesive modules
2. **ERP connector abstraction** -- Strategy pattern with a registry, per-ERP implementations, and unified data normalization

```
                    Express App (index.ts)
                         |
              +----------+----------+
              |                     |
         Middleware            Route Modules
     (auth, logging,      (auth, consultas, erp,
      tenant, cors)        admin, financeiro, ...)
              |                     |
              +----------+----------+
                         |
                  Storage Modules
              (by domain, same pattern)
                         |
                    Drizzle ORM
                         |
                    PostgreSQL

    ERP Connector Engine (independent)
         |
    +----+----+----+----+----+----+
    IXC  MK   SGP  Hub  Voa  RBX  ...

    Scheduler --> Connector Engine --> Storage --> Score Engine
```

---

## Component Boundaries

### Route Module Decomposition

Split `routes.ts` into these domain modules under `server/routes/`:

| Module | File | Routes | Lines (est.) | Dependencies |
|--------|------|--------|-------------|--------------|
| **auth** | `auth.routes.ts` | `/api/auth/*` (login, register, verify, logout, me) | ~200 | storage.users, password, email, tenant |
| **dashboard** | `dashboard.routes.ts` | `/api/dashboard/*`, `/api/customers`, `/api/inadimplentes`, `/api/defaulters`, `/api/invoices`, `/api/equipment`, `/api/contracts` | ~150 | storage.dashboard |
| **import** | `import.routes.ts` | `/api/import/*` (customers, invoices, equipment CSV) | ~250 | storage.customers, storage.invoices |
| **consultas** | `consultas.routes.ts` | `/api/isp-consultations/*`, `/api/spc-consultations/*`, `/api/isp-consultations/lote` | ~1200 | storage.consultations, score engine, LGPD masking |
| **anti-fraude** | `anti-fraude.routes.ts` | `/api/anti-fraud/*` (alerts, rules, migradores, customer-risk) | ~200 | storage.antiFraud |
| **equipamentos** | `equipamentos.routes.ts` | `/api/equipamentos/*` (CRUD, import) | ~100 | storage.equipamentos |
| **provider** | `provider.routes.ts` | `/api/provider/*` (profile, settings, users, partners, documents, webhook, trial, notifications) | ~400 | storage.providers |
| **erp** | `erp.routes.ts` | `/api/provider/erp-integrations/*`, `/api/provider/n8n-config/*`, `/api/webhooks/erp-*` | ~300 | erp-connector engine, storage.erp |
| **heatmap** | `heatmap.routes.ts` | `/api/heatmap/*`, `/api/config/maps-key` | ~200 | heatmap-cache |
| **credits** | `credits.routes.ts` | `/api/credits/*` | ~100 | storage.credits, asaas |
| **admin** | `admin.routes.ts` | `/api/admin/*` (providers, invoices, credit-orders, stats, financial, users, erp-catalog, auto-sync) | ~800 | storage.admin, asaas |
| **chat** | `chat.routes.ts` | `/api/chat/*`, `/api/admin/chat/*`, `/api/public/visitor-chat/*`, `/api/admin/visitor-chats/*` | ~200 | storage.chat, WebSocket |
| **ai** | `ai.routes.ts` | `/api/ai/*` (analyze-consultation, analyze-antifraud) | ~80 | ai-analysis |
| **public** | `public.routes.ts` | `/api/public/*` (erp-catalog, lgpd-info) | ~50 | storage.erp |

**Router registration pattern:**

```typescript
// server/routes/auth.routes.ts
import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";

export function registerAuthRoutes(): Router {
  const router = Router();

  router.post("/api/auth/login", async (req, res) => { ... });
  router.post("/api/auth/register", async (req, res) => { ... });
  // ...

  return router;
}

// server/routes/index.ts
import { registerAuthRoutes } from "./auth.routes";
import { registerDashboardRoutes } from "./dashboard.routes";
// ... all modules

export function registerAllRoutes(app: Express) {
  app.use(registerAuthRoutes());
  app.use(registerDashboardRoutes());
  app.use(registerConsultasRoutes());
  app.use(registerErpRoutes());
  app.use(registerAdminRoutes());
  // ...
}
```

### Storage Module Decomposition

Split `storage.ts` into domain-specific files under `server/storage/`:

| Module | File | Methods (est.) | Tables |
|--------|------|----------------|--------|
| **users** | `users.storage.ts` | ~10 | users |
| **providers** | `providers.storage.ts` | ~15 | providers, providerPartners, providerDocuments |
| **customers** | `customers.storage.ts` | ~8 | customers |
| **consultations** | `consultations.storage.ts` | ~12 | ispConsultations, spcConsultations, consultationLogs |
| **anti-fraud** | `anti-fraud.storage.ts` | ~8 | antiFraudAlerts, antiFraudRules |
| **financial** | `financial.storage.ts` | ~20 | contracts, invoices, providerInvoices, creditOrders |
| **equipamentos** | `equipamentos.storage.ts` | ~8 | equipment, equipamentos |
| **erp** | `erp.storage.ts` | ~12 | erpIntegrations, erpSyncLogs, erpCatalog |
| **chat** | `chat.storage.ts` | ~12 | supportThreads, supportMessages, visitorChats, visitorChatMessages |
| **dashboard** | `dashboard.storage.ts` | ~6 | (cross-table aggregations) |
| **heatmap** | `heatmap.storage.ts` | ~4 | (cross-table queries for geo data) |

**Barrel export preserving the IStorage interface:**

```typescript
// server/storage/index.ts
import { UsersStorage } from "./users.storage";
import { ProvidersStorage } from "./providers.storage";
// ...

class DatabaseStorage implements IStorage {
  private users = new UsersStorage();
  private providers = new ProvidersStorage();
  // ...

  // Delegate to domain modules
  getUser = (id: number) => this.users.getUser(id);
  getUserByEmail = (email: string) => this.users.getUserByEmail(email);
  // ...
}

export const storage = new DatabaseStorage();
```

**Critical: keep the IStorage interface and `storage` singleton export unchanged during migration.** This allows incremental extraction without breaking existing route code. Each domain storage class gets its own file but the facade remains identical.

### Extracted Utilities (from routes.ts)

These pure functions live in routes.ts today but belong in shared modules:

| Function | Move To | Reason |
|----------|---------|--------|
| `calculateIspScore()` | `server/scoring/isp-score.ts` | Core business logic, used by consultas and anti-fraud |
| `geocodeCityServer()` | `server/geo/geocode.ts` | Used by heatmap and consultas |
| `extractCityStateFromAddress()` | `server/geo/geocode.ts` | Address parsing utility |
| `parseAmountRange()` | `server/utils/format.ts` | Utility |
| LGPD masking logic | `server/lgpd/masking.ts` | Cross-cutting concern, must be consistent |

---

## ERP Connector Architecture

### Strategy Pattern with Registry

```typescript
// server/erp/connector.interface.ts

export interface ErpConnector {
  /** Machine-readable identifier matching erpIntegrations.erpSource */
  readonly name: string;

  /** Human-readable label */
  readonly label: string;

  /** Fields this ERP requires beyond apiUrl/apiToken */
  readonly configFields: ErpConfigField[];

  /** Test the connection with provided credentials */
  testConnection(config: ErpConnectionConfig): Promise<ErpTestResult>;

  /** Fetch delinquent customers (overdue invoices) */
  fetchDelinquents(config: ErpConnectionConfig): Promise<ErpFetchResult>;

  /** Fetch all active customers (optional, for full sync) */
  fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult>;
}

export interface ErpConnectionConfig {
  apiUrl: string;
  apiToken: string;
  apiUser?: string;
  /** ERP-specific extra fields (client_id, client_secret, etc.) */
  extra: Record<string, string>;
}

export interface ErpConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  required: boolean;
  placeholder?: string;
}

export interface ErpTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export interface ErpFetchResult {
  ok: boolean;
  message: string;
  customers: NormalizedErpCustomer[];
  totalRecords?: number;
}

export interface NormalizedErpCustomer {
  cpfCnpj: string;        // cleaned, digits only
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  cep?: string;            // digits only
  totalOverdueAmount: number;
  maxDaysOverdue: number;
  overdueInvoicesCount?: number;
}
```

### Connector Registry

```typescript
// server/erp/registry.ts

import { IxcConnector } from "./connectors/ixc.connector";
import { MkConnector } from "./connectors/mk.connector";
import { SgpConnector } from "./connectors/sgp.connector";
import { HubsoftConnector } from "./connectors/hubsoft.connector";
import { VoalleConnector } from "./connectors/voalle.connector";
import { RbxConnector } from "./connectors/rbx.connector";
import type { ErpConnector } from "./connector.interface";

const connectors = new Map<string, ErpConnector>();

function register(connector: ErpConnector) {
  connectors.set(connector.name, connector);
}

// Register all connectors at startup
register(new IxcConnector());
register(new MkConnector());
register(new SgpConnector());
register(new HubsoftConnector());
register(new VoalleConnector());
register(new RbxConnector());

export function getConnector(source: string): ErpConnector | undefined {
  return connectors.get(source);
}

export function getAllConnectors(): ErpConnector[] {
  return Array.from(connectors.values());
}

export function getSupportedSources(): string[] {
  return Array.from(connectors.keys());
}
```

### Auth Strategy per ERP

Each connector handles its own authentication internally. The patterns:

| ERP | Auth Type | Config Fields | Token Lifecycle |
|-----|-----------|---------------|-----------------|
| **IXC Soft** | Basic Auth (`Base64(user:token)`) | apiUser, apiToken | Static -- no refresh needed |
| **MK Solutions** | Bearer JWT | apiToken (pre-generated) | Static -- generated in MK admin panel |
| **SGP** | Token+App OR Basic Auth | apiToken, appName OR apiUser+apiToken | Static |
| **Hubsoft** | OAuth2 (client_credentials + password) | clientId, clientSecret, username, password | **Dynamic** -- token expires, needs refresh |
| **Voalle** | Integration User (Bearer) | apiToken (integration user) | Static or session-based |
| **RBX ISP** | Integration Key in POST body | chaveIntegracao | Static |
| **TopSApp** | Bearer Token | apiToken | Static (assumed, LOW confidence) |
| **RadiusNet** | Bearer Token | apiToken | Static (assumed, LOW confidence) |

**Hubsoft is the only connector requiring token lifecycle management.** Use a simple token cache with TTL:

```typescript
// server/erp/connectors/hubsoft.connector.ts (auth portion)

class HubsoftConnector implements ErpConnector {
  private tokenCache = new Map<string, { token: string; expiresAt: number }>();

  private async getAccessToken(config: ErpConnectionConfig): Promise<string> {
    const cacheKey = config.apiUrl;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60000) {
      return cached.token;
    }

    const resp = await fetch(`${config.apiUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "password",
        client_id: config.extra.clientId,
        client_secret: config.extra.clientSecret,
        username: config.extra.username,
        password: config.extra.password,
      }),
    });

    const data = await resp.json();
    this.tokenCache.set(cacheKey, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    });
    return data.access_token;
  }
}
```

### Connector File Structure

```
server/
  erp/
    connector.interface.ts      # Types and interfaces
    registry.ts                 # Connector registry
    normalize.ts                # Shared normalization utilities (CPF cleaning, etc.)
    connectors/
      ixc.connector.ts          # IXC Soft implementation
      mk.connector.ts           # MK Solutions implementation
      sgp.connector.ts          # SGP implementation
      hubsoft.connector.ts       # Hubsoft (with OAuth)
      voalle.connector.ts       # Voalle
      rbx.connector.ts          # RBX ISP
      topsapp.connector.ts      # TopSApp (phase 2)
      radiusnet.connector.ts    # RadiusNet (phase 2)
      gere.connector.ts         # Gere (phase 2)
      receitanet.connector.ts   # Receita Net (phase 2)
```

### Data Normalization Layer

Each connector maps ERP-specific field names to the `NormalizedErpCustomer` interface. A shared normalization utility handles:

```typescript
// server/erp/normalize.ts

export function cleanCpfCnpj(raw: string): string {
  return (raw || "").replace(/\D/g, "");
}

export function cleanCep(raw: string): string {
  return (raw || "").replace(/\D/g, "").padEnd(8, "0").slice(0, 8);
}

export function cleanPhone(raw: string): string {
  return (raw || "").replace(/\D/g, "");
}

export function calculateDaysOverdue(dueDate: string | null): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const now = new Date();
  const diff = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

/** Aggregate multiple invoice rows into per-customer summaries */
export function aggregateByCustomer(
  invoices: Array<{ cpfCnpj: string; name: string; amount: number; daysOverdue: number; [k: string]: any }>
): NormalizedErpCustomer[] {
  const map = new Map<string, NormalizedErpCustomer>();
  for (const inv of invoices) {
    const existing = map.get(inv.cpfCnpj);
    if (existing) {
      existing.totalOverdueAmount += inv.amount;
      existing.maxDaysOverdue = Math.max(existing.maxDaysOverdue, inv.daysOverdue);
      existing.overdueInvoicesCount = (existing.overdueInvoicesCount || 0) + 1;
    } else {
      map.set(inv.cpfCnpj, {
        cpfCnpj: inv.cpfCnpj,
        name: inv.name,
        totalOverdueAmount: inv.amount,
        maxDaysOverdue: inv.daysOverdue,
        overdueInvoicesCount: 1,
        // spread optional fields from the first invoice
        email: inv.email,
        phone: inv.phone,
        address: inv.address,
        city: inv.city,
        state: inv.state,
        cep: inv.cep,
      });
    }
  }
  return Array.from(map.values());
}
```

---

## Data Flow for ERP Sync

### Auto-Sync Flow (Scheduler)

```
Scheduler (every 30min)
  |
  v
storage.getAllEnabledErpIntegrationsWithCredentials()
  |
  v
For each integration where interval elapsed:
  |
  +---> registry.getConnector(erpSource)
  |         |
  |         v
  |     connector.fetchDelinquents(config)
  |         |
  |         v
  |     NormalizedErpCustomer[]  (ERP-specific -> normalized)
  |         |
  |         v
  |     storage.syncErpCustomers(providerId, source, customers)
  |         |  (upsert into `customers` table)
  |         v
  |     storage.upsertErpIntegration(status, lastSyncAt)
  |     storage.createErpSyncLog(results)
  |
  v
Done -- heatmap-cache picks up new data on next refresh
```

### Manual Sync Flow (API)

```
POST /api/provider/erp-integrations/:source/sync
  |
  v
requireAuth middleware
  |
  v
registry.getConnector(source)
  |
  v
connector.fetchDelinquents(configFromDb)
  |
  v
storage.syncErpCustomers(providerId, source, customers)
  |
  v
Return { upserted, errors } to client
```

### Heatmap Refresh Flow (after N8N removal)

```
Heatmap Cache Refresh (every 24h or manual)
  |
  v
For each provider with ERP enabled:
  |
  v
  Option A (preferred): Read from `customers` table
    -- Already synced by scheduler, no ERP call needed
    -- SELECT * FROM customers WHERE providerId = X AND paymentStatus = 'overdue'
  |
  v
  Geocode: CEP -> ViaCEP -> city/state -> Nominatim -> lat/lng
  |
  v
  Store in in-memory cache (Map<providerId, HeatPoint[]>)
```

**Key change:** The heatmap cache should read from the `customers` table (already synced by scheduler) instead of making direct ERP calls. This eliminates the N8N dependency and avoids duplicate API calls. The current `fetchIxcDelinquents` in `heatmap-cache.ts` that calls N8N should be replaced with a simple database query.

### Score Calculation Flow

```
POST /api/isp-consultations (query by CPF/CNPJ)
  |
  v
storage.getCustomerByCpfCnpj(cpfCnpj)  -- returns records from ALL providers
  |
  v
For each provider's record:
  - LGPD mask: partial name, amount range, no full address
  |
  v
calculateIspScore({
  maxDaysOverdue,
  totalOverdueAmount,
  unreturnedEquipmentCount,
  contractAgeDays,
  recentConsultationsCount,  -- from ispConsultations
  providersWithDebt,         -- count of distinct providers with debt
  clientYears,
  neverLate,
  allEquipmentReturned
})
  |
  v
Return: score (0-100), riskTier, decision, masked history
```

---

## Patterns to Follow

### Pattern 1: Express Router Module

Each route module is a function returning an Express Router. Middleware applied per-route, not globally on the router (to match existing patterns).

```typescript
// server/routes/consultas.routes.ts
import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { calculateIspScore } from "../scoring/isp-score";
import { maskForLgpd } from "../lgpd/masking";

export function registerConsultasRoutes(): Router {
  const router = Router();

  router.get("/api/isp-consultations", requireAuth, async (req, res) => {
    const providerId = req.session.providerId!;
    const consultations = await storage.getIspConsultationsByProvider(providerId);
    res.json(consultations);
  });

  // ... rest of consultation routes

  return router;
}
```

### Pattern 2: Storage Composition via Facade

Domain storage classes are independent, the main `DatabaseStorage` delegates. This keeps the public API stable while allowing internal extraction.

```typescript
// server/storage/users.storage.ts
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

export class UsersStorage {
  async getUser(id: number) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }
  // ...
}
```

### Pattern 3: ERP Connector with Error Boundaries

Each connector wraps API calls with timeout, retry, and structured error reporting.

```typescript
// Common pattern in each connector
import pLimit from "p-limit";
import pRetry from "p-retry";

const limit = pLimit(3); // max 3 concurrent requests per ERP

async fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
  return pRetry(
    () => limit(() => fetch(url, {
      ...options,
      signal: AbortSignal.timeout(30000),
    })),
    { retries: 2, minTimeout: 1000 }
  );
}
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Circular Storage Dependencies
**What:** Domain storage modules importing from each other (e.g., consultations.storage importing from customers.storage).
**Why bad:** Creates tight coupling, makes testing impossible, reintroduces the monolith at a different level.
**Instead:** Cross-domain queries stay in the facade (DatabaseStorage) or in a dedicated "query" layer. Individual domain modules only access their own tables.

### Anti-Pattern 2: ERP Logic in Route Handlers
**What:** Putting ERP-specific API call logic directly in route handlers (as currently done in `routes.ts` and `scheduler.ts`).
**Why bad:** Duplicates logic between manual sync routes and scheduler. Makes adding new ERPs require changes in multiple files.
**Instead:** All ERP interaction goes through the connector registry. Routes and scheduler both call `registry.getConnector(source).fetchDelinquents(config)`.

### Anti-Pattern 3: Abstract Base Class for Connectors
**What:** Using `abstract class BaseErpConnector` with template methods.
**Why bad:** ERPs have fundamentally different auth flows (Basic vs OAuth vs POST-body key). A base class creates false uniformity and leaks abstractions.
**Instead:** Use the interface. Each connector is fully independent. Shared utilities (normalization, retry) are imported as functions, not inherited.

### Anti-Pattern 4: Big-Bang Refactor
**What:** Rewriting routes.ts and storage.ts in one commit.
**Why bad:** Introduces regression risk in a system with 100+ endpoints and no test suite.
**Instead:** Extract one domain at a time. Each extraction is a self-contained commit. The old code in routes.ts gets thinner incrementally.

---

## Suggested Build Order

The refactoring must be ordered by dependency and risk. Items lower in the list depend on items above.

### Phase A: Foundation (do first, everything depends on it)

1. **Extract scoring engine** (`server/scoring/isp-score.ts`)
   - Pure function, zero dependencies, easy to extract
   - Enables testing the core business logic independently

2. **Extract LGPD masking** (`server/lgpd/masking.ts`)
   - Pure functions, used by consultas routes
   - Critical for compliance -- must be consistent and testable

3. **Extract geocoding utilities** (`server/geo/geocode.ts`)
   - Currently duplicated between routes.ts and heatmap-cache.ts
   - Shared by heatmap and consultation routes

### Phase B: ERP Connector Engine (critical path, blocks N8N removal)

4. **Create ERP connector interface and registry** (`server/erp/`)
   - Interface, registry, normalization utilities

5. **Implement IXC connector** (refactor from existing code in scheduler.ts)
   - Most mature, already partially working
   - Validate the interface design against real API

6. **Implement MK, SGP, RBX connectors** (simpler auth: Bearer/Token/Key)
   - Straightforward implementations

7. **Implement Hubsoft connector** (OAuth -- most complex auth)
   - Token lifecycle management

8. **Implement Voalle connector**
   - May need research into their specific API patterns

9. **Update scheduler.ts** to use connector registry
   - Replace `fetchErpCustomersForScheduler()` with `registry.getConnector(source).fetchDelinquents()`

10. **Update heatmap-cache.ts** to read from `customers` table
    - Remove N8N proxy URL and direct ERP calls
    - Query database instead (data already synced by scheduler)

### Phase C: Route Modularization (can partially overlap with Phase B)

11. **Create `server/routes/index.ts`** barrel with router registration
12. **Extract auth routes** (smallest, least risky)
13. **Extract public routes** (no auth, minimal logic)
14. **Extract ERP routes** (already refactored in Phase B)
15. **Extract consultas routes** (largest, most complex -- depends on scoring and LGPD)
16. **Extract admin routes** (second largest)
17. **Extract remaining modules** (dashboard, import, anti-fraude, equipamentos, credits, chat, heatmap, ai, provider)
18. **Delete old routes.ts** when empty

### Phase D: Storage Modularization (after routes are stable)

19. **Create storage facade** (`server/storage/index.ts`) with delegation pattern
20. **Extract domain storage modules** one at a time, starting with the simplest (users, then providers, then customers, etc.)
21. **Delete old monolithic storage.ts** when fully extracted

### Phase E: Cleanup

22. **Remove Replit dependencies** (replit_integrations directory, any Replit plugins)
23. **Remove N8N config fields** from provider settings UI (or mark deprecated)
24. **Clean up dead code** in routes that referenced N8N directly

### Dependency Graph

```
Phase A (foundation)
  |
  +---> Phase B (ERP connectors)  ----> Phase E (cleanup)
  |         |
  |         v
  +---> Phase C (route modularization)
              |
              v
         Phase D (storage modularization)
```

Phases B and C can overlap: start route extraction while ERP connectors are being built. Phase D should wait until routes are stable to avoid changing two layers simultaneously.

---

## Docker Deployment Architecture

### Container Layout

```
docker-compose.yml
  |
  +-- app (Node.js)
  |     - Express server (API + static frontend)
  |     - ERP connector engine (outbound HTTPS calls)
  |     - Scheduler (in-process, not a separate container)
  |     - Port: 5000
  |
  +-- postgres (PostgreSQL 16)
  |     - Data volume: ./data/postgres
  |     - Port: 5432 (internal only)
  |
  +-- (optional) redis
        - Only if session store or heatmap cache needs persistence
        - Current: sessions in PostgreSQL (connect-pg-simple), cache in-memory
        - Verdict: NOT needed initially. Add only if horizontal scaling required.
```

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "dist/index.cjs"]
```

### docker-compose.yml

```yaml
version: "3.8"
services:
  app:
    build: .
    ports:
      - "5000:5000"
    environment:
      - DATABASE_URL=postgresql://consulta:${DB_PASSWORD}@postgres:5432/consultaisp
      - SESSION_SECRET=${SESSION_SECRET}
      - NODE_ENV=production
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=consultaisp
      - POSTGRES_USER=consulta
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U consulta"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

volumes:
  pgdata:
```

### IP Whitelisting for ERPs

Some ERPs (notably IXC Soft) require server IP whitelisting. With Docker on a VPS:
- The outbound IP is the VPS public IP (not a container IP)
- Providers must whitelist this IP in their ERP settings
- Document this in the ERP setup UI: "Adicione o IP X.X.X.X nas configuracoes do seu ERP"
- Consider using a dedicated outbound IP if behind a load balancer

---

## Scalability Considerations

| Concern | Current (single server) | At 100 providers | At 1000 providers |
|---------|------------------------|-------------------|---------------------|
| **ERP Sync** | Sequential in scheduler | Add concurrency limiter (p-limit per ERP, 5 concurrent) | Queue-based with worker processes |
| **Heatmap Cache** | In-memory Map | In-memory Map (still fine, ~100 entries) | Redis or persistent cache |
| **Sessions** | PostgreSQL store | PostgreSQL store (fine) | Redis session store |
| **Database** | Single PostgreSQL | Single PostgreSQL with connection pool (fine) | Read replicas, connection pooling (PgBouncer) |
| **Score Calculation** | Synchronous in request | Synchronous (still fine, <50ms) | Pre-calculate on sync, cache scores |

**Verdict for now:** Single-server Docker Compose is sufficient. The system serves ISPs, not end consumers -- provider count grows linearly and slowly. Architect for 100 providers, plan for 1000 only if traction justifies it.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Route decomposition | HIGH | Based on direct analysis of the 4350-line routes.ts with all endpoint definitions |
| Storage decomposition | HIGH | Based on direct analysis of the 1800-line storage.ts IStorage interface |
| ERP connector interface | HIGH | Based on documented ERP APIs in CLAUDE.md and existing IXC implementation in scheduler.ts |
| ERP auth patterns | MEDIUM-HIGH | IXC, MK, SGP, RBX well-documented; Hubsoft OAuth and Voalle have LOW confidence on exact API details |
| Build order | HIGH | Derived from actual code dependency analysis |
| Docker architecture | HIGH | Standard Node.js + PostgreSQL pattern, matches the existing build system (esbuild + vite) |

## Sources

- Direct codebase analysis: `server/routes.ts` (4350 lines, 100+ endpoints mapped)
- Direct codebase analysis: `server/storage.ts` (IStorage interface, 170+ methods)
- Direct codebase analysis: `server/scheduler.ts` (existing IXC sync implementation)
- Direct codebase analysis: `server/heatmap-cache.ts` (N8N proxy dependency identified)
- CLAUDE.md Section 7: ERP API documentation for IXC, MK, SGP, Hubsoft, Voalle, RBX
- CLAUDE.md Section 3: Directory structure and build system
- IXC API docs: https://wikiapiprovedor.ixcsoft.com.br/
- MK Auth API: https://postman.mk-auth.com.br/
- SGP API: https://bookstack.sgp.net.br/books/api
- Hubsoft API: https://docs.hubsoft.com.br/
- RBX API: https://www.developers.rbxsoft.com/
