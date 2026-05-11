---
phase: quick
plan: 260410-lv1
subsystem: frontend/landing-page
tags: [landing-page, pricing, copy, redesign]
dependency_graph:
  requires: []
  provides: [redesigned-landing-page]
  affects: [client/src/pages/public/landingpage.tsx]
tech_stack:
  added: []
  patterns: [consolidated-section-structure, per-query-pricing-model]
key_files:
  created: []
  modified:
    - client/src/pages/public/landingpage.tsx
decisions:
  - Reduced from 3 plans to 2 (Gratuito + Profissional R$99/mes) with per-query pricing breakdown
  - Consolidated 13+ sections to 7 clean sections
  - Replaced all "calote" with "inadimplencia" or rephrased
  - Updated free credits from 30 to 40
metrics:
  duration: ~4min
  completed: 2026-04-10
---

# Quick Task 260410-lv1: Redesign Landing Page Summary

Redesigned landing page with new headline "Saiba quem nao vai pagar -- antes de instalar", simplified 2-plan pricing (Gratuito R$0 / Profissional R$99/mes) with per-query cost breakdown, and 7 consolidated sections replacing the original 13+.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rewrite landing page with new structure, headline, and pricing | ea8ef8d | client/src/pages/public/landingpage.tsx |
| 2 | Human-verify checkpoint | N/A (noted, not blocking) | - |

## Key Changes

1. **New headline:** "Saiba quem nao vai pagar -- antes de instalar." (replaces "Consulte o CPF antes de instalar")
2. **New pricing model:** 2 plans instead of 3, plus per-query pricing box (R$0 own base, R$1 collaborative, R$4 SPC)
3. **Sections consolidated to 7:** Hero, Como Funciona, Funcionalidades (6 clean cards), Precos, Social Proof (testimonials + comparison table), FAQ (7 items), CTA Final
4. **Removed:** Dores section (~80 lines), Funcionalidades mockup blocks (~175 lines), duplicate ERP section (~25 lines), 6 FAQ items
5. **Global copy:** All "calote" replaced, credits updated 30->40, unused imports removed (Globe, TrendingDown)

## Verification Results

- File: 517 lines (down from 764, within 450-550 target)
- Zero "calote" instances
- New headline present in Hero and CTA Final
- R$99/mes pricing with 2 plans
- 40 creditos referenced in Gratuito plan and CTA Final
- 15 data-testid attributes preserved
- LandingChatbot rendered at bottom
- ERP catalog fetch preserved
- goRegister/goLogin preserved
- TypeScript: no new errors (pre-existing LandingChatbot prop error unrelated)

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED
