# PROMPT PARA CLAUDE CODE: Integrar Skills Knowledge + Treinamento Continuo

> Cole este prompt inteiro no Claude Code. Ele tem todo o contexto necessario para executar autonomamente.

---

## CONTEXTO DO PROJETO

**Projeto:** Consulta ISP — plataforma B2B SaaS de analise de credito colaborativa para provedores de internet (ISPs).

**Stack:** Node.js + Express + better-sqlite3 + Anthropic SDK. NAO e TypeScript. E JavaScript puro.

**Localização:** `C:\ClaudeCode\Consulta_ISP\agentes-sistema\`

**Estrutura atual:**
```
agentes-sistema/
├── src/
│   ├── server.js                    (Express server principal)
│   ├── services/
│   │   ├── claude.js                (agentes IA — system prompts + API calls)
│   │   ├── orchestrator.js          (roteamento de leads + WhatsApp flow)
│   │   ├── supervisor.js            (Diana — planejamento + delegacao)
│   │   ├── skills-knowledge.js      (carrega base de conhecimento markdown → prompts)
│   │   ├── zapi.js                  (integracao WhatsApp Z-API)
│   │   ├── meta-ads.js              (Facebook/Instagram Ads)
│   │   ├── google-ads.js            (Google Ads)
│   │   └── ads-optimizer.js         (otimizacao automatica de ads)
│   ├── routes/
│   │   ├── api.js                   (stats, metricas, dashboard)
│   │   ├── webhook.js               (webhook WhatsApp)
│   │   ├── supervisor.js            (endpoints Diana)
│   │   ├── ads.js                   (endpoints ads)
│   │   └── dashboard.js             (HTML dashboard)
│   └── models/
│       └── database.js              (SQLite schema — better-sqlite3)
├── skills-ref/                      (6 arquivos markdown de conhecimento)
│   ├── skills-conhecimento-marcos-leo.md
│   ├── skills-conhecimento-vendas-sofia.md
│   ├── skills-conhecimento-demandgen.md
│   ├── skills-conhecimento-emailseq.md
│   ├── skills-conhecimento-prospecao-pricing.md
│   └── skills-conhecimento-agentes-arch.md
├── data/agentes.db                  (SQLite database)
├── package.json
├── .env.example
├── Dockerfile
└── docker-compose.yml
```

**7 agentes IA definidos em `claude.js`:**
| Agente | Role | Model |
|--------|------|-------|
| Carlos | Pre-Vendas/SDR | claude-sonnet-4-6 |
| Lucas | Vendas | claude-opus-4-6 |
| Rafael | Closer | claude-opus-4-6 |
| Sofia | Marketing | claude-sonnet-4-6 |
| Leo | Copywriter | claude-opus-4-6 |
| Marcos | Midia Paga | claude-opus-4-6 |
| Diana | Supervisora | claude-opus-4-6 |

---

## O QUE JA EXISTE (NAO RECRIAR)

### 1. `skills-knowledge.js` — Ja atualizado com 6 arquivos

O servico ja foi atualizado com:
- Mapping expandido (cada agente → 2-3 arquivos .md)
- 12 task-type filters: cold-email, email-sequence, ad-campaign, copywriting, strategy, demand-gen, lead-research, pricing, sales, closing, orchestration, general
- `_extractSection()` com markers por agente
- Cache por agentKey

### 2. `claude.js` — Ja consome skills-knowledge (linha 222)

```javascript
const taskType = context?.taskType || 'general';
const skillContext = skillsKnowledge.getCompactContext(agentKey, taskType);
if (skillContext) {
  prompt += skillContext;
}
```

### 3. 6 arquivos markdown em `skills-ref/` — Ja criados

Todos com conteudo completo, organizados por secoes com headers que os markers do `_extractSection()` encontram.

---

## SUAS 7 TAREFAS

### TAREFA 1: Corrigir `_extractSection()` para retornar TODAS as secoes

**Problema:** O metodo atual retorna apenas a PRIMEIRA secao que o regex encontra por marker. Mas com 6 arquivos, um agente pode precisar de MULTIPLAS secoes do MESMO arquivo (ex: `demandgen.md` tem `## MARCOS — Paid Media Playbooks` E `## ESTRATEGIA FULL-FUNNEL (SOFIA + MARCOS)` — Marcos precisa das duas).

**O que fazer:** Abrir `src/services/skills-knowledge.js` e substituir o metodo `_extractSection()` para coletar TODAS as secoes matching com deduplicacao:

```javascript
_extractSection(content, agentKey) {
  // ... sectionMap igual ao atual ...
  
  if (agentKey === 'diana') return content;
  const markers = sectionMap[agentKey];
  if (!markers) return content;

  const sections = [];
  for (const marker of markers) {
    const regex = new RegExp(`^(#+).*${marker}.*$`, 'gmi');
    let match;
    while ((match = regex.exec(content)) !== null) {
      const startIdx = match.index;
      const headerLevel = match[1].length;
      const restContent = content.substring(startIdx + match[0].length);
      const nextHeaderRegex = new RegExp(`^#{1,${headerLevel}}\\s`, 'gm');
      const nextMatch = nextHeaderRegex.exec(restContent);
      const endIdx = nextMatch 
        ? startIdx + match[0].length + nextMatch.index 
        : content.length;
      const section = content.substring(startIdx, endIdx).trim();
      if (!sections.includes(section)) sections.push(section);
    }
  }
  return sections.length > 0 ? sections.join('\n\n---\n\n') : null;
}
```

### TAREFA 2: Adicionar controle de tamanho (MAX_CONTEXT_CHARS = 8000)

Em `getCompactContext()`, truncar se o contexto ficar maior que ~8000 chars (~2000 tokens) para nao dominar o system prompt. Adicionar no inicio do metodo:

```javascript
const MAX_CONTEXT_CHARS = 8000;
```

E antes do return, truncar:
```javascript
if (result.length > MAX_CONTEXT_CHARS) {
  result = result.substring(0, MAX_CONTEXT_CHARS) + '\n\n[... truncado por limite]';
}
```

### TAREFA 3: Adicionar inferencia automatica de taskType

Em `claude.js`, adicionar metodo `_inferTaskType(message)` que detecta o tipo de tarefa pela mensagem do usuario:

```javascript
_inferTaskType(message) {
  const msg = (message || '').toUpperCase();
  const map = {
    'cold-email': ['COLD EMAIL', 'EMAIL FRIO', 'PROSPECAO', 'OUTREACH'],
    'email-sequence': ['SEQUENCIA', 'DRIP', 'NURTURE', 'WELCOME', 'ONBOARDING EMAIL'],
    'ad-campaign': ['CAMPANHA', 'ANUNCIO', 'ADS', 'FACEBOOK ADS', 'GOOGLE ADS', 'LINKEDIN ADS'],
    'demand-gen': ['DEMAND GEN', 'FUNIL', 'TOFU', 'MOFU', 'BOFU', 'AQUISICAO'],
    'lead-research': ['PESQUISA DE LEAD', 'BUSCAR LEAD', 'PROSPECTAR', 'ICP'],
    'pricing': ['PRECO', 'PRICING', 'PLANO', 'TIER', 'DESCONTO', 'PROPOSTA COMERCIAL'],
    'copywriting': ['COPY', 'TEXTO', 'HEADLINE', 'LANDING PAGE'],
    'strategy': ['ESTRATEGIA', 'PLANEJAMENTO', 'LANCAMENTO', 'KPI'],
    'sales': ['VENDA', 'DEMO', 'APRESENTACAO', 'ROI', 'PROPOSTA'],
    'closing': ['FECHAR', 'FECHAMENTO', 'OBJECAO', 'NEGOCIACAO'],
    'orchestration': ['COORDENAR', 'DELEGAR', 'ORQUESTRAR', 'SUPERVISIONAR']
  };
  for (const [taskType, keywords] of Object.entries(map)) {
    if (keywords.some(k => msg.includes(k))) return taskType;
  }
  return 'general';
}
```

E usar em `_getSystemPrompt()`:
```javascript
const taskType = context?.taskType || this._inferTaskType(context?.lastMessage || '');
```

E em `sendToAgent()` e `analyzeAndDecide()`, passar a mensagem no context:
```javascript
const analise = await claude.analyzeAndDecide(lead.agente_atual, message, { ...lead, historico, lastMessage: message });
```

### TAREFA 4: Criar sistema de treinamento continuo

Este e o NOVO sistema que aprende das conversas reais. Complementa o knowledge estatico dos markdowns.

**4a. Criar tabela no banco:** Em `database.js`, adicionar na funcao `initialize()`:

```javascript
CREATE TABLE IF NOT EXISTS treinamento_agentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agente TEXT NOT NULL,
  tipo TEXT NOT NULL,
  regra TEXT NOT NULL,
  contexto TEXT,
  fonte TEXT DEFAULT 'automatico',
  confianca REAL DEFAULT 0.5,
  vezes_aplicada INTEGER DEFAULT 0,
  vezes_sucesso INTEGER DEFAULT 0,
  ativo INTEGER DEFAULT 1,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_treinamento_agente ON treinamento_agentes(agente);
CREATE INDEX IF NOT EXISTS idx_treinamento_tipo ON treinamento_agentes(tipo);
CREATE INDEX IF NOT EXISTS idx_treinamento_ativo ON treinamento_agentes(ativo);
```

**Tipos de regra:** `objecao_superada`, `abordagem_eficaz`, `regiao_insight`, `persona_insight`, `frase_converte`, `erro_evitar`, `timing_ideal`

**4b. Criar servico `src/services/training.js`:**

```javascript
const { getDb } = require('../models/database');

class TrainingService {

  // Registrar aprendizado a partir de uma conversa bem-sucedida
  learn(agentKey, tipo, regra, contexto = null) {
    const db = getDb();
    
    // Verificar se regra similar ja existe
    const existing = db.prepare(
      'SELECT * FROM treinamento_agentes WHERE agente = ? AND tipo = ? AND regra = ?'
    ).get(agentKey, tipo, regra);
    
    if (existing) {
      db.prepare(
        'UPDATE treinamento_agentes SET vezes_aplicada = vezes_aplicada + 1, confianca = MIN(1.0, confianca + 0.05), atualizado_em = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(existing.id);
      return existing.id;
    }
    
    const result = db.prepare(
      'INSERT INTO treinamento_agentes (agente, tipo, regra, contexto, fonte) VALUES (?, ?, ?, ?, ?)'
    ).run(agentKey, tipo, regra, contexto, 'automatico');
    
    console.log(`[TRAINING] ${agentKey} aprendeu: [${tipo}] ${regra.substring(0, 80)}...`);
    return result.lastInsertRowid;
  }

  // Registrar sucesso (quando a abordagem levou a conversao/avanco)
  recordSuccess(ruleId) {
    const db = getDb();
    db.prepare(
      'UPDATE treinamento_agentes SET vezes_sucesso = vezes_sucesso + 1, confianca = MIN(1.0, confianca + 0.1), atualizado_em = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(ruleId);
  }

  // Registrar falha (quando a abordagem nao funcionou)
  recordFailure(ruleId) {
    const db = getDb();
    db.prepare(
      'UPDATE treinamento_agentes SET confianca = MAX(0, confianca - 0.1), atualizado_em = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(ruleId);
  }

  // Buscar regras de treinamento para um agente (ordenadas por confianca)
  getRulesForAgent(agentKey, limit = 15) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM treinamento_agentes WHERE agente = ? AND ativo = 1 AND confianca >= 0.3 ORDER BY confianca DESC, vezes_sucesso DESC LIMIT ?'
    ).all(agentKey, limit);
  }

  // Gerar contexto de treinamento para injetar no prompt
  getTrainingContext(agentKey) {
    const rules = this.getRulesForAgent(agentKey);
    if (rules.length === 0) return '';

    const grouped = {};
    for (const rule of rules) {
      if (!grouped[rule.tipo]) grouped[rule.tipo] = [];
      grouped[rule.tipo].push(rule.regra);
    }

    let context = '\n\nAPRENDIZADOS DAS CONVERSAS ANTERIORES:\n';
    for (const [tipo, regras] of Object.entries(grouped)) {
      const label = {
        'objecao_superada': 'Objecoes que funcionaram',
        'abordagem_eficaz': 'Abordagens eficazes',
        'regiao_insight': 'Insights regionais',
        'persona_insight': 'Insights de persona',
        'frase_converte': 'Frases que convertem',
        'erro_evitar': 'Erros a evitar',
        'timing_ideal': 'Timing ideal'
      }[tipo] || tipo;
      
      context += `\n${label}:\n`;
      for (const regra of regras) {
        context += `- ${regra}\n`;
      }
    }
    return context;
  }

  // Analisar conversa e extrair aprendizados automaticamente
  async analyzeConversation(agentKey, conversation, outcome, claudeClient) {
    // Usar Claude para extrair aprendizados da conversa
    try {
      const response = await claudeClient.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: 'Voce analisa conversas de vendas e extrai aprendizados acionaveis. Responda APENAS em JSON.',
        messages: [{
          role: 'user',
          content: `Analise esta conversa de vendas do agente ${agentKey} com resultado "${outcome}" e extraia aprendizados.

CONVERSA:
${conversation}

Responda em JSON:
{
  "aprendizados": [
    {
      "tipo": "objecao_superada|abordagem_eficaz|regiao_insight|persona_insight|frase_converte|erro_evitar|timing_ideal",
      "regra": "descricao concisa do aprendizado (max 150 chars)",
      "contexto": "quando aplicar (opcional)"
    }
  ]
}`
        }]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        for (const item of (result.aprendizados || [])) {
          this.learn(agentKey, item.tipo, item.regra, item.contexto);
        }
        return result.aprendizados;
      }
    } catch (e) {
      console.error(`[TRAINING] Erro na analise:`, e.message);
    }
    return [];
  }

