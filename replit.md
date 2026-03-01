# Consulta ISP - Sistema de Analise de Credito para Provedores

## Overview
Sistema multi-tenant de consulta de inadimplentes focado em provedores regionais de internet (ISPs). Permite consulta de credito colaborativa entre provedores ("SPC do setor de telecom"), consulta SPC, modulo anti-fraude, gestao de inadimplentes e mais.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI + Wouter (routing)
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL (Drizzle ORM)
- **Auth**: Session-based with express-session + connect-pg-simple

## Key Features
- Login/Register with provider creation (includes subdomain auto-generation + real-time availability check)
- Dashboard with KPIs (customers, equipment, revenue, overdue)
- Consulta ISP (collaborative defaulter database with full score engine, detailed results)
- Consulta SPC (SPC credit bureau simulation with cadastral data, restrictions, score 0-1000)
- Anti-Fraud module (6 tabs: Alertas, Score de Risco, Padroes, Analise IA, Regras, Configuracoes)
- Defaulters list with contact actions
- Heat map with Google Maps integration (two tabs: Meu Provedor with weighted heatmap, Benchmarking Regional with anonymized clusters)
- Credits purchase system
- ERP import tools
- Administration panel
- Multi-tenant provider admin panel (/painel-provedor) with tabs: Visao Geral, Dados do Provedor, Subdominio, Usuarios, Plano e Creditos
- Sidebar shows subdomain chip (xxx.consultaisp.com.br) and plan badge
- Email verification via Resend on registration

## Consulta ISP Score Engine
Score = 100 - penalties + bonuses (clamped 0-100)
Penalties: overdue days (-10 to -40), R$100 blocks (-5 each), unreturned equipment (-15 each), new contract (-10/-15), multiple queries (-20), multi-provider debt (-25)
Bonuses: 2+ year client in good standing (+10), never late (+15), all equipment returned (+5)
Risk tiers: 80-100 Low, 50-79 Medium, 25-49 High, 0-24 Critical
Credit rules: own customer = free, other provider = 1 credit, not found = free
Privacy: cross-provider queries show name, status, overdue range (not exact), days overdue, equipment status, provider name. No address/phone/email.
Anti-fraud alerts auto-generated when: defaulter queried, unreturned equipment, multiple providers querying same doc (>2 in 30 days), recent contract (<90 days).
UI: Provider cards use inner flex with colored accent strip (not border-l-4). Payment status labels: Em dia, Inadimplente (1-30/31-60/61-90/90+ dias). Cross-provider cards show "Dados parciais" badge.
Info tab: Full penalty/bonus tables, 4 risk classifications, anti-fraud system (4 triggers), credit rules, privacy (can/cannot see), recommended flow (ISP→SPC→Decision).
Relatorios tab: Analytics with approval/rejection distribution bar, credit consumption breakdown, alerts count.

## Consulta SPC (Bureau Simulation)
Score 0-1000, 5 risk levels (very_low to very_high). Mock data generator based on document hash seed.
Returns: cadastral data (nome, CPF/CNPJ, nascimento/fundacao, nome da mae, situacao RF, obito), typed restrictions (PEFIN/REFIN/CCF/Protesto/Acao Judicial/Falencia with severity/creditor/value/date), previous consultations by segment, special alerts.
Info tab: 5-level score classification, restriction types reference, recommended ISP-then-SPC flow.

## Anti-Fraud Module
Risk Score 0-100, 5 weighted factors: days overdue (max 35), overdue amount (max 25), unreturned equipment value (max 25), recent ISP consultations (max 15), contract age (max 10).
Risk levels: 75-100 Critical, 50-74 High, 25-49 Medium, 0-24 Low.
Alerts auto-generated on ISP consultation when cross-provider customer has: overdue debt, unreturned equipment, recent contract, or document queried by >2 providers in 30 days.
6 Tabs: Alertas (detailed cards with risk factors, Resolver/Ignorar/Contatar actions, search/filter by status), Score de Risco (customer risk ranking with stats), Padroes (recidiva and ciclo de fraude detection from alert patterns), Analise IA (mock AI analysis with risk summary, detected patterns, recommended actions), Regras (custom rule builder with SE/ENTAO conditions), Configuracoes (toggles for min overdue days, contract age, equipment threshold, multi-query limit, notification emails, critical/high notification toggles).
API routes: GET /api/anti-fraud/alerts, PATCH /api/anti-fraud/alerts/:id/status, GET /api/anti-fraud/customer-risk.

