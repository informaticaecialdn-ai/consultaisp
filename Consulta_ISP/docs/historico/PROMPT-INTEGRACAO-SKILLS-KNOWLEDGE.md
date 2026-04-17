# PROMPT PARA CLAUDE CODE: Integrar Base de Conhecimento Expandida dos Agentes

## CONTEXTO

O projeto Consulta ISP possui um ecossistema de 7 agentes de IA (Carlos-SDR, Lucas-closer, Rafael-consultor, Sofia-estrategista, Leo-copywriter, Marcos-paid media, Diana-supervisora) que operam via Anthropic API (Node.js + Express). Cada agente recebe um system prompt base + conhecimento injetado em runtime pelo servico `skills-knowledge.js`.

A base de conhecimento foi expandida de 2 para 6 arquivos markdown em `agentes-sistema/skills-ref/`. O servico `skills-knowledge.js` ja foi atualizado com os novos mappings e filtros. **Sua tarefa e garantir que a integracao esta completa, funcional e otimizada.**

---

## ARQUIVOS JA ATUALIZADOS (verificar, nao recriar)

### 1. `agentes-sistema/skills-ref/` — 6 arquivos de conhecimento

| Arquivo | Conteudo | Agentes |
|---------|----------|---------|
| `skills-conhecimento-marcos-leo.md` | Frameworks de ads/copy (PAS, BAB, ICE), testes criativos, vieses psicologicos | Marcos, Leo |
| `skills-conhecimento-vendas-sofia.md` | Cold email, prospecao, objecoes, demo scripts, estrategia de lancamento | Carlos, Lucas, Rafael, Sofia |
| `skills-conhecimento-demandgen.md` | Full-funnel (TOFU/MOFU/BOFU), playbooks paid media (LinkedIn/Google/Meta), SEO, parcerias, atribuicao | Marcos, Leo, Sofia |
| `skills-conhecimento-emailseq.md` | Email sequences (outbound 5-7 emails, welcome 7 emails, nurture 7 emails, re-engajamento 4 emails), lifecycle emails, copy guidelines | Carlos, Leo |
| `skills-conhecimento-prospecao-pricing.md` | Lead research framework (ICP, sinais de compra, fit scoring), pricing SaaS (tiers Good-Better-Best, Van Westendorp, objecoes de preco, propostas) | Carlos, Lucas, Rafael, Sofia |
| `skills-conhecimento-agentes-arch.md` | Padroes de orquestracao multi-agente (ReAct Loop, Plan-and-Execute, Tool Registry), anti-padroes, protocolos de supervisao | Diana |

### 2. `agentes-sistema/src/services/skills-knowledge.js` — Servico ja atualizado

O servico ja possui:
- Mapping expandido: cada agente mapeia para 2-3 arquivos de conhecimento
- `_extractSection()` com markers expandidos por agente
- `getCompactContext()` com 12 task-type filters: cold-email, email-sequence, ad-campaign, copywriting, strategy, demand-gen, lead-research, pricing, sales, closing, orchestration, general
- Cache por agentKey

### 3. `agentes-sistema/src/services/claude.js` — Ja consome o servico (linha 222)

```javascript
const skillContext = skillsKnowledge.getCompactContext(agentKey, taskType);
if (skillContext) {
  prompt += skillContext;
}
```

---

## O QUE VOCE PRECISA FAZER

### TAREFA 1: Validar a integracao existente

Leia os arquivos e valide:
1. `skills-knowledge.js` carrega corretamente todos os 6 arquivos
2. `_extractSection()` consegue extrair secoes corretas para cada agente de cada arquivo
3. Os markers no `sectionMap` correspondem aos headers reais nos arquivos markdown
4. Nao ha conflitos de regex que possam pegar secoes erradas

