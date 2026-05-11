# Phase 1: Security & Cleanup - Context

**Gathered:** 2026-03-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Remove all hardcoded secrets from source code, clean all Replit platform artifacts and dependencies, and unify price constants between schema and landing page. The codebase should be platform-independent and secret-free after this phase.

</domain>

<decisions>
## Implementation Decisions

### Secrets Handling
- **D-01:** Move N8N URLs from hardcoded strings to environment variables (N8N_PROXY_URL). These will be fully removed in Phase 5 when native ERP connectors replace N8N. For now, env vars ensure secrets aren't in source.
- **D-02:** Locations: `server/heatmap-cache.ts:3` (N8N_PROXY_URL constant) and `server/routes.ts:739` (CENTRAL_N8N_URL constant).
- **D-03:** Scan entire codebase for any other hardcoded secrets (API keys, tokens, URLs with credentials). Claude's discretion on what else to find and fix.

### Replit Cleanup
- **D-04:** Remove ALL Replit artifacts — Claude's discretion on exact scope. Key targets:
  - `client/replit_integrations/` directory (audio, chat integrations)
  - `server/replit_integrations/` directory (audio, batch, chat, image)
  - `.local/` directory (skills, artifacts, secondary_skills)
  - `.config/replit/` directory (semgrep rules)
  - `.replit` file if present
  - `replit.md` file
  - `attached_assets/` directory (development prompts and pasted assets)
- **D-05:** Remove 3 Replit packages from package.json: `@replit/vite-plugin-cartographer`, `@replit/vite-plugin-dev-banner`, `@replit/vite-plugin-runtime-error-modal`
- **D-06:** Clean vite.config.ts of all Replit plugin imports and usages
- **D-07:** Remove any imports/references to replit_integrations throughout client and server code

### Price Unification
- **D-08:** Not discussed — Claude's discretion. Landing page prices (0/149/349) appear to be the most recent. Unify PLAN_PRICES in schema.ts to match landing page, or align both to the same source of truth.

### Build Validation
- **D-09:** After all cleanup, run `npm run check` (tsc) + `npm run build` to validate nothing is broken. Both must pass with zero errors.

### Claude's Discretion
- Exact scope of Replit artifact removal (D-04 — remove everything that's clearly Replit-specific)
- Additional hardcoded secrets beyond N8N URLs (D-03 — scan and fix)
- Price unification strategy (D-08 — determine correct prices and unify)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Hardcoded Secrets
- `server/heatmap-cache.ts` — Line 3: N8N_PROXY_URL hardcoded
- `server/routes.ts` — Line 739: CENTRAL_N8N_URL hardcoded

### Replit Artifacts
- `client/replit_integrations/` — Frontend Replit integrations (audio, chat)
- `server/replit_integrations/` — Backend Replit integrations (audio, batch, chat, image)
- `.local/skills/` — Replit Agent skills and artifacts
- `.config/replit/` — Replit semgrep config
- `package.json` — 3 @replit/* devDependencies
- `vite.config.ts` — Replit plugin imports

### Price Constants
- `shared/schema.ts` — PLAN_PRICES (lines ~455-459): basic: 199, pro: 399, enterprise: 799
- `client/src/pages/landingpage.tsx` — Landing page prices: 0, 149, 349
- `client/src/pages/creditos.tsx` — Credit purchase UI with pricing

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None specific to this phase — this is a cleanup/removal phase

### Established Patterns
- Environment variables loaded via `process.env` throughout server code
- Build system: esbuild (backend CJS) + vite (frontend) via `script/build.ts`
- TypeScript strict mode via `npm run check` (tsc)

### Integration Points
- `server/heatmap-cache.ts` imports N8N URL — used by heatmap refresh endpoint
- `server/routes.ts` uses N8N URL for ISP consultation central endpoint
- `vite.config.ts` imports Replit plugins — used in dev server
- `server/email.ts` references Replit in email templates (needs check)

</code_context>

<specifics>
## Specific Ideas

- User wants N8N completely replaced by native code (Phases 4-5), not just moved to env vars. Phase 1 is an interim security fix.
- User confirmed "voce decide" for Replit cleanup scope — remove everything clearly Replit-specific.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-security-cleanup*
*Context gathered: 2026-03-29*
