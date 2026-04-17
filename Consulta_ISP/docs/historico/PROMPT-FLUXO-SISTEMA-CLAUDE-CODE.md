# PROMPT PARA CLAUDE CODE: Fluxo Completo do Sistema de Agentes IA — Consulta ISP

> Cole este prompt inteiro no Claude Code. Ele contem o fluxo documentado de como o sistema DEVE funcionar, o estado atual de cada arquivo, e as melhorias necessarias.

---

## 1. VISAO GERAL DA ARQUITETURA

**Projeto:** `C:\ClaudeCode\Consulta_ISP\agentes-sistema\`
**Stack:** Node.js + Express + better-sqlite3 + @anthropic-ai/sdk (JavaScript puro, sem TypeScript)
**Produto:** Consulta ISP — plataforma B2B SaaS de analise de credito colaborativa para provedores de internet (ISPs)
**Diferencial:** Base regional compartilhada de inadimplencia entre provedores. Quanto mais ISPs da regiao, melhor a analise.

### Estrutura de Arquivos

```
agentes-sistema/
├── src/
│   ├── server.js                    # Entry point - Express porta 3001
│   ├── models/
│   │   └── database.js              # SQLite WAL, 10 tabelas, initialize()
│   ├── routes/
│   │   ├── webhook.js               # POST /webhook/zapi (Z-API WhatsApp)
│   │   ├── api.js                   # /api/* (CRM, leads, stats, training, skills)
│   │   ├── ads.js                   # /api/ads/* (Meta + Google Ads)
│   │   ├── supervisor.js            # /api/supervisor/* (Diana orquestracao)
│   │   └── dashboard.js             # Serve SPA index.html
│   └── services/
│       ├── claude.js                # 7 agentes Claude, system prompt composition
│       ├── orchestrator.js          # Core: mensagem → agente → resposta → acao
│       ├── training.js              # Aprendizado continuo + avaliacao supervisor
│       ├── skills-knowledge.js      # Injecao de conhecimento markdown
│       ├── supervisor.js            # Diana: plan → execute → consolidate
│       ├── zapi.js                  # Z-API WhatsApp client
│       ├── meta-ads.js              # Meta/Facebook Ads API
│       ├── google-ads.js            # Google Ads API
│       └── ads-optimizer.js         # Auto-otimizacao com regras
├── skills-ref/                      # 6 arquivos markdown de conhecimento
│   ├── skills-conhecimento-marcos-leo.md       # Paid ads + copywriting
│   ├── skills-conhecimento-vendas-sofia.md     # Sales + marketing strategy
│   ├── skills-conhecimento-demandgen.md        # Full-funnel + demand gen
│   ├── skills-conhecimento-emailseq.md         # Email sequences + automation
│   ├── skills-conhecimento-prospecao-pricing.md # Lead research + pricing
│   └── skills-conhecimento-agentes-arch.md     # Multi-agent orchestration (Diana)
├── public/
│   └── index.html                   # SPA Dashboard (Chart.js, dark theme)
├── tests/
│   └── test-integration.js          # Testes de integracao
└── data/
    └── agentes.db                   # SQLite database
```

### 7 Agentes IA

| Agente | Key | Role | Modelo | Funcao Principal |
|--------|-----|------|--------|-----------------|
| Carlos | carlos | Pre-Vendas/SDR | claude-sonnet-4-6 | Primeiro contato, qualificacao, lead scoring |
| Lucas | lucas | Vendas | claude-opus-4-6 | Demos, ROI, negociacao consultiva |
| Rafael | rafael | Closer | claude-opus-4-6 | Fechamento, objecoes finais, onboarding |
| Sofia | sofia | Marketing | claude-sonnet-4-6 | Estrategia, campanhas, nurturing |
| Leo | leo | Copywriter | claude-opus-4-6 | Textos (WhatsApp, Instagram, email, landing) |
| Marcos | marcos | Midia Paga | claude-opus-4-6 | Meta Ads + Google Ads, otimizacao |
| Diana | diana | Gerente Ops | claude-opus-4-6 | Supervisao, planejamento, delegacao |

---

## 2. FLUXO PRINCIPAL: MENSAGEM WHATSAPP (Inbound)

Este e o core do sistema. Toda mensagem de lead segue este fluxo:

```
[Lead WhatsApp] → Z-API → POST /webhook/zapi → orchestrator.processIncoming()
```

### Passo a passo detalhado:

**PASSO 1 — Webhook recebe mensagem (webhook.js)**
```
POST /webhook/zapi recebe payload Z-API
→ Ignora se: !data.phone || !data.text?.message || data.fromMe
→ Extrai: phone, message, messageData (type, messageId)
→ Chama: orchestrator.processIncoming(phone, message, messageData)
```

**PASSO 2 — Orchestrator cria/busca lead (orchestrator.js)**
```
SELECT * FROM leads WHERE telefone = phone
Se nao existe:
  → INSERT INTO leads (telefone, agente_atual='carlos', etapa_funil='novo', origem='whatsapp')
  → Loga atividade 'lead_criado'
  → Incrementa metrica leads_novos
