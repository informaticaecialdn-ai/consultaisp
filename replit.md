# Consulta ISP - Sistema de Analise de Credito para Provedores

## Overview
Sistema multi-tenant de consulta de inadimplentes focado em provedores regionais de internet (ISPs). Permite consulta de credito colaborativa entre provedores ("SPC do setor de telecom"), consulta SPC, modulo anti-fraude, gestao de inadimplentes e mais.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI + Wouter (routing)
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL (Drizzle ORM)
- **Auth**: Session-based with express-session + connect-pg-simple

## Key Features
- Login/Register with provider creation
- Dashboard with KPIs (customers, equipment, revenue, overdue)
- Consulta ISP (collaborative defaulter database with full score engine)
- Consulta SPC (SPC credit bureau simulation)
- Anti-Fraud module (auto-generated alerts on ISP consultation)
- Defaulters list with contact actions
- Heat map placeholder (requires Google Maps)
- Credits purchase system
- ERP import tools
- Administration panel

## Consulta ISP Score Engine
Score = 100 - penalties + bonuses (clamped 0-100)
Penalties: overdue days (-10 to -40), R$100 blocks (-5 each), unreturned equipment (-15 each), new contract (-10/-15), multiple queries (-20), multi-provider debt (-25)
Bonuses: 2+ year client in good standing (+10), never late (+15), all equipment returned (+5)
Risk tiers: 80-100 Low, 50-79 Medium, 25-49 High, 0-24 Critical
Credit rules: own customer = free, other provider = 1 credit, not found = free
Privacy: cross-provider queries show name, status, overdue range (not exact), days overdue, equipment status, provider name. No address/phone/email.
Anti-fraud alerts auto-generated when: defaulter queried, unreturned equipment, multiple providers querying same doc (>2 in 30 days).

## Test Credentials
- Email: admin@ispanalizze.com / Password: 123456
- Email: carlos@vertical.com / Password: 123456
- Email: admin@speed.com / Password: 123456

## Seed Data (3 providers)
- NsLink Provedor (provider1): 4 customers, some defaulters
- Vertical Fibra (provider2): 2 customers (cross-provider: Joao, Ana)
- Speed Telecom (provider3): 1 customer (cross-provider: Roberto)
- Cross-provider test CPFs: 98765432100 (Joao, in 2 providers), 78912345600 (Roberto, in 2 providers), 45678912300 (Ana, in 2 providers, clean)

## Database Schema
- providers: ISP providers (multi-tenant, ispCredits, spcCredits)
- users: System users linked to providers
- customers: Provider's customers (paymentStatus, totalOverdueAmount, maxDaysOverdue, overdueInvoicesCount, ispScore, riskTier)
- contracts: Service contracts (startDate, endDate)
- invoices: Bills/invoices (status: pending, paid, overdue)
- equipment: Comodato equipment (status: installed, returned, not_returned; inRecoveryProcess)
- isp_consultations: ISP credit checks (decisionReco, cost)
- spc_consultations: SPC credit checks
- anti_fraud_alerts: Fraud detection alerts (consultingProviderId, riskScore)

## File Structure
- shared/schema.ts: All data models and types
- server/db.ts: Database connection
- server/storage.ts: Data access layer
- server/routes.ts: API endpoints + ISP score engine
- server/auth.ts: Session/auth middleware
- server/seed.ts: Seed data (3 providers, cross-tenant customers)
- client/src/lib/auth.tsx: Auth context
- client/src/components/app-sidebar.tsx: Navigation sidebar
- client/src/pages/: All page components
