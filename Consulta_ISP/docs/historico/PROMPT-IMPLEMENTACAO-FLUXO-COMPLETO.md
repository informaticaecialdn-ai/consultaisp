# PROMPT PARA CLAUDE CODE: Implementar Fluxo Completo do Sistema de Agentes IA

> Cole este prompt inteiro no Claude Code. Ele contem o fluxo documentado, o ESTADO REAL de cada componente (implementado / stub / inexistente), e as tarefas exatas para completar o sistema.

---

## CONTEXTO DO PROJETO

**Projeto:** `C:\ClaudeCode\Consulta_ISP\agentes-sistema\`
**Stack:** Node.js + Express + better-sqlite3 + @anthropic-ai/sdk (JavaScript puro)
**Produto:** Consulta ISP — plataforma B2B SaaS de analise de credito colaborativa para ISPs

### Estrutura de Arquivos Atual

```
agentes-sistema/
├── src/
│   ├── server.js                      ✅ COMPLETO
│   ├── models/
│   │   └── database.js                ✅ COMPLETO (12 tabelas + 2 migrations)
│   ├── routes/
│   │   ├── webhook.js                 ✅ COMPLETO (inbound + status_entrega)
│   │   ├── api.js                     ✅ COMPLETO (~500 linhas, todos endpoints)
│   │   ├── ads.js                     ✅ COMPLETO (Meta + Google)
│   │   ├── supervisor.js              ✅ COMPLETO
│   │   └── dashboard.js               ✅ COMPLETO
│   └── services/
│       ├── claude.js                  ✅ COMPLETO (7 agentes, _inferTaskType, 4-layer prompt)
│       ├── orchestrator.js            ✅ COMPLETO (handoff score, followup, rate-limit eval)
│       ├── training.js                ✅ COMPLETO (learn, evaluate, analyze, patterns)
│       ├── skills-knowledge.js        ✅ COMPLETO (multi-match, 12 taskTypes)
│       ├── supervisor.js              ✅ COMPLETO (plan, execute, consolidate)
│       ├── followup.js                ✅ COMPLETO (24/48/72h, scheduler 5min)
│       ├── ab-testing.js              ⚠️ INFRAESTRUTURA (service + routes + tabela, MAS nao wired no orchestrator)
│       ├── zapi.js                    ✅ COMPLETO
│       ├── meta-ads.js                ✅ COMPLETO
│       ├── google-ads.js              ✅ COMPLETO
│       ├── ads-optimizer.js           ✅ COMPLETO
│       ├── instagram.js               🔲 STUB (sendDM funcional, NAO integrado no orchestrator)
│       ├── email-sender.js            🔲 STUB (sendEmail funcional, NAO integrado no orchestrator)
│       └── pdf-report.js              ⚠️ PARCIAL (retorna JSON, NAO gera PDF real)
├── skills-ref/                        ✅ 6 arquivos markdown
├── public/index.html                  ✅ SPA Dashboard (NAO tem metricas de avaliacoes)
├── tests/
│   ├── test-integration.js            ✅ EXISTE
│   └── test-e2e-mocked.js            ✅ EXISTE
└── data/agentes.db                    ✅ SQLite
```

---

## ESTADO DETALHADO DO QUE JA FUNCIONA

### 1. Fluxo WhatsApp Inbound — ✅ COMPLETO
```
Z-API → POST /webhook/zapi → orchestrator.processIncoming()
→ Cria/busca lead → Salva msg recebida → Cancela followups
→ Carrega historico (10 msgs) → claude.analyzeAndDecide()
→ Atualiza dados + score → Handoff auto por score (61/81/31)
→ Envia via Z-API → Rate-limited eval (a cada 3 msgs) → _processAction
→ Training em avancos (fire-forget) → Agenda followup
```

### 2. Composicao do Prompt (4 Camadas) — ✅ COMPLETO
```
Camada 1: Prompt base fixo por agente
Camada 2: Skills knowledge (6 .md, filtrado por agente + taskType, max 8000 chars)
Camada 3: Training continuo (top 15 regras, confianca >= 0.3, agrupadas por tipo)
Camada 4: Contexto do lead (historico + dados + analysisPrompt JSON)
```

### 3. Lead Scoring — ✅ COMPLETO
```
score_perfil (0-50) + score_comportamento (0-50) = score_total (0-100)
frio (0-30), morno (31-60), quente (61-80), ultra_quente (81-100)
```

### 4. Handoff — ✅ COMPLETO (com anti-duplicata)
```
carlos → lucas (score>=61 ou acao:transferir_vendas)
lucas → rafael (score>=81 ou acao:transferir_closer)
qualquer → sofia (score<31 ou acao:devolver_marketing)
Flag scoreHandoffDone evita handoff duplo no mesmo turno
```

### 5. Training Continuo — ✅ COMPLETO
```
evaluateResponse (nota 1-5, a cada 3 msgs) → learn + _analyzePatterns (a cada 10)
analyzeConversation (em avancos) → extract aprendizados → learn
Ciclo confianca: 0.5 inicio, +0.05 repet, +0.1 sucesso, -0.1 falha, <0.3 oculta
```

### 6. Follow-up Automatico — ✅ COMPLETO
```
Agendado apos resposta (24h) → Scheduler 5min → Claude gera msg → Z-API
3 tentativas: 24h, 48h, 72h → Cancelado quando lead responde
```

### 7. Supervisor Diana — ✅ COMPLETO
```
createDemand → executePlan (paralelo por ordem) → _consolidateResults
analyzeAndRecommend, delegateToAgent, generateTeamReport
```

### 8. Webhook Status — ✅ COMPLETO
```
POST /webhook/zapi/status → mapeia DELIVERY_ACK/READ → atualiza conversas.status_entrega
GET /api/metricas/entrega → taxa entrega/leitura por agente
```

### 9. A/B Testing — ⚠️ INFRAESTRUTURA SEM WIRING
```
✅ ab-testing.js: createTest, getVariant, recordSend, recordResponse, checkWinner
✅ Tabela ab_tests (status, variantes, contadores, vencedor)
✅ Routes: GET/POST /api/ab-tests, GET /:id, POST /:id/conclude
❌ NAO CHAMADO no orchestrator.processIncoming() nem em sendOutbound()
❌ Carlos NAO consulta getVariant() ao prospectar
```

### 10. Multi-Canal — 🔲 STUBS NAO INTEGRADOS
```
✅ instagram.js: sendDM via Graph API (funcional se configurado)
✅ email-sender.js: sendEmail via Resend API (funcional se configurado)
✅ leads.canal_preferido column existe (migration)
❌ Orchestrator NAO detecta canal de entrada
❌ Orchestrator NAO roteia resposta por canal
❌ Nenhuma rota de webhook para Instagram/Email
❌ Leo NAO adapta tom por canal
```

### 11. Relatorios PDF — ⚠️ PARCIAL
```
✅ pdf-report.js: generatePerformanceReport() retorna JSON estruturado
✅ Coleta KPIs, funil, performance agentes, top leads, entrega, analise Diana
✅ GET /api/relatorios/performance
❌ NAO gera arquivo PDF real (pdfkit nao instalado)
```

### 12. Dashboard — ⚠️ FALTA METRICAS AVALIACOES
```
✅ public/index.html: SPA completo com Chart.js
❌ NAO mostra notas do supervisor (media por agente, evolucao, problemas)
❌ NAO mostra A/B testing results
❌ NAO mostra follow-up status
```

---

## FLUXO ALVO COMPLETO (como DEVE funcionar)

### Fluxo WhatsApp com A/B Testing integrado:
```
Lead manda WhatsApp → orchestrator.processIncoming()
→ Cria/busca lead → Cancela followups → Carrega historico
→ claude.analyzeAndDecide() → Atualiza dados + score → Handoff auto

