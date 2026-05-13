# Spec 012.5 — Cliente 360º (Operacional, 3 cenários)

**Status:** Aguardando autorização schema + design completo.
**Estimativa:** ~20-30 dias-pessoa para implementação 100% (todos cenários).
**Sessão de origem:** 2026-05-13 — Emerson pediu visão 360 completa após quick win
do dossiê.

## Documentos canônicos pareados (nesta pasta)

- [`CLIENTE_360-schema-geral.md`](./CLIENTE_360-schema-geral.md) — schema técnico geral (JSON consolidado, Prisma schema, blocos A-O, LGPD, retenção)
- [`CLIENTE_360-tela-cobranca-ativa.md`](./CLIENTE_360-tela-cobranca-ativa.md) — tela operacional para cliente ATIVO (12 cards, wireframe, JSON cobrança, botões calibrados por perfil DNA)
- [`CLIENTE_360-tela-recuperacao.md`](./CLIENTE_360-tela-recuperacao.md) — tela operacional para EX-CLIENTE (5 estágios Daniel + workflow Lucas paralelo, ROI obrigatório, prescrição CC 206)
- [`mockup-cobranca.html`](./mockup-cobranca.html) — mockup visual cobrança ativa (Tailwind, abrir no navegador)
- [`mockup-recuperacao.html`](./mockup-recuperacao.html) — mockup visual recuperação pós-cancelamento

**Origem:** documentos canônicos vêm do projeto `Consulta_ISP/agentes-sistema/` (sistema A — vendas). Stack lá é Next 15 + Hono + apps/web monorepo. **Stack aqui (c:\ClaudeCode\) é Caminho B: Vite + Express + Drizzle + Wouter mantidos.** Os specs descrevem o quê e o porquê; o como adapta pro stack atual.

---

## Três cenários distintos da mesma tela

A "Cliente 360" é, na verdade, **3 telas diferentes** dependendo do status do contrato:

### Cenário A — Cliente ATIVO (contrato vigente)

**Objetivo:** preservar relacionamento + recuperar receita preventivamente.

- **Agentes ativos:** Helena, Bruno, Rafael, Sofia, Pedro (todos)
- **Régua DNA:** A1-C3 calibra tom/cadência/desconto
- **Sofia:** agradece pagamentos
- **Pedro:** pesquisa NPS
- **Descontos máx:** até 30% policy
- **Tela completa:** `CLIENTE_360-tela-cobranca-ativa.md` (12 cards)

### Cenário B — Cliente SUSPENSO (D+15 Anatel, bloqueio temporário)

**Objetivo:** religar serviço via acordo amigável agressivo antes de virar cancelado.

- **Agentes ativos:** Carla (timeline Anatel 765), Rafael (acordos agressivos), Helena (inbound)
- **Régua DNA:** congelada no momento da suspensão
- **Descontos máx:** até 40% (8x sem juros)
- **Críticos:** janela <60s religamento pós-Pix (Spec 010 Religamento Inteligente)
- **Tela:** variante da `CLIENTE_360-tela-cobranca-ativa.md` com timeline regulatória destacada

### Cenário C — Cliente CANCELADO (ex-cliente, contrato encerrado)

**Objetivo:** recuperar dívida financeira (Daniel) + equipamento comodato (Lucas) dentro da lei, com ROI positivo.

- **Agentes ativos:** Daniel (recuperação financeira D+60+), Lucas (equipamentos)
- **Régua DNA:** congelada no perfil do cancelamento (não recalcula mais)
- **Descontos máx:** até 70% (autonomia maior — ex-cliente)
- **5 estágios Daniel:** amigável → anuência prévia CDC 43§2 → negativação SPC/Serasa → protesto → cessão/arquivar
- **Workflow Lucas paralelo:** Dia 0 (3 caminhos) → Dia 7 (downsell -10%) → Dia 15 (notificação formal) → Dia 30 (soma à negativação) → Dia 60 (pequenas causas)
- **ROI obrigatório:** se ROI < 0.3 → arquivar com fundamentação econômica
- **Loop ConsultaISP:** registrar evento de inadimplência é o moat principal
- **Tela completa:** `CLIENTE_360-tela-recuperacao.md` (13 cards distintos)

---

## Quick win JÁ implementado (não substitui esta spec)

**Estado atual em prod (2026-05-13):**
- `GET /api/customers/:id/profile` retornando customer + equipment + contracts
- `<CustomerProfilePanel>` renderizando 4 cards no `cliente-dossie.tsx`:
  Identidade & Contato, Localização, Cobrança & Contrato, Equipamentos
- Health Score 360 com branch lógica `contractStatus`:
  - active → Helena/Bruno/Rafael/Sofia
  - cancelled → Lucas/Daniel + banner "Risco já materializado"
  - suspended → Carla/Rafael

**Cobertura atual: ~15% da visão completa.**

Falta tudo o que está nos documentos canônicos: 12 cards estruturados, predições ML, score Marcos, timeline régua, audit Júlia, alertas críticos contextuais, ROI, loop Consulta ISP.

---

## Roadmap de execução proposto

### Fase 1 — Schema + Fundação (4-5 dias)

**Pré-requisito:** autorização do owner para adicionar tabelas (CLAUDE.md §13.1).

**Novas tabelas necessárias:**
- `customer_health_snapshots` (Spec 010A já pedida)
- `regra_pauses` — pausas manuais + auto (vulnerável, Súmula 548)
- `customer_portfolio_assignments` — carteira atribuída ao operador
- `customer_tasks` — tasks humanas (queda fiel → liga, etc)
- `legal_notifications` (Spec 010 Carla — Anatel 765)
- `next_action_recommendations` (Spec 011 Marcos — RESOURCES R6)
- `provedor_index_snapshots` (Spec 011 Marcos — RESOURCES R7)
- `recovery_stage_events` — log dos 5 estágios Daniel para ex-clientes
- `equipment_recovery_attempts` — log workflow Lucas (Dia 0/3/7/15/30/60)

