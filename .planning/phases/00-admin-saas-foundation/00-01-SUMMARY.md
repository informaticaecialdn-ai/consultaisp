---
phase: 00-admin-saas-foundation
plan: 01
subsystem: auth
tags: [connect-pg-simple, postgresql, session, express-session, middleware]

requires:
  - phase: none
    provides: first plan of new phase
provides:
  - PostgreSQL-backed persistent sessions via connect-pg-simple
  - Mandatory SESSION_SECRET enforcement (no fallback)
  - requireAdmin middleware allowing superadmin access
affects: [00-admin-saas-foundation, all admin routes, session persistence]

tech-stack:
  added: [connect-pg-simple, pg.Pool for sessions]
  patterns: [session store auto-creates table, mandatory env vars throw on missing]

key-files:
  created: []
  modified: [server/auth.ts]

key-decisions:
  - "Used connect-pg-simple with createTableIfMissing:true for zero-migration session setup"
  - "SESSION_SECRET throws at startup instead of falling back to insecure default"
  - "requireAdmin accepts both admin and superadmin roles for tenant-scoped route access"

patterns-established:
  - "Mandatory env vars: throw Error at module load, never use fallback secrets"
  - "cookie.secure conditional on NODE_ENV=production"

requirements-completed: [AUTH-01, AUTH-02, TENANT-01]

duration: 1min
completed: 2026-04-01
---

# Phase 00 Plan 01: Session Persistence & Auth Middleware Summary

**PostgreSQL-backed sessions via connect-pg-simple replacing memorystore, with mandatory SESSION_SECRET and superadmin access through requireAdmin**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-01T20:02:47Z
- **Completed:** 2026-04-01T20:04:04Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Replaced volatile memorystore with PostgreSQL-backed connect-pg-simple sessions that persist across restarts
- Enforced SESSION_SECRET as mandatory env var (server throws on missing instead of using insecure fallback)
- Fixed requireAdmin middleware to allow superadmin role through admin-protected routes

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace memorystore with connect-pg-simple and enforce SESSION_SECRET** - `201251e` (feat)
2. **Task 2: Fix requireAdmin to allow superadmin access** - `abd8b45` (fix)

## Files Created/Modified
- `server/auth.ts` - Session middleware with connect-pg-simple, mandatory SESSION_SECRET, role-aware requireAdmin

## Decisions Made
- Used connect-pg-simple with `createTableIfMissing: true` to avoid needing a manual migration for the session table
- SESSION_SECRET throws at startup rather than using a fallback -- prevents accidental insecure deployments
- requireAdmin checks for both "admin" and "superadmin" roles, allowing superadmin to access all tenant-scoped routes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. SESSION_SECRET was already in .env.example.

## Next Phase Readiness
- Session persistence is ready for production use
- requireAdmin middleware correctly gates admin routes for both admin and superadmin roles
- Next plans in this phase can build on the corrected auth foundation

---
*Phase: 00-admin-saas-foundation*
*Completed: 2026-04-01*
