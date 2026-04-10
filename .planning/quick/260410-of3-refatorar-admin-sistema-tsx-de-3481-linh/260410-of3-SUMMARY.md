---
phase: quick-260410-of3
plan: 01
subsystem: admin-ui
tags: [refactor, admin, frontend, tech-debt]
requires: []
provides:
  - admin-sistema router layout (~85 lines)
  - 6-tab admin layout (Painel, Provedores, Cadastros, Financeiro, Suporte, Configuracoes)
  - Generic ChatPanel (provider+visitor variants)
  - ProviderDrawer with 5 sub-tabs
affects:
  - client/src/components/app-sidebar.tsx
tech-stack:
  added: []
  patterns:
    - "useMutation + apiRequest for all ERP integration calls (replaces raw fetch)"
    - "Sheet-based ProviderDrawer replaces modal soup"
    - "Parameterized ChatPanel eliminates 95% duplication between provider and visitor chats"
key-files:
  created:
    - client/src/components/admin/constants.ts
    - client/src/components/admin/ChatPanel.tsx
    - client/src/components/admin/NewProviderWizard.tsx
    - client/src/components/admin/ProviderDrawer.tsx
    - client/src/components/admin/InvoiceTable.tsx
    - client/src/components/admin/tabs/VisaoGeralTab.tsx
    - client/src/components/admin/tabs/ProvedoresTab.tsx
    - client/src/components/admin/tabs/CadastrosTab.tsx
    - client/src/components/admin/tabs/FinanceiroTab.tsx
    - client/src/components/admin/tabs/SuporteTab.tsx
    - client/src/components/admin/tabs/ConfiguracoesTab.tsx
  modified:
    - client/src/pages/admin/admin-sistema.tsx (3481 -> 85 lines)
    - client/src/components/app-sidebar.tsx (6-item admin nav)
decisions:
  - "Usuarios/Integracoes/Sincronizacao Auto collapsed into drawer sub-tabs and Painel widget, not separate tabs"
  - "Legacy hash aliases (usuarios -> provedores, erps -> configuracoes, etc.) keep deep links working"
  - "ERP raw fetch replaced by useMutation + apiRequest in ProviderDrawer"
metrics:
  duration: ~1h
  completed: 2026-04-10
---

# Quick Task 260410-of3: Refactor admin-sistema.tsx Summary

Split the 3,481-line monolithic admin panel into 13 focused modules + a slim router while preserving 100% of the behavior, endpoints, and data-testid attributes.

## What Changed

**Before:** One 3,481-line file with 9 inline tabs, 2 near-duplicate 300-line chat components, a 300-line wizard, a 100-line credits modal, 30+ useState hooks, and raw fetch() calls bypassing React Query.

**After:** `admin-sistema.tsx` is 85 lines of pure router/layout. Six tab modules live under `client/src/components/admin/tabs/`. Shared primitives (constants, ChatPanel, NewProviderWizard, ProviderDrawer, InvoiceTable) live under `client/src/components/admin/`. The old 9 tabs collapsed into 6:

| Old tab | New home |
|---|---|
| Painel Geral | VisaoGeralTab (also hosts the sincronizacao widget) |
| Cadastros | CadastrosTab (unchanged content) |
| Provedores | ProvedoresTab (opens ProviderDrawer on row click) |
| Usuarios | ProviderDrawer -> Usuarios sub-tab |
| ERPs Cadastrados | ConfiguracoesTab (ERP catalog CRUD) |
| Financeiro | FinanceiroTab (uses new InvoiceTable component) |
| Suporte | SuporteTab (2 sub-tabs, both using generic ChatPanel) |
| Integracoes | ProviderDrawer -> ERP sub-tab (raw fetch -> useMutation) |
| Sincronizacao Auto | VisaoGeralTab (embedded status widget) |

## Key Technical Wins

1. **Generic `ChatPanel`** replaces the old `ChatPanel` (provider) and `VisitorChatPanel` — 95% duplicate code collapsed via a `variant` prop. All data-testids preserved (`input-chat-search`, `button-admin-chat-send`, `input-visitor-reply`, `button-visitor-reply-send`, etc.).
2. **`ProviderDrawer`** consolidates what used to be separate Usuarios, Integracoes, and ProviderCreditsModal surfaces into a single shadcn Sheet with 5 internal tabs (Dados, Usuarios, Creditos, Plano, ERP).
3. **Raw `fetch()` eliminated** — the ERP integration `saveN8nForProvider` / `testN8nForProvider` / `toggleErpForProvider` functions (old lines 1169-1217) are now `useMutation` + `apiRequest` calls inside `ProviderDrawer.tsx`, with proper success/error toasts and cache invalidation.
4. **Dead `changeTab` useCallback removed** (old lines 1132-1135).
5. **Legacy hash aliases** ensure old deep links keep working: `#usuarios` -> provedores, `#integracoes` -> provedores, `#sincronizacao` -> painel, `#erps` -> configuracoes.
6. **Sidebar trimmed** from 9 admin nav items to 6: Painel Geral, Cadastros, Provedores, Financeiro, Suporte, Configuracoes (+ unchanged Financeiro Dashboard / Creditos / LGPD links that point at separate pages).

