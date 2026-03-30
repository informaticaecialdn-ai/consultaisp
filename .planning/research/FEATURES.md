# Feature Landscape

**Domain:** ISP Credit Bureau SaaS - ERP Integration, LGPD Compliance, Deployment, Modular Architecture
**Researched:** 2026-03-29
**Milestone context:** Subsequent milestone - core credit analysis, anti-fraud, N8N ERP sync, payments, multi-tenant auth already exist

## Table Stakes

Features that are non-negotiable for this milestone. Without these, the ERP integration and LGPD compliance story is incomplete.

### ERP Integration - Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Abstract ERP connector interface | Every ERP has different auth and endpoints. A unified interface (`ErpConnector`) with per-ERP implementations is the only scalable way to support 6+ ERPs | Medium | Already designed in CLAUDE.md - `testConnection`, `fetchDelinquents`, `fetchCustomers` |
| IXC Soft direct connector | Largest ISP ERP in Brazil. Currently works via N8N proxy. Must work natively with Basic Auth + POST with `ixcsoft: "listar"` header | Medium | Partially implemented. Refactor from N8N dependency. IP whitelist instructions for providers |
| MK Solutions connector | Second most popular ISP ERP. JWT Bearer auth, REST GET/POST | Medium | Well-documented API at postman.mk-auth.com.br |
| Connection test endpoint | Providers MUST be able to verify their ERP credentials work before enabling sync. `POST /api/erp-integrations/:source/test` | Low | Already exists conceptually in routes |
| Manual sync trigger | Providers need on-demand sync, not just scheduled. `POST /api/erp-integrations/:source/sync` | Low | Route exists, needs to use new connectors |
| Auto-sync scheduler expansion | Current scheduler only handles IXC via N8N. Must iterate all configured ERPs per provider using the connector registry | Medium | Modify `scheduler.ts` to loop through `erpIntegrations` table entries |
| ERP-specific config UI | Each ERP needs different fields: IXC needs user+token, Hubsoft needs client_id+client_secret+username+password (OAuth), RBX needs ChaveIntegracao | Medium | Dynamic form based on selected ERP from `erpCatalog` |
| Sync error logging and display | `erpSyncLogs` table already exists. Providers need a UI to see sync history, errors, records upserted | Low | Table exists, need frontend page/tab |
| Rate limiting / retry on ERP calls | ERP APIs are unreliable. Must have exponential backoff, timeout handling, and circuit breaker per connector | Medium | Use existing `p-retry` + `p-limit` dependencies |
| N8N removal from heatmap-cache | Heatmap currently calls N8N proxy. Must use `connectors[source].fetchDelinquents()` instead | Low | Direct replacement in `heatmap-cache.ts` |

### LGPD Compliance - Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Data minimization in cross-provider sharing | LGPD Art. 6 requires sharing only the minimum necessary. Current masking (partial name, value range, no full address) is correct but must be enforced systematically | Medium | Audit all cross-provider data paths. Create a masking middleware/utility that ALL cross-tenant queries pass through |
| Consent/legal basis documentation in system | Art. 7(X) "protecao de credito" is the legal basis. System must document this in privacy policy AND display it during provider onboarding | Low | Static content + acceptance checkbox at registration |
| Data retention policy enforcement | LGPD requires defined retention periods. Delinquency data cannot be kept indefinitely. Industry standard: 5 years (aligned with CDC Art. 43 par. 1) | Medium | Add `expiresAt` logic to consultation/customer records. Background job to purge expired data |
| Prior notification mechanism | CDC Art. 43 par. 2 requires written notification before including someone in delinquency registries. System should generate/track notifications | High | This is legally critical. When a provider reports a defaulter, the system should track that the defaulter was notified (by the originating provider, not the platform) |
| Audit trail for data access | Every cross-provider consultation must be logged with who accessed what, when, and why. `consultationLogs` partially covers this | Low | Already exists. Ensure completeness: log provider ID, user ID, timestamp, CPF consulted, data returned |
| LGPD data subject rights endpoints | Data subjects (consumers) have the right to: know what data exists about them, request correction, request deletion. Platform needs at minimum a documented process | Medium | Can start with manual process via support + a `/lgpd` page explaining rights. Automated self-service is a differentiator |
| Data Processing Agreement (DPA) between providers | Each provider joining the network must accept a data processing agreement defining roles (controller vs processor) and obligations | Low | Legal document, not code. But system must track acceptance and version |
| Mascaramento validation tests | Automated tests ensuring no personal data leaks across provider boundaries. Name, full address, exact values must NEVER appear in cross-provider responses | Medium | Critical regression tests. Every cross-provider API response must be validated |

