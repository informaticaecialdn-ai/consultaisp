# Cliente 360° — Cobrança (operacional)

> Tela/payload otimizado para **decisão de cobrança**. Subset acionável do
> Cliente 360° completo. Mostra ao operador/agente em UMA tela tudo que ele
> precisa para decidir: cobrar agora? como? quanto? por qual canal? ou pausar?

**Audiência**: Bruno, Rafael, Carla, Daniel (agentes) + Operador humano financeiro do tenant.

**Pareado com**: CLIENTE_360.md (versão completa), DESIGN.md (specs visuais).

---

## 1. Princípios da tela

1. **Decisão em 3 segundos.** Ao abrir a tela, operador deve entender em <3s: este cliente PODE ser cobrado agora? Se sim, COMO? Se não, POR QUÊ?

2. **Bloqueios sangram primeiro.** Se há flag de compliance (vulneravel/binding/prescrita/Procon/chamado técnico aberto), o **TOPO** mostra em vermelho/âmbar + bloqueia ações restritivas. Operador não precisa "encontrar" o bloqueio, ele aparece de cara.

3. **Histórico → presente → futuro.** Esquerda: o que aconteceu (timeline). Centro: situação atual (números). Direita: próximas ações sugeridas pelo Score & Decisão.

4. **Ações calibradas por perfil.** Botões de ação variam conforme Régua DNA. Cliente A3 não tem botão "Negativar". Cliente C3 não tem botão "Desconto 30%" antes de D+60.

5. **Auditoria visível.** Cada ação mostra: quem (qual funcionário/agente), quando, base legal. Toda decisão Júlia bloqueada aparece com motivo + lei citada. Provedor SENTE que está protegido.

6. **Densidade calculada.** Operador trabalha 8h/dia na tela. Tipografia DM Sans 14px, tabelas compactas, ícones 16px. Sem cards gigantes desperdiçando espaço.

7. **Mobile NÃO é prioridade no admin.** Esta tela é desktop-first. Cliente final (assinante) é mobile-first, mas é OUTRA tela (renegocia.isp).

---