```

**PASSO 3 — Armazena mensagem recebida**
```
INSERT INTO conversas (lead_id, agente, direcao='recebida', mensagem, tipo, canal='whatsapp')
Incrementa metrica mensagens_recebidas
```

**PASSO 4 — Carrega historico**
```
SELECT ultimas 10 mensagens do lead (conversas)
Mapeia: recebida → { role: 'user' }, enviada → { role: 'assistant' }
```

**PASSO 5 — Envia para agente IA (claude.js → analyzeAndDecide)**
```
System prompt = prompt_base[agentKey]
             + skillsKnowledge.getCompactContext(agentKey, taskType)  // Max 8000 chars
             + training.getTrainingContext(agentKey)                  // Regras aprendidas

Messages = historico (10 msgs) + analysisPrompt

Agente responde em JSON:
{
  "resposta_whatsapp": "texto para WhatsApp (sem markdown, max 3-4 frases)",
  "score_update": { "perfil": 0-N, "comportamento": 0-N },
  "acao": "responder|agendar_demo|enviar_proposta|transferir_vendas|transferir_closer|devolver_marketing|encerrar",
  "notas_internas": "observacoes internas",
  "dados_extraidos": { "nome", "provedor", "cidade", "porte", "erp", "num_clientes" }
}
```

**PASSO 6 — Composicao do System Prompt (claude.js → _getSystemPrompt)**
```
1. Prompt base fixo por agente (ex: "Voce e o Carlos, pre-vendas...")
2. _inferTaskType(lastMessage) → detecta tipo de tarefa por keywords
   - 12 tipos: cold-email, email-sequence, ad-campaign, demand-gen,
     lead-research, pricing, copywriting, strategy, sales, closing,
     orchestration, general
3. skillsKnowledge.getCompactContext(agentKey, taskType):
   - Carrega N arquivos .md mapeados para o agente
   - _extractSection() filtra secoes por header markers (multi-match)
   - Filtra por keywords do taskType
   - Trunca se > 8000 chars
   - Cache de 5 minutos
4. training.getTrainingContext(agentKey):
   - Top 15 regras ativas (confianca >= 0.3)
   - Agrupadas por tipo (objecoes, abordagens, insights, frases, erros, timing)
```

**PASSO 7 — Atualiza dados do lead**
```
_updateLeadData(leadId, dados_extraidos) → UPDATE leads SET nome, provedor, cidade...
_updateScore(leadId, score_update):
  → novoPerfil = min(50, perfil + update.perfil)
  → novoComportamento = min(50, comportamento + update.comportamento)
  → total = perfil + comportamento
  → Classificacao: frio(0-30), morno(31-60), quente(61-80), ultra_quente(81-100)
