# CLAUDE.md — Consulta ISP (Super Prompt)

---

## 1. IDENTIDADE DO PROJETO

Você é o desenvolvedor principal do **Consulta ISP** — um SaaS multi-tenant de análise de crédito colaborativa para provedores regionais de internet (ISPs) no Brasil. Funciona como um bureau de crédito especializado em telecom: provedores compartilham dados de inadimplência para minimizar calotes, fraudes por migração serial e perdas de equipamentos.

**Repositório:** `https://github.com/informaticaecialdn-ai/Consulta-ISP`
**Ambiente original:** Replit (com deploy para produção)

---

## 2. STACK TECNOLÓGICA COMPLETA

### Frontend
| Tecnologia | Versão | Uso |
|---|---|---|
| React | 18 | UI com componentes funcionais + TypeScript |
| Vite | 7 | Bundler |
| Tailwind CSS | 3 | Estilização via classes utilitárias + variáveis CSS HSL |
| shadcn/ui | new-york | Componentes UI (base color: neutral, CSS vars) |
| Wouter | 3 | Roteamento (useLocation, Switch, Route, Link) — NÃO React Router |
| TanStack React Query | 5 | Estado server-side (useQuery, useMutation) |
| React Hook Form | 7 | Formulários |
| Zod | 3 | Validação de schemas |
| Recharts | 2 | Gráficos |
| Leaflet + leaflet.heat | 1.9 | Mapa de calor geográfico |
| Framer Motion | 11 | Animações |
| Lucide React + React Icons | — | Ícones |
| date-fns | 3 | Datas |
| PapaParse | 5 | Parsing CSV |
| cmdk | 1 | Command palette |
| embla-carousel-react | 8 | Carrosséis |
| vaul | 1 | Drawers |

### Backend
| Tecnologia | Versão | Uso |
|---|---|---|
| Express | 5 | Servidor HTTP |
| TypeScript | 5.6 | Tipagem |
| tsx | 4 | Execução TS em dev |
| express-session + connect-pg-simple | — | Auth baseada em sessão (cookies httpOnly, 30 dias) |
| Passport.js (passport-local) | 0.7 | Estratégia de autenticação |
| WebSocket (ws) | 8 | Tempo real (chat de suporte) |
| OpenAI SDK | 6 | Análise IA com streaming (gpt-4o-mini) |
| Resend | 6 | Emails transacionais |
| p-limit + p-retry | — | Controle de concorrência |

### Banco de Dados
| Tecnologia | Versão | Uso |
|---|---|---|
| PostgreSQL | — | Banco principal |
| Drizzle ORM | 0.39 | Queries e tipos |
| drizzle-zod | 0.7 | Integração Drizzle ↔ Zod |
| drizzle-kit | 0.31 | Push/migrações |

### Serviços Externos
| Serviço | Uso |
|---|---|
| Resend | Emails (verificação, notificações) |
| Asaas API | Pagamento PIX/Boleto (auto-detect sandbox/prod pelo prefixo `$aact_`) |
| OpenAI API | Análise IA de risco com streaming SSE |
| Google Maps API | Visualização no mapa de calor |
| ViaCEP + Nominatim | Geocodificação CEP → cidade → lat/lng |

### Variáveis de Ambiente
```env
DATABASE_URL=                       # PostgreSQL connection string
SESSION_SECRET=                     # Aleatória para assinar cookies
RESEND_API_KEY=                     # Resend para emails
ASAAS_API_KEY=                      # Asaas ($aact_ = prod, $aact_test_ = sandbox)
AI_INTEGRATIONS_OPENAI_API_KEY=     # OpenAI para análise IA
AI_INTEGRATIONS_OPENAI_BASE_URL=    # Base URL OpenAI (opcional)
GOOGLE_MAPS_API_KEY=                # Google Maps
PARTNER_CODE_SECRET=                # Chave do código de provedor parceiro (32+ chars; sem ela deriva do SESSION_SECRET)
PARTNER_CODE_SECRET_PREVIOUS=       # Chaves anteriores, separadas por vírgula — só para o superadmin resolver códigos antigos
SPC_USERNAME=                       # Operador do WebService do SPC Brasil (senha de WebService ≠ senha web)
SPC_PASSWORD=
SPC_WSDL_URL=                       # Produção: https://api.spc.org.br/spc/remoting/ws/consulta/consultaWebService
SPC_PRODUCT_CODE=257                # SPC MIX TOP +
SPC_INSUMOS_OPCIONAIS=              # Insumos opcionais por consulta (ex.: 17,78,3082 = protesto, score 12 meses, obito) — a entidade pode cobrar
```

---

## 3. ESTRUTURA DE DIRETÓRIOS

```
Consulta-ISP/
├── client/                         # Frontend React
│   ├── index.html
│   └── src/
│       ├── App.tsx                 # Router + Auth + Layout principal
│       ├── main.tsx                # Entry point
│       ├── index.css               # Estilos globais + variáveis CSS
│       ├── components/
│       │   ├── app-sidebar.tsx     # Sidebar de navegação
│       │   ├── chat-widget.tsx     # Widget chat provedor
│       │   ├── landing-chatbot.tsx # Chatbot landing page
│       │   └── ui/                # ~50 componentes shadcn/ui
│       ├── hooks/
│       │   ├── use-mobile.tsx
│       │   └── use-toast.ts
│       ├── lib/
│       │   ├── auth.tsx            # AuthProvider + useAuth (React Context)
│       │   ├── queryClient.ts      # TanStack Query config
│       │   ├── subdomain.ts        # Utilitário de subdomínios
│       │   ├── leaflet-patch.ts    # Fix Leaflet
│       │   └── utils.ts            # cn() = clsx + tailwind-merge
│       └── pages/                  # 20 páginas (listadas na seção 8)
├── server/                         # Backend Express
│   ├── index.ts                    # Entry: cria servidor HTTP + WebSocket
│   ├── routes.ts                   # ~4350 linhas, ~100+ endpoints
│   ├── storage.ts                  # Interface IStorage + DatabaseStorage (Drizzle)
│   ├── auth.ts                     # Session config + middlewares
│   ├── password.ts                 # Hash scrypt nativo
│   ├── email.ts                    # Resend
│   ├── tenant.ts                   # slugifySubdomain, buildSubdomainUrl
│   ├── db.ts                       # Conexão Drizzle PostgreSQL
│   ├── asaas.ts                    # Gateway de pagamento Asaas
│   ├── ai-analysis.ts             # Streaming IA OpenAI (gpt-4o-mini)
│   ├── heatmap-cache.ts           # Cache in-memory mapa de calor (TTL 24h)
│   ├── scheduler.ts               # Auto-sync ERP (verifica a cada 30min)
│   ├── seed.ts                    # Dados iniciais
│   ├── static.ts                  # Arquivos estáticos em produção
│   └── vite.ts                    # Middleware Vite dev
├── shared/                         # Compartilhado frontend/backend
│   ├── schema.ts                  # Schema Drizzle + tipos + Zod (516 linhas)
│   └── models/chat.ts
├── script/build.ts                # Build: esbuild (backend CJS) + vite (frontend)
├── package.json                   # type: "module", ESM
├── vite.config.ts
├── drizzle.config.ts              # dialeto: postgresql, schema: shared/schema.ts
├── tailwind.config.ts
├── tsconfig.json
└── components.json                # shadcn/ui config
```

