# Spec 007 — Reorganização do Frontend + Página /team + Tab Superadmin

**Status:** Draft → In Progress
**Duração estimada:** 2-3 semanas (3 sub-fases)
**Depende de:** Spec 006 ✅ (rebrand já aplicado)
**Bloqueia:** Spec 009 (Rafael — vai aparecer no `/team` como ativo quando pronto)

## Objetivo

Aplicar a arquitetura de navegação canônica do `DESIGN.md §4.1` e criar a UI que materializa o pitch comercial "10 funcionários digitais". Resolve a sensação de "produto sem narrativa" — hoje o operador vê só 2 toggles (Bruno/Sofia) e não percebe o time completo.

## Sub-fases (ordem aprovada: b → a → c)

### Fase B — Página `/time` + AgentBadge (~3-4 dias)

Constrói a peça visual mais impactante: grid 5×2 com os 10 funcionários do TEAM.md, mostrando estado real dos 4 implementados e "Em treinamento" dos 6 pendentes. Componente AgentBadge reutilizável fica pronto pra ser usado em Comunicações, Dossiê e timeline.

### Fase A — Sidebar nova com 9 itens (~2-3 dias)

Reorganiza o menu para refletir DESIGN.md §4.1: Dashboard / Clientes / Cobrança / Equipamentos / Carteiras / Time / Anatel Shield / Relatórios / Settings. Rotas atuais preservadas via alias — zero breaking change.

### Fase C — Tab superadmin "Time Digital" (~2 dias)

Adiciona `/admin-sistema#time-digital` mostrando visão agregada cross-tenant dos 10 agentes. Reusa o padrão de tabs existentes (useQuery + cards + tabela).

## User Stories

**US-001 — Operador acessa `/time`** vê 10 cards. Júlia/Bruno/Helena/Sofia: status "Online" com KPI real do mês. Marcos/Rafael/Carla/Daniel/Lucas/Pedro: status "Em treinamento" com descrição estática do TEAM.md.

**US-002 — Operador clica em qualquer agente** abre página `/time/[agentId]` com job description, ferramentas, KPIs e últimas ações (auditadas via `audit_logs`).

**US-003 — Operador olha a sidebar** vê 9 itens top-level organizados conceitualmente. Click em "Cobrança" abre a régua + comunicações + acordos. Itens antigos da Consulta ISP ficam sob "Clientes > Rede Colaborativa".

**US-004 — AgentBadge inline** aparece em toda timeline de comunicações e audit log mostrando quem fez o quê (avatar de iniciais + nome). Click no badge abre o perfil do agente em modal.

**US-005 — Superadmin acessa `/admin-sistema#time-digital`** vê tabela: tenants × agentes (status ativo por agente), totais agregados (mensagens enviadas, custo total Claude API, taxa Júlia de bloqueio), top 5 tenants por volume.

## Critérios de sucesso (mensuráveis)

- [ ] `GET /api/team` retorna 10 agentes com shape `{ id, name, role, status, kpi }` — endpoint protegido por `requireAuth`
- [ ] Página `/time` renderiza grid 5×2 em desktop, 2×5 em mobile (sm: breakpoint)
- [ ] AgentBadge com 3 variants (`inline`/`small`/`large`) tem snapshot test passando (ou ao menos render sem erro)
- [ ] Sidebar nova preserva 100% das rotas existentes via alias — `/consulta-isp`, `/inadimplentes`, `/regua-pre-vencimento` continuam acessíveis
- [ ] `GET /api/admin/team-stats` retorna agregado cross-tenant — protegido por `requireSuperAdmin`
- [ ] `/admin-sistema#time-digital` aparece como nova tab, segue padrão visual de VisaoGeralTab
- [ ] Zero regressões TS (baseline 21 client/ + 91 server/)
- [ ] `npm run build` passa

## Edge cases

- **EC-1:** Tenant não tem nenhum `outbound_attempt` ainda — cards dos 4 agentes mostram "Sem dados", não erro.
- **EC-2:** Agente "Em treinamento" não pode ter toggle ativo no `/configuracoes-agentes`. Hard-coded para não exibir.
- **EC-3:** Mobile (sidebar collapsível) preserva navegação atual. Não vamos redesenhar mobile nesta spec.
- **EC-4:** Superadmin de outro tenant não pode ver dados cross-tenant — `requireSuperAdmin` valida `role === "superadmin"` (não `role === "admin"`).
- **EC-5:** Quando Rafael (Spec 009) for implementado, ele troca de "Em treinamento" para "Online" no `/time` automaticamente quando o backend marcar agente como ativo. Não precisa redeploy do frontend.

## Schema (sem migration nesta spec)

Reusa `audit_logs`, `outbound_attempts`, `compliance_checks`, `agent_toggles`. KPIs agregados via SQL queries em runtime — sem caching ainda (otimizar depois se virar gargalo).

## Não-objetivos

- Dashboard hero "Provedor Index" (R7) — vai virar Spec 011 (Marcos), depende de dados que Marcos produz
- Mudança visual completa para paleta verde-floresta (DESIGN.md §3.1) — tokens novos já adicionados em 006, aplicação visual será gradual nas próximas specs
- Mobile app (B6 do MODULES_ROADMAP) — fora de escopo
- Renomeação de rotas existentes (ex: `/consulta-isp` → `/rede-colaborativa`) — preservar URLs

## Referências canônicas

- DESIGN.md §4.1 — sidebar com 9 itens, hierarquia de rotas
- DESIGN.md §5.1 — AgentBadge anatomia + cores por agente
- DESIGN.md §7 — Página /team layout (cards + perfil detalhado)
- TEAM.md §4 — 10 funcionários, persona, KPIs
- TEAM.md §1.4 — pitch comercial "10 funcionários"

## Plano de execução

Ver [tasks.md](./tasks.md). 3 sub-fases sequenciais com checkpoint entre cada.