  // Desativar regra
  disable(ruleId) {
    const db = getDb();
    db.prepare('UPDATE treinamento_agentes SET ativo = 0 WHERE id = ?').run(ruleId);
  }

  // Stats
  getStats() {
    const db = getDb();
    return {
      total: db.prepare('SELECT COUNT(*) as c FROM treinamento_agentes WHERE ativo = 1').get().c,
      por_agente: db.prepare('SELECT agente, COUNT(*) as c FROM treinamento_agentes WHERE ativo = 1 GROUP BY agente').all(),
      por_tipo: db.prepare('SELECT tipo, COUNT(*) as c FROM treinamento_agentes WHERE ativo = 1 GROUP BY tipo').all(),
      top_regras: db.prepare('SELECT * FROM treinamento_agentes WHERE ativo = 1 ORDER BY confianca DESC LIMIT 10').all()
    };
  }
}

module.exports = new TrainingService();
```

**4c. Integrar no `claude.js`:** Adicionar import e injetar no prompt:

```javascript
const training = require('./training');

// Em _getSystemPrompt(), apos o skillContext:
const trainingContext = training.getTrainingContext(agentKey);
if (trainingContext) {
  prompt += trainingContext;
}
```

**4d. Integrar no `orchestrator.js`:** Apos cada conversa, analisar e extrair aprendizados quando houver handoff ou conversao:

```javascript
const training = require('./training');

// Em processIncoming(), apos processar a acao:
if (['transferir_vendas', 'transferir_closer', 'agendar_demo', 'enviar_proposta'].includes(analise.acao)) {
  // Conversa gerou avanco — extrair aprendizados em background
  const conversaTexto = historico.map(m => `${m.role}: ${m.content}`).join('\n');
  training.analyzeConversation(lead.agente_atual, conversaTexto, analise.acao, this._getClaudeClient())
    .catch(e => console.error('[TRAINING] Erro async:', e.message));
}
```

### TAREFA 5: Cache com TTL (5 minutos)

Em `skills-knowledge.js`, substituir o construtor e `getKnowledgeForAgent`:

```javascript
constructor() {
  this.skillsDir = path.join(__dirname, '../../skills-ref');
  this.cache = new Map();
  this.cacheTimestamps = new Map();
  this.CACHE_TTL = 5 * 60 * 1000;
}

getKnowledgeForAgent(agentKey) {
  const now = Date.now();
  const cachedAt = this.cacheTimestamps.get(agentKey) || 0;
  if (this.cache.has(agentKey) && (now - cachedAt) < this.CACHE_TTL) {
    return this.cache.get(agentKey);
  }
  // ... resto do carregamento existente ...
  // No final, ao cachear:
  this.cache.set(agentKey, knowledge);
  this.cacheTimestamps.set(agentKey, now);
}