```

**PASSO 8 — Handoff automatico por score**
```
Se carlos e score >= 61 → transferLead para lucas (negociacao)
Se lucas e score >= 81 → transferLead para rafael (fechamento)
Se carlos e score > 0 e < 31 → transferLead para sofia (nurturing)
```

**PASSO 9 — Envia resposta via Z-API**
```
zapi.sendText(phone, analise.resposta_whatsapp)
INSERT INTO conversas (direcao='enviada', tempo_resposta_ms, metadata={acao, notas})
Loga atividade 'resposta_enviada'
Incrementa metrica mensagens_enviadas
```

**PASSO 10 — Avaliacao do Supervisor (fire-and-forget)**
```
training.evaluateResponse(agentKey, leadId, conversaId, resposta, mensagem, leadData, client)
  → Claude Sonnet avalia: nota 1-5, sentimento, problemas, sugestao
  → Salva na tabela avaliacoes
  → Se nota >= 4: learn(agentKey, 'frase_converte', ...)
  → Se nota <= 2: learn(agentKey, 'erro_evitar', problemas[0])
  → A cada 10 avaliacoes: _analyzePatterns() extrai regras de melhoria
```

**PASSO 11 — Processa acao (orchestrator._processAction)**
```
switch (acao):
  'transferir_vendas'  → transferLead(lead, agente_atual, 'lucas', notas)
  'transferir_closer'  → transferLead(lead, agente_atual, 'rafael', notas)
  'devolver_marketing' → transferLead(lead, agente_atual, 'sofia', 'Lead frio')
  'agendar_demo'       → INSERT tarefas (tipo='demo', prioridade='alta')
                          UPDATE etapa_funil = 'demo_agendada'
  'enviar_proposta'    → INSERT tarefas (tipo='proposta', prioridade='alta')
                          UPDATE etapa_funil = 'proposta_enviada'
  'encerrar'           → UPDATE etapa_funil = 'perdido'
```

**PASSO 12 — Training por conversa (fire-and-forget, so em avancos)**
```
Se acao in [transferir_vendas, transferir_closer, agendar_demo, enviar_proposta]:
  → training.analyzeConversation(agentKey, historico, acao, client)
  → Claude Sonnet analisa conversa completa → extrai aprendizados JSON
  → training.learn() salva cada aprendizado
  → Regras com confianca >= 0.3 aparecem no proximo prompt
```

---

## 3. FLUXO DE HANDOFF

```
Carlos (novo → qualificacao)
  ↓ transferir_vendas OU score >= 61
Lucas (negociacao)
  ↓ transferir_closer OU score >= 81
Rafael (fechamento)
  ↓ enviar_proposta → proposta_enviada
  ↓ encerrar → perdido

Caminho alternativo:
Qualquer agente → devolver_marketing → Sofia (nurturing, classificacao='frio')
```

### transferLead(leadId, fromAgent, toAgent, motivo):
```
1. UPDATE leads SET agente_atual = toAgent
2. INSERT INTO handoffs (de_agente, para_agente, score_no_momento)
3. INSERT INTO tarefas (tipo='handoff', status='concluida')
4. UPDATE leads SET etapa_funil = etapas[toAgent]
   - sofia → nurturing, carlos → qualificacao, lucas → negociacao, rafael → fechamento
5. Loga atividade (handoff_enviado + handoff_recebido)
6. Incrementa metrica leads_qualificados
```

---

## 4. FLUXO DE SKILLS & KNOWLEDGE

```
Agente recebe mensagem → _getSystemPrompt() → _inferTaskType(lastMessage)
  ↓
skillsKnowledge.getCompactContext(agentKey, taskType)
  ↓
getKnowledgeForAgent(agentKey):
  → Mapping: cada agente → 2-3 arquivos .md
  → _extractSection(content, agentKey):
     → markers por agente (ex: Carlos = ['CARLOS', 'PROSPECAO', 'PRINCIPIOS FUNDAMENTAIS'])
     → Diana recebe arquivo inteiro
     → Regex multi-match: while((match = regex.exec(content)) !== null)
     → Extrai secao entre header atual e proximo header de mesmo nivel
     → Deduplicacao + join com ---
  → Cache por agente (5 min TTL)
  ↓
getCompactContext(agentKey, taskType):
  → Se taskType tem filtros: filtra secoes por keywords
  → Se taskType = 'general': retorna tudo
  → Trunca em MAX_CONTEXT_CHARS = 8000
  → Retorna: "\n\nBASE DE CONHECIMENTO (taskType):\n..."
