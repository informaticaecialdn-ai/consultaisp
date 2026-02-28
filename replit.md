# Consulta ISP - Sistema de Analise de Credito para Provedores

## Overview
Sistema multi-tenant de consulta de inadimplentes focado em provedores regionais de internet (ISPs). Permite consulta de credito colaborativa entre provedores, consulta SPC, modulo anti-fraude, gestao de inadimplentes e mais.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI + Wouter (routing)
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL (Drizzle ORM)
- **Auth**: Session-based with express-session + connect-pg-simple

## Key Features
- Login/Register with provider creation
- Dashboard with KPIs (customers, equipment, revenue, overdue)
- Consulta ISP (collaborative defaulter database)
- Consulta SPC (SPC credit bureau simulation)
- Anti-Fraud module
- Defaulters list with contact actions
- Heat map placeholder (requires Google Maps)
- Credits purchase system
- ERP import tools
- Administration panel

## Test Credentials
- Email: admin@ispanalizze.com
- Password: 123456

## Database Schema
- providers: ISP providers (multi-tenant)
- users: System users linked to providers
- customers: Provider's customers
- contracts: Service contracts
- invoices: Bills/invoices (status: pending, paid, overdue)
- equipment: Comodato equipment
- isp_consultations: ISP credit checks
- spc_consultations: SPC credit checks
- anti_fraud_alerts: Fraud detection alerts

## File Structure
- shared/schema.ts: All data models and types
- server/db.ts: Database connection
- server/storage.ts: Data access layer
- server/routes.ts: API endpoints
- server/auth.ts: Session/auth middleware
- server/seed.ts: Seed data
- client/src/lib/auth.tsx: Auth context
- client/src/components/app-sidebar.tsx: Navigation sidebar
- client/src/pages/: All page components