### Deployment (Docker/VPS) - Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Production Dockerfile | Multi-stage build: build stage (Node + esbuild + Vite) and runtime stage (node:slim). Non-root user, proper signal handling | Medium | Must handle both backend (CJS via esbuild) and frontend (Vite static) |
| docker-compose.yml | App + PostgreSQL + (optional) Redis. Environment variables via .env file. Volumes for DB persistence | Low | Standard pattern |
| Health check endpoint | `GET /api/health` returning `{ status: "ok", db: "connected", uptime: N }`. Docker HEALTHCHECK directive using it | Low | Express endpoint + Dockerfile HEALTHCHECK instruction |
| Graceful shutdown | Handle SIGTERM/SIGINT properly: stop accepting connections, drain existing requests, close DB pool, close WebSocket server | Medium | Critical for zero-downtime deploys and Docker stop |
| Environment variable configuration | All secrets via env vars, no hardcoded values. Validation at startup (fail fast if DATABASE_URL missing) | Low | Partially exists. Add startup validation with clear error messages |
| Structured logging | JSON logs with timestamp, level, request-id, provider-id context. Replace `console.log` with a logger (pino) | Medium | Essential for production debugging and log aggregation |

### Modular Backend - Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Route modularization | Split `routes.ts` (4350 lines) into domain modules: auth, consultas, erp, admin, financeiro, equipamentos, heatmap, support | High | Biggest refactoring task. Must preserve all existing functionality |
| Storage modularization | Split `storage.ts` (1800+ lines) into domain-specific storage modules that implement focused interfaces | High | Same pattern as routes. Domain separation |
| ERP connector as isolated module | `server/erp/` directory with connector interface, per-ERP implementations, registry, types | Medium | Already designed in CLAUDE.md |
| Remove Replit dependencies | Clean out `replit_integrations`, Replit plugins, any Replit-specific configs | Low | Search and remove |

## Differentiators

Features that set the product apart from generic solutions. Not expected but create competitive advantage.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| SGP, Hubsoft, Voalle, RBX connectors | Covering 6 ERPs instead of just IXC+MK means the network covers far more ISPs. More ISPs = more valuable collaborative data | High (4 connectors) | SGP (token auth), Hubsoft (OAuth), Voalle (integration user), RBX (ChaveIntegracao POST). Each is a separate implementation |
| TopSApp, RadiusNet, Gere, ReceitaNet connectors | Secondary ERPs. Completeness of coverage is the moat | High (4 more) | Less documented APIs. May need to contact ERP vendors for docs. Flag for deeper research |
| Bidirectional sync (write-back to ERP) | Not just reading delinquents FROM ERP, but updating customer status IN the ERP when credit check is done. Example: flag a customer as "alto risco" in IXC | Very High | Most ERPs support write operations. Huge differentiator but risky - data corruption in provider's ERP is catastrophic |
| Webhook-based real-time sync | Instead of polling every 30min, receive webhooks from ERPs when invoices become overdue. Near-real-time data freshness | High | Requires ERP webhook support (IXC has it, others vary). Fallback to polling |
| LGPD self-service portal for consumers | Allow consumers (CPF holders) to check what data the platform has about them, request corrections, download their data | High | Legally valuable but complex. Requires identity verification for the consumer (not a provider user). Separate auth flow |
| RIPD (Data Protection Impact Report) generator | Auto-generate LGPD impact reports based on actual data flows in the system. Shows compliance maturity | Medium | Template + populated data from system metrics. Impressive for enterprise/regulatory sales |
| Data anonymization for analytics | Aggregate analytics (sector-wide default rates, geographic trends) using fully anonymized data. No LGPD issue with truly anonymous data | Medium | Separate analytics pipeline that strips all PII before aggregation |
| Container orchestration readiness | Kubernetes manifests, horizontal scaling config, separate worker containers for sync jobs | High | Overkill for initial VPS deploy but shows maturity |
| Centralized log aggregation | ELK stack or Loki+Grafana for searching logs across containers | Medium | Can start with simple file-based logging + log rotation. Full stack is a differentiator |
| APM integration (Application Performance Monitoring) | Integrate with Datadog, New Relic, or open-source alternatives (OpenTelemetry) for request tracing | Medium | Helps diagnose slow ERP calls, DB queries |
| Blue-green or rolling deployment | Zero-downtime deployments using Docker Compose profiles or simple nginx upstream switching | Medium | Important for production reliability |
| Automated database migrations | Drizzle Kit migrations (not just push) with version tracking and rollback capability | Medium | Currently uses `drizzle-kit push` which is dev-only. Production needs proper migrations |

