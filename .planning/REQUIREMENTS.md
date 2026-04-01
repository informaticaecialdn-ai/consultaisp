# Requirements — Consulta ISP (Milestone v2.0: Consulta Tempo Real Regional)

## v2.0 Requirements

### Admin SaaS Foundation (Phase 0 — Pre-requisito)
- [ ] **AUTH-01**: Fix login — senha scrypt hash deve bater com seed, login/logout/sessao funcional para todos os roles
- [ ] **AUTH-02**: Hardening de sessao — SESSION_SECRET obrigatorio via env, cookie secure condicional, session store persistente (connect-pg-simple)
- [ ] **AUTH-03**: Credenciais superadmin via env vars (nao hardcoded no seed)
- [ ] **TENANT-01**: Middleware de tenant isolation auditado — toda rota com dados de provedor filtra por req.session.providerId
- [ ] **TENANT-02**: CNPJ lookup endpoint protegido com requireAuth (atualmente publico)
- [ ] **CRUD-01**: Admin CRUD provedores funcional — criar, editar, listar, desativar provedor com validacao
- [ ] **CRUD-02**: Admin CRUD usuarios por provedor — criar, editar, listar, remover usuario vinculado ao provedor
- [ ] **CRUD-03**: Admin ERP config por provedor — salvar/testar credenciais ERP (campos dinamicos por tipo), sem mencao a N8N
- [ ] **SEED-01**: Seed limpo — apenas superadmin + dados minimos de teste, sem provedores fake misturados com reais

### Regionalizacao
- [x] **REG-01**: Adicionar campo `cidadesAtendidas` (text array ou jsonb) na tabela providers para definir area de cobertura
- [x] **REG-02**: UI no admin para configurar cidades/regiao atendida por provedor (autocomplete com cidades do Brasil)
- [x] **REG-03**: Ao consultar CPF, identificar automaticamente todos provedores que atendem a mesma regiao do provedor consultante

### Consulta Tempo Real
- [ ] **RT-01**: Redesenhar endpoint POST /api/isp-consultations para buscar em tempo real nos ERPs regionais (paralelo)
- [x] **RT-02**: Para cada provedor da regiao com ERP configurado, chamar connector.fetchDelinquents() ou fetchCustomerByCpf() em paralelo
- [ ] **RT-03**: Agregar resultados de todos os ERPs regionais em um unico score ISP (0-100)
- [x] **RT-04**: Implementar timeout por ERP (max 10s) — se um ERP nao responde, continuar com os demais
- [ ] **RT-05**: Retornar resultado com mascaramento LGPD (nome parcial, faixa de valor, endereco sem numero)

### Cache
- [ ] **CACHE-01**: Cache de resultado por CPF com TTL curto (5-10 minutos)
- [ ] **CACHE-02**: Se CPF ja foi consultado recentemente, retornar cache sem ir aos ERPs
- [ ] **CACHE-03**: Cache em memoria (nao persistente) — dados transitam, nao ficam no banco

### Remocao de Sync Centralizado
- [ ] **NOSYNC-01**: Remover scheduler de sync automatico (server/scheduler.ts) — nao e mais necessario
- [ ] **NOSYNC-02**: Remover logica de upsert de clientes de outros provedores na tabela customers
- [ ] **NOSYNC-03**: Tabela customers passa a conter apenas clientes do PROPRIO provedor (importados via CSV ou cadastro manual)

### Busca por Endereco
- [ ] **ADDR-01**: Busca por CEP/logradouro em tempo real nos ERPs regionais
- [ ] **ADDR-02**: Identificar todos os clientes no mesmo endereco (de diferentes provedores)
- [ ] **ADDR-03**: Gerar "risco por endereco" baseado no historico de inadimplencia no local

### Deteccao de Migradores
- [ ] **MIG-01**: Ao consultar CPF, verificar se existe contrato cancelado recente (< 90 dias) em algum provedor da regiao
- [ ] **MIG-02**: Cruzar com numero de consultas do mesmo CPF por provedores diferentes (rede colaborativa)
- [ ] **MIG-03**: Gerar alerta de migrador serial quando CPF tem divida ativa + contrato cancelado + consulta por outro provedor

### UI de Resultado
- [ ] **UI-01**: Manter layout de resultado da consulta igual ao Replit (score gauge, historico na rede, condicoes obrigatorias)
- [ ] **UI-02**: Exibir detalhes por provedor com mascaramento LGPD (nome parcial, faixa de valor, CEP parcial)
- [ ] **UI-03**: Secao "Condicoes Obrigatorias" baseada no score (pagamento antecipado, sem equipamento comodato, etc.)
- [ ] **UI-04**: Botao "Analisar com IA" para interpretacao do resultado

### Admin ERP
- [ ] **ADM-01**: Refinar pagina de Integracoes no admin — campos dinamicos por tipo de ERP, sem mencao a N8N
- [ ] **ADM-02**: Status de conexao em tempo real (ultimo teste, latencia, erros)

## Deferred (v3.0+)

- Score por endereco (modelo TeiaH) — analise de risco baseada no imovel
- Metricas de reducao de churn
- LGPD hardening completo (audit trail, retencao 5 anos)
- API publica documentada
- Consulta em lote tempo real (batch de CPFs)

## Out of Scope

- Armazenamento centralizado de dados de clientes de outros provedores
- Sync agendado/periodico de dados entre provedores
- App mobile nativo
- Multi-idioma

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| AUTH-01 | Phase 0 | Pending |
| AUTH-02 | Phase 0 | Pending |
| AUTH-03 | Phase 0 | Pending |
| TENANT-01 | Phase 0 | Pending |
| TENANT-02 | Phase 0 | Pending |
| CRUD-01 | Phase 0 | Pending |
| CRUD-02 | Phase 0 | Pending |
| CRUD-03 | Phase 0 | Pending |
| SEED-01 | Phase 0 | Pending |
| REG-01 | Phase 1 | Pending |
| REG-02 | Phase 1 | Complete |
| REG-03 | Phase 1 | Pending |
| RT-01 | Phase 2 | Pending |
| RT-02 | Phase 2 | Complete |
| RT-03 | Phase 2 | Pending |
| RT-04 | Phase 2 | Complete |
| RT-05 | Phase 2 | Pending |
| CACHE-01 | Phase 2 | Pending |
| CACHE-02 | Phase 2 | Pending |
| CACHE-03 | Phase 2 | Pending |
| NOSYNC-01 | Phase 3 | Pending |
| NOSYNC-02 | Phase 3 | Pending |
| NOSYNC-03 | Phase 3 | Pending |
| ADDR-01 | Phase 4 | Pending |
| ADDR-02 | Phase 4 | Pending |
| ADDR-03 | Phase 4 | Pending |
| MIG-01 | Phase 4 | Pending |
| MIG-02 | Phase 4 | Pending |
| MIG-03 | Phase 4 | Pending |
| UI-01 | Phase 5 | Pending |
| UI-02 | Phase 5 | Pending |
| UI-03 | Phase 5 | Pending |
| UI-04 | Phase 5 | Pending |
| ADM-01 | Phase 5 | Pending |
| ADM-02 | Phase 5 | Pending |