```

### Mapeamento Agente → Arquivos:

| Agente | Arquivos |
|--------|----------|
| Carlos | vendas-sofia.md, prospecao-pricing.md, emailseq.md |
| Lucas | vendas-sofia.md, prospecao-pricing.md |
| Rafael | vendas-sofia.md, prospecao-pricing.md |
| Sofia | vendas-sofia.md, demandgen.md, prospecao-pricing.md |
| Leo | marcos-leo.md, emailseq.md, demandgen.md |
| Marcos | marcos-leo.md, demandgen.md |
| Diana | marcos-leo.md, vendas-sofia.md, agentes-arch.md |

### 12 Task Types e Keywords:

| TaskType | Keywords de Filtro |
|----------|-------------------|
| cold-email | COLD EMAIL, FOLLOW-UP, ASSUNTO, PROSPECAO, OUTREACH, SEQUENCIA |
| email-sequence | EMAIL, SEQUENCIA, WELCOME, NURTURE, RE-ENGAJAMENTO, LIFECYCLE |
| ad-campaign | CAMPAIGN, TARGETING, OTIMIZACAO, METRICAS, PLAYBOOK, PAID MEDIA |
| copywriting | HEADLINE, COPY, FRAMEWORK, CTA, TEMPLATES DE AD |
| strategy | ESTRATEGIA, LANCAMENTO, LAUNCH, CHURN, FULL-FUNNEL, ATRIBUICAO |
| demand-gen | TOFU, MOFU, BOFU, FULL-FUNNEL, SEO, PARCERIAS, ALOCACAO |
| lead-research | LEAD, PESQUISA, QUALIFICACAO, SINAIS, ICP, FIT SCORE |
| pricing | PRICING, TIER, PRECO, VAN WESTENDORP, FREEMIUM, TRIAL |
| sales | OBJECOES, DEMO, DECK, ROI, PROPOSTA |
| closing | FECHAMENTO, OBJECOES, PROPOSTA, SAVE, DESCONTO |
| orchestration | ORQUESTRACAO, REACT, PLAN-AND-EXECUTE, DELEGACAO, ANTI-PADROES |
| general | Sem filtro — retorna tudo |

---

## 5. FLUXO DE TREINAMENTO CONTINUO

### 5A. Training por conversa (em avancos de funil)
```
orchestrator detecta acao de sucesso (transferir, demo, proposta)
  → training.analyzeConversation(agentKey, conversa, outcome, client)
  → Claude Sonnet extrai aprendizados JSON:
    [{ tipo: "objecao_superada", regra: "...", contexto: "..." }]
  → training.learn() para cada aprendizado:
    → Se ja existe (agente+tipo+regra): vezes_aplicada++, confianca +0.05
    → Se nova: INSERT com confianca=0.5, fonte='automatico'
    → Enriquece contexto com taskType inferido
```

### 5B. Avaliacao do Supervisor (toda resposta)
```
orchestrator apos enviar resposta Z-API
  → training.evaluateResponse(agentKey, leadId, ...)
  → Claude Sonnet avalia: nota 1-5, sentimento, problemas, sugestao
  → INSERT INTO avaliacoes
  → Se nota >= 4: learn('frase_converte', lead+resposta)
  → Se nota <= 2: learn('erro_evitar', problemas[0])
  → A cada 10 avaliacoes: _analyzePatterns()
    → Claude analisa ultimas 10 avaliacoes
    → Sugere ate 3 regras de melhoria
    → learn() para cada regra
```

### 5C. Ciclo de confianca
```
learn() nova regra       → confianca = 0.5
learn() duplicada        → confianca += 0.05
recordSuccess()          → confianca += 0.1
recordFailure()          → confianca -= 0.1
confianca < 0.3          → nao aparece no contexto do agente
disable()                → ativo = 0 (removida permanentemente)
```

### 5D. Injecao no prompt
```
training.getTrainingContext(agentKey):
  → Top 15 regras (ativo=1, confianca >= 0.3, ORDER BY confianca DESC)
  → Agrupadas:
    - Objecoes que funcionaram
    - Abordagens eficazes
    - Insights regionais
    - Insights de persona
    - Frases que convertem
    - Erros a evitar
    - Timing ideal
  → Retorna: "\n\nAPRENDIZADOS DAS CONVERSAS ANTERIORES:\n..."