## Anti-Features

Features to deliberately NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Public API for third-party integrations | Premature. No external consumers yet. API surface would need versioning, rate limiting, documentation, auth tokens - massive scope | Focus on internal ERP connectors. Revisit API in v2 once core is stable |
| Mobile native app | Web responsive is sufficient. No user demand signal. Adds iOS+Android maintenance burden | Ensure responsive design works well on mobile browsers |
| Integration with bureaus beyond SPC | Serasa, Boa Vista, Quod each have complex regulatory requirements and commercial agreements | Keep SPC integration. Other bureaus are a separate business initiative |
| Multi-language support | Market is 100% Brazilian. Zero international demand | Keep everything in pt-BR |
| Custom scoring algorithm editor | Letting providers customize the scoring formula sounds flexible but creates inconsistency across the network. The value IS the standardized score | Keep the centralized scoring engine. Allow providers to set their own risk thresholds (e.g., "reject below 30" vs "reject below 25") but not modify the score calculation |
| Blockchain-based audit trail | Adds complexity for no practical benefit. A properly secured PostgreSQL with audit logging is sufficient and legally defensible | Use database-level audit tables with immutable append-only pattern |
| Real-time streaming dashboard (WebSocket) | Current polling/refresh approach works. WebSocket dashboard adds complexity for marginal UX improvement | Periodic refresh (30s-60s) with manual refresh button |
| LGPD consent management platform | Building a full consent management platform is a product in itself. The credit protection legal basis (Art. 7 X) does not require consent | Document the legal basis clearly. Track DPA acceptance. Don't build a consent management UI |
| Direct ERP database access | Some ERPs allow direct DB connections (MySQL/Postgres). NEVER do this - it bypasses the ERP's business logic, security, and creates version coupling | Always use official REST APIs, even if slower |
| Automated legal compliance checking | AI-powered LGPD compliance verification sounds cool but is unreliable and creates false sense of security | Manual compliance review with checklist. Legal team validation |

## Feature Dependencies

```
Route modularization ──────────────────────────┐
                                                 ├─→ ERP connector module
Storage modularization ────────────────────────┘         │
                                                          ├─→ IXC connector (refactor from N8N)
N8N removal from heatmap-cache ─────────────────────────┤
                                                          ├─→ MK Solutions connector
ERP-specific config UI ──────────────────────────────────┤
                                                          ├─→ SGP connector
Connection test endpoint ─────────────────────────────────┤
                                                          ├─→ Hubsoft connector (OAuth)
Auto-sync scheduler expansion ────────────────────────────┤
                                                          ├─→ Voalle connector
                                                          └─→ RBX connector

Mascaramento validation tests ──→ Masking middleware/utility ──→ LGPD audit trail completeness

Dockerfile ──→ docker-compose.yml ──→ Health check endpoint
                                   ──→ Graceful shutdown
                                   ──→ Structured logging (pino)
                                   ──→ Env var validation

Data retention policy ──→ Background purge job (depends on scheduler)
```