**Path Aliases:** `@/` → `client/src/`, `@shared/` → `shared/`, `@assets/` → `attached_assets/`

---

## 4. ARQUITETURA MULTI-TENANT

A tabela de tenants se chama **`providers`** (NÃO `tenants`). O campo de isolamento é **`providerId`** (NÃO `tenantId`).

**Regra absoluta:** TODA tabela com dados de provedor tem `provider_id` → `providers.id`. TODA query filtra por `req.session.providerId`.

### Roles
| Role | providerId | Acesso |
|---|---|---|
| `user` | obrigatório | Operador: consultas, dashboard |
| `admin` | obrigatório | Admin do provedor: total ao painel |
| `superadmin` | null | Admin da plataforma: total ao sistema |

### Session
```typescript
// server/auth.ts
declare module "express-session" {
  interface SessionData {
    userId: number;
    providerId: number;
    role: string;
  }
}
```

### Middlewares
- `requireAuth` → `req.session.userId` existe
- `requireAdmin` → `role === "admin"`
- `requireSuperAdmin` → `role === "superadmin"`

---

## 5. SCHEMA DO BANCO (20 tabelas em `shared/schema.ts`)

### Tabelas Core

**providers** — Provedores (tenants)
```
id, name, tradeName, cnpj(unique), legalType, openingDate, businessSegment,
subdomain(unique), plan(free/basic/pro/enterprise), status(active/suspended/cancelled),
verificationStatus(pending/approved/rejected), ispCredits(default 50), spcCredits(default 0),
contactEmail, contactPhone, website,
addressZip/Street/Number/Complement/Neighborhood/City/State,
webhookToken, webhookAtivo,
notifWhatsapp/Email/Push/Sms/WhatsappNumber/DailySummary,
n8nWebhookUrl, n8nAuthToken, n8nEnabled, n8nErpProvider,
createdAt
// NAO EXISTE trialInicio: a coluna nunca foi criada. Ver a nota de trial abaixo.
```

**users** — Usuários
```
id, email(unique), password(scrypt hash), name, phone,
role(user/admin/superadmin), providerId(FK nullable),
emailVerified, verificationToken, verificationTokenExpiresAt, createdAt
```

**customers** — Clientes dos provedores
```
id, providerId(FK), name, cpfCnpj, email, phone,
address, city, state, cep, latitude, longitude,
status(active), paymentStatus(current/overdue),
totalOverdueAmount, maxDaysOverdue, overdueInvoicesCount,
ispScore, riskTier, erpSource(manual/ixc/mk/sgp),
lastSyncAt, notificacaoEnviada/Data/Canal, createdAt
```

### Tabelas de Consulta
- **ispConsultations** — result(JSONB), score(0-100), decisionReco(Accept/Review/Reject), cost
- **spcConsultations** — result(JSONB), score(0-1000)
- ~~consultationLogs~~ — **NÃO EXISTE**. Documentada aqui desde sempre, mas nunca
  criada: não está no schema, não está em migração, ninguém escreve e ninguém lê.
  O rastro de uma consulta é o log do pino, correlacionado pelo `consultaId`
  (`CI-AAMM-XXXXXX`, coluna `consulta_id` nas três tabelas de consulta desde a
  migração 0015). Para achar uma consulta pelo código:
  `GET /api/admin/consultas?codigo=` (superadmin). O código vai na query, e não
  no caminho, porque o log de acesso registra `req.path` — e a caixa de busca
  aceita texto livre.

### Tabelas Financeiras
- **contracts** — customerId, providerId, plan, value, status
- **invoices** — contractId, customerId, providerId, value, dueDate, status
- **providerInvoices** — invoiceNumber(NF-YEAR-000001), Asaas integração completa
- **creditOrders** — orderNumber, ispCredits, spcCredits, creditType(isp/spc/mixed), Asaas

### Tabelas de Equipamento
- **equipment** — customerId, providerId, type, brand, model, serialNumber, mac, status
- **equipamentos** — cpfCnpj, nomeCliente, tipo(ONU), marca, modelo, numeroSerie, valor, status(retido/recuperado/em_cobranca/baixado)

### Tabelas Anti-Fraude
- **antiFraudAlerts** — type, severity, riskScore, riskFactors(JSONB), daysOverdue, overdueAmount, equipmentNotReturned
- **antiFraudRules** — providerId, tipo, ativo, parametros(JSONB) — regras por provedor (catálogo em `shared/antifraude-regras.ts`)

### Tabelas de Suporte
- **supportThreads** + **supportMessages** — Chat provedor ↔ admin
- **visitorChats** + **visitorChatMessages** — Chat visitantes landing page

### Tabelas de Gestão
- **providerPartners** — Sócios (name, cpf, sharePercentage)
- **providerDocuments** — KYC (fileData base64, status pending/approved/rejected)
- **planChanges** — Histórico de planos
- **erpIntegrations** — Config ERP por provedor (apiUrl, apiToken, apiUser, syncIntervalHours)
- **erpSyncLogs** — Logs de sync (upserted, errors, syncType auto/manual)
- **erpCatalog** — Catálogo de ERPs disponíveis