```

---

## 6. FLUXO DO SUPERVISOR (Diana)

Diana NAO participa do fluxo WhatsApp. Ela coordena demandas internas de marketing e campanhas.

### 6A. Demanda → Planejamento
```
POST /api/supervisor/run { demanda: "...", contexto: {} }
  → supervisor.executeFullDemand(demanda, contexto)
  → Diana analisa demanda e cria plano JSON:
    { plano_execucao: [
        { ordem: 1, agente: "sofia", tarefa: "Estrategia regional", briefing: "...", depende_de: null },
        { ordem: 2, agente: "leo", tarefa: "Criar copy ads", briefing: "...", depende_de: 1 },
        { ordem: 2, agente: "marcos", tarefa: "Configurar campanha", briefing: "...", depende_de: 1 },
        { ordem: 3, agente: "diana", tarefa: "Consolidar", briefing: "...", depende_de: 2 }
    ]}
```

### 6B. Execucao do Plano
```
executePlan(taskId):
  → Agrupa tarefas por 'ordem'
  → Para cada ordem (sequencial):
    → Verifica dependencias: injeta resultado da tarefa anterior no briefing
    → Executa tarefas da mesma ordem em PARALELO (Promise.all)
    → Cada tarefa: claude.sendToAgent(agente, briefing, {})
  → Diana consolida todos os resultados (_consolidateResults)
  → Retorna: consolidacao + resultados_detalhados + tokens_total
```

### 6C. Outros endpoints Diana
```
POST /api/supervisor/demand        → Cria plano (sem executar)
POST /api/supervisor/execute/:id   → Executa plano existente
POST /api/supervisor/run           → Cria + executa (one-shot)
POST /api/supervisor/analyze       → Diana analisa situacao e recomenda
POST /api/supervisor/delegate      → Delega tarefa especifica para agente
GET  /api/supervisor/tasks         → Lista tasks ativas
GET  /api/supervisor/tasks/:id     → Status de uma task
GET  /api/supervisor/report        → Relatorio consolidado da equipe
```

---

## 7. FLUXO DE MIDIA PAGA (Marcos)

```
Criacao: POST /api/ads/meta/campaigns ou /api/ads/google/campaigns
  → Marcos planeja campanha via IA (/api/ads/ai/planner)
  → Leo cria copy dos anuncios (via Diana)
  → Marcos configura segmentacao ISP/telecom/fibra

Otimizacao automatica (ads-optimizer.js):
  Meta Ads:
    → Pausar: CPL > 2x target por 3+ dias
    → Alerta: CTR < 0.5%
    → Alerta: Frequencia > 4
    → Escalar: budget +30% se CPL < 70% target
    → Pausar: 0 leads com gasto > 3x CPL target
  Google Ads:
    → Regras similares por CPA
    → Auto negative keywords: gratis, curso, emprego, etc.

Relatorio: /api/ads/ai/reporter → Marcos gera analise de performance
```

---

## 8. FLUXO DE PROSPECCAO EM MASSA

```
POST /api/prospectar { telefones: [...], agente: "carlos", mensagem: "...", campanha: "nome" }
  → Cria/vincula registro em tabela campanhas
  → Para cada telefone:
    → orchestrator.sendOutbound(phone, agentKey, message)
    → Cria lead se nao existe (etapa='prospeccao', origem='outbound')
    → Claude personaliza mensagem para o lead
    → Envia via Z-API
    → Salva em conversas
  → Quando lead responde → entra no fluxo normal de WhatsApp
  → Retorna: total_enviados, falhas, lead_ids