→ NOVO: Se lead ta respondendo a uma mensagem de prospeccao com A/B test ativo:
    abTesting.recordResponse(testId, variante) → checkWinner()

→ Envia Z-API → Eval supervisor (a cada 3) → _processAction
→ Training (avancos) → Agenda followup
```

### Fluxo Prospeccao com A/B Testing:
```
POST /api/prospectar → Para cada telefone:
→ NOVO: abTest = abTesting.getVariant(agente, 'prospeccao')
→ Se abTest existe: usa abTest.mensagem + abTesting.recordSend()
→ Se nao: Claude personaliza mensagem normal
→ Envia Z-API + Salva conversa (com metadata: { abTestId, variante })
→ Agenda followup
```

### Fluxo Multi-Canal:
```
Lead chega por WhatsApp: canal_preferido = 'whatsapp' (fluxo atual)
Lead chega por Instagram DM: canal_preferido = 'instagram'
Lead chega por Email: canal_preferido = 'email'

Orchestrator detecta canal → Envia resposta pelo canal correto:
  whatsapp → zapi.sendText()
  instagram → instagram.sendDM()
  email → emailSender.sendEmail()

Leo adapta tom no system prompt:
  WhatsApp: max 3-4 frases, sem markdown, 1-2 emojis
  Instagram: emojis estrategicos, quebras de linha
  Email: subject line + corpo mais formal