### Preços e Créditos
```typescript
// FONTE ÚNICA: `shared/planos.ts` (a partir da fase 0 do white label, 03/09/2026).
// `shared/schema.ts` só re-exporta. O client NUNCA importa a tabela: lê de
// GET /api/credits/packages (autenticado) ou GET /api/public/precos (landing).
// Há um teste que falha se algum arquivo de client voltar a importar a tabela.

PLAN_PRICES = { free: 0, basic: 149, pro: 99, enterprise: 799 }  // R$/mês
// Na vitrine da landing só aparecem `free` e `pro`. `basic` é legado (há
// provedores nele) e `enterprise` é negociado fora do site.
PLAN_CREDITS = {
  free: { isp: 50, spc: 0 },
  basic: { isp: 200, spc: 50 },
  pro: { isp: 0, spc: 0 },     // o plano virou ACESSO: a consulta na rede se paga por crédito
  enterprise: { isp: 1500, spc: 500 },
}
// ATENÇÃO: PLAN_CREDITS é o que a FATURA declara como incluso. Nada soma esses
// créditos a providers.ispCredits quando a fatura é paga — quem credita é o
// superadmin ou a compra avulsa em /creditos.

CREDIT_PACKAGES = [   // crédito único, sem desconto por volume
  50 créditos → R$50,00 (R$1,00/un),
  100 → R$100,00 (R$1,00/un, popular),
  250 → R$250,00 (R$1,00/un),
  500 → R$500,00 (R$1,00/un)
]
// Um crédito vale para qualquer consulta; o que muda é quantos créditos cada
// uma consome (CUSTO_EM_CREDITOS). A cadastral custa R$0,72 na BigDataCorp e é
// vendida por 1 crédito.

// Piso e teto do preço da marca revendedora (fase 2 do white label):
// piso = a própria tabela acima (a marca só pode SUBIR), teto R$5,00/crédito.
// `validarPrecoDaMarca()` em shared/planos.ts rejeita fora da faixa, nunca ajusta.
```

---

## 6. MOTOR DE SCORE ISP (0-100) — `calculateIspScore()` em routes.ts

### Penalidades
| Condição | Pontos |
|---|---|
| Atraso >90 dias | -40 |
| Atraso 61-90 dias | -30 |
| Atraso 31-60 dias | -20 |
| Atraso 1-30 dias | -10 |
| Valor em aberto | -5 a cada R$100 |
| Equipamento não devolvido | -15 cada |
| Contrato <3 meses | -15 |
| Contrato <6 meses | -10 |
| Consultado por >3 provedores (30 dias) | -20 |
| Dívida em múltiplos provedores | -25 |

### Bônus
| Condição | Pontos |
|---|---|
| Cliente >2 anos em dia | +10 |
| Nunca atrasou | +15 |
| Equipamentos sempre devolvidos | +5 |

### Faixas de Risco
| Score | Tier | Recomendação |
|---|---|---|
| ≥80 | Baixo | Aprovar |
| ≥50 | Médio | Aprovar com cautela |
| ≥25 | Alto | Exigir garantias |
| <25 | Crítico | Rejeitar |

---

## 7. INTEGRAÇÃO ERP — ARQUITETURA DE CONECTORES

### Situação Atual (pós-migração N8N, 2026-03-31)
O sistema usa um **registry de conectores ERP nativos** — sem nenhum proxy intermediário. Cada ERP suportado tem implementação dedicada que fala direto com a API REST do ERP do provedor. Caminho legado N8N foi removido em GSD Phase 05 (`erp-ui-n8n-removal`, commits `c479768` + `2958d54`).

### Arquitetura Implementada

**Local:** `server/erp-connector.ts` (interface) + implementações por ERP. Heatmap, scheduler, rotas de test/sync e consultas usam o connector registry via `getConnector(erpSource)`.

**ERPs suportados via conectores diretos:** IXC Soft, MK Solutions, SGP, Hubsoft, Voalle, RBX ISP.

**Fluxos cobertos:**
1. **Sync manual:** `POST /api/provider/erp-integrations/:source/sync`
2. **Auto-sync:** scheduler dispara `connectors[source].fetchDelinquents()` periodicamente
3. **Heatmap:** `heatmap-cache.ts` consulta via registry, suporta os 6 ERPs (não só IXC)
4. **Test de conexão:** `POST /api/provider/erp-integrations/:source/test`
5. **Logs:** `erpSyncLogs` registra cada tentativa (sucesso/erro/contagem)
6. **Catálogo:** `GET /api/erp-connectors` expõe metadata (`name`, `label`, `configFields`)

### Pré-requisito operacional por ERP
Alguns ERPs (notavelmente IXC) exigem que o provedor **libere o IP do servidor** no painel deles antes da primeira sincronização. Sem isso, o teste de conexão retorna erro de bloqueio.

### ERPs e Suas APIs (referência)

#### IXC Soft (IXCSoft/IXC Provedor)
- **Auth:** Basic Auth (`Base64(user:token)`)
- **Base URL:** `https://[dominio]/webservice/v1/`
- **Método:** POST com header `ixcsoft: "listar"` e `Content-Type: application/json`
- **Endpoint inadimplentes:** `/webservice/v1/fn_areceber` com body `{ qtype: "fn_areceber.status", query: "A", oper: "=" }`
- **Endpoint clientes:** `/webservice/v1/cliente`
- **Paginação:** campos `page`, `rp` (records per page)
- **Resposta:** `{ registros: [...], total: N }`
- **Docs:** https://wikiapiprovedor.ixcsoft.com.br/
- **Nota:** Provedor deve liberar IP do servidor (whitelist) no painel IXC antes do primeiro test/sync. Erro de bloqueio é diferenciado de credencial inválida na mensagem retornada.

#### MK Solutions (MK Auth)
- **Auth:** JWT Bearer Token (gerado na interface admin do MK Auth)
- **Base URL:** `https://[dominio]/api/v1/`
- **Método:** GET/POST com `Authorization: Bearer <token>`
- **Endpoint inadimplentes:** `/api/v1/financeiro/inadimplentes?limit=1000`
- **Endpoint clientes:** `/api/v1/clientes?limit=1000`
- **Docs:** https://postman.mk-auth.com.br/
- **GitHub:** https://github.com/felipebergamin/mkauth-node-api

#### SGP (Sistema Gerencial de Provedores)
- **Auth:** Token/App (token + app_name no body) OU Basic Auth (Base64 user:pass)
- **Base URL:** `https://[dominio]/api/`
- **Método:** GET/POST com `Content-Type: application/json`
- **Endpoint clientes:** `/api/clientes?limit=1000`
- **Endpoint financeiro:** `/api/financeiro/inadimplentes`
- **Docs:** https://bookstack.sgp.net.br/books/api
- **Auth details:** https://bookstack.sgp.net.br/books/api/page/autenticacoes-via-api

#### Hubsoft
- **Auth:** OAuth (client_id, client_secret, username, password) → Bearer Token
- **Base URL:** `https://[dominio]/api/`
- **Método:** POST para obter token, depois GET/POST com Bearer
- **Endpoint financeiro:** módulo financeiro
- **Docs:** https://docs.hubsoft.com.br/
- **GitHub:** https://github.com/hubsoftbrasil/api