**Critical path:** Route/storage modularization MUST happen before or in parallel with ERP connector work. The 4350-line routes.ts is the bottleneck for all backend changes.

## MVP Recommendation

### Phase 1: Foundation (modularization + deployment)
Prioritize:
1. **Route modularization** - unblocks all backend work
2. **Storage modularization** - same rationale
3. **Remove Replit dependencies** - clean foundation
4. **Dockerfile + docker-compose** - deploy capability
5. **Health check + graceful shutdown** - production readiness
6. **Structured logging (pino)** - production debugging
7. **Env var validation** - fail-fast on misconfiguration

### Phase 2: ERP Core (connectors + N8N removal)
1. **ERP connector interface + registry** - architecture
2. **IXC direct connector** - refactor existing, remove N8N
3. **MK Solutions connector** - second priority ERP
4. **N8N removal from heatmap + scheduler** - clean break
5. **Connection test + manual sync** - provider-facing features
6. **ERP config UI** - provider-facing features
7. **Sync error logging UI** - observability

### Phase 3: LGPD Hardening
1. **Masking middleware/utility** - systematic enforcement
2. **Mascaramento validation tests** - regression safety
3. **Audit trail completeness** - legal requirement
4. **Data retention policy + purge job** - legal requirement
5. **DPA tracking** - legal requirement
6. **LGPD subject rights documentation** - legal requirement

### Phase 4: ERP Expansion (differentiator)
1. **SGP connector**
2. **Hubsoft connector** (OAuth adds complexity)
3. **Voalle connector**
4. **RBX connector**

Defer:
- **TopSApp, RadiusNet, Gere, ReceitaNet**: Less documented, smaller market share. Research their APIs in a future milestone
- **Bidirectional ERP sync**: High risk, needs careful design. Separate milestone
- **Consumer self-service LGPD portal**: Significant scope. Separate milestone
- **Kubernetes/orchestration**: VPS + Docker Compose is sufficient for initial production

## Sources

- [Compartilhamento de dados de inadimplentes - LGPD e CDC](https://chenut.online/compartilhamento-de-dados-de-inadimplentes-os-riscos-legais-nas-listas-internas-sob-a-lgpd-e-o-cdc/) - LGPD legal requirements for delinquency data sharing
- [Interface entre Cadastro Positivo e LGPD](https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/tecnologia/interface-entre-a-nova-lei-do-cadastro-positivo-e-a-lei-geral-de-protecao-de-dados) - Lei 12.414 and LGPD intersection
- [Projeto fixa regras para dados pessoais em protecao ao credito](https://www.camara.leg.br/noticias/692295-projeto-fixa-regras-para-uso-de-dados-pessoais-do-consumidor-por-empresas-de-protecao-ao-credito/) - Legislative framework for credit data
- [LGPD e Provedores de Internet - Cartilha](https://www.pontoisp.com.br/wp-content/uploads/2020/08/LGPD-Provedores-cartilha.pdf) - ISP-specific LGPD guidance
- [IXC Soft API Documentation](https://wikiapiprovedor.ixcsoft.com.br/) - IXC API reference
- [MK Auth API - Postman](https://postman.mk-auth.com.br/) - MK Solutions API reference
- [SGP API Documentation](https://bookstack.sgp.net.br/books/api) - SGP API reference
- [Hubsoft API - GitHub](https://github.com/hubsoftbrasil/api) - Hubsoft API reference
- [RBXSoft Developers](https://www.developers.rbxsoft.com/) - RBX ISP API reference
- [Dockerizing Node.js for Production 2026](https://dev.to/axiom_agent/dockerizing-nodejs-for-production-the-complete-2026-guide-7n3) - Docker best practices
- [Docker Health Checks for Node.js](https://anthonymineo.com/docker-healthcheck-for-your-node-js-app/) - Health check patterns
- [INFORM Credit Risk Scoring for Telecom](https://www.inform-software.com/en/solutions/risk-fraud/risk-monitoring/credit-risk-scoring) - Telecom credit scoring features