```

---

## 9. BANCO DE DADOS (SQLite + WAL)

### 10 Tabelas:

| Tabela | Descricao | Campos-chave |
|--------|-----------|-------------|
| leads | CRM principal | telefone(UNIQUE), nome, provedor, cidade, porte, erp, score_perfil(0-50), score_comportamento(0-50), score_total, classificacao, etapa_funil, agente_atual, valor_estimado |
| conversas | Log de mensagens | lead_id(FK), agente, direcao(recebida/enviada), mensagem, tempo_resposta_ms, metadata(JSON) |
| atividades_agentes | Log de atividades | agente, tipo, descricao, lead_id, decisao, score_antes, score_depois, tokens_usados, tempo_ms |
| sessoes_agentes | Sessoes ativas | lead_id, agente, session_id, ativo |
| tarefas | Fila de tarefas | lead_id, agente, tipo(demo/proposta/handoff), status, prioridade, data_limite |
| metricas_diarias | KPIs por agente/dia | data+agente(UNIQUE), mensagens, leads, demos, propostas, contratos, tokens, valor_pipeline |
| handoffs | Transferencias | lead_id, de_agente, para_agente, motivo, score_no_momento |
| campanhas | Campanhas outbound | nome, tipo, agente, regiao, status, total_enviados/respondidos/qualificados |
| treinamento_agentes | Regras aprendidas | agente, tipo, regra, contexto, confianca(0-1), vezes_aplicada, vezes_sucesso, ativo |
| avaliacoes | Avaliacoes supervisor | lead_id, agente, conversa_id, nota(1-5), sentimento, problemas(JSON), sugestao, tags(JSON) |

---

## 10. TODAS AS API ROUTES

### Core API (/api)
```
GET  /api/stats                     → Dashboard stats
GET  /api/metricas/historico        → Metricas diarias (7 dias)
GET  /api/metricas/agentes          → Metricas por agente hoje
GET  /api/funil                     → Funil de vendas
GET  /api/leads                     → Listar leads (com filtros)
POST /api/leads                     → Criar lead manualmente
GET  /api/leads/:id                 → Detalhe do lead + conversas
PUT  /api/leads/:id                 → Atualizar lead
POST /api/send                      → Enviar mensagem manual
POST /api/prospectar                → Prospeccao em massa
GET  /api/conversas/recentes        → Conversas recentes
POST /api/conteudo                  → Gerar conteudo (Leo)
POST /api/estrategia                → Gerar estrategia (Sofia)
POST /api/transferir                → Transferir lead entre agentes
GET  /api/tarefas                   → Listar tarefas
PUT  /api/tarefas/:id               → Atualizar tarefa
GET  /api/atividades                → Log de atividades
GET  /api/campanhas                 → Listar campanhas
POST /api/campanhas                 → Criar campanha
GET  /api/skills/status             → Status dos arquivos skills
GET  /api/skills/test/:agent/:task  → Testar skill injection
GET  /api/training/stats            → Estatisticas treinamento
GET  /api/training/rules/:agent     → Regras de um agente
POST /api/training/learn            → Registrar regra manual
DELETE /api/training/rules/:id      → Deletar regra
GET  /api/training/avaliacoes       → Listar avaliacoes supervisor
GET  /api/training/avaliacoes/resumo → Nota media por agente
POST /api/setup-webhook             → Configurar webhook Z-API
```

### Webhook (/webhook)
```
POST /webhook/zapi                  → Recebe mensagem WhatsApp (Z-API)
POST /webhook/zapi/status           → Status de entrega/leitura
```

### Ads (/api/ads)
```
GET/POST /api/ads/meta/campaigns    → Campanhas Meta
GET/POST /api/ads/meta/adsets       → Ad Sets Meta
GET/POST /api/ads/meta/ads          → Anuncios Meta
POST     /api/ads/meta/audiences    → Audiences Meta
GET/POST /api/ads/google/campaigns  → Campanhas Google
GET/POST /api/ads/google/adgroups   → Ad Groups Google
GET/POST /api/ads/google/keywords   → Keywords Google
GET/POST /api/ads/google/rsa        → RSA ads Google
GET      /api/ads/*/metrics         → Metricas
POST     /api/ads/optimizer/run     → Otimizacao automatica
POST     /api/ads/ai/planner       → Marcos planeja campanha
POST     /api/ads/ai/reporter      → Marcos gera relatorio
```

### Supervisor (/api/supervisor)
```
POST /api/supervisor/demand         → Cria plano (sem executar)
POST /api/supervisor/execute/:id    → Executa plano existente
POST /api/supervisor/run            → Cria + executa (one-shot)
POST /api/supervisor/analyze        → Analise e recomendacao
POST /api/supervisor/delegate       → Delegar tarefa para agente
GET  /api/supervisor/tasks          → Listar tasks
GET  /api/supervisor/tasks/:id      → Status de uma task
GET  /api/supervisor/report         → Relatorio equipe
```

---

## 11. O QUE PRECISA SER FEITO AGORA

Leia TODOS os arquivos listados na estrutura antes de comecar. O sistema ja esta funcional com os 7 agentes, orquestrador, training, skills-knowledge, supervisor, ads e dashboard. Abaixo estao as areas que precisam de revisao, melhoria e novos desenvolvimentos.

### 11A. REVISAO E TESTES — Validar o que ja existe

1. **Rodar `node tests/test-integration.js`** e verificar se todos os testes passam
2. **Validar que _extractSection() retorna multiplas secoes** — testar com `node -e "const sk = require('./src/services/skills-knowledge'); console.log(sk.getCompactContext('marcos', 'demand-gen').length)"` dentro da pasta agentes-sistema
3. **Validar que _inferTaskType() funciona** — testar com varias mensagens: "quanto custa?", "quero uma demo", "oi tudo bem"
4. **Validar tabela avaliacoes** — verificar que existe no schema e que evaluateResponse() grava corretamente
5. **Validar handoff por score** — verificar que o orchestrator.processIncoming() tem os checks de score >= 61, >= 81, < 31

### 11B. MELHORIAS NECESSARIAS

1. **Conflito de handoff**: O agente pode decidir `acao: transferir_vendas` E o score pode triggar handoff automatico no mesmo turno. Adicionar logica para evitar handoff duplicado — se o score ja triggou, nao executar _processAction com a mesma transferencia.

2. **Feedback loop das avaliacoes**: O training.evaluateResponse() salva na tabela avaliacoes, mas os insights nao voltam diretamente para o _getSystemPrompt(). Considerar adicionar um resumo das ultimas avaliacoes do agente no system prompt quando a media de notas cair abaixo de 3.0.

3. **Metricas de avaliacoes no dashboard**: O SPA dashboard (public/index.html) nao exibe as metricas de avaliacao do supervisor. Adicionar uma secao no dashboard mostrando: nota media por agente, evolucao temporal, problemas mais frequentes.

4. **Rate limiting na avaliacao**: evaluateResponse() roda em TODA mensagem, o que pode ser caro em API calls (1 call extra por mensagem). Considerar avaliar apenas a cada 3-5 mensagens, ou so quando o agente muda de etapa.

5. **Prospeccao com delay**: sendOutbound() nao tem delay entre envios. Para listas grandes, Z-API pode throttlear. Adicionar delay configuravel entre envios (ex: 2-5 segundos).

6. **Error handling no analyzeAndDecide**: Se o Claude retornar JSON malformado, o fallback retorna texto truncado como resposta_whatsapp. Melhorar o fallback para tentar re-parsear ou pedir retry.

7. **Testes end-to-end**: Adicionar teste que simula o fluxo completo: webhook → orchestrator → claude (mock) → zapi (mock) → training. Usar mocks do Anthropic client para nao gastar tokens nos testes.

### 11C. PROXIMAS FEATURES (quando o core estiver validado)

1. **Agendamento de follow-up**: Quando o lead nao responde em X horas, o agente envia follow-up automatico via scheduled task
2. **Multi-canal**: Alem de WhatsApp, suportar Instagram DM e Email
3. **Relatorios PDF**: Gerar relatorios de performance em PDF via API
4. **Webhook de status Z-API**: Processar status de entrega/leitura para tracking de engajamento
5. **A/B testing de mensagens**: Leo gera 2 variantes, sistema testa e aprende qual converte melhor

---

## INSTRUCOES DE EXECUCAO

1. **Primeiro**: Leia TODOS os arquivos fonte antes de fazer qualquer mudanca
2. **Segundo**: Rode os testes existentes para verificar o estado atual
3. **Terceiro**: Corrija os bugs/melhorias da secao 11B em ordem (1→7)
4. **Quarto**: Rode os testes novamente para garantir que nada quebrou
5. **Quinto**: Implemente as features da secao 11C conforme prioridade

**REGRA CRITICA**: Nao sobrescreva codigo existente que funciona. Faca alteracoes cirurgicas. Use git diff para verificar mudancas antes de salvar.