## 2. Layout geral (wireframe ASCII)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ HEADER (sempre fixo, 80px altura)                                            │
│                                                                              │
│ 👤 Maria Silva Souza         CPF 123.***.**-12     📍 Centro/Cambé-PR        │
│    Cliente desde Ago/2023 (32m)  📞 +55 11 *****1234  ✉️ maria@exemplo.com   │
│                                                                              │
│ 🟠 PERFIL B3 (era A3 30 dias atrás)  ⚠️ ALERTA QUEDA FIEL — Marcos sugeriu   │
│ 💰 R$ 179,80 em aberto (2 faturas) | 📅 Mais antiga: 32 dias atraso          │
│ 🔌 Serviço ATIVO  | Último contato: há 2 dias (WhatsApp, sentiment -0.1)     │
│                                                                              │
│ [✅ AÇÕES] [📋 Histórico] [💬 Conversas] [⚖️ Compliance] [⚙️ Configurar]    │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────┬──────────────────────────────────────────┐
│ COLUNA ESQUERDA (40%)            │ COLUNA DIREITA (60%)                     │
│                                  │                                          │
│ ⚠️ ALERTAS CRÍTICOS              │ 💰 SITUAÇÃO FINANCEIRA                  │
│ ┌──────────────────────────────┐ │ ┌──────────────────────────────────────┐ │
│ │ • A3 → B3 (30d atrás)        │ │ │ Saldo devedor       R$ 179,80        │ │
│ │   → Marcos liga PESSOAL      │ │ │ Faturas em aberto   2                │ │
│ │ • Cliente disse "tá apertado"│ │ │                                      │ │
│ │   há 4 dias — sinal vulnerab.│ │ │ ┌──────────────────────────────────┐ │ │
│ │   (não confirmado ainda)     │ │ │ │ Fat #4521 | Venc 10/04 (D+32)    │ │ │
│ └──────────────────────────────┘ │ │ │ Principal R$ 89,90               │ │ │
│                                  │ │ │ Multa 2%   R$  1,80              │ │ │
│ 🎯 RÉGUA DNA — B3                │ │ │ Juros 1.07%R$  0,96              │ │ │
│ ┌──────────────────────────────┐ │ │ │ ───────────────                  │ │ │
│ │ Tom:        extra-gentle     │ │ │ │ TOTAL      R$ 92,66              │ │ │
│ │ Cadência:   gentle pause     │ │ │ │ [Gerar Pix] [Gerar 2ª via]       │ │ │
│ │ Canal:      WhatsApp + voz   │ │ │ └──────────────────────────────────┘ │ │
│ │ Desconto:   até 25%          │ │ │ ┌──────────────────────────────────┐ │ │
│ │ Parcelas:   até 12x          │ │ │ │ Fat #4587 | Venc 10/05 (D+2)     │ │ │
│ │ Retenção:   downgrade temp.  │ │ │ │ Principal R$ 89,90               │ │ │
│ │ Humano:     OBRIGATÓRIO      │ │ │ │ Multa+Juros R$  0,06             │ │ │
│ └──────────────────────────────┘ │ │ │ TOTAL      R$ 89,96              │ │ │
│                                  │ │ │ [Gerar Pix] [Gerar 2ª via]       │ │ │
│ 📊 PREDIÇÕES & SCORES            │ │ └──────────────────────────────────┘ │
│ ┌──────────────────────────────┐ │ │                                      │
│ │ Prob pagamento prox. fatura: │ │ │ Último pagamento: 08/03/2026         │
│ │   62% ████░░░░░ MÉDIO        │ │ │   R$ 89,90 via Pix                   │
│ │                              │ │ │                                      │
│ │ Prob churn 60d:              │ │ │ Padrão histórico: paga sempre        │
│ │   45% ███████░░ ALTO         │ │ │   entre dia 8-12 (32 meses)          │
│ │                              │ │ │   Primeira vez atrasou >7 dias       │
│ │ Prob Procon 30d:             │ │ │                                      │
│ │    5% █░░░░░░░░ BAIXO        │ │ │ Taxa atraso 12m: 8% (1 ocorrência)   │
│ │                              │ │ │ Média dias atraso: 4 dias            │
│ │ LTV próximos 24m:            │ │ │ Valor pago acumulado 12m: R$ 1078,80 │
│ │   R$ 2.157,60 ⭐⭐⭐           │ │ └──────────────────────────────────────┘ │
│ │                              │ │                                          │
│ │ Score Consulta ISP:     720  │ │ 💬 LINHA DO TEMPO (últimas 10)          │
│ │ SPC:                limpo    │ │ ┌──────────────────────────────────────┐ │
│ │ Serasa:             limpo    │ │ │ 10/05 19:30 ← cliente: "Tô apertado  │ │
│ │ ROI cobrança estimado: 8.3x  │ │ │            esse mês. Dá pra esperar  │ │
│ └──────────────────────────────┘ │ │            até dia 20?" (sent -0.1)  │ │
│                                  │ │ │ 10/05 19:35 → Helena: "Entendo,    │ │
│ 🔌 SITUAÇÃO TÉCNICA              │ │ │            sem estresse. Vou abrir │ │
│ ┌──────────────────────────────┐ │ │ │            opção pra você falar    │ │
│ │ Link:         ATIVO ✅        │ │ │            com Rafael. Em 1 min."  │ │
│ │ Sinal ONU:    BOM (-22 dBm)  │ │ │ 08/05 14:20 ← incidente POP-3        │ │
│ │ Uptime 30d:   99.8%          │ │ │            90 min downtime           │ │
│ │ POP:          POP-3          │ │ │ 05/05 09:00 → Bruno: lembrete D-5    │ │
│ │ Último inc.:  08/05 (90min)  │ │ │ 02/05 19:00 ← cliente: pergunta NPS  │ │
│ │ Chamados:     nenhum aberto  │ │ │ ...                                  │ │
│ │                              │ │ │ [Ver todas 47 interações →]          │ │
│ │ ⚠️ POP-3 caiu 08/05 90min    │ │ └──────────────────────────────────────┘ │
│ │   considerar antes de cobrar │ │                                          │
│ └──────────────────────────────┘ │ 🎬 PRÓXIMAS AÇÕES SUGERIDAS              │
│                                  │ ┌──────────────────────────────────────┐ │
│ 📦 EQUIPAMENTOS                  │ │ Marcos (Score & Decisão) recomenda:  │ │
│ ┌──────────────────────────────┐ │ │                                      │ │
│ │ ONU ZTE F660                 │ │ │ 1. ⭐ HUMANO LIGAR PESSOALMENTE        │ │
│ │   Serial ZTE-XYZ-123         │ │ │    cliente A3 → B3 (queda fiel)      │ │
│ │   Comodato (R$ 175 reposição)│ │ │    Carlos Operador (atribuído)       │ │
│ │ Roteador TP-Link AC1200      │ │ │    Próximos 24h, horário comercial   │ │
│ │   Comodato (R$ 80 reposição) │ │ │    [Atribuir task]                   │ │
│ │ Total: R$ 255 se não devolver│ │ │                                      │ │
│ └──────────────────────────────┘ │ │ 2. Rafael oferecer downgrade temp:  │ │
│                                  │ │    100Mbps R$ 69,90 por 3 meses     │ │
│ ⚖️ FLAGS DE COMPLIANCE           │ │    reverte automático               │ │
│ ┌──────────────────────────────┐ │ │    [Gerar proposta]                 │ │
│ │ Vulnerável (14.181):  ⚠️ SUSP.│ │ │                                      │ │
│ │   "tô apertado" 4 dias atrás │ │ │ 3. Pausar régua automática 7 dias    │ │
│ │   [Confirmar vulneravel]     │ │ │    enquanto humano resolve           │ │
│ │ Binding (Procon):     OK     │ │ │    [Pausar até 19/05]                │ │
│ │ Super endividado:     OK     │ │ │                                      │ │
│ │ Menor de idade:       OK     │ │ │ ❌ NÃO RECOMENDADO agora:            │ │
│ │ Prescrita (CC 206):   OK     │ │ │   - Cobrança ostensiva (B3 fragiliza)│ │
│ │ Serviço essencial:    n/a    │ │ │   - Suspensão D+15 (cliente fiel)    │ │
│ │ Pausa Súmula 548:     n/a    │ │ │   - Desconto >25% (acima policy)     │ │
│ │ Alegou pagamento:     não    │ │ │                                      │ │
│ └──────────────────────────────┘ │ │ Estimativa econômica:                │ │
│                                  │ │   Custo ação humana: R$ 5,00         │ │
│                                  │ │   Valor esperado: R$ 152,80          │ │
│                                  │ │   ROI: 30.6x                         │ │
│                                  │ └──────────────────────────────────────┘ │
└──────────────────────────────────┴──────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚖️ RÉGUA EM EXECUÇÃO (timeline horizontal)                                   │
│                                                                              │
│   D-5   D-3   D-1   D+0   D+1   D+3   D+7   D+10   D+12  D+14  D+15  D+30   │
│    ●     ●     ●     │     │     │     ▲      ◯      ◯     ◯     ◯     ◯     │
│  Bruno Bruno Bruno  venc  pago  pago  Cliente Rafael Carla Carla Carla Daniel│
│                                       inbound oferta notif  reforço suspende │
│                                       (10/05) (sugest) (D-3) (SMS+voz) D+15  │
│                                                                              │
│   ✅ Bruno D-5/D-3/D-1 enviados (3 lembretes preventivos)                    │
│   ✅ Vencimento 10/05 não pago (D+2 hoje)                                    │
│   ⏸️ PAUSA AUTOMÁTICA — flag vulnerável suspeita (4 dias atrás)              │
│   📍 PRÓXIMO: Humano liga (24h) | OU Rafael oferece downgrade D+5            │
│                                                                              │
│   D+12 Carla: NOTIFICAÇÃO PRÉVIA Anatel — anuência 30/05                     │
│   D+15 Carla: SUSPENSÃO PARCIAL automática (se Júlia liberar)                │
│   D+30 Daniel: anuência negativação SPC/Serasa (Súmula 359)                  │
│   D+40 Daniel: NEGATIVAÇÃO (10 dias úteis vencidos, se Júlia liberar)        │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 🛡️ AUDITORIA RECENTE (Júlia)                                                 │
│                                                                              │
│ 10/05 19:31  ⚠️ APROVADO COM AJUSTE  Helena.send_freeform_message            │
│              motivo: cliente B3 (queda fiel) — sugerido escalar Marcos       │
│              fonte: Régua DNA policy B3.human_intervention_required          │
│                                                                              │
│ 10/05 19:35  ✅ APROVADO  Helena.send_freeform_message (resposta inbound)    │
│              fonte: janela 24h ativa + sem violações compliance              │
│                                                                              │
│ Ver todas decisões neste cliente (47) →                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Cards detalhados

