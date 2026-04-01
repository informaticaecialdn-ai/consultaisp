# Roadmap: Consulta ISP

## Milestones

- ~~**v1.0 Refactoring + ERP Direto** - Phases 1-7 (shipped 2026-03-31)~~
- **v2.0 Consulta Tempo Real Regional** - Phases 1-5 (in progress)

## Phases

<details>
<summary>v1.0 Refactoring + ERP Direto (Phases 1-7) - SHIPPED 2026-03-31</summary>

- [x] **Phase 1: Security & Cleanup** - Remove hardcoded secrets, Replit artifacts, unify prices
- [x] **Phase 2: Foundation & Docker** - Extract business logic modules, containerize
- [x] **Phase 3: Backend Modularization** - Decompose routes.ts and storage.ts into domain modules
- [x] **Phase 4: ERP Connector Engine** - Abstract connector interface + 6 documented ERP connectors
- [x] **Phase 5: ERP UI & N8N Removal** - Wire ERP config UI, eliminate N8N dependency
- [x] **Phase 6: Undocumented ERP Connectors** - Stub connectors for TopSApp, RadiusNet, Gere, ReceitaNet
- [x] **Phase 7: LGPD Hardening** - Centralized masking middleware, no bypass paths

</details>

### v2.0 Consulta Tempo Real Regional

**Milestone Goal:** Redesenhar consultas ISP para busca em tempo real nos ERPs regionais, eliminando armazenamento centralizado de dados de outros provedores.