## Email Verification (Resend)
New registrations require email verification before login:
- POST /api/auth/register returns { needsVerification: true, email } without creating session
- Verification email sent via Resend with 24-hour token
- GET /api/auth/verify-email?token=xxx verifies token and creates session
- POST /api/auth/resend-verification resends verification email
- POST /api/auth/login returns 403 with code EMAIL_NOT_VERIFIED if unverified
- Frontend: "check email" screen after registration; /verificar-email page handles token validation
- Seed users are pre-marked as emailVerified=true
- Sender: EMAIL_FROM env var (fallback: onboarding@resend.dev); requires RESEND_API_KEY secret

## System Admin Panel (/admin-sistema)
- Access: superadmin role only (master@consultaisp.com.br / Master@2024)
- Sidebar for superadmin shows ONLY "Painel Administrativo" link (no provider features)
- 5 tabs: Painel Geral (system stats), Provedores (list/create/manage/deactivate), Usuarios (all system users), Financeiro (credits and plan history per provider), Suporte (chat panel with providers)
- Provider management: create providers with admin user, toggle active/inactive, manage ISP/SPC credits, change plan
- Support chat: polling every 10s for chat threads, admin can reply to any provider's thread
- API routes protected with requireSuperAdmin middleware

## Support Chat Widget
- Floating button at bottom-right for non-superadmin users (data-testid="button-open-chat")
- Provider-side polls /api/chat/thread every 5s when open; /api/chat/unread every 30s
- Admin side polls /api/admin/chat/threads every 10s
- DB tables: support_threads, support_messages (created via direct SQL, not in Drizzle schema)

## Auth & Session Notes
- Session stores userId, providerId (0 for superadmin), role
- Login sets providerId = user.providerId || 0 (0 for superadmin with no provider)
- /api/auth/me returns provider: null for superadmin
- requireSuperAdmin checks req.session.role === "superadmin"
- requireAdmin checks req.session.role === "admin" (provider admins only)

## Test Credentials
- Email: admin@ispanalizze.com / Password: 123456 (NsLink provider admin)
- Email: carlos@vertical.com / Password: 123456 (Vertical provider admin)
- Email: admin@speed.com / Password: 123456 (Speed provider admin)
- Email: master@consultaisp.com.br / Password: Master@2024 (System superadmin)

## Seed Data (3 providers)
- NsLink Provedor (provider1): 4 customers, some defaulters
- Vertical Fibra (provider2): 2 customers (cross-provider: Joao, Ana)
- Speed Telecom (provider3): 1 customer (cross-provider: Roberto)
- Cross-provider test CPFs: 98765432100 (Joao, in 2 providers), 78912345600 (Roberto, in 2 providers), 45678912300 (Ana, in 2 providers, clean)

## Database Schema
- providers: ISP providers (multi-tenant, ispCredits, spcCredits)
- users: System users linked to providers
- customers: Provider's customers (paymentStatus, totalOverdueAmount, maxDaysOverdue, overdueInvoicesCount, ispScore, riskTier, latitude, longitude)
- contracts: Service contracts (startDate, endDate)
- invoices: Bills/invoices (status: pending, paid, overdue)
- equipment: Comodato equipment (status: installed, returned, not_returned; inRecoveryProcess)
- isp_consultations: ISP credit checks (decisionReco, cost)
- spc_consultations: SPC credit checks
- anti_fraud_alerts: Fraud detection alerts (riskScore 0-100, riskLevel, riskFactors jsonb, daysOverdue, overdueAmount, equipmentNotReturned, equipmentValue, consultingProviderName, customerName, customerCpfCnpj, status: new/resolved/dismissed, recentConsultations)

## File Structure
- shared/schema.ts: All data models and types
- server/db.ts: Database connection
- server/storage.ts: Data access layer
- server/routes.ts: API endpoints + ISP score engine
- server/auth.ts: Session/auth middleware
- server/seed.ts: Seed data (3 providers, cross-tenant customers)
- client/src/lib/auth.tsx: Auth context
- client/src/components/app-sidebar.tsx: Navigation sidebar
- client/src/pages/: All page components (incl. verificar-email.tsx for email verification)
- server/email.ts: Resend email service