### Card 1 — HEADER (sempre visível)

**Conteúdo:**
- Nome + CPF mascarado
- Idade do cliente (anos)
- Cidade/UF + bairro
- Telefones + e-mail (mascarados quando expostos em logs/audit)
- Tempo de relação (meses + visualização "Cliente desde")
- Perfil Régua DNA atual + comparação 30 dias atrás
- Saldo devedor total + número de faturas em aberto
- Dias de atraso da fatura mais antiga
- Status do contrato (ativo/suspenso parcial/suspenso total/cancelado)
- Última interação (canal, direção, data, sentiment)
- Tabs: Ações | Histórico | Conversas | Compliance | Configurar

**Cores semânticas:**
- Verde: cliente A1/A2/A3 ok
- Âmbar: B1/B2/**B3 (com alerta especial)**
- Vermelho-terra: C1/C2/C3 ou flag binding/Procon
- Cinza: prescrita/cancelado

**Alertas no header:**
- 🟠 "QUEDA FIEL" se old_profile_30d=A3 e perfil_atual=B3
- 🚨 "PROCON ABERTO" se flag_binding=true
- 🛡️ "VULNERÁVEL CONFIRMADO" se flag_vulneravel=true
- ⏸️ "PAUSA SÚMULA 548 até DD/MM" se cliente alegou pagamento

### Card 2 — ⚠️ ALERTAS CRÍTICOS (esquerda topo)

Mostra **TODOS** os sinais que devem influenciar a decisão de cobrança:

```
• A3 → B3 detectado em 12/05 (Marcos liga PESSOAL recomendado)
• Cliente disse "tá apertado esse mês" há 4 dias (sinal vulnerável NÃO confirmado)
• Incidente POP-3 em 08/05 (90min downtime) — afetou este cliente
• Acordo anterior quebrado em 02/2025 (cuidado com novo acordo)
• Geo-cluster ativo no bairro Centro (5+ inadimplentes em raio 500m)
```

**Regras:**
- Máximo 5 alertas visíveis. Resto em "Ver mais alertas".
- Cada alerta tem [ação rápida]: confirmar vulnerável, pausar régua, escalar Marcos.

### Card 3 — 🎯 RÉGUA DNA — perfil aplicado

| Campo | Valor |
|---|---|
| Perfil atual | B3 |
| Perfil 30d atrás | A3 (⚠️ caiu) |
| Tempo relação | 32 meses |
| Taxa atraso 12m | 8% (1 de 12) |
| Média dias atraso | 4 dias |
| **Tom recomendado** | **extra-gentle** |
| **Cadência** | **gentle pause** |
| **Canal primário** | **WhatsApp** |
| **Canal fallback** | **Voz (humano)** |
| **Desconto máximo** | **25%** |
| **Parcelas máximas** | **12x** |
| **Oferta retenção** | **downgrade temp 3m** |
| **Humano obrigatório** | **SIM** |

### Card 4 — 💰 SITUAÇÃO FINANCEIRA (centro topo)

**Resumo:**
- Saldo devedor total (centavos formatado BRL)
- Número de faturas em aberto
- Fatura mais antiga (data venc + dias atraso)

**Detalhe por fatura (lista):**
```
Fatura #4521 | Vencimento 10/04/2026 (D+32)
  Principal:      R$ 89,90
  Multa 2%:       R$  1,80
  Juros 1.07%:    R$  0,96  ← (32 dias × 1%/30 = 1.07%)
  ─────────────────
  TOTAL ATUAL:    R$ 92,66
  [Gerar Pix] [Gerar 2ª via] [Negociar]
```

**Histórico financeiro do cliente:**
- Último pagamento (data, valor, forma)
- Padrão histórico (descrição em linguagem natural):
  > "Paga sempre entre dia 8-12. 32 meses sem atraso > 7 dias. Primeira vez agora."
- Taxa atraso 12m + média dias
- Valor pago acumulado 12m

**Indicador visual ao topo:**
- 🟢 "Pagador exemplar" se A1/A2/A3
- 🟡 "Pagador oscilante" se B1/B2/B3
- 🔴 "Pagador problemático" se C1/C2/C3

### Card 5 — 📊 PREDIÇÕES & SCORES

**Predições ML (com barra visual):**
- Probabilidade pagamento próxima fatura: 62% MÉDIO
- Probabilidade churn 60 dias: 45% ALTO
- Probabilidade Procon 30 dias: 5% BAIXO
- LTV próximos 24 meses: R$ 2.157,60 ⭐⭐⭐

**Scores externos:**
- Score Consulta ISP (rede colaborativa): 720
- Status SPC: limpo
- Status Serasa: limpo
- Eventos negativos em outros provedores: 0

**ROI estimado da cobrança:**
- Valor esperado = saldo × prob_pagamento
- Custo estimado (varia por agente)
- ROI = (valor_esperado - custo) / custo
- Recomendação automática:
  - ROI > 5: 🟢 alta prioridade
  - ROI 2-5: 🟡 média
  - ROI 1-2: 🟠 baixa
  - ROI < 1: 🔴 ARQUIVAR

### Card 6 — 🔌 SITUAÇÃO TÉCNICA (cruzamento NMS)

| Campo | Valor | Alerta |
|---|---|---|
| Link | ATIVO ✅ | OK |
| Sinal ONU | -22 dBm | BOM |
| Uptime 30d | 99.8% | OK |
| SLA pago | 99.5% | acima da meta |
| POP | POP-3 | (clicável → detalhe POP) |
| Último incidente | 08/05 (90min) | ⚠️ recente |
| Chamados abertos | nenhum | OK |

**Alertas técnicos importantes para cobrança:**
- 🚨 "Chamado técnico aberto" → BLOQUEIA cobrança automática (cliente não está usando o serviço)
- ⚠️ "Incidente POP nas últimas 72h" → considerar dar tempo antes de cobrar
- ⚠️ "Sinal crítico (<-28 dBm)" → cliente pode estar tendo problemas que justificam atraso

### Card 7 — ⚖️ FLAGS DE COMPLIANCE (lateral esquerda)

Lista de TODAS as flags relevantes:

| Flag | Status | Detalhe / ação |
|---|---|---|
| Vulnerável (Lei 14.181) | ⚠️ SUSPEITA | "tô apertado" 4d atrás. [Confirmar] |
| Binding (Procon/jurídico) | ✅ OK | nenhum |
| Super endividado | ✅ OK | sem múltiplas inadimplências |
| Menor de idade | ✅ OK | 45 anos |
| Prescrita CC 206 §5 I | ✅ OK | dívida < 5 anos |
| Serviço essencial declarado | ✅ n/a | não declarado |
| Pausa Súmula 548 | ✅ n/a | não alegou pagamento |
| Falecido | ✅ OK | |
| Opt-out canais | ✅ todos ativos | nenhum opt-out |

**Quando vermelho/âmbar:** clicar abre modal com motivo + ação corretiva.

### Card 8 — 💬 LINHA DO TEMPO DE COMUNICAÇÃO

Últimas 10 interações (cronológico inverso):

```
10/05 19:35 → Helena (WhatsApp): "Entendo, sem estresse. Vou abrir 
                                  opção pra você falar com Rafael..."
                                  [sentiment +0.2]

10/05 19:30 ← Cliente (WhatsApp): "Tô apertado esse mês. Dá pra esperar
                                   até dia 20?"
                                  [sentiment -0.1] [🚨 SINAL VULNERÁVEL]

08/05 14:20 ⚡ Incidente POP-3 (90min downtime) — afetou 87 clientes

05/05 09:00 → Bruno (WhatsApp): "Oi Maria! Lembrete amigável: amanhã 
                                  vence sua fatura de R$ 89,90..."
                                  [template: bruno_d-1_amigavel]

02/05 19:00 ← Cliente (WhatsApp): respondeu pesquisa NPS = 8 (neutro)
                                  comentário: "Internet boa, mas o preço
                                  vai subindo..."

08/04 ← pagamento confirmado Asaas (R$ 89,90 PIX)
08/04 → Sofia (WhatsApp): "Olá Maria! Recebemos seu pagamento..."

[Ver todas 47 interações →]
```

**Filtros visíveis:**
- Por canal (WhatsApp / SMS / email / voz / inbound vs outbound)
- Por agente (Helena / Bruno / Rafael / Sofia / etc)
- Por sentiment (positivo / neutro / negativo)
- Por período

### Card 9 — 🎬 PRÓXIMAS AÇÕES SUGERIDAS (centro direita)

Output do Score & Decisão (Marcos) com ranking:

```
Marcos recomenda (ordenado por ROI):

1. ⭐ HUMANO LIGA PESSOALMENTE  (ROI 30.6x)
   Razão: cliente A3 → B3 (queda fiel após 32 meses)
   Atribuído: Carlos Operador (carteira)
   Prazo: próximas 24h, horário comercial
   [Atribuir task]

2. Rafael oferecer downgrade temporário  (ROI 18.2x)
   Plano 100Mbps R$ 69,90 por 3 meses (vs atual R$ 89,90)
   Reverte automático após 90 dias
   [Gerar proposta]

3. Pausar régua automática 7 dias  (sem custo)
   Enquanto humano resolve
   Bruno, Carla suspendem envio
   [Pausar até 19/05]

❌ NÃO RECOMENDADO agora:
   - Cobrança ostensiva (perfil B3 fragiliza ainda mais)
   - Suspensão D+15 (cliente fiel — Carla bloqueada por Júlia)
   - Desconto >25% (acima policy do tenant)

Estimativa econômica para "Humano liga":
  Custo: R$ 5,00 (15 min de operador)
  Valor esperado: R$ 152,80 (84% prob × R$ 179,80)
  ROI: 30.6x
```

### Card 10 — ⚖️ RÉGUA EM EXECUÇÃO (timeline horizontal)

Visão de funil — onde o cliente está e o que vai acontecer:

```
D-5  D-3  D-1  D+0  D+1  D+3  D+7  D+10  D+12  D+14  D+15  D+30  D+40  D+60
 ●    ●    ●    │   →    →    →    ◯     ◯     ◯     ◯     ◯     ◯     ◯
Bruno      Bruno  venc                Cliente Rafael Carla Carla  Susp. Daniel  Negativ
(envio (envio    (10/04)              inbound proposta notif. reforço D+15 anuênc. SPC

✅ Concluído  →  Curso atual  ◯ Próximo passo  ⏸️ Pausado
```

Mostra:
- Histórico de ações (Bruno enviou D-5, D-3, D-1 — pagamento NÃO veio)
- Estado atual (D+32 da fatura mais antiga)
- Pausas aplicadas (régua pausada por flag vulnerável suspeita)
- Próximos marcos legais:
  - D+12: Notificação prévia Anatel (Carla)
  - D+15: Suspensão parcial (Júlia gate)
  - D+30: Anuência negativação SPC (Daniel)
  - D+40 útil: Negativação efetiva (Júlia gate)

### Card 11 — 📦 EQUIPAMENTOS COMODATO

Lista de equipamentos atribuídos a este cliente:

```
ONU ZTE F660
  Serial: ZTE-XYZ-123
  MAC: AA:BB:CC:DD:EE:FF
  Instalado: 20/08/2023 (32m)
  Valor reposição: R$ 175,00
  Termo comodato: ✅ assinado

Roteador TP-Link Archer C20
  Serial: TPL-789
  Valor reposição: R$ 80,00
  Termo comodato: ✅ assinado

Total se cancelado: R$ 255,00 em equipamentos a recuperar
```

Mostra antes mesmo do cancelamento — útil para Lucas saber o que estará em risco.

### Card 12 — 🛡️ AUDITORIA RECENTE (Júlia)

Últimas 5 decisões da Júlia sobre este cliente:

```
10/05 19:31  ⚠️ APROVADO COM AJUSTE  Helena.send_freeform_message
              motivo: cliente B3 (queda fiel) — sugerido escalar Marcos
              fonte: Régua DNA policy B3.human_intervention_required

10/05 19:35  ✅ APROVADO  Helena.send_freeform_message (resposta inbound)
              fonte: janela 24h ativa + sem violações compliance

08/05 14:25  ❌ BLOQUEADO  Bruno.send_template (lembrete D+1)
              motivo: incidente POP-3 ativo (90 min)
              fonte: política "não cobrar durante incidente técnico"

05/05 08:30  ✅ APROVADO  Bruno.send_template_d_menos_5

[Ver todas decisões (47) →]
```

---

## 4. JSON do payload (subset cobrança)

Endpoint: `GET /api/customers/:id/cobranca`

```json
{
  "cliente_id": "uuid",
  "header": {
    "nome": "Maria Silva Souza",
    "cpf_cnpj_masked": "123.***.**-12",
    "idade": 45,
    "cidade_uf": "Cambé/PR",
    "bairro": "Centro",
    "tempo_relacao_meses": 32,
    "perfil_atual": "B3",
    "perfil_30d_atras": "A3",
    "alerta_queda_fiel": true,
    "saldo_devedor_centavos": 17980,
    "faturas_em_aberto_count": 2,
    "dias_atraso_mais_antiga": 32,
    "status_contrato": "ativo",
    "ultima_interacao": {
      "at": "2026-05-10T19:30:00Z",
      "canal": "whatsapp",
      "direcao": "inbound",
      "sentiment": -0.1
    }
  },

  "alertas_criticos": [
    {
      "tipo": "queda_fiel",
      "severidade": "alta",
      "detectado_em": "2026-05-12T00:30:00Z",
      "acao_sugerida": "humano_liga_pessoalmente"
    },
    {
      "tipo": "sinal_vulneravel_suspeita",
      "severidade": "media",
      "detectado_em": "2026-05-10T19:30:00Z",
      "sinal": "tô apertado esse mês",
      "confirmado": false,
      "acao_sugerida": "confirmar_via_helena"
    },
    {
      "tipo": "incidente_pop_recente",
      "severidade": "info",
      "pop_id": "POP-3",
      "occurred_at": "2026-05-08T14:20:00Z",
      "duration_min": 90,
      "acao_sugerida": "considerar_pausa_72h"
    }
  ],

  "regua_dna": {
    "perfil_atual": "B3",
    "tom": "extra_gentle",
    "canal_primario": "whatsapp",
    "canal_fallback": "voz",
    "desconto_max_pct": 25,
    "parcelas_max": 12,
    "retention_offer": {
      "tipo": "downgrade_temp",
      "plano_id": "plano_100mb",
      "preco_centavos": 6990,
      "duracao_meses": 3,
      "reverter_automatico": true
    },
    "human_intervention_required": true
  },

  "financeiro": {
    "saldo_devedor_centavos": 17980,
    "faturas_em_aberto": [
      {
        "fatura_id": "uuid",
        "numero": "4521",
        "data_vencimento": "2026-04-10",
        "dias_atraso": 32,
        "principal_centavos": 8990,
        "multa_centavos": 180,
        "juros_centavos": 96,
        "total_centavos": 9266,
        "asaas_payment_id": "...",
        "pix_link": "...",
        "boleto_link": "..."
      },
      {
        "fatura_id": "uuid",
        "numero": "4587",
        "data_vencimento": "2026-05-10",
        "dias_atraso": 2,
        "principal_centavos": 8990,
        "multa_centavos": 180,
        "juros_centavos": 6,
        "total_centavos": 9176
      }
    ],
    "ultimo_pagamento": {
      "data": "2026-03-08",
      "valor_centavos": 8990,
      "forma": "pix"
    },
    "padrao_pagamento": "paga entre dia 8-12 historicamente, 32 meses",
    "taxa_atraso_12m": 0.08,
    "media_dias_atraso": 4,
    "valor_pago_12m_centavos": 107880
  },

  "predicoes_ml": {
    "predicted_payment_probability_proxima_fatura": 0.62,
    "predicted_payment_probability_classificacao": "MEDIO",
    "predicted_churn_60d": 0.45,
    "predicted_churn_60d_classificacao": "ALTO",
    "predicted_procon_30d": 0.05,
    "predicted_procon_30d_classificacao": "BAIXO",
    "predicted_ltv_proximos_24m_centavos": 215760,
    "modelo_versao": "v1.2.3",
    "valido_ate": "2026-05-13T06:00:00Z"
  },

  "scores_externos": {
    "consulta_isp_score": 720,
    "consulta_isp_eventos_negativos": 0,
    "spc_status": "limpo",
    "serasa_status": "limpo",
    "ultima_consulta": "2026-04-30"
  },

  "status_tecnico": {
    "link_ativo": true,
    "sinal_onu_dbm": -22,
    "sinal_classificacao": "bom",
    "uptime_30d_pct": 0.998,
    "sla_pago_pct": 0.995,
    "sla_realizado_pct": 0.998,
    "pop_id": "POP-3",
    "ultimo_incidente": {
      "tipo": "pop_downtime",
      "occurred_at": "2026-05-08T14:20:00Z",
      "duration_min": 90,
      "afetou_este_cliente": true
    },
    "chamados_tecnicos_abertos": []
  },

  "equipamentos_comodato": [
    {
      "tipo": "ONU",
      "modelo": "ZTE F660",
      "serial": "ZTE-XYZ-123",
      "valor_reposicao_centavos": 17500,
      "termo_comodato_assinado": true
    },
    {
      "tipo": "roteador",
      "modelo": "TP-Link Archer C20",
      "valor_reposicao_centavos": 8000,
      "termo_comodato_assinado": true
    }
  ],
  "total_reposicao_se_cancelar_centavos": 25500,

  "flags_compliance": {
    "vulneravel": {
      "status": "suspeita",
      "sinal_detectado": "tô apertado esse mês",
      "detectado_em": "2026-05-10T19:30:00Z",
      "confirmado": false,
      "acao_disponivel": "confirmar_via_helena"
    },
    "binding_procon": { "status": "ok" },
    "super_endividado": { "status": "ok" },
    "menor_de_idade": { "status": "ok" },
    "prescrita_cc206": { "status": "ok" },
    "servico_essencial": { "status": "nao_declarado" },
    "pausa_sumula_548": { "ativa": false, "ate": null },
    "falecido": { "status": "ok" }
  },

  "timeline_comunicacao": [
    /* últimas 10 interações */
  ],

  "regua_em_execucao": {
    "marcos_concluidos": ["D-5_bruno", "D-3_bruno", "D-1_bruno"],
    "marco_atual": "D+32_fatura_mais_antiga",
    "proximos_marcos": [
      {
        "data": "2026-05-22",
        "agente": "carla",
        "acao": "notificacao_previa_anatel",
        "fundamentacao": "Anatel 765 art. 84 IV"
      },
      {
        "data": "2026-05-25",
        "agente": "carla",
        "acao": "suspensao_parcial",
        "requer_julia_gate": true
      },
      {
        "data": "2026-06-10",
        "agente": "daniel",
        "acao": "anuencia_previa_negativacao",
        "fundamentacao": "CDC 43 §2 + Súmula 359 STJ"
      }
    ],
    "pausas_aplicadas": [
      {
        "motivo": "sinal_vulneravel_suspeita",
        "desde": "2026-05-10T19:30:00Z",
        "ate": "2026-05-19T00:00:00Z",
        "agentes_pausados": ["bruno", "carla", "daniel"]
      }
    ]
  },

  "proximas_acoes_sugeridas": [
    {
      "rank": 1,
      "acao": "humano_liga_pessoalmente",
      "razao": "cliente A3 → B3 (queda fiel após 32 meses)",
      "atribuido_a": "Carlos Operador",
      "prazo_horas": 24,
      "custo_estimado_centavos": 500,
      "valor_esperado_centavos": 15280,
      "roi": 30.6,
      "botao_acao": "atribuir_task_ligacao"
    },
    {
      "rank": 2,
      "acao": "rafael_oferecer_downgrade",
      "razao": "B3 com preço sensível",
      "params": {
        "novo_plano": "plano_100mb",
        "preco_centavos": 6990,
        "duracao_meses": 3
      },
      "roi": 18.2,
      "botao_acao": "gerar_proposta_downgrade"
    },
    {
      "rank": 3,
      "acao": "pausar_regua_automatica",
      "razao": "enquanto humano resolve queda fiel",
      "duracao_dias": 7,
      "custo_estimado_centavos": 0,
      "botao_acao": "pausar_regua_7d"
    }
  ],

  "nao_recomendado": [
    {
      "acao": "cobranca_ostensiva",
      "razao": "perfil B3 fragiliza ainda mais",
      "agente_bloqueado": "daniel"
    },
    {
      "acao": "suspensao_d15",
      "razao": "cliente fiel — Júlia bloqueada por policy B3",
      "fonte": "ReguaPolicy.B3.human_intervention_required"
    },
    {
      "acao": "desconto_acima_25_pct",
      "razao": "acima de policy do tenant",
      "limite_atual": 0.25
    }
  ],

  "auditoria_recente": [
    /* últimas 5 decisões Júlia neste cliente */
  ],

  "carteira": {
    "portfolio_id": "uuid",
    "portfolio_nome": "Cambé centro",
    "operador_responsavel": {
      "id": "uuid",
      "nome": "Carlos Operador",
      "telefone_e164": "+5511999998888"
    }
  },

  "tasks_abertas": [
    {
      "id": "uuid",
      "titulo": "Ligar pessoalmente",
      "prioridade": "HIGH",
      "due_date": "2026-05-14",
      "criada_por": "marcos",
      "razao": "A3→B3 queda fiel"
    }
  ],

  "metadados": {
    "ultima_atualizacao": "2026-05-12T08:31:00Z",
    "ultima_recalculo_perfil": "2026-05-12T00:30:00Z",
    "ultima_recalculo_predicoes": "2026-05-12T06:00:00Z"
  }
}
```

---

## 5. Botões de ação disponíveis (calibrados por perfil)

| Ação | Disponibilidade | Quem aprova | Validação Júlia |
|---|---|---|---|
| **Gerar Pix** | sempre | autônomo agente | horário + opt-out |
| **Gerar 2ª via boleto** | sempre | autônomo | horário + opt-out |
| **Enviar lembrete amigável** | sempre (não em chamado técnico aberto) | autônomo | horário + opt-out + janela 24h |
| **Oferecer desconto ≤5%** | autônomo Rafael (D+1 a D+14) | Rafael autônomo | policy do tenant |
| **Oferecer desconto 5-15%** | apenas se Score ConsultaISP >600 + 12m+ pagando | Rafael pré-aprovado | policy + histórico |
| **Oferecer desconto 15-30%** | requer aprovação humana | Marcos → owner | Júlia: tarefa humana |
| **Oferecer parcelamento até 3x** | D+11 a D+14 | Rafael autônomo | policy |
| **Oferecer parcelamento até 12x (vulnerável)** | apenas flag_vulneravel=true | Rafael humanizado | Lei 14.181 |
| **Oferecer parcelamento até 6x default** | D+14+ | Rafael | policy |
| **Notificação formal Anatel (D+12)** | apenas se D-1, D+3, D+7 enviados | Carla | Anatel 765 art. 84 IV |
| **Suspensão parcial (D+15)** | apenas com anuência ≥15d + Júlia OK | Carla | Anatel 765 + Júlia |
| **Anuência negativação (D+30)** | após D+15 cumprido | Daniel | CDC 43§2 + Súmula 359 |
| **Negativação SPC/Serasa** | após anuência 10 dias úteis + Júlia OK | Daniel | Súmula 359 + valor mín R$ 50 |
| **Excluir negativação após pagamento** | obrigatório 5 dias úteis | Daniel cron diário | Súmula 548 STJ + Lei 12.039 |
| **Protesto cartório** | D+121-D+180, dívida >R$ 200, ROI positivo | Daniel + humano | sem disputa judicial |
| **Pausar régua manualmente** | qualquer momento | Marcos/operador humano | audit log |
| **Confirmar vulnerável** | apenas operador humano | humano | flag persistente + Lei 14.181 |
| **Aplicar pausa Súmula 548** | quando cliente alega "já paguei" | Helena automático | Súmula 548 STJ |
| **Escalar para humano** | qualquer momento | qualquer agente | audit |

---

## 6. Casos de uso por agente

### Bruno (Preventivo D-5 a D-1)

Ao abrir um cliente, Bruno verifica:
1. Header: perfil A1/A2/A3? → envia D-1 simples. B/C? → D-3 + D-1.
2. Alertas críticos: chamado técnico aberto? → ABORTA. Vulnerável? → ABORTA (Rafael trata).
3. Régua DNA: tom recomendado pela policy
4. Histórico de pagamentos: pagador exemplar? → tom de cortesia. Score <400? → Pix obrigatório.
5. Janela horária: 09h-20h? → envia. Senão, agenda.
6. Botão "Enviar lembrete D-X" → Júlia valida → executa

### Rafael (Negociador D+1 a D+14)

Ao abrir um cliente:
1. Verifica perfil DNA → calibra tom (gentle/balanced/firm) + desconto máximo
2. Histórico financeiro → cliente exemplar? oferece 5% só por gentileza. Crônico? 20%+ direto.
3. Predições ML → prob churn alto? prioriza retenção sobre recuperação.
4. Acordos quebrados → CUIDADO: cliente já quebrou acordo? sugere parcelas menores + Pix imediato.
5. ROI calculado → mostra valor esperado da negociação
6. Botões: gerar 3 opções (à vista/2x/3x) com cálculo correto + interactive buttons

### Carla (Suspensão D+15)

Ao abrir um cliente:
1. **FIRST CHECK**: incidente técnico recente no POP? → PAUSA até resolver
2. Régua execução: D-1, D+3, D+7 (Bruno) e D+10 (Rafael) realmente enviados?
3. Anuência prévia (D+12): JÁ enviada? comprovada lida?
4. Júlia gate: validar prazos Anatel 765 art. 84 IV
5. Casos especiais: serviço essencial declarado? → BLOQUEIA
6. Botão "Suspensão parcial" só habilitado se TODOS gates verdes

### Daniel (D+60+)

Ao abrir um cliente:
1. **Anuência prévia já enviada?** (D+30, exigência CDC 43 §2 + Súmula 359)
2. **10 dias úteis decorridos da anuência?**
3. **Validar via calendario-br MCP**
4. **Júlia valida**: cliente não-vulnerável, não-binding, dívida não-prescrita, valor ≥R$ 50
5. **ROI**: ROI < 0.3 → recomenda arquivar caso (fundamentação econômica)
6. Botão "Negativar SPC+Serasa" só habilitado com TODOS os gates verdes

### Operador humano financeiro

Ao abrir cliente:
1. Vê de cara: status, perfil DNA, alertas críticos
2. Decide manualmente: cobrar agora? pausar? oferecer plano alternativo?
3. Cria tasks para si ou para colega
4. Adiciona notas livres ("falei com Maria, vai pagar dia 20")
5. Pode override de policy do tenant em casos justificados (audit log)

---

## 7. Anti-padrões visuais — o que NÃO mostrar

❌ **Vermelho agressivo em tudo.** Vermelho-terra apenas para vedação real legal. Default = navy/verde-floresta.

❌ **Botão "Negativar" sempre habilitado.** Habilitar APENAS quando todos os gates legais estão verdes. Senão, desabilitado com tooltip explicando o que falta.

❌ **Mostrar CPF completo na tela.** Sempre `123.***.**-12`. Operador pode fazer reveal por 5s se PRECISAR (audit log de reveal).

❌ **Linguagem de cobrança agressiva.** "Cliente é caloteiro", "Vamos meter no SPC". Usar: "Cliente em atraso", "Inclusão em SPC após anuência".

❌ **Esconder bloqueios da Júlia.** Operador NUNCA deve descobrir tarde que Júlia bloqueou. Mostrar no topo + razão clara.

❌ **Cards gigantes ocupando tela toda.** Densidade calculada. Operador trabalha 8h/dia.

❌ **Histórico de tudo na primeira tela.** Mostrar últimas 10 interações + link "ver todas 47".

❌ **Telefone clicável sem confirmação.** Click em telefone → mostra modal "Ligar para [nome]? (E.164)" antes de discar.

❌ **Esconder ROI / custo da ação.** Operador deve ver custo de cada decisão. Decisão econômica é parte do negócio.

❌ **Mostrar predições ML como certeza.** Sempre com classificação verbal (BAIXO/MÉDIO/ALTO) + probabilidade percentual, NÃO "Vai pagar SIM".

---

## 8. Acessibilidade

- **Contraste WCAG AA**: ratio 4.5:1 para texto pequeno, 3:1 grande
- **Keyboard navigation**: tab order lógico, atalhos cmd+K busca global
- **Screen reader**: ARIA labels em botões de ação, status badges
- **Cores não-exclusivas**: alertas usam ícone + texto + cor (não só cor)
- **Foco visível**: outline azul-floresta 2px em elementos focados
- **Tamanho clicável**: botões mínimo 44×44px
- **Modal de PII**: reveal de CPF/telefone tem timer visível (5s)

---

## 9. Mobile / variação responsiva

Esta tela NÃO é mobile-first (admin é desktop).

Para tablet (>768px): mantém 2 colunas, cards menores.
Para mobile (<768px): empilha em coluna única, header sticky, cards colapsáveis.

A tela específica para o **cliente final** (mobile-first) é o **Renegocia.ISP** descrito no DESIGN.md seção 8 — fora do escopo deste documento.

---

## 10. Endpoints REST

```
GET    /api/customers/:id/cobranca           → JSON completo (este documento)
GET    /api/customers/:id/cobranca/header    → só header
GET    /api/customers/:id/cobranca/alertas   → só alertas
GET    /api/customers/:id/cobranca/timeline?limit=10 → linha do tempo
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

Toda mudança de estado registrada em audit_log com: timestamp, agente/operador, ação, antes/depois, fundamentação.

---

## 11. Métricas norte da tela

- **Tempo médio operador resolve um caso**: ≤ 3 minutos
- **% decisões tomadas com pleno contexto** (todos cards visíveis antes da ação): ≥ 95%
- **% ações bloqueadas pela Júlia que o operador entendeu o motivo** (não recorrer): ≥ 90%
- **NPS interno do operador sobre a tela**: ≥ 70
- **Carga cognitiva** (medida via tempo de hesitação antes de decidir): tendência decrescente

---

*Spec da tela de Cobrança 360° v1.0 — Maio/2026. Pareado com CLIENTE_360.md (schema completo) e DESIGN.md (specs visuais).*
