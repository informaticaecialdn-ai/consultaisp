# Consulta ISP - Sistema de Análise de Crédito para Provedores

## Overview
Consulta ISP is a multi-tenant credit analysis system designed for regional internet service providers (ISPs). It aims to create a collaborative credit checking network among ISPs, akin to a specialized credit bureau for the telecom sector. The system includes features for collaborative defaulter lookups, SPC credit bureau simulations, an anti-fraud module, and comprehensive management of overdue accounts. Its core purpose is to minimize financial losses for ISPs due to bad debt and fraud, while fostering a community-driven approach to risk assessment.

## User Preferences
I want iterative development.
I prefer detailed explanations.
Ask before making major changes.
I do not want changes to the folder `shared`.

## System Architecture
The application is built with a modern web stack. The frontend utilizes **React, TypeScript, Tailwind CSS, Shadcn UI, and Wouter** for routing, focusing on a responsive and intuitive user experience. The backend is developed using **Express.js with TypeScript**, providing a robust API layer. **PostgreSQL** serves as the primary database, managed through the **Drizzle ORM**. Authentication is handled via **session-based mechanisms** using `express-session` and `connect-pg-simple`.

**UI/UX Decisions:**
- The design leverages Tailwind CSS and Shadcn UI for a consistent, modern aesthetic.
- Dashboard views provide key performance indicators (KPIs) for customers, equipment, revenue, and overdue accounts.
- Multi-tenant provider control panels (`/painel-provedor`) feature dedicated tabs for company information, partners, document uploads (KYC), subdomain management, users, and credits. KYC document uploads are stored as base64 in the database, with status badges for verification.
- A Superadmin panel (`/admin-sistema`) uses hash-based navigation and a collapsible sidebar, offering system-wide KPIs, provider and user management, financial oversight, and a support chat interface.

**Technical Implementations & Feature Specifications:**
- **Authentication:** Email verification is implemented using Resend, ensuring user legitimacy.
- **Subdomain Management:** Providers receive auto-generated subdomains with real-time availability checks during registration.
- **Consulta ISP (Collaborative Defaulter Database):** Features a comprehensive score engine (0-100) based on penalties (e.g., overdue days, unreturned equipment, multiple queries, multi-provider debt) and bonuses (e.g., long-term clients, never late). It includes risk tiers (Low, Medium, High, Critical) and privacy-focused data sharing (name, status, overdue range, equipment status, provider name). Anti-fraud alerts are auto-generated based on specific triggers.
- **Consulta SPC (Bureau Simulation):** Provides a simulated credit bureau report with a score (0-1000) and five risk levels. It includes cadastral data, categorized restrictions (PEFIN, REFIN, CCF, Protesto, etc.), previous consultations by segment, and special alerts. Mock data generation is based on document hash seeds.
- **Anti-Fraud Module:** Calculates a risk score (0-100) using weighted factors such as days overdue, overdue amount, unreturned equipment value, recent ISP consultations, and contract age. It includes `Alerts` with detailed cards, `Risk Score` rankings, `Patterns` for fraud detection, a mock `AI Analysis` for risk summaries, customizable `Rules` with SE/ENTAO conditions, and `Configurations` for various thresholds and notifications.
- **ERP Integration:** Supports integration with 7 ERP systems (iXC Soft, SGP, MK Solutions, Tiacos, Hubsoft, Fly Speed, Netflash) via webhooks. Each provider has a unique webhook token. The system tracks synced customers, errors, and logs, with a dedicated N8N template generator.
- **Credit Purchase System:** ISP and SPC credits are separate products with independent pricing. ISP packages: 50/100/250/500 credits. SPC packages: 10/30/50/100 credits. Each has its own pricing tier with volume discounts. Orders track `creditType` field ("isp", "spc", or "mixed" for legacy). Payment via Asaas (PIX/Boleto). Provider page (`/creditos`) has tabbed UI. Admin page (`/admin-creditos`) has type filter and separate package selection.
- **Financial System:** Manages invoices, tracks MRR/ARR, and provides plan distribution insights. It allows for manual invoice creation, monthly invoice generation for active providers, and includes a detailed invoice view with print functionality. Invoice numbering follows a `NF-YEAR-000001` format.
- **Support Chat:** Implements a chat interface for providers to communicate with administrators, with separate polling mechanisms for provider and admin sides. Visitor chat widget on landing page for non-authenticated users.
- **Superadmin Functionality:** A dedicated `/admin-sistema` panel provides comprehensive system management, including provider and user administration, financial oversight, and support chat management.

## External Dependencies
- **PostgreSQL:** Primary database for all application data.
- **Drizzle ORM:** Used for interacting with the PostgreSQL database.
- **Tailwind CSS:** Utility-first CSS framework for styling.
- **Shadcn UI:** UI component library.
- **Wouter:** Lightweight React router.
- **Resend:** Email API for sending email verification and other transactional emails.
- **Asaas API:** Payment gateway for SaaS billing, handling customer creation, charge generation (BOLETO/PIX), status synchronization, and webhooks. Automatically detects sandbox vs. production environment based on API key prefix.
- **Google Maps:** Integrated for displaying heat maps of customer data.
- **N8N:** Workflow automation tool used for ERP integrations. The system generates N8N workflow templates for easy import.