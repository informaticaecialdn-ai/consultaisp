# Tasks — Spec 007

3 sub-fases sequenciais (b → a → c). Checkpoint visual entre cada.

---

## Sub-fase B — Página /time + AgentBadge (FOCO ATUAL)

### Backend

- [ ] B1 — `shared/types/team.ts`: tipos `Agent`, `AgentStatus`, `AgentKpi` compartilhados client+server. Define enum `AgentId` com os 10 IDs (`'julia'|'bruno'|'helena'|'sofia'|'marcos'|'rafael'|'carla'|'daniel'|'lucas'|'pedro'`).

- [ ] B2 — `server/services/team.service.ts`: função `buildTeamRoster(providerId)` retorna array de 10 agentes com status + KPIs:
  - Júlia: KPI = `taxa_bloqueio_mes` (count `compliance_checks WHERE decision='BLOCKED'` / total)
  - Bruno: KPI = `lembretes_enviados_mes` (count `outbound_attempts WHERE agent='bruno' AND status='sent'`)
  - Helena: KPI = `conversas_atendidas_mes` (count distinct `conversations` com role inbound)
  - Sofia: KPI = `agradecimentos_mes` (count `outbound_attempts WHERE agent='sofia'`)
  - Marcos/Rafael/Carla/Daniel/Lucas/Pedro: status = `training`, kpi = `null`

- [ ] B3 — `server/routes/team.routes.ts`: novo arquivo registrando `GET /api/team` (requireAuth) → `buildTeamRoster(req.session.providerId)`. Registrar em `server/server.ts` (ou onde routes são montadas).

- [ ] B4 — Smoke test manual: `curl -b cookies.txt http://localhost:5000/api/team` retorna JSON com 10 itens.

### Frontend — componente AgentBadge

- [ ] B5 — `client/src/components/agent-badge.tsx`:
  - Props: `agentId: AgentId`, `variant?: 'inline' | 'small' | 'large'`, `showStatus?: boolean`
  - Cores hardcoded conforme DESIGN.md §5.1 (Marcos navy, Júlia gray+gold, Bruno green-500, Helena green-700, Rafael amber, Carla red, Daniel navy+gold, Lucas amber-dark, Sofia green-100, Pedro navy-mid)
  - Avatar circular com iniciais 2 letras (Fraunces)
  - Variant `inline`: só avatar 16px
  - Variant `small`: avatar 24px + primeiro nome
  - Variant `large`: avatar 40px + nome completo + cargo + status dot (verde pulsa se online)

### Frontend — página /time

- [ ] B6 — `client/src/pages/provedor/time.tsx`:
  - useQuery `['team']` chama `GET /api/team`
  - Grid 5 cols desktop, 2 cols mobile (`grid-cols-2 lg:grid-cols-5`)
  - Card por agente: AgentBadge (large) + descrição curta + KPI do mês
  - Loading: skeleton dos 10 cards
  - Click no card navega para `/time/${agentId}`

- [ ] B7 — `client/src/pages/provedor/time-detail.tsx`:
  - Wouter route `/time/:agentId`
  - Header com AgentBadge large + breadcrumb "Time → [Nome]"
  - Seções: Job Description (texto estático do TEAM.md §4.X), KPIs do mês (gráfico), Últimas Ações (audit_logs filtrado por agentId), Ferramentas (lista yaml estática)
  - Para agentes "Em treinamento": exibe apenas Job Description + "Em desenvolvimento — previsto para [Spec X]"

- [ ] B8 — `client/src/App.tsx`: adicionar lazy imports + rotas `/time` e `/time/:agentId`.

### Checkpoint Fase B

- `npm run check` → 21 erros baseline mantido
- `npm run build` → ok
- Visual: login → `/time` mostra os 10 cards corretos
- AgentBadge inline pode ser testado em algum lugar existente (ex: cliente-dossie)

---

## Sub-fase A — Sidebar nova (DEPOIS de B)

- [ ] A1 — `client/src/components/app-sidebar.tsx`: reorganizar `mainMenu` em 9 seções top-level conforme DESIGN.md §4.1. Sub-itens internos por seção.
- [ ] A2 — Aliases: `/consulta-isp`, `/consulta-spc`, etc. — preservam rota mas mostram em "Clientes > Rede Colaborativa" no sidebar.
- [ ] A3 — Adicionar item "Time" no sidebar apontando para `/time`.
- [ ] A4 — Permission gate por role (operator vê só Cobrança + Clientes; admin vê tudo do tenant; superadmin acessa `/admin-sistema`).

---

## Sub-fase C — Tab superadmin Time Digital (DEPOIS de A)

- [ ] C1 — `server/routes/admin.routes.ts`: novo endpoint `GET /api/admin/team-stats` (requireSuperAdmin) — agregados cross-tenant.
- [ ] C2 — `client/src/components/admin/tabs/TimeDigitalTab.tsx`: tabela tenants × agentes + cards KPI agregados (mensagens/mês total, custo total, taxa bloqueio Júlia).
- [ ] C3 — `client/src/pages/admin/admin-sistema.tsx`: adicionar `time-digital` em `VALID_TABS` (constants.ts:6-14), renderizar `<TimeDigitalTab />` quando `activeTab === 'time-digital'`.
- [ ] C4 — Hash routing: link `#time-digital` funciona como pattern existente.

### Checkpoint final Spec 007

- Operador acessa `/time` → 10 cards
- Operador clica em "Bruno" → vê perfil detalhado
- Sidebar nova mostra 9 itens, rotas antigas preservadas
- Superadmin acessa `/admin-sistema#time-digital` → tabela cross-tenant
- Commit final: `feat(spec007): nova navegação + página /time + AgentBadge + tab superadmin`