**Migrações Drizzle + rollback testado em staging.**

### Fase 2 — MK Connector v3 (3-4 dias)

Persiste **contracts** + **invoices** + **ordens_servico** + **payments_history** ao sincronizar (hoje só agrega no customer). Necessário pra:
- Card de faturas com cálculo Anatel 765 art. 88 real
- Histórico financeiro 12m
- Padrão de pagamento em NL
- Anuência prévia CDC 43§2 com prova de entrega

### Fase 3 — Tela Cobrança Ativa MVP (5-7 dias)

Implementa 6 cards prioritários:
1. Header completo + alertas críticos
2. Régua DNA aplicada (já calcula no health-360, falta UI)
3. Predições ML (heurísticas v1 já existem no calculator)
4. Situação financeira detalhada com cálculo Anatel
5. Próximas ações sugeridas (precisa Marcos Spec 011 mínimo)
6. Timeline régua em execução

Wireframe: `mockup-cobranca.html` é a referência visual exata.

### Fase 4 — Tela Recuperação Pós-Cancelamento (5-7 dias)

Implementa 7 cards específicos do cenário C:
1. Header ex-cliente + análise post-mortem
2. Histórico de recuperação (tentativas + outcomes)
3. **Decisão econômica ROI (card central)** — `valor × prob - custo` por estágio
4. Dívida equipamentos Lucas (com alerta revenda ilegal via Consulta ISP)
5. Timeline 5 estágios + paralelo Lucas
6. Compliance ex-cliente (prescrição CC 206 + falecido + fraude)
7. Loop Consulta ISP (moat estratégico)

Wireframe: `mockup-recuperacao.html`.

### Fase 5 — Predições ML reais (5+ dias, opcional)

Substitui heurísticas v1 por modelos treinados (regressão logística → gradient boosting). Dataset: 12 meses de histórico do tenant piloto.

### Fase 6 — Diferenciação comercial (3-5 dias)

- Botões de ação calibrados por perfil DNA (~18 ações distintas, ver tabela em `CLIENTE_360-tela-cobranca-ativa.md` §5)
- Anti-padrões legais aplicados (CDC 39 V, 42, 71, Súmulas 359/548, CC 206)
- Audit log Júlia visível em cada bloqueio

**Total: 25-35 dias-pessoa para 3 telas completas.**

---

## Próximos passos imediatos (ordem)

1. **Owner autoriza schema** — sem isso, fase 1 trava
2. **Confirmar mockups** — `mockup-cobranca.html` + `mockup-recuperacao.html` representam a visão? Ajustes antes de codar?
3. **Spec 011 Marcos** — pré-requisito de "próximas ações sugeridas". Ou implementamos heurística v1 enquanto não tem Marcos completo?
4. **Schema da Régua DNA + ML** — onde armazenamos perfil A1-C3 + predicted_probability? Ainda não há tabelas
5. **Definir tenant piloto** — Vertical Fibra ou NsLink primeiro? Cliente real pra UAT iterar

---

## Métricas norte (de `CLIENTE_360-tela-recuperacao.md` §10)

### Recuperação Daniel
- D+60-D+90: ≥ 25%
- D+60-D+180: ≥ 40%
- Custo por R$ recuperado: ≤ R$ 0,15
- 0 violações Súmula 548/359

### Equipamentos Lucas
- Devolução voluntária: ≥ 50% (mercado é 15-25%)
- Recuperação total valor: ≥ 75%
- 0 cobrança valor > mercado (CDC 39 V)

### Sistêmicas
- ROI médio recuperação: ≥ 1.5×
- 100% casos arquivados com fundamentação econômica
- 100% negativações registradas no Consulta ISP (moat)

---

## Compliance legal hardcoded (anti-padrões)

Os documentos canônicos listam **12 práticas proibidas** que precisam ser bloqueadas pela Júlia:

1. Cobrança ostensiva diária — CDC 42 (limite 1×/semana mesmo canal)
2. Ameaça de judicialização sem ação real — CDC 71 (crime)
3. Negativação antes de 10 dias úteis — Súmula 359 STJ
4. Não baixar em 5 dias úteis após pagamento — Súmula 548 STJ + Lei 12.039
5. Cobrança de dívida prescrita — CDC 71 (crime, detenção 3m-1a)
6. Cobrança equipamento > valor mercado — CDC 39 V
7. Ignorar sinal vulnerável — Lei 14.181/2021
8. Cobrança de familiar/empregador — CDC 42 explícito
9. Cobrança em incidente técnico ativo — boa-fé objetiva
10. Spam de marketing a ex-cliente irritado — ofende intimidade
11. Linguagem agressiva ("caloteiro", "vamos meter SPC") — vexatória CDC 71
12. CPF completo na tela sem audit — LGPD princípio mínimo

Cada uma vira **gate da Júlia** com fundamentação legal apresentada ao operador quando bloqueia ação.

---

Pareado com:
- `CLAUDE.md` §1 — princípios produto
- `RESOURCES.md` R6 (Next Action), R7 (Provedor Index)
- `TEAM.md` §4.1 (Marcos), §4.5 (Rafael), §4.6 (Carla), §4.7 (Daniel), §4.8 (Lucas)
- `DESIGN.md` §3 (tokens), §7 (cards), §4.1 (navegação)