**Teste com um script rapido:**
```javascript
const skillsKnowledge = require('./src/services/skills-knowledge');

// Testar cada agente
const agents = ['carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'diana'];
for (const agent of agents) {
  const knowledge = skillsKnowledge.getKnowledgeForAgent(agent);
  console.log(`[${agent}] Knowledge length: ${knowledge ? knowledge.length : 0} chars`);
  if (knowledge) {
    // Mostrar primeiros 200 chars para validar conteudo
    console.log(`  Preview: ${knowledge.substring(0, 200)}...`);
  }
}

// Testar task-type filters
const taskTests = [
  { agent: 'carlos', task: 'cold-email' },
  { agent: 'carlos', task: 'lead-research' },
  { agent: 'marcos', task: 'ad-campaign' },
  { agent: 'marcos', task: 'demand-gen' },
  { agent: 'leo', task: 'email-sequence' },
  { agent: 'leo', task: 'copywriting' },
  { agent: 'sofia', task: 'pricing' },
  { agent: 'sofia', task: 'strategy' },
  { agent: 'lucas', task: 'closing' },
  { agent: 'rafael', task: 'sales' },
  { agent: 'diana', task: 'orchestration' },
  { agent: 'diana', task: 'general' }
];

for (const { agent, task } of taskTests) {
  const ctx = skillsKnowledge.getCompactContext(agent, task);
  console.log(`[${agent}/${task}] Context length: ${ctx.length} chars`);
}
```

### TAREFA 2: Corrigir problemas no _extractSection()

O metodo atual tem uma limitacao: ele retorna apenas a PRIMEIRA secao que encontra por marker. Mas com 6 arquivos, um agente pode precisar de MULTIPLAS secoes do MESMO arquivo.

**Problema:** Se o arquivo `demandgen.md` tem secoes `## MARCOS — Paid Media Playbooks` E `## ESTRATEGIA FULL-FUNNEL (SOFIA + MARCOS)`, o Marcos so recebe a primeira que o regex encontrar.

**Corrigir para retornar TODAS as secoes matching:**