#### Voalle (Voalle ERP)
- **Auth:** Usuário tipo "Integração" (marcado no sistema Voalle)
- **Base URL:** variável por instalação
- **Endpoint financeiro:** via módulo financeiro
- **Docs:** https://wiki.grupovoalle.com.br/APIs
- **Postman:** https://documenter.getpostman.com/view/16282829/TzzBqFw1

#### RBX ISP (RBXSoft)
- **Auth:** ChaveIntegracao no body do POST
- **Base URL:** `https://[dominio]/routerbox/ws/rbx_server_json.php`
- **Método:** POST com chave de integração
- **Filtros:** SQL-like com WHERE clause
- **Endpoint financeiro:** "Pendências Financeiras"
- **Config:** Empresa → Parâmetros → Web Services
- **Docs:** https://www.developers.rbxsoft.com/

### Arquitetura Proposta para o Conector ERP

```typescript
// server/erp-connector.ts

interface ErpConnector {
  name: string;
  testConnection(config: ErpConfig): Promise<{ ok: boolean; message: string }>;
  fetchDelinquents(config: ErpConfig): Promise<ErpCustomer[]>;
  fetchCustomers(config: ErpConfig): Promise<ErpCustomer[]>;
}

interface ErpConfig {
  apiUrl: string;
  apiUser?: string;
  apiToken: string;
  extra?: Record<string, string>;  // client_id, client_secret, etc.
}

interface ErpCustomer {
  cpfCnpj: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  cep?: string;
  totalOverdueAmount: number;
  maxDaysOverdue: number;
  erpSource: string;
}

// Implementações: IxcConnector, MkConnector, SgpConnector, HubsoftConnector, VoalleConnector, RbxConnector
// Registry: const connectors: Record<string, ErpConnector> = { ixc: new IxcConnector(), mk: new MkConnector(), ... }
```

### Estado dos Arquivos (referência)
- **`server/erp-connector.ts`** — Interface + connector registry (`getConnector`, `buildConnectorConfig`) ✅ implementado
- **`server/scheduler.ts`** — Usa `connectors[source].fetchDelinquents()` ✅
- **`server/heatmap-cache.ts`** — Reescrito para usar registry (~225 linhas, 6 ERPs suportados) ✅
- **`server/routes/erp.routes.ts`** — Rotas de test/sync via connectors ✅; `GET /api/erp-connectors` expõe catálogo ✅
- **`shared/schema.ts`** — Tabela `erp_integrations` cobre campos por ERP (incl. OAuth do Hubsoft) ✅
- **Frontend** — Tela de configuração ERP renderiza campos do connector metadata ✅

---

## 8. ROTAS FRONTEND (20 páginas)

```
/                          → Dashboard (provedores)
/consulta-isp              → Consulta ISP (score + histórico rede)
/consulta-spc              → Consulta SPC (score 0-1000, simulação)
/anti-fraude               → Anti-Fraude (alertas, regras, IA)
/inadimplentes             → Lista de Inadimplentes
/mapa-calor                → Mapa de Calor (Leaflet + heat)
/creditos                  → Compra de Créditos (ISP/SPC)
/importacao                → Importação de Dados (clientes, faturas, equipamentos via CSV)
/importacao-equipamentos   → Importação de Equipamentos
/administracao             → Administração do Provedor
/painel-provedor           → Painel Provedor (abas: info, sócios, docs KYC, subdomínio, usuários, créditos)
/admin-sistema             → Painel Superadmin (navegação via hash)
/admin/provedor/:id        → Detalhes provedor (admin)
/admin/fatura/:id          → Visualização fatura
/admin/financeiro          → Financeiro admin
/admin/creditos            → Créditos admin
/lgpd                      → Página LGPD
/login                     → Login
/verificar-email           → Verificação email
/landingpage               → Landing Page (se não logado e sem subdomínio)
```

Superadmins → `/admin-sistema`. Sem login + sem subdomínio → Landing Page.

---

## 9. ROTAS API (~100+ endpoints em routes.ts)

### Auth (`/api/auth/*`)
POST login, POST register, GET check-subdomain, GET verify-email, POST resend-verification, POST logout, GET me

### Dashboard/Dados (requireAuth)
GET dashboard/stats, dashboard/defaulters, customers, inadimplentes, invoices, equipment, contracts, defaulters
POST customers

### Importação (requireAuth)
POST import/customers, import/invoices, import/equipment

### Consultas (requireAuth)
GET/POST isp-consultations   // NAO existe rota de lote — nunca foi construida
GET/POST spc-consultations

### Anti-Fraude (requireAuth)
GET anti-fraud/alerts, PATCH alerts/:id/status, GET customer-risk, GET migradores, GET/PUT anti-fraud/rules (regras + canais do provedor; PUT só admin)

### Equipamentos (requireAuth)
GET/POST/PATCH/DELETE equipamentos, POST equipamentos/import

### Provedor Config (requireAuth)
GET/PATCH provider/profile, provider/settings, provider/notification-settings
GET/POST/DELETE provider/users, provider/partners, provider/documents
GET/PATCH provider/webhook-config
// NAO existe provider/trial-status: nao ha rota, nao ha coluna, nao ha trial.
// O client ainda consulta esse endereco a cada 5 min e recebe 404 em silencio
// (client/src/components/app-sidebar.tsx).

### ERP Integration (requireAuth)
GET provider/erp-integrations, PATCH erp-integrations/:source
POST erp-integrations/:source/test, POST erp-integrations/:source/sync
GET provider/erp-sync-logs, erp-integration-stats
GET /api/erp-connectors (catálogo público de conectores e seus campos)

### Mapa de Calor (requireAuth)
GET heatmap/provider, heatmap/regional, heatmap/city-ranking, heatmap/sync-info, heatmap/cache-status
POST heatmap/refresh

### Créditos (requireAuth)
GET credits/orders, POST credits/purchase, GET credits/orders/:id/asaas/pix