```

### Fluxo Relatorio PDF:
```
GET /api/relatorios/performance?periodo=semanal&formato=pdf
→ pdf-report.js coleta dados (ja implementado)
→ NOVO: Se formato=pdf, gera PDF real via pdfkit
→ NOVO: Se formato=json (default), retorna JSON (atual)
```

---

## TAREFAS DE IMPLEMENTACAO

### TAREFA 1: Integrar A/B Testing no Orchestrator (PRIORIDADE ALTA)

O ab-testing.js ja esta completo, mas NUNCA e chamado no fluxo real.

**1A. Wiring na prospeccao (orchestrator.sendOutbound ou api.js /api/prospectar):**

No loop de prospeccao, antes de enviar a mensagem:
```javascript
const abTesting = require('./ab-testing'); // ou '../services/ab-testing' dependendo do arquivo

// Dentro do loop de prospeccao:
const abTest = abTesting.getVariant(agentKey, 'prospeccao');
let mensagemFinal;

if (abTest) {
  mensagemFinal = abTest.mensagem;
  abTesting.recordSend(abTest.testId, abTest.variante);
  // Salvar metadata na conversa: { abTestId: abTest.testId, variante: abTest.variante }
} else {
  // Fluxo normal: Claude personaliza
  const result = await claude.sendToAgent(agentKey, message, { leadData: lead });
  mensagemFinal = result.resposta;
}
```

**1B. Registrar resposta (orchestrator.processIncoming):**

Quando um lead responde, verificar se a conversa anterior tinha abTestId nos metadata:
```javascript
// Dentro de processIncoming, apos carregar historico:
const lastEnviada = db.prepare(
  "SELECT metadata FROM conversas WHERE lead_id = ? AND direcao = 'enviada' ORDER BY criado_em DESC LIMIT 1"
).get(lead.id);

if (lastEnviada?.metadata) {
  try {
    const meta = JSON.parse(lastEnviada.metadata);
    if (meta.abTestId) {
      abTesting.recordResponse(meta.abTestId, meta.variante);
    }
  } catch {}
}
```

**1C. Verificar:** Testar criando um A/B test via API, prospectando, e verificando se os contadores incrementam.

### TAREFA 2: Integrar Multi-Canal no Orchestrator (PRIORIDADE MEDIA)

Os services instagram.js e email-sender.js existem como stubs. Precisam ser wired.

**2A. Webhook para Instagram (nova rota em webhook.js):**
```javascript
const instagram = require('../services/instagram');

router.post('/instagram', async (req, res) => {
  // Instagram envia via Graph API Webhooks
  const data = req.body;
  
  // Verificacao de assinatura (challenge)
  if (req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN) {
    return res.send(req.query['hub.challenge']);
  }
  
  // Processar mensagem recebida
  const entries = data?.entry || [];
  for (const entry of entries) {
    const messaging = entry?.messaging || [];
    for (const msg of messaging) {
      if (msg.message?.text) {
        const senderId = msg.sender.id; // IGSID
        const text = msg.message.text;
        const result = await orchestrator.processIncoming(senderId, text, { 
          type: 'texto', canal: 'instagram' 
        });
      }
    }
  }
  res.status(200).json({ received: true });
});

