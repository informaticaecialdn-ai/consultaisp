---
phase: 00-admin-saas-foundation
plan: 02
subsystem: seed
tags: [security, seed, env-vars]
dependency_graph:
  requires: []
  provides: [env-based-superadmin, gated-demo-data]
  affects: [server/seed.ts, .env.example]
tech_stack:
  added: []
  patterns: [env-var-config, feature-flag-gating]
key_files:
  created: []
  modified: [server/seed.ts, .env.example]
decisions:
  - SUPERADMIN_EMAIL default in .env.example kept as master@consultaisp.com.br for convenience
  - SEED_DEMO_DATA defaults to false (production-safe)
metrics:
  duration: 76s
  completed: "2026-04-01T20:08:34Z"
  tasks: 2
  files: 2
---

# Phase 00 Plan 02: Clean Seed Credentials Summary

Env-based superadmin credentials with SEED_DEMO_DATA flag gating all demo provider data.

## What Was Done

### Task 1: Superadmin credentials from env vars (e4757e6)
- Replaced hardcoded `master@consultaisp.com.br` / `Master@2024` with `process.env.SUPERADMIN_EMAIL` and `process.env.SUPERADMIN_PASSWORD`
- Seed warns and skips superadmin creation when env vars not set (no crash)
- Password never logged to console
- Added both vars to `.env.example`

### Task 2: Gate demo seed data behind SEED_DEMO_DATA flag (3ebc0b5)
- Added `process.env.SEED_DEMO_DATA !== "true"` check as first line of `seedDatabase()`
- Returns early with log message when flag not set
- All existing demo data (3 providers, users, customers, contracts, invoices, equipment, ERP integrations) preserved but only runs when explicitly enabled
- Added `SEED_DEMO_DATA=false` to `.env.example`

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | e4757e6 | Replace hardcoded superadmin credentials with env vars |
| 2 | 3ebc0b5 | Gate demo seed data behind SEED_DEMO_DATA env flag |

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.
