# Requirements — Consulta ISP (Milestone: Refactoring + ERP Direto)

## v1 Requirements

### Security & Cleanup
- [x] **SEC-01**: Remover credenciais N8N hardcoded do codigo-fonte (heatmap-cache.ts)
- [x] **SEC-02**: Limpar todas as 62 referencias a Replit (replit_integrations, plugins, dependencias dev)
- [x] **SEC-03**: Remover pacotes Replit do package.json (@replit/vite-plugin-cartographer, dev-banner, runtime-error-modal)

### Backend Modularization
- [ ] **MOD-01**: Extrair funcoes puras em modulos isolados: score engine (calculateIspScore), mascaramento LGPD, geocodificacao
- [x] **MOD-02**: Modularizar routes.ts (~4350 linhas) em ~14 modulos por dominio (auth, consultas, erp, admin, financeiro, antifraude, heatmap, suporte, webhooks, provider, equipamentos, creditos, importacao, public)
- [x] **MOD-03**: Modularizar storage.ts (~1800 linhas) em modulos por dominio com facade mantendo interface IStorage e singleton storage
- [x] **MOD-04**: Garantir que toda modularizacao preserva isolamento multi-tenant (84 refs a providerId em routes.ts)

### ERP Connector Engine
- [x] **ERP-01**: Criar server/erp-connector.ts com interface abstrata ErpConnector (testConnection, fetchDelinquents, fetchCustomers)
- [x] **ERP-02**: Implementar conector IXC Soft (Basic Auth, POST com header ixcsoft, paginacao, fn_areceber + cliente)
- [x] **ERP-03**: Implementar conector MK Solutions (Bearer JWT, GET, financeiro/inadimplentes + clientes)
- [x] **ERP-04**: Implementar conector SGP (Token/App ou Basic Auth, GET/POST, clientes + financeiro)
- [x] **ERP-05**: Implementar conector Hubsoft (OAuth2 com client_id/secret → Bearer, token refresh)
- [x] **ERP-06**: Implementar conector Voalle (usuario tipo Integracao, modulo financeiro)
- [x] **ERP-07**: Implementar conector RBX ISP (ChaveIntegracao no body POST, filtros SQL-like)
- [x] **ERP-08**: Implementar conector TopSApp (pesquisar API — documentacao nao publica)
- [x] **ERP-09**: Implementar conector RadiusNet (pesquisar API — documentacao nao publica)
- [x] **ERP-10**: Implementar conector Gere (pesquisar API — documentacao nao publica)
- [x] **ERP-11**: Implementar conector Receita Net (pesquisar API — documentacao nao publica)
- [x] **ERP-12**: Registry de conectores: Record<string, ErpConnector> para lookup dinamico por erpSource
- [x] **ERP-13**: Resiliencia: retry com backoff + circuit breaker (cockatiel) em todos os conectores
- [x] **ERP-14**: Rate limiting por provedor para chamadas ERP