clearCache() {
  this.cache.clear();
  this.cacheTimestamps.clear();
  console.log('[SKILLS] Cache limpo');
}
```

### TAREFA 6: Endpoints de debug

Em `src/routes/api.js`, adicionar:

```javascript
const training = require('../services/training');
const skillsKnowledge = require('../services/skills-knowledge');

// Status da base de conhecimento
router.get('/skills/status', (req, res) => {
  const agents = ['carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'diana'];
  const status = {};
  for (const agent of agents) {
    const k = skillsKnowledge.getKnowledgeForAgent(agent);
    status[agent] = { loaded: !!k, chars: k ? k.length : 0, tokens_est: k ? Math.round(k.length / 4) : 0 };
  }
  res.json({ agents: status });
});

// Testar contexto de agente
router.get('/skills/test/:agent/:taskType?', (req, res) => {
  const { agent, taskType } = req.params;
  const ctx = skillsKnowledge.getCompactContext(agent, taskType || 'general');
  res.json({ agent, taskType: taskType || 'general', length: ctx.length, preview: ctx.substring(0, 500) });
});

// Stats de treinamento
router.get('/training/stats', (req, res) => {
  res.json(training.getStats());
});

// Regras de um agente
router.get('/training/rules/:agent', (req, res) => {
  const rules = training.getRulesForAgent(req.params.agent, 50);
  res.json({ agent: req.params.agent, total: rules.length, rules });
});

// Adicionar regra manual
router.post('/training/learn', (req, res) => {
  const { agente, tipo, regra, contexto } = req.body;
  if (!agente || !tipo || !regra) return res.status(400).json({ error: 'agente, tipo e regra sao obrigatorios' });
  const id = training.learn(agente, tipo, regra, contexto);
  res.json({ id, message: 'Regra registrada' });
});

// Desativar regra
router.delete('/training/rules/:id', (req, res) => {
  training.disable(req.params.id);
  res.json({ message: 'Regra desativada' });
});
```

### TAREFA 7: Testes

Criar `tests/test-integration.js`:

```javascript
// Rodar com: node tests/test-integration.js
// Precisa estar no diretorio agentes-sistema/

const assert = require('assert');
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';

// Inicializar banco
const { initialize } = require('../src/models/database');
initialize();

// === TESTE 1: Skills Knowledge ===
console.log('\n=== SKILLS KNOWLEDGE ===');
const sk = require('../src/services/skills-knowledge');

const agents = ['carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'diana'];
for (const agent of agents) {
  const k = sk.getKnowledgeForAgent(agent);
  assert(k && k.length > 100, `${agent}: conhecimento nao carregou`);
  console.log(`[OK] ${agent}: ${k.length} chars`);
}

// Task-type filters
const tests = [
  ['carlos', 'cold-email', 'COLD'],
  ['carlos', 'lead-research', 'LEAD'],
  ['marcos', 'ad-campaign', 'PLAYBOOK'],
  ['leo', 'email-sequence', 'EMAIL'],
  ['sofia', 'pricing', 'PRICING'],
  ['diana', 'orchestration', 'ORQUESTRACAO'],
];
for (const [agent, task, expect] of tests) {
  const ctx = sk.getCompactContext(agent, task);
  assert(ctx.length > 0, `${agent}/${task}: vazio`);
  console.log(`[OK] ${agent}/${task}: ${ctx.length} chars`);
}

// Tamanho max
for (const agent of agents) {
  const ctx = sk.getCompactContext(agent, 'general');
  assert(ctx.length <= 9000, `${agent}/general: ${ctx.length} chars (> 9000 limite)`);
  console.log(`[OK] ${agent}/general: ${ctx.length} chars (dentro do limite)`);
}

// === TESTE 2: Training Service ===
console.log('\n=== TRAINING SERVICE ===');
const training = require('../src/services/training');

// Learn
const id1 = training.learn('carlos', 'abordagem_eficaz', 'ISPs de MG respondem melhor quando menciona economia com inadimplencia');
assert(id1, 'learn falhou');
console.log(`[OK] learn: id=${id1}`);

// Duplicate
const id2 = training.learn('carlos', 'abordagem_eficaz', 'ISPs de MG respondem melhor quando menciona economia com inadimplencia');
assert(id2 === id1, 'deduplicacao falhou');
console.log(`[OK] deduplicacao funcionou`);

// Record success
training.recordSuccess(id1);
console.log(`[OK] recordSuccess`);

// Get rules
const rules = training.getRulesForAgent('carlos');
assert(rules.length > 0, 'getRulesForAgent vazio');
console.log(`[OK] getRulesForAgent: ${rules.length} regras`);

// Get context
const ctx = training.getTrainingContext('carlos');
assert(ctx.includes('ISPs de MG'), 'contexto nao contem regra');
console.log(`[OK] getTrainingContext: ${ctx.length} chars`);

// Stats
const stats = training.getStats();
assert(stats.total > 0, 'stats vazio');
console.log(`[OK] stats: ${stats.total} regras ativas`);

// Disable
training.disable(id1);
const rulesAfter = training.getRulesForAgent('carlos');
console.log(`[OK] disable: ${rulesAfter.length} regras ativas apos desativar`);

console.log('\n=== TODOS OS TESTES PASSARAM ===');
```

---

## ARQUITETURA FINAL (DEPOIS DAS 7 TAREFAS)

```
System Prompt do Agente (montado em claude.js):
┌────────────────────────────────────────────────────────────┐
│ 1. Prompt base (fixo por agente)                           │
│    "Voce e o Carlos, pre-vendas do Consulta ISP..."        │
│                                                            │
│ 2. Skills Knowledge (estatico, dos markdowns)     ← JA TEM│
│    BASE DE CONHECIMENTO (cold-email):                      │
│    "Framework PAS: Problem-Agitate-Solution..."            │
│                                                            │
│ 3. Treinamento Continuo (dinamico, do SQLite)     ← NOVO  │
│    APRENDIZADOS DAS CONVERSAS ANTERIORES:                  │
│    "ISPs de MG respondem melhor quando..."                 │
│    "Objecao 'esta caro' superada com ROI..."               │
│                                                            │
│ 4. Contexto do Lead (por conversa)                ← JA TEM│
│    "Nome: Joao, Provedor: NetFibra, Score: 65..."          │
└────────────────────────────────────────────────────────────┘
```

**Fluxo de dados do treinamento continuo:**
```
Lead manda mensagem via WhatsApp
    → orchestrator.processIncoming()
    → claude.analyzeAndDecide() (com skills + training no prompt)
    → Agente responde
    → Se houve avanco (handoff, demo, proposta):
        → training.analyzeConversation() [async, background]
        → Claude Sonnet analisa a conversa
        → Extrai aprendizados em JSON
        → training.learn() salva no SQLite
        → Proxima conversa ja usa o aprendizado no prompt
```

**Arquivos novos a criar:**
- `src/services/training.js` (servico de treinamento)
- `tests/test-integration.js` (testes)

**Arquivos a modificar:**
- `src/services/skills-knowledge.js` (corrigir _extractSection + cache TTL + max chars)
- `src/services/claude.js` (adicionar _inferTaskType + injetar training context)
- `src/services/orchestrator.js` (trigger de analise pos-conversa)
- `src/models/database.js` (tabela treinamento_agentes)
- `src/routes/api.js` (endpoints debug)

---

## VERIFICACAO FINAL

Depois de implementar tudo, rodar:

```bash
cd agentes-sistema
node tests/test-integration.js
```

Todos os testes devem passar. Depois verificar:

1. `GET /api/skills/status` → 7 agentes com `loaded: true`
2. `GET /api/skills/test/carlos/cold-email` → retorna contexto relevante
3. `GET /api/training/stats` → retorna `{ total: 0 }` (vai crescer conforme conversas)
4. `POST /api/training/learn` com body `{ "agente": "carlos", "tipo": "abordagem_eficaz", "regra": "teste" }` → retorna id
5. `GET /api/training/rules/carlos` → retorna a regra criada

Pronto — o sistema tera duas camadas de inteligencia: frameworks estaticos (markdowns) + aprendizados dinamicos (conversas reais).