**Phase Numbering:**
- Integer phases (0, 1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 0: Admin SaaS Foundation** - Fix auth, tenant isolation hardening, admin CRUD funcional, seed limpo
- [ ] **Phase 1: Regionalizacao** - Provedores definem suas cidades atendidas e o sistema identifica vizinhos regionais
- [ ] **Phase 2: Motor de Consulta Tempo Real** - Consulta CPF busca em paralelo nos ERPs de todos provedores da regiao com cache curto
- [ ] **Phase 3: Remocao do Sync Centralizado** - Eliminar scheduler, upsert cruzado e armazenamento de clientes de outros provedores
- [ ] **Phase 4: Busca por Endereco e Migradores** - Consulta por CEP/logradouro e deteccao de migradores seriais em tempo real
- [ ] **Phase 5: UI de Resultado e Admin ERP** - Interface de resultado da consulta e refinamento da pagina de integracoes ERP

## Phase Details

### Phase 0: Admin SaaS Foundation
**Goal**: Sistema admin funcional — login que funciona, tenant isolation auditado, CRUD provedores/usuarios/ERP operacional, seed limpo
**Depends on**: Nothing (pre-requisito de todas as fases)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, TENANT-01, TENANT-02, CRUD-01, CRUD-02, CRUD-03, SEED-01
**Success Criteria** (what must be TRUE):
  1. Login com email/senha funciona para superadmin, admin e user — sessao persiste entre requests
  2. Session store usa PostgreSQL (connect-pg-simple), nao memory store
  3. Credenciais do superadmin vem de env vars, nao hardcoded no seed
  4. Toda rota admin filtra por providerId da sessao — nenhum endpoint vaza dados cross-tenant
  5. CNPJ lookup requer autenticacao
  6. Superadmin consegue criar provedor, configurar ERP, criar usuario via interface
  7. Seed cria apenas superadmin + estrutura minima, sem provedores fake
**Plans**: 4 plans
Plans:
- [ ] 00-01-PLAN.md — Session store connect-pg-simple + requireAdmin fix
- [ ] 00-02-PLAN.md — Seed cleanup: env-based superadmin + gated demo data
- [ ] 00-03-PLAN.md — Admin routes middleware normalization
- [ ] 00-04-PLAN.md — Superadmin user creation endpoint (CRUD-02)

### Phase 1: Regionalizacao
**Goal**: Provedores tem sua area de cobertura configurada e o sistema sabe quais provedores atendem a mesma regiao
**Depends on**: Nothing (first phase of v2.0)
**Requirements**: REG-01, REG-02, REG-03
**Success Criteria** (what must be TRUE):
  1. Provedor admin pode configurar a lista de cidades atendidas no painel, com autocomplete de cidades brasileiras
  2. Ao consultar um CPF, o sistema retorna a lista de todos provedores que atendem a mesma regiao do provedor consultante
  3. Campo cidadesAtendidas persiste no banco e e editavel a qualquer momento pelo admin do provedor
**Plans**: 2 plans
Plans:
- [x] 01-01-PLAN.md — Schema cidadesAtendidas + cities JSON + regional service + API routes
- [x] 01-02-PLAN.md — Admin UI for city configuration with autocomplete
**UI hint**: yes

### Phase 2: Motor de Consulta Tempo Real
**Goal**: Uma consulta de CPF busca em tempo real nos ERPs de todos provedores da regiao, agrega os resultados em um score unico e cacheia por curto periodo
**Depends on**: Phase 1
**Requirements**: RT-01, RT-02, RT-03, RT-04, RT-05, CACHE-01, CACHE-02, CACHE-03
**Success Criteria** (what must be TRUE):
  1. POST /api/isp-consultations para um CPF dispara chamadas paralelas aos ERPs de todos provedores configurados na mesma regiao
  2. Se um ERP nao responde em 10 segundos, a consulta continua com os demais e o resultado indica quais ERPs responderam
  3. O score ISP (0-100) e calculado a partir dos dados agregados de todos os ERPs regionais que responderam
  4. Resultado respeita mascaramento LGPD (nome parcial, faixa de valor, endereco sem numero)
  5. Consulta repetida do mesmo CPF dentro de 5-10 minutos retorna cache em memoria sem ir aos ERPs novamente
**Plans**: 3 plans
Plans:
- [x] 02-01-PLAN.md — In-memory TTL cache service for consultation results
- [x] 02-02-PLAN.md — Fix ERP timeout to 10s and add failure reporting
- [x] 02-03-PLAN.md — Wire cache into consultas route + score 0-100 mapping

### Phase 3: Remocao do Sync Centralizado
**Goal**: O sistema nao armazena mais dados de clientes de outros provedores -- tabela customers contem apenas clientes proprios
**Depends on**: Phase 2
**Requirements**: NOSYNC-01, NOSYNC-02, NOSYNC-03
**Success Criteria** (what must be TRUE):
  1. O scheduler de sync automatico (server/scheduler.ts) nao executa mais sync periodico de dados entre provedores
  2. Nenhuma logica de upsert insere clientes de outros provedores na tabela customers de um provedor
  3. A tabela customers de cada provedor contem apenas clientes importados por ele (CSV ou cadastro manual)
**Plans**: TBD

### Phase 4: Busca por Endereco e Migradores
**Goal**: Provedores podem consultar por endereco alem de CPF e recebem alertas automaticos de migradores seriais
**Depends on**: Phase 2
**Requirements**: ADDR-01, ADDR-02, ADDR-03, MIG-01, MIG-02, MIG-03
**Success Criteria** (what must be TRUE):
  1. Provedor pode buscar por CEP ou logradouro e receber todos os registros de inadimplencia naquele endereco, de diferentes provedores
  2. O sistema gera um "risco por endereco" baseado no historico de inadimplencia no local
  3. Ao consultar um CPF que tem contrato cancelado recente (< 90 dias) em outro provedor da regiao, o sistema emite alerta de migrador serial
  4. O alerta de migrador cruza divida ativa + contrato cancelado + consulta por outro provedor para detectar fraude por migracao
**Plans**: TBD

### Phase 5: UI de Resultado e Admin ERP
**Goal**: A interface de resultado da consulta mantem o layout validado e a pagina de integracoes ERP e refinada sem mencao a N8N
**Depends on**: Phase 2, Phase 4
**Requirements**: UI-01, UI-02, UI-03, UI-04, ADM-01, ADM-02
**Success Criteria** (what must be TRUE):
  1. Resultado da consulta exibe score gauge, historico na rede e condicoes obrigatorias no mesmo layout do Replit
  2. Detalhes por provedor aparecem com mascaramento LGPD completo (nome parcial, faixa de valor, CEP parcial)
  3. Secao "Condicoes Obrigatorias" mostra restricoes baseadas no score (pagamento antecipado, sem comodato, etc.)
  4. Botao "Analisar com IA" dispara interpretacao do resultado com streaming
  5. Pagina de Integracoes no admin exibe campos dinamicos por tipo de ERP e status de conexao em tempo real, sem mencao a N8N
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 0 -> 1 -> 2 -> 3 -> 4 (parallel with 3) -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Admin SaaS Foundation | 0/4 | Planned | - |
| 1. Regionalizacao | 0/2 | Planned | - |
| 2. Motor de Consulta Tempo Real | 0/3 | Planned | - |
| 3. Remocao do Sync Centralizado | 0/0 | Not started | - |
| 4. Busca por Endereco e Migradores | 0/0 | Not started | - |
| 5. UI de Resultado e Admin ERP | 0/0 | Not started | - |