### Admin Superadmin (requireSuperAdmin)
CRUD providers, invoices, credit-orders, erp-catalog
POST providers/:id/plan, providers/:id/credits
POST invoices/generate-monthly
GET admin/stats, admin/financial/saas-metrics, admin/financial/summary
GET/POST admin/chat/threads, visitor-chats
GET/POST/PATCH admin/auto-sync/*

### Webhooks (públicos)
POST webhooks/erp-sync, webhooks/erp-inadimplente, asaas/webhook

### IA (requireAuth)
POST ai/analyze-consultation (streaming SSE), POST ai/analyze-antifraud (streaming SSE)

### Público
GET public/erp-catalog, public/lgpd-info
POST/GET public/visitor-chat/*

---

## 10. FUNCIONALIDADES DA LANDING PAGE (versão atualizada)

### Proposta de Valor
- "Consulte o CPF antes de instalar. Evite o calote antes que aconteça."
- R$ 690 prejuízo médio por inadimplente
- < 2s resultado da consulta
- Consultas na própria base são gratuitas

### Funcionalidades Destacadas
1. **Consulta ISP** — Score em 2s, histórico em toda a rede, equipamentos retidos, sugestão APROVAR/REJEITAR
2. **Anti-Fraude** — Alerta via WhatsApp em <5s quando CPF é consultado por outro provedor
3. **Controle de Equipamentos** — Registro, rastreamento, status
4. **Consulta por Endereço** — Cruza CEP + número independente do CPF
5. **Consulta SPC** — Negativação integrada
6. **Integração ERP** — IXC, MK Solutions, SGP, Hubsoft, RBX ISP, Voalle (+ CSV)
7. **Consulta em Lote** — Até 500 CPFs via CSV

### Planos na Landing (versão mais recente)
- **Gratuito R$0:** 30 créditos ISP, anti-fraude básico, CSV, 1 usuário
- **Básico R$149/mês:** 200 ISP + 50 SPC/mês, WhatsApp, 1 ERP, 3 usuários
- **Profissional R$349/mês:** 500 ISP + 150 SPC/mês, todos ERPs, lote 500 CPFs, ilimitado

### Depoimentos/Social Proof
- Provedores de MG, SP, RS, PR, GO, BA
- Economia de R$11.200 em equipamentos citada

---

## 11. ANÁLISE IA (server/ai-analysis.ts)

### Modelo: gpt-4o-mini via OpenAI SDK com streaming

### Consulta ISP — System Prompt
Analista de crédito ISP brasileiro. Seções: RESUMO EXECUTIVO, PRINCIPAIS FATORES DE RISCO, ANÁLISE DE PADRÃO, CONDIÇÕES RECOMENDADAS. Max 400 palavras.

### Anti-Fraude — System Prompt
Especialista em fraude por migração serial ISP. Contexto: cliente contrata, não paga 1-3 mensalidades, migra. Prejuízo: instalação + equipamento (R$200-800) + mensalidades. Seções: CENÁRIO DE MIGRAÇÃO, PERFIS DE MAIOR RISCO, PADRÃO DE FRAUDE, AÇÕES URGENTES, PREVENÇÃO FUTURA. Max 600 palavras.

### Anti-Fraude — detector de FUGA

**O conceito:** avisar o provedor que um cliente que ele **ainda tem** está
procurando outro provedor. Não é lista de inadimplentes nem log de consultas.
A carteira inteira vive em `/inadimplentes`.

**A regra** (`server/services/antifraude-rules.ts`, com testes), nas palavras
do dono (02/09/2026): *cliente com contrato ativo e inadimplente, consultado por
um provedor parceiro → o dono é avisado.* Dispara quando TODAS forem verdadeiras:
1. quem consultou **não** é o dono do cliente;
2. o cliente é **comprovadamente ativo** (ou suspenso por atraso — cortado, mas
   ainda cliente) na base do dono — cancelado sai, e **status desconhecido
   também**: ausência de prova de que é cliente não é prova de que é;
3. tem **fatura vencida** (≥ 1 dia, ≥ R$ 20 — abaixo disso é resíduo).

Não há teto de atraso nem condição de "contrato recente": os dois saíram em
02/09/2026. O teto compensava status desatualizado; desde que o sync lê o
contrato de verdade (V2 do MK, contratos do IXC, conexão bloqueada = suspenso),
ativo é ativo. Contrato novo em dia não é inadimplente.

**Quem é avaliado** (`proactive-alert.service.ts`): o dono que respondeu na
consulta ao vivo e, para o provedor cujo ERP **não respondeu** (fora da região,
fora do ar), a base sincronizada `customers`. O alerta é **gravado em
`anti_fraud_alerts`** (tipo `defaulter_consulted`) com a foto do momento —
dívida, dias, contrato, consulente — e é mostrado como nasceu; a situação de
hoje vai junto (`atual`) para o provedor ver se o cliente pagou ou saiu.
`proactive_alerts` é só log de envio e trava de 24h por CPF e dono.

**Avisos:** e-mail para o contato do provedor ou, sem ele, para os admins;
WhatsApp pela Z-API para o telefone de contato, quando configurada; webhook.
Na tela, o item Anti-Fraude da sidebar mostra a contagem de alertas abertos.

**Só cliente ativo.** Ex-cliente não é anti-fraude: o contrato acabou, não há
o que proteger. O sinal de migrador serial (ex-cliente que saiu devendo e foi
consultado de novo) é papel do bureau e aparece no **resultado da consulta**
de quem consultou; ele **não** é gravado em `anti_fraud_alerts` nem entra na
lista do dono. Linhas `migrador_serial` anteriores a 02/09/2026 ficam no
banco, ignoradas pela listagem.

A lista é deduplicada por CPF + consulente.

**Regras por provedor** (`shared/antifraude-regras.ts`, tabela `anti_fraud_rules`,
aba Anti-Fraude do Painel do Provedor, `GET/PUT /api/anti-fraud/rules`). Todas
exigem contrato ativo ou suspenso; o provedor liga o que quer vigiar:
- `ativo_inadimplente` (padrão, ligada) — fatura vencida ≥ R$ 20 e ≥ 1 dia; limiares editáveis.
- `contrato_novo` — até N dias de contrato (90), em dia ou não. Só dispara com
  a data de contrato do ERP ao vivo; a base sincronizada não a guarda.
- `consultas_repetidas` — N ou mais provedores diferentes do dono em 30 dias (2).
- `ativo_qualquer` — qualquer cliente ativo consultado (retenção).

Os motivos que bateram vão em `riskFactors`; o rótulo do card sai do motivo
principal. Sem linha gravada vale o padrão. Os canais (e-mail, WhatsApp,
webhook, liga/desliga) ficam na mesma aba.

**Código de provedor parceiro** (`server/utils/provider-anonymizer.ts`): o
nome de outro provedor nunca aparece; sai `Provedor Parceiro ISP-XXX-XXX`.
O código é **pareado por observador** — HMAC-SHA256 com chave HKDF de
`PARTNER_CODE_SECRET` sobre `viewer:parceiro` — e nada do nome entra. O
provedor A vê um código para Z, o B vê outro, e A vê sempre o mesmo. O
esquema anterior (sha256 de salt fixo no fonte + id, com a inicial do nome no
fim) era enumerável com o fonte em mãos e a inicial isolava o parceiro numa
região pequena. O id numérico de outro tenant nunca sai em payload
(alertas, providerDetails, addressMatches); `erpLatencies` traz só a linha
do próprio ERP; o histórico gravado é limpo na leitura
(`server/utils/historico-consulta.ts`). Só o superadmin resolve um código, por
`POST /api/admin/partner-code/resolve` com observador, código e motivo.
Cada provedor vê o **próprio código** no dashboard ("seu código",
`partnerCode` em `GET /api/auth/me`), derivado em **outro domínio de chave**
(`generateOwnCode`): serve para se identificar ao suporte e **não** é o que
os parceiros veem para ele. Sem observador, o resolvedor trata o código como
próprio.

Linhas legadas de `proactive_alerts` sem foto continuam entrando, reavaliadas
pela regra com a situação atual.

---

## 12. MAPA DE CALOR (server/heatmap-cache.ts)

- **Cache in-memory** por provedor com TTL 24h
- **Fonte:** Connector registry — suporta os 6 ERPs (IXC, MK, SGP, Hubsoft, Voalle, RBX) via `getConnector(erpSource).fetchDelinquents()`
- **Geocodificação:** quando o ERP não retorna endereço estruturado, fallback CEP → ViaCEP → cidade/estado → Nominatim → lat/lng
- **Rate limiting:** `getProviderLimiter` controla concorrência por provedor para respeitar limites dos ERPs
- **Scheduler:** Refresh automático a cada 24h + manual via POST /api/heatmap/refresh
- Tabela `customers` NÃO é usada — somente cache in-memory

---

## 13. REGRAS DE DESENVOLVIMENTO

1. **NUNCA modifique `shared/schema.ts`** sem autorização explícita.
2. **Desenvolvimento iterativo** — mudanças incrementais, uma feature por vez.
3. **Sempre explique em detalhes** antes de executar.
4. **Pergunte antes de mudanças grandes** na arquitetura.
5. **Multi-tenant obrigatório** — toda feature isola por `providerId`.
6. **Textos em português brasileiro** — interface e erros.
7. **Use os padrões existentes** — mesmos componentes, hooks, patterns.
8. Novas tabelas → SEMPRE `providerId` FK `providers.id`.
9. Novas rotas → SEMPRE middleware de auth adequado.
10. Queries → Drizzle ORM via `storage` (padrão Repository) — NUNCA SQL raw.
11. Frontend → TanStack Query para API — NUNCA fetch direto em componentes.
12. Preferir **portugues** para nomes de variáveis/funções de domínio quando já existe padrão (ex: `equipamentos`, `notificacaoEnviada`).

---

## 14. SCRIPTS E BUILD

```bash
npm run dev          # tsx server/index.ts (dev com Vite middleware)
npm run build        # esbuild backend (CJS) + vite frontend
npm run start        # node dist/index.cjs (produção)
npm run check        # tsc
npm run db:push      # drizzle-kit push (sync schema → PostgreSQL)
```

---

## 15. PRIORIDADE DE DESENVOLVIMENTO

### Concluído (referência)
- ✅ Migração ERP completa: 6 conectores diretos + remoção total do N8N (Phases 04 + 05 do GSD arquivado)
- ✅ Multi-ERP heatmap via connector registry
- ✅ IXC e MK validados em produção (per memória do projeto)

### Em Aberto — Próximos Itens
1. **NFS-e via FocusNFe** — emissão fiscal eletrônica de notas
2. **SPC** — integrado em 02/09/2026 (`server/services/spc/`: SOAP `consultaWebService`, produto 257, parser testado com os exemplos da doc v4.3). Credencial validada com `listarProdutos` em 02/09/2026: o operador tem 257 (SPC MIX TOP +), 325, 331, 332, 1044 e 1045. O retorno padrão do 257 não traz score, protesto nem óbito — são insumos opcionais (`SPC_INSUMOS_OPCIONAIS`). Pendente: primeira consulta real com autorização do dono e a VPS ainda sem as credenciais
3. **Paginação em `fetchCustomers`** — atualmente sem paginação em todos os conectores
4. **Indicador de % de inadimplência** — métrica agregada por provedor no dashboard

### Melhorias Planejadas
- Unificar preços (schema vs landing page — divergência documentada na seção 5)
- Dashboard analytics avançado
- API pública documentada para integrações customizadas
- Cobertura de testes para áreas críticas (auth, multi-tenant, score ISP, ERP connectors)

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Consulta ISP**

SaaS multi-tenant de analise de credito colaborativa para provedores regionais de internet (ISPs) no Brasil. Funciona como um bureau de credito especializado em telecom — provedores compartilham dados de inadimplencia (mascarados por LGPD) para minimizar calotes, fraudes por migracao serial e perdas de equipamentos. Similar ao Serasa/SPC, mas focado exclusivamente no setor ISP.

**Core Value:** Permitir que um provedor consulte o CPF/CNPJ de um potencial cliente e receba em 2 segundos um score de risco baseado no historico colaborativo de toda a rede de provedores — evitando o calote antes que aconteca.

### Constraints

- **LGPD:** Dados de inadimplencia entre provedores devem ser mascarados — nome parcial, faixa de valor, endereco sem numero. Nenhum dado pessoal completo exposto entre tenants.
- **Multi-tenant:** Isolamento absoluto por providerId em toda query e toda tabela.
- **Schema:** Nao modificar shared/schema.ts sem autorizacao explicita.
- **Qualidade > Velocidade:** Sem deadline, fazer direito. Mudancas incrementais, uma feature por vez.
- **Portugues BR:** Interface, erros e nomes de dominio em portugues.
- **Padrao existente:** Usar mesmos patterns do codebase (Drizzle via storage, TanStack Query, shadcn/ui).
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Current Stack (No Changes)
| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| Express | 5.0.1 | HTTP server | Keep |
| React | 18.3 | Frontend UI | Keep |
| PostgreSQL | 16+ | Primary database | Keep |
| Drizzle ORM | 0.39 | Queries and types | Keep |
| Vite | 7.3 | Frontend bundler | Keep |
| Tailwind CSS | 3.4 | Styling | Keep |
| shadcn/ui | new-york | UI components | Keep |
| TanStack Query | 5 | Server state | Keep |
| Wouter | 3 | Routing | Keep |
| Zod | 3.25 | Validation | Keep |
| OpenAI SDK | 6.25 | AI analysis streaming | Keep |
| Resend | 6.9 | Transactional email | Keep |
| p-limit | 7.3 | Concurrency control | Keep |
| p-retry | 7.1 | Retry logic | Keep |
## Recommended Stack Additions
### 1. ERP HTTP Client & Resilience
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Native `fetch` (Node 18+) | built-in | HTTP client for ERP APIs | Zero dependencies. Node.js built-in fetch (powered by undici) is production-ready since Node 18. The project already uses ESM. No need for axios or node-fetch -- one less dependency to maintain. For ERP integrations with simple REST calls (POST/GET with JSON), native fetch is sufficient. | HIGH |
| cockatiel | ^4.0.0 | Circuit breaker + retry policies | Replaces ad-hoc retry logic with composable resilience policies (retry, circuit breaker, timeout, bulkhead, fallback). Inspired by .NET Polly. 268K weekly downloads, actively maintained (v4 released 2024). The project already has p-retry but cockatiel provides circuit breakers which are critical for ERP integrations -- when an ERP API is down, you need to stop hammering it. | HIGH |
| bottleneck | ^2.19.5 | Rate limiting outbound ERP calls | 5.5M weekly downloads. Stable since 2019 (no bugs = no releases). Perfect for throttling ERP API calls to respect rate limits (e.g., IXC allows X requests/min). Zero dependencies. NOTE: unmaintained but battle-tested and stable. The alternative (building rate limiting into cockatiel) is more complex. | MEDIUM |
### 2. Structured Logging
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| pino | ^10.3.1 | Structured JSON logging | 5-10x faster than winston. JSON-native output perfect for Docker log aggregation. Essential for ERP sync debugging -- when a sync fails at 3am, you need structured logs with correlation IDs, ERP source, provider ID, and error details. The project currently has NO logging library (uses console.log). | HIGH |
| pino-http | ^10.0.0 | Express HTTP request logging | Auto-logs every HTTP request with timing, status, and request ID. Drop-in Express middleware. Replaces manual logging in routes. | HIGH |
| pino-pretty | ^13.0.0 | Dev-only log formatting | Makes pino's JSON output human-readable in development. Install as devDependency only. | HIGH |
### 3. Backend Modularization
### 4. API Rate Limiting (Inbound)
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| express-rate-limit | ^8.3.1 | Rate limit incoming API requests | 15.6M weekly downloads, actively maintained. Prevents abuse of credit-consuming endpoints (ISP/SPC consultations). Essential for a SaaS with per-credit billing -- without rate limiting, a compromised API key could drain all credits in seconds. | HIGH |
### 5. Docker & Deployment
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Docker | 27+ | Containerization | Industry standard. Required for VPS deployment per project requirements. | HIGH |
| Docker Compose | 2.x (v2 spec) | Multi-container orchestration | Manages app + PostgreSQL + optional Redis in a single `docker-compose.yml`. Simpler than Kubernetes for single-VPS deployment. | HIGH |
| node:20-slim | 20 LTS | Base Docker image | Node 20 is LTS until April 2026. Use `-slim` variant (not alpine) because: (1) Alpine uses musl libc which can cause issues with native Node modules, (2) slim is Debian-based with glibc compatibility, (3) still small (~200MB vs ~1GB for full image). The project uses `pg` which has native bindings. | HIGH |
| PostgreSQL 16 | 16.x | Database container | Latest stable LTS. Use official `postgres:16-alpine` image (Alpine is fine for Postgres, no Node native module concerns). | HIGH |
# Stage 1: Build
# Stage 2: Production
### 6. LGPD Compliance
- Data masking between providers (partial name, value ranges, address without number)
- Provider isolation via `providerId` on every query
| Concern | Implementation | Confidence |
|---------|---------------|------------|
| Audit trail for data access | New `audit_logs` table: who queried what CPF, when, from which provider. Use Drizzle, no new lib needed. | HIGH |
| Consent management | Record legal basis for data processing per provider. LGPD Art. 7 requires legitimate interest or consent. For credit bureau data, legitimate interest (Art. 7, IX) applies. Document this in the system. | MEDIUM |
| Data retention policy | Auto-purge consultation logs after configurable period (e.g., 5 years per credit bureau norms). Implement via scheduled job in existing scheduler.ts. | MEDIUM |
| Breach notification | LGPD requires 72h breach notification to ANPD. This is operational, not code. Document the process. | LOW (operational) |
| Right to deletion | Endpoint to anonymize customer data on request. Replace PII with hashes, keep aggregated scores. | MEDIUM |
| Data encryption at rest | PostgreSQL TDE or application-level encryption for CPF/CNPJ fields. Use Node.js built-in `crypto` module, no external library. | MEDIUM |
### 7. Dev/Build Tools (Cleanup)
| Action | What | Why | Confidence |
|--------|------|-----|------------|
| REMOVE | `@replit/vite-plugin-cartographer` | Replit-specific, unnecessary outside Replit | HIGH |
| REMOVE | `@replit/vite-plugin-dev-banner` | Replit-specific | HIGH |
| REMOVE | `@replit/vite-plugin-runtime-error-modal` | Replit-specific | HIGH |
| REMOVE | `memorystore` | Replace with connect-pg-simple (already installed) for session storage in production. Memorystore leaks memory in production. | HIGH |
| KEEP | `connect-pg-simple` | PostgreSQL-backed sessions, production-ready | HIGH |
## ERP Connector Technical Details
### Authentication Patterns by ERP
| ERP | Auth Method | Required Fields | Confidence |
|-----|------------|-----------------|------------|
| IXC Soft | Basic Auth (Base64 `user:token`) + custom header `ixcsoft: "listar"` | apiUrl, apiUser, apiToken | HIGH (documented, partially implemented) |
| MK Solutions | Bearer JWT Token | apiUrl, apiToken | MEDIUM (API docs at postman.mk-auth.com.br) |
| SGP | Token + App Name in body, OR Basic Auth | apiUrl, apiToken, apiUser (optional) | MEDIUM (docs at bookstack.sgp.net.br) |
| Hubsoft | OAuth2 (client_id, client_secret, username, password) -> Bearer | apiUrl, clientId, clientSecret, apiUser, apiToken (password) | HIGH (docs at docs.hubsoft.com.br, confirmed OAuth flow) |
| Voalle | Integration User credentials | apiUrl, apiUser, apiToken | LOW (wiki.grupovoalle.com.br, limited public docs) |
| RBX ISP | Integration Key in POST body | apiUrl, apiToken (ChaveIntegracao) | MEDIUM (docs at developers.rbxsoft.com) |
| TopSApp | Unknown - needs research during implementation | TBD | LOW |
| RadiusNet | Unknown - needs research during implementation | TBD | LOW |
| Gere | Unknown - needs research during implementation | TBD | LOW |
| Receita Net | Unknown - needs research during implementation | TBD | LOW |
### Shared `erpIntegrations` Schema Needs
### IXC Node.js SDK Assessment
- **DO NOT USE IT.** The package has minimal downloads, unknown maintenance status, and wraps simple HTTP calls. The project should own its connector code for reliability and debugging. Writing a direct fetch-based IXC connector is ~50 lines of code and gives full control over error handling, logging, and retry policies.
## Dependency Summary
### New Production Dependencies
### New Dev Dependencies
### Optional (evaluate during implementation)
# Only if ERP rate limits prove problematic during testing
### Dependencies to Remove
### Net Dependency Change
- **Added:** 4 production + 1 dev (cockatiel, pino, pino-http, express-rate-limit, pino-pretty)
- **Removed:** 4 (3 Replit plugins + memorystore)
- **Net change:** +1 production dependency
## Alternatives Considered
| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| HTTP Client | Native fetch | axios | Unnecessary dependency; fetch is built-in since Node 18, powered by undici |
| HTTP Client | Native fetch | undici (direct) | fetch IS undici; direct undici API adds complexity for no gain in this use case |
| Circuit Breaker | cockatiel | opossum | Opossum is callback-oriented, heavier, less composable |
| Rate Limit (outbound) | bottleneck (optional) | p-limit (existing) | p-limit handles concurrency but not time-based rate limits |
| Rate Limit (inbound) | express-rate-limit | rate-limiter-flexible | express-rate-limit is simpler, Express-native, sufficient for this use case |
| Logging | pino | winston | Winston is 5-10x slower; pino is JSON-native, better for Docker/structured logging |
| Docker base | node:20-slim | node:20-alpine | Alpine's musl libc causes issues with pg native bindings and esbuild |
| Backend framework | Express 5 (keep) | Fastify / NestJS | Migration cost is extreme for 100+ endpoints; Express 5 is modern enough |
| Session store | connect-pg-simple (keep) | Redis | Unnecessary complexity; PG sessions work fine at this scale |
| ORM | Drizzle (keep) | Prisma | Drizzle is already deeply integrated; Prisma migration would touch every query |
## Environment Variables (New)
# Existing (no changes)
# New for Docker deployment
# No new env vars for ERP -- config stored in erpIntegrations table per provider
## Sources
### Verified (HIGH confidence)
- [Express Router documentation](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Express_Nodejs/routes)
- [Docker official Node.js guide](https://docs.docker.com/guides/nodejs/containerize/)
- [Cockatiel GitHub - resilience library](https://github.com/connor4312/cockatiel)
- [Pino npm - structured logging](https://www.npmjs.com/package/pino)
- [express-rate-limit npm](https://www.npmjs.com/package/express-rate-limit)
- [IXC Soft API docs](https://wikiapiprovedor.ixcsoft.com.br/)
- [Hubsoft API docs](https://docs.hubsoft.com.br/)
- [MK Auth API Postman](https://postman.mk-auth.com.br/)
- [SGP API docs](https://bookstack.sgp.net.br/books/api)
- [RBX ISP developer docs](https://www.developers.rbxsoft.com/)
### Cross-referenced (MEDIUM confidence)
- [Bottleneck npm - rate limiter](https://www.npmjs.com/package/bottleneck) - Stable but unmaintained since 2019
- [LGPD compliance guide for SaaS](https://complydog.com/blog/brazil-lgpd-complete-data-protection-compliance-guide-saas)
- [Voalle API wiki](https://wiki.grupovoalle.com.br/APIs)
- [Node.js Docker best practices 2026](https://dev.to/axiom_agent/dockerizing-nodejs-for-production-the-complete-2026-guide-7n3)
- [Pino vs Winston comparison](https://betterstack.com/community/comparisons/pino-vs-winston/)
### Single source (LOW confidence - needs validation during implementation)
- TopSApp, RadiusNet, Gere, Receita Net API details -- no public documentation found
- [ixc-soft-api npm package](https://github.com/isacna/ixc-soft-api) - Assessed and rejected
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- DESIGN:start -->
## Design

Leia @DESIGN_SYSTEM.md ANTES de criar ou alterar qualquer componente, pagina ou estilo.
Nao desvie dos tokens definidos la — a lista negra da secao 8 e obrigatoria.

O sistema e "Bureau" (v4.0): instrumento de medicao, neutro frio, denso e alinhado.
NAO e editorial, NAO e quente, NAO tem serifa.

Pontos que mais geram erro:
- O acento e **roxo** `--color-brand` (#533AFD), texto e **navy** `--color-ink` (#061B31).
  Botao primario e navy; o roxo fica para navegacao, link e estado ativo.
- **Nao existe serifa.** Inter para tudo, IBM Plex Mono para todo dado numerico.
- **Todo numero leva `tabular-nums`.** Coluna desalinhada destroi a leitura de organizacao.
- Profundidade e **borda de 1px** (`0 0 0 1px var(--ring-subtle)`), nunca `shadow-md/lg/xl`.
  Os tokens `--ring-*` ainda se chamam "warm" mas valem neutro frio — leia o valor,
  nao deduza pelo nome.
- Raio: 4px botao/badge, 6px nav, 8px card. Nada acima de 8px.
  Badge de status e retangular, nunca `rounded-full`.

Para o que o doc nao cobrir: cor e tipografia em
`.claude/skills/design/references/stripe.md`; raio e elevacao em
`.claude/skills/design/references/intercom.md`. Nao misture uma terceira referencia.
<!-- DESIGN:end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

> **INATIVO — GSD nao esta instalado neste repositorio.**
> Nao existe `.claude/commands/` nem skills `gsd:*`, entao os comandos abaixo nao podem
> ser executados e a regra nao pode ser cumprida. Bloco mantido como registro historico.
> Para reativar, reinstale o GSD; caso contrario, remova este bloco.

Regra original (nao aplicavel enquanto o GSD estiver ausente):
Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/001-fetchcustomers-pagination/plan.md`
<!-- SPECKIT END -->
