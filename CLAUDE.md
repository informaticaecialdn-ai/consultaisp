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
trialInicio, createdAt
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
- **consultationLogs** — cpfCnpj, providerId, tipo(isp/spc)

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
- **antiFraudRules** — tipo, label, ativo, valorMinimo, diasMinimo

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
PLAN_PRICES = { free: 0, basic: 199, pro: 399, enterprise: 799 }  // R$/mês
PLAN_CREDITS = {
  free: { isp: 50, spc: 0 },
  basic: { isp: 200, spc: 50 },
  pro: { isp: 500, spc: 150 },
  enterprise: { isp: 1500, spc: 500 },
}
// Landing page mostra: Gratuito R$0 / Básico R$149/mês / Profissional R$349/mês
// NOTA: há divergência entre PLAN_PRICES no schema (199/399/799) e landing page (0/149/349)
// A landing page é a versão mais recente

ISP_CREDIT_PACKAGES = [
  50 consultas → R$49,90 (R$1,00/un),
  100 → R$89,90 (R$0,90/un, popular),
  250 → R$199,90 (R$0,80/un),
  500 → R$349,90 (R$0,70/un)
]
SPC_CREDIT_PACKAGES = [
  10 → R$49,90 (R$4,99/un),
  30 → R$129,90 (R$4,33/un, popular),
  50 → R$199,90 (R$4,00/un),
  100 → R$349,90 (R$3,50/un)
]
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

## 7. INTEGRAÇÃO ERP — SITUAÇÃO ATUAL E MIGRAÇÃO NECESSÁRIA

### Situação Atual
O sistema usa **N8N como proxy** para comunicação com ERPs, especialmente o IXC Soft. Há um proxy N8N em `https://n8n.aluisiocunha.com.br/webhook/ixc-inadimplentes` que contorna restrições de IP do IXC.

**Problema:** A dependência do N8N precisa ser eliminada. O sistema deve fazer **chamadas diretas via API** para TODOS os ERPs suportados, sem intermediários.

### O QUE PRECISA SER FEITO: Motor de Integração ERP Direto

**Substituir o N8N por um módulo de integração nativo** (`server/erp-connector.ts`) que se conecte diretamente a cada ERP via suas APIs REST. O módulo deve:

1. Ter um **conector abstrato** (interface) com implementações específicas por ERP
2. Suportar **auto-sync** via scheduler (já existe em `scheduler.ts`, só precisa expandir)
3. Suportar **sync manual** via rota `POST /api/provider/erp-integrations/:source/sync`
4. Alimentar o **mapa de calor** (substituir `fetchIxcDelinquents` em `heatmap-cache.ts`)
5. Manter logs em `erpSyncLogs` e status em `erpIntegrations`

### ERPs e Suas APIs

#### IXC Soft (IXCSoft/IXC Provedor) — JÁ IMPLEMENTADO PARCIALMENTE
- **Auth:** Basic Auth (`Base64(user:token)`)
- **Base URL:** `https://[dominio]/webservice/v1/`
- **Método:** POST com header `ixcsoft: "listar"` e `Content-Type: application/json`
- **Endpoint inadimplentes:** `/webservice/v1/fn_areceber` com body `{ qtype: "fn_areceber.status", query: "A", oper: "=" }`
- **Endpoint clientes:** `/webservice/v1/cliente`
- **Paginação:** campos `page`, `rp` (records per page)
- **Resposta:** `{ registros: [...], total: N }`
- **Docs:** https://wikiapiprovedor.ixcsoft.com.br/
- **Nota:** Pode ter restrição de IP — o sistema já tenta fallback via N8N proxy. Na nova versão, instruir o provedor a liberar o IP do servidor.

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

### O que Mudar em Cada Arquivo
1. **Criar `server/erp-connector.ts`** — Interface + implementações por ERP
2. **Atualizar `server/scheduler.ts`** — Usar connectors[source].fetchDelinquents() em vez de `fetchErpCustomersForScheduler()`
3. **Atualizar `server/heatmap-cache.ts`** — Remover N8N proxy, usar connectors[source].fetchDelinquents()
4. **Atualizar `server/routes.ts`** — Rotas de test/sync usando connectors
5. **Atualizar `shared/schema.ts`** — Adicionar campos extras na tabela `erpIntegrations` se necessário (ex: `clientId`, `clientSecret` para Hubsoft OAuth)
6. **Atualizar frontend** — Tela de configuração ERP para campos específicos de cada ERP

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
GET/POST isp-consultations, POST isp-consultations/lote
GET/POST spc-consultations

### Anti-Fraude (requireAuth)
GET anti-fraud/alerts, PATCH alerts/:id/status, GET customer-risk, GET migradores, GET/PATCH rules

### Equipamentos (requireAuth)
GET/POST/PATCH/DELETE equipamentos, POST equipamentos/import

### Provedor Config (requireAuth)
GET/PATCH provider/profile, provider/settings, provider/notification-settings
GET/POST/DELETE provider/users, provider/partners, provider/documents
GET/PATCH provider/webhook-config, GET provider/trial-status

### ERP Integration (requireAuth)
GET provider/erp-integrations, PATCH erp-integrations/:source
POST erp-integrations/:source/test, POST erp-integrations/:source/sync
GET provider/erp-sync-logs, erp-integration-stats
GET/PATCH provider/n8n-config, POST n8n-config/test

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

### Tipos de Alerta Anti-Fraude
- `defaulter_consulted` — Tentativa de Fuga
- `multiple_consultations` — Migrador Serial (3+ provedores em 30 dias)
- `equipment_risk` — Risco de Equipamento
- `recent_contract` — Contrato Recente (<90 dias tentando migrar)

---

## 12. MAPA DE CALOR (server/heatmap-cache.ts)

- **Cache in-memory** por provedor com TTL 24h
- **Fonte principal:** API do ERP IXC (fn_areceber status=A) — PRECISA EXPANDIR PARA OUTROS ERPs
- **Geocodificação:** CEP → ViaCEP → cidade/estado → Nominatim → lat/lng
- **N8N Proxy atual:** `https://n8n.aluisiocunha.com.br/webhook/ixc-inadimplentes` — A SER REMOVIDO
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

### Imediato — Migração ERP
1. Criar `server/erp-connector.ts` com interface + implementações
2. Implementar conectores: IXC (refatorar existente), MK Auth, SGP, Hubsoft, Voalle, RBX
3. Remover dependência N8N de `heatmap-cache.ts`
4. Atualizar `scheduler.ts` para usar conectores
5. Atualizar rotas de test/sync em `routes.ts`
6. Adaptar UI de configuração ERP para campos específicos de cada ERP

### Melhorias Planejadas
- Unificar preços (schema vs landing page)
- Expandir mapa de calor para todos os ERPs (não só IXC)
- Dashboard analytics avançado
- API pública documentada para integrações customizadas

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

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

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
