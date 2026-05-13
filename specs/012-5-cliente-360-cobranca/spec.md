# Spec 012.5 — Cliente 360º (tela de Cobrança Operacional)

**Status:** Aguardando autorização schema + design completo.
**Estimativa:** ~16 dias-pessoa (per spec do `Consulta_ISP/agentes-sistema/`).
**Sessão de origem:** 2026-05-13 — Emerson pediu visão 360 completa após quick win
do dossiê.

## Quick win JÁ implementado (parcial — não substitui esta spec)

- `GET /api/customers/:id/profile` retornando customer + equipment + contracts
- `<CustomerProfilePanel>` renderizando 4 cards no `cliente-dossie.tsx`:
  Identidade & Contato, Localização, Cobrança & Contrato, Equipamentos
- Princípios aplicados: CPF/telefone mascarado, status do contrato como badge,
  densidade calculada, tolerante a dados vazios

O quick win cobre **20%** da visão. Esta spec descreve os outros **80%**.

---

## 1. Princípios da tela

1. **Decisão em 3 segundos.** Ao abrir a tela, operador deve entender em <3s: este cliente PODE ser cobrado agora? Se sim, COMO? Se não, POR QUÊ?

2. **Bloqueios sangram primeiro.** Se há flag de compliance (vulnerável/binding/prescrita/Procon/chamado técnico aberto), o **TOPO** mostra em vermelho/âmbar + bloqueia ações restritivas. Operador não precisa "encontrar" o bloqueio, ele aparece de cara.

3. **Histórico → presente → futuro.** Esquerda: o que aconteceu (timeline). Centro: situação atual (números). Direita: próximas ações sugeridas pelo Score & Decisão.

4. **Ações calibradas por perfil.** Botões de ação variam conforme Régua DNA. Cliente A3 não tem botão "Negativar". Cliente C3 não tem botão "Desconto 30%" antes de D+60.

5. **Auditoria visível.** Cada ação mostra: quem (qual funcionário/agente), quando, base legal. Toda decisão Júlia bloqueada aparece com motivo + lei citada. Provedor SENTE que está protegido.

6. **Densidade calculada.** Operador trabalha 8h/dia na tela. Tipografia DM Sans 14px, tabelas compactas, ícones 16px. Sem cards gigantes desperdiçando espaço.

7. **Mobile NÃO é prioridade no admin.** Esta tela é desktop-first. Cliente final (assinante) é mobile-first, mas é OUTRA tela (renegocia.isp).

---

## 2. Estrutura de 12 cards

### Header (sticky topo)
- Nome + CPF mascarado + idade + cidade/UF + bairro
- Telefones (mascarados) + email
- Tempo de relação + perfil Régua DNA (A1-C3) + comparação 30d atrás
- Saldo devedor + qty faturas + dias atraso mais antiga
- Status contrato + última interação (canal/sentiment)
- Tabs: Ações | Histórico | Conversas | Compliance | Configurar
- Alertas no header: 🟠 queda fiel A3→B3, 🚨 Procon aberto, 🛡️ vulnerável confirmado

### Coluna esquerda (40%)
1. **Alertas críticos** — máx 5 visíveis com ação rápida (queda fiel, sinal vulnerável, incidente POP, acordo quebrado, geo-cluster)
2. **Régua DNA aplicada** — perfil + 30d atrás + tom/cadência/canal/desconto/parcelas/retenção/humano-obrigatório
3. **Predições ML & scores** — prob pagamento, prob churn, prob Procon, LTV, Consulta ISP, SPC, Serasa, ROI estimado
4. **Status técnico** — link, sinal ONU, uptime, POP, último incidente, chamados abertos. Bloqueio de cobrança se chamado técnico aberto.
5. **Equipamentos comodato** — lista com valor de reposição. Útil pro Lucas.
6. **Flags de compliance** — vulnerável, binding, super endividado, menor idade, prescrita CC 206, serviço essencial, pausa Súmula 548, falecido

### Coluna direita (60%)
7. **Situação financeira detalhada** — saldo + lista de faturas em aberto com cálculo Anatel 765 art. 88 (principal + multa 2% + juros 1%/mês) + botões Gerar Pix / 2ª via / Negociar. Histórico: último pagamento, padrão (NL), taxa atraso 12m, valor pago acumulado.
8. **Próximas ações sugeridas** — output Score & Decisão Marcos com 3 ações ranqueadas por ROI + ❌ não-recomendadas com razão
9. **Linha do tempo** — últimas 10 interações (mensagens + eventos + pagamentos + incidentes) com filtros agent/canal/sentiment