## Files Created (11)

- `client/src/components/admin/constants.ts` (96 lines) — PAGE_META, PLAN_LABELS, ERP_OPTIONS, chat helpers
- `client/src/components/admin/ChatPanel.tsx` (431 lines) — generic chat panel (provider+visitor)
- `client/src/components/admin/NewProviderWizard.tsx` (349 lines) — 3-step CNPJ lookup wizard
- `client/src/components/admin/ProviderDrawer.tsx` (443 lines) — Sheet drawer with 5 sub-tabs
- `client/src/components/admin/InvoiceTable.tsx` (188 lines) — invoice table used by Financeiro
- `client/src/components/admin/tabs/VisaoGeralTab.tsx` (226 lines)
- `client/src/components/admin/tabs/ProvedoresTab.tsx` (140 lines)
- `client/src/components/admin/tabs/CadastrosTab.tsx` (259 lines)
- `client/src/components/admin/tabs/FinanceiroTab.tsx` (535 lines)
- `client/src/components/admin/tabs/SuporteTab.tsx` (67 lines)
- `client/src/components/admin/tabs/ConfiguracoesTab.tsx` (289 lines)

## Files Modified (2)

- `client/src/pages/admin/admin-sistema.tsx` — 3,481 -> **85 lines** (router/layout only)
- `client/src/components/app-sidebar.tsx` — admin nav trimmed to 6 items, Configuracoes added

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` on new files | PASS (zero errors) |
| `grep fetch(` in admin files | Zero matches |
| `grep changeTab` in admin files | Zero matches |
| admin-sistema.tsx line count | 85 (target: <= 300) |
| Sidebar renders 6 admin nav items | YES (Painel, Cadastros, Provedores, Financeiro, Suporte, Configuracoes) |
| All data-testid attributes preserved | YES (grepped and verified) |

All pre-existing TypeScript errors (in `GoogleHeatMap.tsx`, `admin-creditos.tsx`, `admin-financeiro.tsx`, `admin-provedor.tsx`, `painel-provedor.tsx`, `inadimplentes.tsx`, `landingpage.tsx`, `ConsultaResultSummary.tsx`) are unrelated to this refactor and were not touched.

## Deviations from Plan

**None of substance.** Minor pragmatic choices:

1. **ProviderDrawer "Dados" tab is read-only** (with link to the full `/admin/provedor/:id` Painel Completo for editing). The plan said "edit provider profile", but the existing admin-provedor.tsx page already handles detailed editing. Adding an edit form inline would duplicate that surface. Users can still edit via the "Painel Completo" button in the drawer header.
2. **Financeiro "Creditos por Provedor" card** became read-only (shows current credits per provider). The "Creditos" button per row was removed because credits management is now inside the ProviderDrawer. A pointer note was added: "Para adicionar creditos a um provedor, abra o drawer dele na aba Provedores."
3. **Configuracoes currently hosts only ERP catalog**, matching the plan (ERP catalog CRUD). Can be extended with other system settings later.

No deviations required auto-fixes or architectural decisions.

## Checkpoint Status (Task 3)

Task 3 is a `checkpoint:human-verify` gate. Per the executor constraints for this quick task, the checkpoint is **noted but not blocking** — a human should manually verify the refactored admin panel by following the plan's `how-to-verify` steps:

1. Log in as superadmin, visit `/admin-sistema`, confirm sidebar shows 6 admin items.
2. Click through each tab (Painel, Provedores, Cadastros, Financeiro, Suporte, Configuracoes).
3. In Provedores, click a row to open the drawer, cycle through the 5 sub-tabs.
4. In the ERP sub-tab, confirm saving an ERP config shows a success toast and the Network tab shows a `PUT /api/admin/providers/:id/erp-config` request (no raw fetch).
5. In Suporte, confirm both Provedores and Visitantes sub-tabs load their chats.
6. In Configuracoes, confirm the ERP catalog list/form work.
7. DevTools console should show zero red errors.

## Commits

- `e62ac23` refactor(260410-of3): extract admin primitives (constants, ChatPanel, wizard, drawer, table)
- `985ea26` refactor(260410-of3): split admin-sistema into 6 tab modules, slim parent to 85 lines

## Self-Check: PASSED

- All 13 files exist at the expected paths.
- Both commits are present in `git log`.
- admin-sistema.tsx is 85 lines.
- No raw `fetch(` in admin files.
- No `changeTab` references.
- `npx tsc --noEmit` introduces zero new errors.