```javascript
_extractSection(content, agentKey) {
  const sectionMap = {
    marcos: ['MARCOS', 'PARTE 1', 'ESTRATEGIA FULL-FUNNEL', 'SEO'],
    leo: ['LEO', 'PARTE 2', 'DIRETRIZES DE COPY', 'CHECKLIST', 'PRINCIPIOS FUNDAMENTAIS'],
    carlos: ['CARLOS', 'PROSPECAO', 'PRINCIPIOS FUNDAMENTAIS'],
    lucas: ['LUCAS', 'RAFAEL', 'PRICING', 'OBJECOES'],
    rafael: ['LUCAS', 'RAFAEL', 'PRICING', 'PROPOSTAS'],
    sofia: ['SOFIA', 'ESTRATEGIA', 'ATRIBUICAO', 'METRICAS', 'PARCERIAS', 'PRICING'],
    diana: null
  };

  if (agentKey === 'diana') return content;

  const markers = sectionMap[agentKey];
  if (!markers) return content;

  // Coletar TODAS as secoes matching, nao apenas a primeira
  const sections = [];
  
  for (const marker of markers) {
    const regex = new RegExp(`^(#+).*${marker}.*$`, 'gmi');
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      const startIdx = match.index;
      const headerLevel = match[1].length;
      
      // Encontra o proximo header de mesmo nivel ou superior
      const restContent = content.substring(startIdx + match[0].length);
      const nextHeaderRegex = new RegExp(`^#{1,${headerLevel}}\\s`, 'gm');
      const nextMatch = nextHeaderRegex.exec(restContent);
      const endIdx = nextMatch 
        ? startIdx + match[0].length + nextMatch.index 
        : content.length;
      
      const section = content.substring(startIdx, endIdx).trim();
      
      // Evitar duplicatas
      if (!sections.includes(section)) {
        sections.push(section);
      }
    }
  }

  return sections.length > 0 ? sections.join('\n\n---\n\n') : null;
}
```

### TAREFA 3: Adicionar controle de tamanho do contexto injetado

Com 6 arquivos por agente, o contexto pode ficar MUITO grande. Adicionar truncamento inteligente:

```javascript
getCompactContext(agentKey, taskType = 'general') {
  const knowledge = this.getKnowledgeForAgent(agentKey);
  if (!knowledge) return '';

  const MAX_CONTEXT_CHARS = 8000; // ~2000 tokens, limite seguro para nao dominar o prompt

  const taskFilters = {
    'cold-email': ['COLD EMAIL', 'FOLLOW-UP', 'ASSUNTO', 'PROSPECAO', 'OUTREACH', 'SEQUENCIA'],
    'email-sequence': ['EMAIL', 'SEQUENCIA', 'WELCOME', 'NURTURE', 'RE-ENGAJAMENTO', 'LIFECYCLE'],
    'ad-campaign': ['CAMPAIGN', 'TARGETING', 'OTIMIZACAO', 'METRICAS', 'PLAYBOOK', 'PAID MEDIA'],
    'copywriting': ['HEADLINE', 'COPY', 'FRAMEWORK', 'CTA', 'TEMPLATES DE AD'],
    'strategy': ['ESTRATEGIA', 'LANCAMENTO', 'LAUNCH', 'CHURN', 'FULL-FUNNEL', 'ATRIBUICAO'],
    'demand-gen': ['TOFU', 'MOFU', 'BOFU', 'FULL-FUNNEL', 'SEO', 'PARCERIAS', 'ALOCACAO'],
    'lead-research': ['LEAD', 'PESQUISA', 'QUALIFICACAO', 'SINAIS', 'ICP', 'FIT SCORE'],
    'pricing': ['PRICING', 'TIER', 'PRECO', 'VAN WESTENDORP', 'FREEMIUM', 'TRIAL'],
    'sales': ['OBJECOES', 'DEMO', 'DECK', 'ROI', 'PROPOSTA'],
    'closing': ['FECHAMENTO', 'OBJECOES', 'PROPOSTA', 'SAVE', 'DESCONTO'],
    'orchestration': ['ORQUESTRACAO', 'REACT', 'PLAN-AND-EXECUTE', 'DELEGACAO', 'ANTI-PADROES'],
    'general': null
  };

  const filters = taskFilters[taskType];
  let result;
  
  if (!filters) {
    // General: truncar se muito grande
    result = knowledge.length > MAX_CONTEXT_CHARS 
      ? knowledge.substring(0, MAX_CONTEXT_CHARS) + '\n\n[... conhecimento truncado por limite de contexto]'
      : knowledge;
    return `\n\nBASE DE CONHECIMENTO:\n${result}`;
  }

  // Filtra secoes relevantes
  const sections = knowledge.split(/\n(?=##)/);
  const relevant = sections.filter(section => {
    const upper = section.toUpperCase();
    return filters.some(f => upper.includes(f));
  });

  if (relevant.length === 0) return '';
  
  result = relevant.join('\n\n');
  if (result.length > MAX_CONTEXT_CHARS) {
    result = result.substring(0, MAX_CONTEXT_CHARS) + '\n\n[... truncado]';
  }
  
  return `\n\nBASE DE CONHECIMENTO (${taskType}):\n${result}`;
}
```

### TAREFA 4: Garantir que taskType e passado corretamente nos fluxos

Verificar em `claude.js` e em todos os pontos onde `getCompactContext()` e chamado que o `taskType` esta sendo inferido corretamente da mensagem do usuario ou do contexto da conversa.

Se necessario, adicionar deteccao automatica de taskType baseada na mensagem:

```javascript
_inferTaskType(message, agentKey) {
  const msg = message.toUpperCase();
  
  // Mapeamento de palavras-chave para task types
  const taskKeywords = {
    'cold-email': ['COLD EMAIL', 'EMAIL FRIO', 'PROSPECAO', 'OUTREACH'],
    'email-sequence': ['SEQUENCIA', 'DRIP', 'NURTURE', 'WELCOME', 'ONBOARDING EMAIL'],
    'ad-campaign': ['CAMPANHA', 'ANUNCIO', 'ADS', 'FACEBOOK', 'GOOGLE ADS', 'LINKEDIN ADS'],
    'demand-gen': ['DEMAND GEN', 'FUNIL', 'TOFU', 'MOFU', 'BOFU', 'AQUISICAO'],
    'lead-research': ['PESQUISA DE LEAD', 'BUSCAR LEAD', 'PROSPECTAR', 'ICP', 'LEAD RESEARCH'],
    'pricing': ['PRECO', 'PRICING', 'PLANO', 'TIER', 'DESCONTO', 'PROPOSTA COMERCIAL'],
    'copywriting': ['COPY', 'TEXTO', 'HEADLINE', 'LANDING PAGE', 'CTA'],
    'strategy': ['ESTRATEGIA', 'PLANEJAMENTO', 'LANCAMENTO', 'KPI', 'METRICA'],
    'sales': ['VENDA', 'DEMO', 'APRESENTACAO', 'ROI', 'PROPOSTA'],
    'closing': ['FECHAR', 'FECHAMENTO', 'OBJECAO', 'NEGOCIACAO', 'CONTRATO'],
    'orchestration': ['COORDENAR', 'PLANEJAR', 'DELEGAR', 'ORQUESTRAR', 'SUPERVISIONAR']
  };

  for (const [taskType, keywords] of Object.entries(taskKeywords)) {
    if (keywords.some(k => msg.includes(k))) {
      return taskType;
    }
  }
  
  return 'general';
}
```

E usar isso em `claude.js` onde o prompt e montado:

```javascript
// Em getSystemPrompt() ou onde o agente e invocado:
const taskType = context?.taskType || this._inferTaskType(userMessage, agentKey);
const skillContext = skillsKnowledge.getCompactContext(agentKey, taskType);
```

### TAREFA 5: Invalidacao de cache quando arquivos mudam

O cache atual nunca expira. Adicionar invalidacao:

```javascript
constructor() {
  this.skillsDir = path.join(__dirname, '../../skills-ref');
  this.cache = new Map();
  this.cacheTimestamps = new Map();
  this.CACHE_TTL = 5 * 60 * 1000; // 5 minutos
}

getKnowledgeForAgent(agentKey) {
  const now = Date.now();
  const cachedAt = this.cacheTimestamps.get(agentKey) || 0;
  
  if (this.cache.has(agentKey) && (now - cachedAt) < this.CACHE_TTL) {
    return this.cache.get(agentKey);
  }
  
  // ... resto do carregamento ...
  
  if (knowledge) {
    this.cache.set(agentKey, knowledge);
    this.cacheTimestamps.set(agentKey, now);
  }
  return knowledge || null;
}

// Metodo para forcar refresh (util em dev/admin)
clearCache() {
  this.cache.clear();
  this.cacheTimestamps.clear();
  console.log('[SKILLS] Cache limpo manualmente');
}
```

### TAREFA 6: Adicionar endpoint de debug (opcional mas recomendado)

No router de API, adicionar rota para verificar o estado da base de conhecimento:

```javascript
// Em routes/api.js
router.get('/skills/status', (req, res) => {
  const skillsKnowledge = require('../services/skills-knowledge');
  const agents = ['carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'diana'];
  
  const status = {};
  for (const agent of agents) {
    const knowledge = skillsKnowledge.getKnowledgeForAgent(agent);
    status[agent] = {
      loaded: !!knowledge,
      chars: knowledge ? knowledge.length : 0,
      estimatedTokens: knowledge ? Math.round(knowledge.length / 4) : 0
    };
  }
  
  // Listar arquivos disponiveis
  const fs = require('fs');
  const path = require('path');
  const skillsDir = path.join(__dirname, '../../skills-ref');
  let files = [];
  try {
    files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md')).map(f => {
      const stats = fs.statSync(path.join(skillsDir, f));
      return { name: f, size: stats.size, modified: stats.mtime };
    });
  } catch (e) {
    files = [{ error: e.message }];
  }
  
  res.json({
    agents: status,
    files,
    taskTypes: [
      'cold-email', 'email-sequence', 'ad-campaign', 'copywriting',
      'strategy', 'demand-gen', 'lead-research', 'pricing',
      'sales', 'closing', 'orchestration', 'general'
    ]
  });
});

// Endpoint para testar contexto de um agente com task type
router.get('/skills/test/:agent/:taskType?', (req, res) => {
  const skillsKnowledge = require('../services/skills-knowledge');
  const { agent, taskType } = req.params;
  
  const context = skillsKnowledge.getCompactContext(agent, taskType || 'general');
  
  res.json({
    agent,
    taskType: taskType || 'general',
    contextLength: context.length,
    estimatedTokens: Math.round(context.length / 4),
    preview: context.substring(0, 500) + (context.length > 500 ? '...' : '')
  });
});
```

### TAREFA 7: Testes unitarios

Criar `agentes-sistema/tests/skills-knowledge.test.js`:

```javascript
const assert = require('assert');

// Ajustar path conforme estrutura do projeto
const skillsKnowledge = require('../src/services/skills-knowledge');

console.log('=== TESTES SKILLS KNOWLEDGE ===\n');

// Teste 1: Todos os agentes carregam conhecimento
const agents = ['carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'diana'];
for (const agent of agents) {
  const knowledge = skillsKnowledge.getKnowledgeForAgent(agent);
  assert(knowledge, `[FAIL] ${agent} nao tem conhecimento carregado`);
  assert(knowledge.length > 100, `[FAIL] ${agent} conhecimento muito curto: ${knowledge.length}`);
  console.log(`[PASS] ${agent}: ${knowledge.length} chars carregados`);
}

// Teste 2: Task-type filters retornam conteudo relevante
const taskTests = [
  { agent: 'carlos', task: 'cold-email', expect: 'COLD' },
  { agent: 'carlos', task: 'lead-research', expect: 'LEAD' },
  { agent: 'marcos', task: 'ad-campaign', expect: 'PLAYBOOK' },
  { agent: 'leo', task: 'email-sequence', expect: 'SEQUENCIA' },
  { agent: 'sofia', task: 'pricing', expect: 'PRICING' },
  { agent: 'diana', task: 'orchestration', expect: 'ORQUESTRACAO' },
];

for (const { agent, task, expect: expected } of taskTests) {
  const ctx = skillsKnowledge.getCompactContext(agent, task);
  assert(ctx.length > 0, `[FAIL] ${agent}/${task} contexto vazio`);
  assert(ctx.toUpperCase().includes(expected), `[FAIL] ${agent}/${task} nao contem "${expected}"`);
  console.log(`[PASS] ${agent}/${task}: ${ctx.length} chars, contem "${expected}"`);
}

// Teste 3: Diana recebe tudo (nao filtrado)
const dianaGeneral = skillsKnowledge.getCompactContext('diana', 'general');
assert(dianaGeneral.length > 1000, `[FAIL] Diana general muito curto: ${dianaGeneral.length}`);
console.log(`[PASS] diana/general: ${dianaGeneral.length} chars (acesso completo)`);

// Teste 4: Cache funciona
const t1 = Date.now();
skillsKnowledge.getKnowledgeForAgent('carlos');
const t2 = Date.now();
skillsKnowledge.getKnowledgeForAgent('carlos');
const t3 = Date.now();
assert((t3 - t2) <= (t2 - t1), `[WARN] Cache pode nao estar funcionando`);
console.log(`[PASS] Cache: primeira chamada ${t2-t1}ms, segunda ${t3-t2}ms`);

console.log('\n=== TODOS OS TESTES PASSARAM ===');
```

---

## RESUMO DE VERIFICACAO

Depois de implementar tudo, verifique:

1. **`node tests/skills-knowledge.test.js`** — Todos os testes passam
2. **`GET /api/skills/status`** — Todos os 7 agentes com `loaded: true`
3. **Nenhum agente recebe mais de ~8000 chars** de contexto por chamada
4. **Cada agente recebe APENAS conhecimento relevante** para sua funcao
5. **`_inferTaskType()` funciona** — testar com mensagens reais tipo:
   - "crie um cold email para o ISP X" → cold-email
   - "quanto devemos cobrar" → pricing
   - "planeje a campanha do mes" → demand-gen
   - "coordene o lancamento" → orchestration

---

## ARQUITETURA FINAL

```
agentes-sistema/
├── skills-ref/                              ← 6 arquivos markdown de conhecimento
│   ├── skills-conhecimento-marcos-leo.md         (785 linhas — frameworks ads/copy)
│   ├── skills-conhecimento-vendas-sofia.md       (385 linhas — vendas e estrategia)
│   ├── skills-conhecimento-demandgen.md          (demand gen, full-funnel, SEO)
│   ├── skills-conhecimento-emailseq.md           (email sequences e automacao)
│   ├── skills-conhecimento-prospecao-pricing.md   (lead research + pricing SaaS)
│   └── skills-conhecimento-agentes-arch.md       (orquestracao multi-agente)
├── src/
│   ├── services/
│   │   ├── skills-knowledge.js              ← Carrega, filtra e injeta conhecimento
│   │   └── claude.js                        ← Monta system prompt + knowledge context
│   └── routes/
│       └── api.js                           ← Endpoints de debug /skills/status
└── tests/
    └── skills-knowledge.test.js             ← Testes de integracao
```

**Fluxo de dados:**
```
Mensagem do usuario
    → claude.js detecta agentKey + taskType
    → skills-knowledge.getCompactContext(agentKey, taskType)
    → Carrega N arquivos markdown do mapping do agente
    → _extractSection() filtra secoes por markers
    → getCompactContext() filtra por task-type keywords
    → Trunca se > MAX_CONTEXT_CHARS (8000)
    → Injeta no system prompt do agente
    → Agente responde com conhecimento contextualizado
```