// GET para verificacao do webhook Instagram
router.get('/instagram', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN) {
    return res.send(req.query['hub.challenge']);
  }
  res.status(403).send('Forbidden');
});
```

**2B. Modificar orchestrator.processIncoming para multi-canal:**

O orchestrator precisa saber por qual canal o lead chegou e responder pelo mesmo:
```javascript
async processIncoming(phone, message, messageData = {}) {
  const canal = messageData.canal || 'whatsapp';
  
  // No INSERT do lead novo, guardar canal_preferido:
  if (!lead) {
    db.prepare(`INSERT INTO leads (telefone, agente_atual, etapa_funil, origem, canal_preferido) 
      VALUES (?, 'carlos', 'novo', ?, ?)`).run(phone, canal, canal);
  }
  
  // Na hora de enviar resposta, rotear por canal:
  await this._sendResponse(phone, analise.resposta_whatsapp, lead.canal_preferido || canal);
}

// Novo metodo helper:
async _sendResponse(phone, message, canal) {
  switch (canal) {
    case 'instagram':
      const instagram = require('./instagram');
      if (instagram.isConfigured()) {
        await instagram.sendDM(phone, message);
      } else {
        console.warn('[ORCHESTRATOR] Instagram nao configurado, fallback WhatsApp');
        await zapi.sendText(phone, message);
      }
      break;
    case 'email':
      const emailSender = require('./email-sender');
      if (emailSender.isConfigured()) {
        await emailSender.sendEmail(phone, 'Consulta ISP', message);
      } else {
        console.warn('[ORCHESTRATOR] Email nao configurado, fallback WhatsApp');
        await zapi.sendText(phone, message);
      }
      break;
    default:
      await zapi.sendText(phone, message);
  }
}
```

**2C. Adicionar canal no system prompt do agente:**

Em claude.js _getSystemPrompt(), adicionar instrucao de tom por canal:
```javascript
// Apos montar o prompt base, antes de retornar:
if (context?.canal === 'instagram') {
  prompt += '\n\nCANAL: Instagram DM. Use emojis estrategicos, quebre texto em linhas curtas. Max 4 frases.';
} else if (context?.canal === 'email') {
  prompt += '\n\nCANAL: Email. Tom mais formal, inclua saudacao e assinatura. Pode ser mais longo (5-8 frases).';
} else {
  // Default WhatsApp (ja no prompt base)
}
```

**2D. Montar rota /webhook em server.js:**
```javascript
// Ja existe: app.use('/webhook', webhookRoutes);
// O router em webhook.js precisa das novas rotas POST/GET /instagram
```

### TAREFA 3: Gerar PDF Real nos Relatorios (PRIORIDADE BAIXA)

**3A. Instalar pdfkit:**
```bash
cd agentes-sistema && npm install pdfkit
```

**3B. Adicionar geracao PDF no pdf-report.js:**

Adicionar metodo `generatePDF(data)` que recebe o JSON do `generatePerformanceReport()` e cria um PDF usando pdfkit. O endpoint `/api/relatorios/performance` aceita query param `formato=pdf`:
```javascript
// Em api.js:
router.get('/relatorios/performance', async (req, res) => {
  const { periodo, agente, formato } = req.query;
  const data = await pdfReport.generatePerformanceReport(periodo, agente);
  
  if (formato === 'pdf') {
    const pdfBuffer = await pdfReport.generatePDF(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio-${periodo}.pdf`);
    res.send(pdfBuffer);
  } else {
    res.json(data);
  }
});
```

### TAREFA 4: Atualizar Dashboard com Metricas de Avaliacoes, A/B e Follow-up (PRIORIDADE MEDIA)

O public/index.html precisa de 3 novas secoes:

**4A. Secao "Supervisor" no dashboard:**
- Nota media por agente (GET /api/training/avaliacoes/resumo)
- Evolucao temporal da nota media (nova query)
- Top 5 problemas mais frequentes (nova query nos problemas JSON)

**4B. Secao "A/B Testing":**
- Testes ativos com contadores e taxas (GET /api/ab-tests)
- Resultado de testes concluidos com vencedor

**4C. Secao "Follow-ups":**
- Follow-ups pendentes (GET /api/followups)
- Taxa de sucesso (leads que responderam apos follow-up)

### TAREFA 5: Feedback Loop de Avaliacoes no Prompt (PRIORIDADE MEDIA)

Quando a nota media de um agente cair abaixo de 3.0, injetar alerta no system prompt.

Em claude.js _getSystemPrompt(), apos o training context:
```javascript
// Feedback loop: alerta se nota media baixa
try {
  const db = require('../models/database').getDb();
  const avgResult = db.prepare(
    'SELECT AVG(nota) as m FROM avaliacoes WHERE agente = ? AND criado_em > datetime("now", "-7 days")'
  ).get(agentKey);
  
  if (avgResult?.m && avgResult.m < 3.0) {
    const topProblemas = db.prepare(
      'SELECT problemas FROM avaliacoes WHERE agente = ? AND nota <= 2 ORDER BY criado_em DESC LIMIT 5'
    ).all(agentKey);
    
    const problemas = topProblemas.flatMap(p => {
      try { return JSON.parse(p.problemas || '[]'); } catch { return []; }
    });
    const uniqueProbs = [...new Set(problemas)].slice(0, 3);
    
    prompt += `\n\nATENCAO: Sua nota media esta ${avgResult.m.toFixed(1)}/5.0. Problemas recentes: ${uniqueProbs.join('; ')}. MELHORE estes pontos.`;
  }
} catch {}
```

### TAREFA 6: Testes E2E Atualizados

Atualizar tests/test-e2e-mocked.js e/ou test-integration.js para cobrir:
- A/B testing wiring (criar test → prospectar → verificar contadores)
- Follow-up scheduling (enviar msg → verificar followup agendado)
- Multi-canal (se configurado)
- Feedback loop de avaliacoes

---

## RESUMO EXECUTIVO — ESTADO vs ALVO

| # | Feature | Estado Atual | Tarefa |
|---|---------|-------------|--------|
| 1 | WhatsApp inbound | ✅ Completo | — |
| 2 | 4-layer prompt | ✅ Completo | TAREFA 5: feedback loop |
| 3 | Scoring + Handoff | ✅ Completo (anti-duplicata) | — |
| 4 | Training continuo | ✅ Completo (eval + analyze + patterns) | — |
| 5 | Follow-up automatico | ✅ Completo (24/48/72h, scheduler) | — |
| 6 | Supervisor Diana | ✅ Completo | — |
| 7 | Webhook status | ✅ Completo (entrega/leitura) | — |
| 8 | A/B Testing | ⚠️ Service existe, NAO wired | **TAREFA 1** |
| 9 | Multi-Canal | 🔲 Stubs isolados | **TAREFA 2** |
| 10 | Relatorios PDF | ⚠️ JSON only | **TAREFA 3** |
| 11 | Dashboard metricas | ⚠️ Falta avaliacoes/AB/followup | **TAREFA 4** |
| 12 | Feedback loop prompt | ❌ Nao existe | **TAREFA 5** |
| 13 | Testes atualizados | ⚠️ Existem mas nao cobrem novos features | **TAREFA 6** |

### PRIORIDADE DE EXECUCAO:
1. **TAREFA 1** (A/B Testing wiring) — feature pronta esperando wiring, alto impacto
2. **TAREFA 5** (Feedback loop) — melhora qualidade de todas as respostas
3. **TAREFA 4** (Dashboard metricas) — visibilidade dos novos sistemas
4. **TAREFA 2** (Multi-canal) — expansao de canais
5. **TAREFA 3** (PDF reports) — nice to have
6. **TAREFA 6** (Testes) — rodar apos cada tarefa

---

## INSTRUCOES CRITICAS

1. **Leia TODOS os arquivos fonte antes de qualquer mudanca** — o sistema esta funcional, nao quebre o que existe
2. **Faca alteracoes CIRURGICAS** — nao reescreva arquivos inteiros
3. **Rode `node tests/test-integration.js` antes e depois** de cada tarefa
4. **Nao instale pacotes desnecessarios** — so pdfkit (tarefa 3) e novo
5. **Mantenha fallback WhatsApp** em tudo — se Instagram/Email nao configurado, volta pro Z-API
6. **Todas as novas features devem ser fire-and-forget ou async** — nao bloquear resposta ao lead
