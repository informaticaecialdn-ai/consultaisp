---
phase: 04-erp-connector-engine
plan: 02
subsystem: erp-connectors
tags: [erp, connectors, ixc, mk, sgp, resilience]
dependency_graph:
  requires: [04-01]
  provides: [ixc-connector, mk-connector, sgp-connector]
  affects: [04-03, 04-04]
tech_stack:
  added: []
  patterns: [connector-interface, circuit-breaker, basic-auth, bearer-jwt]
key_files:
  created:
    - server/erp/connectors/ixc.ts
    - server/erp/connectors/mk.ts
    - server/erp/connectors/sgp.ts
  modified: []
decisions:
  - IXC uses pagination loop (max 50 pages) with aggregateByCustomer for invoice-to-customer grouping
  - MK and SGP parse flexible response shapes (array or { data: [...] } or { clientes: [...] })
  - SGP appends app_name as query param when apiUser is configured
metrics:
  duration: ~15min
  completed: 2026-03-29
---

# Phase 04 Plan 02: ERP Connector Implementations (IXC, MK, SGP) Summary

Three ERP connectors for IXC Soft (Basic Auth + POST), MK Solutions (Bearer JWT + GET), and SGP (Bearer Token + GET) implementing the ErpConnector interface with withResilience + CircuitBreaker on all API calls.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Implement IXC Soft connector | 3b72396 | server/erp/connectors/ixc.ts |
| 2 | Implement MK Solutions and SGP connectors | abe53ab | server/erp/connectors/mk.ts, server/erp/connectors/sgp.ts |

## Implementation Details

### IXC Soft Connector (server/erp/connectors/ixc.ts)
- **Auth:** Basic Auth (Base64 user:token) + `ixcsoft: "listar"` header on all requests
- **testConnection:** POST to `/webservice/v1/fn_areceber` with minimal query, 8s timeout
- **fetchDelinquents:** POST to `/webservice/v1/fn_areceber` with status "A", paginated (1000/page, max 50 pages), filters overdue by vencimento < now, uses `aggregateByCustomer` to group invoices per CPF/CNPJ
- **fetchCustomers:** POST to `/webservice/v1/cliente` with paginated query
- **Field mapping:** cpf_cnpj/cnpj_cpf, razao/nome, valor/valor_original, vencimento/data_vencimento, endereco/logradouro, cidade, uf, cep, fone_celular/telefone
- Refactored from existing logic in `server/routes/utils.ts` and `server/scheduler.ts`

### MK Solutions Connector (server/erp/connectors/mk.ts)
- **Auth:** Bearer JWT (`Authorization: Bearer <token>`)
- **testConnection:** GET `/api/v1/clientes?limit=1`, 8s timeout
- **fetchDelinquents:** GET `/api/v1/financeiro/inadimplentes?limit=1000`, flexible response parsing (array or wrapped)
- **fetchCustomers:** GET `/api/v1/clientes?limit=1000`
- **Field mapping:** cpf_cnpj/cpf/cnpj, nome/razao_social, valor_total/saldo_devedor, dias_atraso/atraso_dias

### SGP Connector (server/erp/connectors/sgp.ts)
- **Auth:** Bearer Token with optional `app_name` query param (from apiUser config)
- **testConnection:** GET `/api/clientes?limit=1`, 8s timeout
- **fetchDelinquents:** GET `/api/financeiro/inadimplentes?limit=1000`
- **fetchCustomers:** GET `/api/clientes?limit=1000`
- **Field mapping:** cpf_cnpj/cpf/cnpj, nome/razao_social/razao, valor_total/saldo_devedor/valor, dias_atraso/atraso_dias

### Shared Patterns
- All connectors use `withResilience` wrapper with own `CircuitBreaker` instance
- All normalize results to `NormalizedErpCustomer` using `cleanCpfCnpj`, `cleanPhone`, `cleanCep`
- All handle timeout errors with descriptive Portuguese messages
- All strip trailing slashes from base URLs

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - all three connectors are fully implemented with real API integration logic.

## Verification

- TypeScript compilation: All three connector files compile without errors (`npx tsc --noEmit`)
- Each exports a class implementing `ErpConnector` (testConnection, fetchDelinquents, fetchCustomers)
- Each uses `withResilience` + `CircuitBreaker` for resilience
- Each maps ERP-specific fields to `NormalizedErpCustomer`

## Self-Check: PASSED

- FOUND: server/erp/connectors/ixc.ts
- FOUND: server/erp/connectors/mk.ts
- FOUND: server/erp/connectors/sgp.ts
- FOUND: commit 3b72396
- FOUND: commit abe53ab
