# BIA — Skill de Relatorios e Comunicacao Interna

Adaptada de `anthropics/skills/internal-comms` (Apache 2.0). Usa formato 3P
(Progress/Plans/Problems) pra reports semanais ao operador humano, e formato
FAQ pra consolidar duvidas recorrentes.

---

## Quando usar esta skill

Bia usa este playbook quando chamada pra:
- **Relatorio semanal 3P** pro operador (metricas + o que rolou + o que vai fazer)
- **Resumo executivo** (apos evento critico: auto-pause, anomalia, milestone)
- **FAQ interno** (quando operador faz mesma pergunta varias vezes)
- **Alerta via notify_operator** (formato estruturado)

NAO usa pra:
- Mensagens de marketing ou vendas (Sofia/Leo cuidam)
- Conversa com leads (Carla/Lucas/Rafael cuidam)

---

## Formato 1 — 3P Update semanal (operador humano)

Target: operador (CEO/dono) que nao tem tempo. Legivel em 30-60s, tom factual,
dados em vez de adjetivos.

```
[Nivel] Bia — Semana DD/MM a DD/MM

Progress (o que rolou):
- Leads prospectados: [N] (vs [N] semana anterior, [+/-]%)
- Qualificados (handoff Carla->Lucas): [N]
- Propostas enviadas: [N]
- Contratos fechados: [R$ total mensal]

Plans (proxima semana):
- [Acao 1 com owner agente/worker]
- [Acao 2]

Problems (o que precisa de voce):
- [Bloqueador que exige humano - ou "nenhum" se nao ha]
```

**Nivel** = emoji que comunica humor da semana:
- green_check = boa semana
- warning = alguma preocupacao
- alert = ruim, precisa acao

Exemplo real:
```
green_check Bia — Semana 20/04 a 27/04

Progress:
- 48 leads prospectados (vs 32, +50%)
- 7 qualificados, 3 handoffs Carla->Lucas
- 2 propostas, 1 fechado R$349/mes (Profissional)

Plans:
- Marcos vai A/B testar 2 variantes de copy cold inicial
- Sofia vai expandir regioes pra incluir PR e SC

Problems:
- Nenhum.
```

Regras:
- Sempre metricas concretas (numeros absolutos + delta %)
- 1-3 frases por secao, nunca mais
- Se Problems esta vazio, diga "nenhum" — nao omita a secao
- Fonte dos numeros: sempre tabelas leads/conversas/handoffs/metricas_diarias

---

## Formato 2 — Alerta estruturado (notify_operator)

Usar quando algo critico aconteceu e operador precisa agir. Formato:

```
[SEVERITY] Titulo curto
Oque: [1 frase do que rolou]
Impacto: [1 frase do efeito pratico no negocio]
Evidencia: [dados concretos — numeros, logs, IDs]
Recomendacao: [1-2 acoes sugeridas, ordenadas por prioridade]
```

Exemplo:
```
CRITICAL Z-API down 2h
Oque: Zapi.canais.status = down desde 14:23 UTC
Impacto: Nenhum outbound sendo entregue; 3 leads aguardando resposta
Evidencia: erros_log entries 847-892, all "ZAPI timeout"
Recomendacao:
1. Checar se instancia Z-API foi desativada no painel
2. Se sim, reconectar; se nao, abrir chamado Z-API
```

Severity:
- INFO: FYI, nao urgente
- WARN: pode virar problema se nao resolver em 24h
- CRITICAL: impactando operacao agora, precisa acao hoje

---

## Formato 3 — FAQ consolidado

Quando operador faz mesma pergunta >2 vezes, Bia adiciona ao FAQ interno.

```
Q: [pergunta em 1 linha]
A: [resposta em 1-2 linhas, com link pra doc se relevante]
```

Exemplo:
```
Q: Por que o worker pausou sozinho ontem a noite?
A: Auto-healer detectou custo Claude diario > $50 (threshold AUTO_PAUSE_COST_USD)
   e ligou kill switch no outbound. Ver /autonomia pra historico.
```

Mantido em `.planning/FAQ-OPERADOR.md` (Bia cria se nao existir).

---

## Tools que Bia usa pra gerar os relatorios

- `query_leads` — contadores por etapa, classificacao, agente
- `query_lead_detail` — se precisar detalhar caso especifico no relatorio
- `notify_operator` — enviar relatorio via webhook/errors_log

Sequencia tipica pra 3P semanal:
1. query_leads({dias_sem_resposta: 7}) — detecta parados
2. query_leads({origem: 'prospector_auto'}) — conta prospectados
3. query_leads({classificacao: 'ultra_quente'}) — conta quentes
4. Monta relatorio no formato 3P
5. notify_operator({severity: 'info', titulo: 'Relatorio semanal', mensagem: relatorio})

---

## Principios gerais

- **Factual**: numeros > adjetivos. "3 handoffs" nao "alguns handoffs".
- **Breve**: relatorio semanal em <200 palavras sempre.
- **Sem jargao**: operador e dono do provedor, nao dev. Evitar termos tecnicos
  sem explicar (ex: "circuit breaker aberto" → "worker pausou por muitos erros").
- **Actionable**: Problems sempre tem recomendacao clara.
- **Honesto**: se metricas cairam, diga. Nao disfarce.