### Rodapé full-width
10. **Régua em execução** — timeline horizontal D-5 a D+60 com marcos cumpridos/pausados/futuros + base legal Anatel
11. **Auditoria recente Júlia** — últimas 5 decisões (APROVADO/COM_AJUSTE/BLOQUEADO) com base legal

---

## 3. JSON payload completo (referência)

Endpoint: `GET /api/customers/:id/cobranca` — retorna estrutura tipada com 24
seções (header, alertas_críticos, régua_dna, financeiro, predições_ml,
scores_externos, status_técnico, equipamentos_comodato, flags_compliance,
timeline_comunicação, régua_em_execução, próximas_ações_sugeridas,
nao_recomendado, auditoria_recente, carteira, tasks_abertas, metadados).

Ver versão completa do spec funcional em
`C:\ClaudeCode\Consulta_ISP\agentes-sistema\mockups\` + arquivos referenciados:
- `CLIENTE_360_COBRANCA.md` (funcional, ~300 linhas)
- `cliente-360-cobranca.html` (mockup visual)
- componentes-react.md (inventário 28 componentes, ~1000 linhas)
- backend-routes.ts (11 endpoints REST tipados Hono)

**Importante:** o repositório `agentes-sistema/` é o sistema A (vendas) com
stack diferente (Next 15 + Hono + apps/web monorepo). Esta spec descreve
adaptação pro stack atual do `c:\ClaudeCode\` (Vite + Express + Drizzle +
Wouter — Caminho B confirmado em 2026-05-11).

---

## 4. Botões de ação calibrados por perfil DNA

| Ação | Disponibilidade | Quem aprova | Validação Júlia |
|---|---|---|---|
| Gerar Pix | sempre | autônomo agente | horário + opt-out |
| Gerar 2ª via boleto | sempre | autônomo | horário + opt-out |
| Lembrete amigável | sempre (não em chamado técnico aberto) | autônomo | horário + opt-out + janela 24h |
| Desconto ≤5% | autônomo Rafael (D+1 a D+14) | Rafael | policy do tenant |
| Desconto 5-15% | Score ConsultaISP >600 + 12m+ pagando | Rafael pré-aprovado | policy + histórico |
| Desconto 15-30% | requer aprovação humana | Marcos → owner | tarefa humana |
| Parcelamento até 3x | D+11 a D+14 | Rafael autônomo | policy |
| Parcelamento até 12x (vulnerável) | flag_vulneravel=true | Rafael humanizado | Lei 14.181 |
| Notificação formal Anatel D+12 | D-1, D+3, D+7 enviados | Carla | Anatel 765 art. 84 IV |
| Suspensão parcial D+15 | anuência ≥15d + Júlia OK | Carla | Anatel 765 + Júlia |
| Anuência negativação D+30 | após D+15 cumprido | Daniel | CDC 43§2 + Súmula 359 |
| Negativação SPC/Serasa | anuência 10 dias úteis + Júlia OK | Daniel | Súmula 359 + valor mín R$ 50 |
| Excluir negativação após pagamento | obrigatório 5 dias úteis | Daniel cron | Súmula 548 STJ + Lei 12.039 |
| Protesto cartório | D+121-D+180, dívida >R$ 200, ROI+ | Daniel + humano | sem disputa judicial |
| Pausar régua manual | qualquer momento | Marcos/operador humano | audit log |
| Confirmar vulnerável | apenas humano | humano | flag persistente + Lei 14.181 |
| Pausa Súmula 548 | cliente alega "já paguei" | Helena automático | Súmula 548 STJ |
| Escalar humano | qualquer momento | qualquer agente | audit |

---

## 5. Endpoints REST (a implementar)

```
GET    /api/customers/:id/cobranca           → JSON completo (24 seções)
GET    /api/customers/:id/cobranca/header    → só header
GET    /api/customers/:id/cobranca/alertas   → só alertas
GET    /api/customers/:id/cobranca/timeline?limit=10&agent=&channel=
POST   /api/customers/:id/actions/pausar-regua → { duracao_dias }
POST   /api/customers/:id/actions/confirmar-vulneravel
POST   /api/customers/:id/actions/escalar-humano → { motivo, prazo }
POST   /api/customers/:id/actions/gerar-pix → { fatura_id }
POST   /api/customers/:id/actions/gerar-2via → { fatura_id }
POST   /api/customers/:id/actions/proposta-rafael → { tipo, parcelas, desconto_pct }
POST   /api/customers/:id/actions/notificacao-anatel-d12 → Carla
POST   /api/customers/:id/actions/suspender-d15 → Carla + Júlia gate
POST   /api/customers/:id/actions/anuencia-d30 → Daniel
POST   /api/customers/:id/actions/negativar-d40 → Daniel + Júlia gate
POST   /api/customers/:id/actions/baixar-negativacao → Daniel
GET    /api/customers/:id/cobranca/proximas-acoes → output Score & Decisão (Marcos)
```

Toda mudança de estado registrada em `audit_logs` com: timestamp, agente/operador,
ação, antes/depois, fundamentação legal.

---

## 6. Schema novo necessário (requer autorização)

- `customer_health_snapshots` (Spec 010A já solicitada — Carla blocking)
- `regra_pauses` — pausas manuais ou automáticas (vulnerável, Súmula 548, incidente)
- `customer_portfolio_assignments` — carteira atribuída ao operador
- `customer_tasks` — tasks atribuídas pra humano (queda fiel → ligar pessoalmente)
- `legal_notifications` (Spec 010 Carla — Anatel 765)
- `next_action_recommendations` (Spec 011 Marcos — RESOURCES R6)
- `provedor_index_snapshots` (Spec 011 Marcos — RESOURCES R7)

---

## 7. Dependências de outros agentes/módulos

- **Marcos** (Spec 011) — Score & Decisão com ROI ranking
- **Rafael** (Spec 009) — Negociação D+1 a D+14 com policy DNA
- **Carla** (Spec 010) — Anatel 765 D+15+ + Religamento <60s
- **Daniel** (Spec 012) — Recuperação D+60+ com Súmula 359/548
- **Lucas** (Spec 013) — Recuperação equipamento comodato
- **Júlia** (Spec 003 ✅) — Compliance gate ATIVA
- **Helena** (Spec 003 ✅) — Atendimento inbound + Memory ATIVA
- **Bruno** (Spec 004) — Lembrete pré-vencimento (OFF em prod, aguardando HSM)
- **Sofia** (Spec 004) — Agradecimento pagamento (OFF, aguardando HSM)

---

## 8. Métricas norte

- Tempo médio operador resolve um caso: **≤ 3 minutos**
- % decisões tomadas com pleno contexto: **≥ 95%**
- % ações bloqueadas pela Júlia que o operador entendeu o motivo (não recorre): **≥ 90%**
- NPS interno do operador sobre a tela: **≥ 70**
- Carga cognitiva (tempo hesitação antes decidir): tendência decrescente

---

## 9. Anti-padrões — o que NÃO mostrar

- ❌ Vermelho agressivo em tudo. Vermelho-terra apenas para vedação real legal.
- ❌ Botão "Negativar" sempre habilitado. Habilitar APENAS quando todos gates legais verdes.
- ❌ CPF completo na tela. Sempre mascarado, reveal por 5s com audit.
- ❌ Linguagem agressiva. "Caloteiro" → "Cliente em atraso".
- ❌ Esconder bloqueios da Júlia. Topo + razão clara.
- ❌ Cards gigantes ocupando tela toda. Densidade calculada.
- ❌ Histórico de tudo na primeira tela. Últimas 10 + link "ver todas".
- ❌ Telefone clicável sem confirmação. Modal "Ligar para [nome]?".
- ❌ Esconder ROI / custo da ação. Operador deve ver custo de cada decisão.
- ❌ Predições ML como certeza. Sempre com classificação verbal (BAIXO/MÉDIO/ALTO).

---

## 10. Próximos passos pra executar esta spec

1. **Autorizar schema** das 7 tabelas novas (CLAUDE.md §13.1)
2. **Spec 011 Marcos** (orquestrador) em produção — pré-requisito de "próximas ações sugeridas" calibradas
3. **MK connector v3** persistir contracts + invoices (hoje só agrega no customer) — Quick win 30min via probe-mk-endpoints.ts (já temos os endpoints corretos descobertos)
4. **Spec dedicada do componente `<CustomerProfilePanel>` v2** com timeline + predições + flags + Score Decisão
5. **Backend endpoint `GET /api/customers/:id/cobranca`** consolidando 24 seções
6. **UI redesign** seguindo wireframe ASCII do spec original
7. **Mockup visual review** com Emerson antes de codar
8. **Testes E2E** com 1 cliente real (Carla Aparecida, cd=63, 570d atraso)

Pareado com:
- `CLAUDE.md` §1 — princípios produto
- `RESOURCES.md` R6 (Next Action Recommendation), R7 (Provedor Index)
- `TEAM.md` §4.1 (Marcos), §4.5 (Rafael), §4.6 (Carla), §4.7 (Daniel), §4.8 (Lucas)
- `DESIGN.md` §3 (tokens), §7 (cards), §4.1 (navegação)