### N8N Removal
- [x] **N8N-01**: Atualizar scheduler.ts para usar conectores diretos em vez de fetchErpCustomersForScheduler via N8N
- [x] **N8N-02**: Atualizar heatmap-cache.ts para usar conectores diretos — remover proxy N8N (https://n8n.aluisiocunha.com.br)
- [x] **N8N-03**: Atualizar rotas de test/sync em routes.ts para usar conectores
- [x] **N8N-04**: Remover campos n8n do schema de providers (n8nWebhookUrl, n8nAuthToken, n8nEnabled, n8nErpProvider) — ou deprecar
- [x] **N8N-05**: Expandir mapa de calor para todos os ERPs (nao apenas IXC)

### ERP Frontend
<<<<<<< HEAD
- [ ] **ERPUI-01**: Adaptar tela de configuracao ERP para mostrar campos especificos por tipo de ERP (Basic Auth vs OAuth vs Token)
- [ ] **ERPUI-02**: UI de teste de conexao com feedback visual por ERP
- [ ] **ERPUI-03**: UI de sync manual com progresso e logs
=======
- [x] **ERPUI-01**: Adaptar tela de configuracao ERP para mostrar campos especificos por tipo de ERP (Basic Auth vs OAuth vs Token)
- [x] **ERPUI-02**: UI de teste de conexao com feedback visual por ERP
- [x] **ERPUI-03**: UI de sync manual com progresso e logs
>>>>>>> worktree-agent-a5b7f0b5
- [ ] **ERPUI-04**: Atualizar catalogo de ERPs com todos os novos conectores

### LGPD Mascaramento
- [ ] **LGPD-01**: Revisar e sistematizar mascaramento de dados entre provedores (nome parcial, faixa de valor, endereco sem numero)
- [ ] **LGPD-02**: Criar middleware/funcao centralizada de mascaramento que se aplica a todas as respostas entre tenants
- [ ] **LGPD-03**: Garantir que consultas ISP nunca exponham dados completos de clientes de outros provedores

### Docker & Deploy
- [x] **DOCK-01**: Criar Dockerfile multi-stage (node:20-slim, build + runtime)
- [x] **DOCK-02**: Criar docker-compose.yml com app + PostgreSQL + volumes persistentes
- [x] **DOCK-03**: Configurar health checks e graceful shutdown
- [x] **DOCK-04**: Validacao de variaveis de ambiente no startup
- [ ] **DOCK-05**: Logging estruturado com pino (substituir console.log)

### Data Fixes
- [x] **FIX-01**: Unificar divergencia de precos entre schema (199/399/799) e landing page (0/149/349)

## v2 Requirements (Deferred)

- Score por endereco (inspirado TeiaH) — analise de risco baseada no endereco/imovel, nao apenas CPF
- Metricas de reducao de churn — dashboard de retencao inspirado TeiaH
- LGPD hardening completo — audit trail, retencao de dados 5 anos, notificacao consumidor (CDC Art. 43)
- Registro como bureau de credito (Lei 12.414/2011) — requer consultoria juridica
- API publica documentada para integracoes customizadas
- Dashboard analytics avancado
- Alertas WhatsApp em <5s (real-time como ISP Score)

## Out of Scope

- App mobile nativo — web responsivo suficiente
- Multi-idioma — publico exclusivamente brasileiro
- Integracoes com bureaus alem do SPC — complexidade regulatoria
- Migracao de banco de dados — PostgreSQL permanece
- Rewrite de frontend — apenas ajustes de UI para ERP config

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| SEC-01 | Phase 1: Security & Cleanup | Complete |
| SEC-02 | Phase 1: Security & Cleanup | Complete |
| SEC-03 | Phase 1: Security & Cleanup | Complete |
| FIX-01 | Phase 1: Security & Cleanup | Complete |
| MOD-01 | Phase 2: Foundation & Docker | Pending |
| DOCK-01 | Phase 2: Foundation & Docker | Complete |
| DOCK-02 | Phase 2: Foundation & Docker | Complete |
| DOCK-03 | Phase 2: Foundation & Docker | Complete |
| DOCK-04 | Phase 2: Foundation & Docker | Complete |
| DOCK-05 | Phase 2: Foundation & Docker | Pending |
| MOD-02 | Phase 3: Backend Modularization | Complete |
| MOD-03 | Phase 3: Backend Modularization | Complete |
| MOD-04 | Phase 3: Backend Modularization | Complete |
| ERP-01 | Phase 4: ERP Connector Engine | Complete |
| ERP-02 | Phase 4: ERP Connector Engine | Complete |
| ERP-03 | Phase 4: ERP Connector Engine | Complete |
| ERP-04 | Phase 4: ERP Connector Engine | Complete |
| ERP-05 | Phase 4: ERP Connector Engine | Complete |
| ERP-06 | Phase 4: ERP Connector Engine | Complete |
| ERP-07 | Phase 4: ERP Connector Engine | Complete |
| ERP-12 | Phase 4: ERP Connector Engine | Complete |
| ERP-13 | Phase 4: ERP Connector Engine | Complete |
| ERP-14 | Phase 4: ERP Connector Engine | Complete |
<<<<<<< HEAD
| ERPUI-01 | Phase 5: ERP UI & N8N Removal | Pending |
| ERPUI-02 | Phase 5: ERP UI & N8N Removal | Pending |
| ERPUI-03 | Phase 5: ERP UI & N8N Removal | Pending |
=======
| ERPUI-01 | Phase 5: ERP UI & N8N Removal | Complete |
| ERPUI-02 | Phase 5: ERP UI & N8N Removal | Complete |
| ERPUI-03 | Phase 5: ERP UI & N8N Removal | Complete |
>>>>>>> worktree-agent-a5b7f0b5
| ERPUI-04 | Phase 5: ERP UI & N8N Removal | Pending |
| N8N-01 | Phase 5: ERP UI & N8N Removal | Complete |
| N8N-02 | Phase 5: ERP UI & N8N Removal | Complete |
| N8N-03 | Phase 5: ERP UI & N8N Removal | Complete |
| N8N-04 | Phase 5: ERP UI & N8N Removal | Complete |
| N8N-05 | Phase 5: ERP UI & N8N Removal | Complete |
| ERP-08 | Phase 6: Undocumented ERP Connectors | Complete |
| ERP-09 | Phase 6: Undocumented ERP Connectors | Complete |
| ERP-10 | Phase 6: Undocumented ERP Connectors | Complete |
| ERP-11 | Phase 6: Undocumented ERP Connectors | Complete |
| LGPD-01 | Phase 7: LGPD Hardening | Pending |
| LGPD-02 | Phase 7: LGPD Hardening | Pending |
| LGPD-03 | Phase 7: LGPD Hardening | Pending |
