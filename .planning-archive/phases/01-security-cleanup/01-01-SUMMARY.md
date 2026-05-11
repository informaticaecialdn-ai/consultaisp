---
phase: 01-security-cleanup
plan: 01
subsystem: infra
tags: [security, env-vars, replit-cleanup, vite, n8n]

# Dependency graph
requires: []
provides:
  - "Secret-free source code with N8N credentials via env vars"
  - "Replit-free codebase (no platform artifacts, packages, or references)"
  - "Clean vite.config.ts with only react plugin"
  - "Production domain (app.consultaisp.com.br) for DNS CNAME"
affects: [02-backend-modularization, 05-n8n-removal, 07-deploy-docker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Environment variables for all external service credentials"
    - "APP_URL env var as single source for application URL"

key-files:
  created: []
  modified:
    - server/routes.ts
    - vite.config.ts
    - package.json
    - package-lock.json
    - server/email.ts
    - client/src/pages/admin-provedor.tsx

key-decisions:
  - "heatmap-cache.ts does not exist in this branch -- only routes.ts had hardcoded N8N secrets"
  - "Used app.consultaisp.com.br as CNAME target replacing replit.app domain"
  - "Kept @assets alias removal since attached_assets directory was deleted"

patterns-established:
  - "Secrets via process.env with empty string fallback: process.env.VAR_NAME || ''"
  - "No platform-specific env var fallbacks in URL resolution"

requirements-completed: [SEC-01, SEC-02, SEC-03]

# Metrics
duration: 3min
completed: 2026-03-29
---

# Phase 01 Plan 01: Security Cleanup Summary

**Removed hardcoded N8N credentials from routes.ts and purged all Replit artifacts (90 files, 5651 lines deleted)**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-30T01:46:03Z
- **Completed:** 2026-03-30T01:48:52Z
- **Tasks:** 2
- **Files modified:** 6 (plus 84 deleted)

## Accomplishments
- Replaced hardcoded N8N URL and Basic auth token in server/routes.ts with process.env references
- Deleted 5 Replit directories/files: client/replit_integrations, server/replit_integrations, .replit, replit.md, attached_assets
- Removed 3 @replit devDependencies and cleaned vite.config.ts of all Replit plugins
- Removed Replit env var fallbacks from server/email.ts
- Replaced replit.app CNAME domain with app.consultaisp.com.br in admin-provedor.tsx

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace hardcoded N8N secrets with environment variables** - `e827d5c` (fix)
2. **Task 2: Remove all Replit artifacts, packages, and references** - `f10ea79` (chore)

## Files Created/Modified
- `server/routes.ts` - CENTRAL_N8N_URL and CENTRAL_N8N_AUTH now read from process.env
- `vite.config.ts` - Clean config with only react() plugin, removed @assets alias
- `package.json` - Removed 3 @replit devDependencies
- `package-lock.json` - Updated after dependency removal
- `server/email.ts` - Removed REPLIT_DEPLOYMENT_URL and REPLIT_DEV_DOMAIN fallbacks
- `client/src/pages/admin-provedor.tsx` - CNAME target changed to app.consultaisp.com.br

## Decisions Made
- heatmap-cache.ts referenced in plan does not exist in this branch; only routes.ts had N8N hardcoded secrets
- Used app.consultaisp.com.br as CNAME target per plan suggestion (production domain direction)
- .local and .config/replit directories did not exist in this branch (already absent)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] heatmap-cache.ts not found**
- **Found during:** Task 1
- **Issue:** Plan referenced server/heatmap-cache.ts with hardcoded N8N secrets at lines 3-4, but this file does not exist in the current branch
- **Fix:** Skipped heatmap-cache.ts changes; confirmed only routes.ts had hardcoded N8N credentials via grep scan of entire server/ directory
- **Verification:** grep -rn "n8n.aluisiocunha\|Basic aXNw" server/ returns zero matches
- **Committed in:** e827d5c (Task 1 commit)

---

**Total deviations:** 1 (file referenced in plan not present)
**Impact on plan:** No impact -- the security goal is fully achieved. All hardcoded secrets removed.

## Issues Encountered
None beyond the missing heatmap-cache.ts file noted in deviations.

## User Setup Required

The following environment variables must be configured before deployment:
- `CENTRAL_N8N_URL` - N8N webhook URL for ISP consult
- `CENTRAL_N8N_AUTH` - N8N Basic auth token
- `APP_URL` - Application URL (replaces former Replit env var fallbacks)

## Known Stubs
None -- all env var references use the standard `process.env.VAR || ""` pattern. The empty string fallback is intentional for the interim period before N8N removal in Phase 5.

## Next Phase Readiness
- Codebase is now secret-free and platform-independent
- Ready for Plan 01-02 (additional security cleanup if any) or Phase 02 (backend modularization)
- N8N env vars are interim; N8N dependency fully removed in Phase 5

## Self-Check: PASSED

All files verified present. Both commit hashes (e827d5c, f10ea79) confirmed in git log.

---
*Phase: 01-security-cleanup*
*Completed: 2026-03-29*
