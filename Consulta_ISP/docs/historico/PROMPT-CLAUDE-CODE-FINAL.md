# PROMPT PARA CLAUDE CODE: Completar Integração do Sistema de Agentes

> Cole este prompt inteiro no Claude Code. Ele tem o contexto completo do que ja existe e o que falta.

---

## CONTEXTO

Projeto: `C:\ClaudeCode\Consulta_ISP\agentes-sistema\`
Stack: Node.js + Express + better-sqlite3 + @anthropic-ai/sdk. JavaScript puro (sem TypeScript).

O sistema JA possui:
- 7 agentes IA (Carlos, Lucas, Rafael, Sofia, Leo, Marcos, Diana) em `src/services/claude.js`
- Orchestrator de leads via WhatsApp em `src/services/orchestrator.js`
- Supervisor Diana em `src/services/supervisor.js`
- Skills knowledge (6 arquivos markdown) em `src/services/skills-knowledge.js`
- Training continuo em `src/services/training.js`
- Ads (Meta + Google) em `meta-ads.js`, `google-ads.js`, `ads-optimizer.js`
- Banco SQLite com tabelas: leads, conversas, atividades_agentes, sessoes_agentes, tarefas, metricas_diarias, handoffs, campanhas, treinamento_agentes
- Rotas: api.js, webhook.js, supervisor.js, ads.js, dashboard.js
- Endpoints de skills/training: GET /api/skills/status, GET /api/training/stats, etc.

### COMO FUNCIONA HOJE (JA IMPLEMENTADO)

**Fluxo de prompt montado em `claude.js` → `_getSystemPrompt()`:**
```
1. Prompt base fixo por agente (ex: "Voce e o Carlos, pre-vendas...")
2. + Skills knowledge estatico (markdowns filtrados por agentKey + taskType)
3. + Training dinamico (regras aprendidas do SQLite, confianca >= 0.3)
```

**Fluxo de training em `orchestrator.js`:**
```
Quando acao e transferir_vendas/transferir_closer/agendar_demo/enviar_proposta:
→ training.analyzeConversation() [fire-and-forget, async]
→ Claude Sonnet analisa conversa → extrai aprendizados JSON
→ training.learn() salva no SQLite
→ Proxima chamada ja injeta via training.getTrainingContext()
```

**Fluxo de skills-knowledge em `skills-knowledge.js`:**
```
getCompactContext(agentKey, taskType):
→ Carrega N arquivos .md do mapping do agente
→ _extractSection() filtra secoes por markers do agente
→ Filtra por taskType keywords
→ Trunca se > 8000 chars (MAX_CONTEXT_CHARS)
```

---

## O QUE FALTA IMPLEMENTAR (6 TAREFAS)

### TAREFA 1: Corrigir `_extractSection()` — retornar TODAS as secoes matching

**Arquivo:** `src/services/skills-knowledge.js`

**Problema:** O `_extractSection()` atual usa `regex.exec(content)` que retorna apenas o PRIMEIRO match. Mas com 6 arquivos markdown, um agente pode precisar de MULTIPLAS secoes do MESMO arquivo.

Exemplo: `skills-conhecimento-demandgen.md` tem `## MARCOS — Paid Media Playbooks` E `## ESTRATEGIA FULL-FUNNEL (SOFIA + MARCOS)`. Marcos precisa das duas, mas so recebe a primeira.

**Correcao:** Substituir o metodo `_extractSection()` para usar um `while` loop que coleta TODAS as secoes matching, com deduplicacao. O `for (const marker of markers)` interno deve usar `while ((match = regex.exec(content)) !== null)` em vez de um unico `regex.exec()`.

Apos coletar todas as secoes, juntar com `\n\n---\n\n` e retornar. Se nenhuma secao encontrada, retornar `null`.

### TAREFA 2: Adicionar `_inferTaskType()` em `claude.js`

**Arquivo:** `src/services/claude.js`

**Problema:** Atualmente `taskType` vem de `context?.taskType || 'general'`. Mas no fluxo principal (`orchestrator.processIncoming`), nenhum `taskType` e passado — sempre cai em `'general'`, entao o agente recebe TODO o conhecimento sem filtro (ou truncado sem inteligencia).

**Implementar:** Adicionar metodo `_inferTaskType(message)` que detecta o tipo de tarefa pela mensagem do lead:

```javascript
_inferTaskType(message) {
  const msg = (message || '').toUpperCase();
  const map = {
    'cold-email': ['COLD EMAIL', 'EMAIL FRIO'],
    'email-sequence': ['SEQUENCIA DE EMAIL', 'DRIP', 'NURTURE'],
    'pricing': ['PRECO', 'QUANTO CUSTA', 'VALORES', 'PLANO', 'DESCONTO', 'PROPOSTA'],
    'sales': ['DEMO', 'APRESENTACAO', 'DEMONSTRACAO', 'FUNCIONALIDADE'],
    'closing': ['FECHAR', 'CONTRATO', 'ASSINAR', 'PAGAMENTO', 'BOLETO'],
    'lead-research': ['QUANTOS CLIENTES', 'QUAL SISTEMA', 'QUE ERP'],
    'ad-campaign': ['CAMPANHA', 'ANUNCIO', 'ADS']
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

E em `analyzeAndDecide()`, passar a mensagem original no context:
```javascript
const response = await this.client.messages.create({
  ...
  system: this._getSystemPrompt(agentKey, { ...context, lastMessage: message }),
  ...
});
```

### TAREFA 3: Sistema de Avaliacao do Supervisor (Fluxo 3 do documento)

**O que falta:** O fluxo documentado descreve um Supervisor que avalia CADA resposta de agente com nota 1-5, sentimento e problemas, salvando em `crm_avaliacoes`. Esse fluxo NAO existe no codigo atual.

O que existe hoje: `training.analyzeConversation()` so roda quando ha handoff/demo/proposta. NAO roda em TODA resposta.

**Implementar:**

**3a. Criar tabela `avaliacoes` em `database.js`:**
```sql
CREATE TABLE IF NOT EXISTS avaliacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  agente TEXT NOT NULL,
  conversa_id INTEGER,
  nota INTEGER NOT NULL,
  sentimento TEXT,
  problemas TEXT,
  sugestao TEXT,
  tags TEXT,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_agente ON avaliacoes(agente);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_nota ON avaliacoes(nota);
```

**3b. Adicionar metodo `evaluateResponse()` em `training.js`:**

```javascript
async evaluateResponse(agentKey, leadId, conversaId, agentResponse, leadMessage, leadData, claudeClient) {
  try {
    const response = await claudeClient.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: 'Voce e um supervisor de vendas. Avalie a resposta do agente. Responda APENAS em JSON.',
      messages: [{
        role: 'user',
        content: `Agente: ${agentKey}
Lead: ${leadData.nome || 'desconhecido'} (${leadData.provedor || '?'}, ${leadData.porte || '?'})
Etapa: ${leadData.etapa_funil}

Lead disse: "${leadMessage}"
Agente respondeu: "${agentResponse}"

Avalie em JSON:
{
  "nota": 1-5,
  "sentimento_lead": "positivo|neutro|negativo",
  "problemas": ["lista de problemas se houver"],
  "sugestao": "melhoria sugerida",
  "tags": ["regiao", "porte", "erp"]
}`
      }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const avaliacao = JSON.parse(jsonMatch[0]);
      const db = getDb();
      
      db.prepare(
        'INSERT INTO avaliacoes (lead_id, agente, conversa_id, nota, sentimento, problemas, sugestao, tags) VALUES (?,?,?,?,?,?,?,?)'
      ).run(
        leadId, agentKey, conversaId,
        avaliacao.nota,
        avaliacao.sentimento_lead,
        JSON.stringify(avaliacao.problemas || []),
        avaliacao.sugestao,
        JSON.stringify(avaliacao.tags || [])
      );

      // Se nota alta → extrair como exemplo de sucesso
      if (avaliacao.nota >= 4) {
        this.learn(agentKey, 'frase_converte', 
          `Lead: "${leadMessage.substring(0,80)}" → Agente: "${agentResponse.substring(0,80)}"`,
          `nota ${avaliacao.nota}, ${avaliacao.sentimento_lead}`
        );
      }
      
      // Se nota baixa → registrar erro a evitar
      if (avaliacao.nota <= 2 && avaliacao.problemas?.length > 0) {
        this.learn(agentKey, 'erro_evitar',
          avaliacao.problemas[0],
          avaliacao.sugestao
        );
      }

      // A cada 10 avaliacoes, analisar padroes e sugerir regras
      const count = db.prepare('SELECT COUNT(*) as c FROM avaliacoes WHERE agente = ?').get(agentKey).c;
      if (count % 10 === 0 && count > 0) {
        this._analyzePatterns(agentKey, claudeClient).catch(e => 
          console.error('[TRAINING] Erro patterns:', e.message)
        );
      }

      return avaliacao;
    }
  } catch (e) {
    console.error(`[TRAINING] Erro avaliacao:`, e.message);
  }
  return null;
}

async _analyzePatterns(agentKey, claudeClient) {
  const db = getDb();
  const recent = db.prepare(
    'SELECT * FROM avaliacoes WHERE agente = ? ORDER BY criado_em DESC LIMIT 10'
  ).all(agentKey);

  const avgNota = recent.reduce((s, a) => s + a.nota, 0) / recent.length;
  const problemas = recent.flatMap(a => {
    try { return JSON.parse(a.problemas || '[]'); } catch { return []; }
  });
  
  const response = await claudeClient.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: 'Analise padroes de avaliacao e sugira regras de melhoria. Responda em JSON.',
    messages: [{
      role: 'user',
      content: `Ultimas 10 avaliacoes do agente ${agentKey}:
Nota media: ${avgNota.toFixed(1)}
Problemas frequentes: ${[...new Set(problemas)].join(', ')}
Sugestoes: ${recent.map(a => a.sugestao).filter(Boolean).join('; ')}

Sugira ate 3 regras de melhoria em JSON:
{ "regras": [{ "tipo": "...", "regra": "...", "contexto": "..." }] }`
    }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const result = JSON.parse(jsonMatch[0]);
    for (const r of (result.regras || [])) {
      this.learn(agentKey, r.tipo, r.regra, r.contexto);
    }
    console.log(`[TRAINING] ${agentKey}: ${result.regras?.length || 0} regras sugeridas a partir de padroes`);
  }
}
```

**3c. Integrar no `orchestrator.js`:** Apos enviar resposta via Z-API, chamar avaliacao em background:

```javascript
// Apos a linha: await zapi.sendText(phone, analise.resposta_whatsapp);
// Adicionar:
training.evaluateResponse(
  lead.agente_atual, lead.id, null,
  analise.resposta_whatsapp, message, lead, claude.client
).catch(e => console.error('[TRAINING] Erro avaliacao async:', e.message));
```

**3d. Adicionar endpoints em `api.js`:**
```javascript
// Avaliacoes
router.get('/training/avaliacoes', (req, res) => {
  const db = getDb();
  const { agente, limit } = req.query;
  let query = 'SELECT a.*, l.nome as lead_nome, l.provedor FROM avaliacoes a LEFT JOIN leads l ON a.lead_id = l.id';
  const params = [];
  if (agente) { query += ' WHERE a.agente = ?'; params.push(agente); }
  query += ' ORDER BY a.criado_em DESC LIMIT ?';
  params.push(parseInt(limit) || 50);
  res.json(db.prepare(query).all(...params));
});

// Nota media por agente
router.get('/training/avaliacoes/resumo', (req, res) => {
  const db = getDb();
  res.json(db.prepare(`
    SELECT agente, 
      COUNT(*) as total, 
      ROUND(AVG(nota), 1) as nota_media,
      SUM(CASE WHEN nota >= 4 THEN 1 ELSE 0 END) as boas,
      SUM(CASE WHEN nota <= 2 THEN 1 ELSE 0 END) as ruins
    FROM avaliacoes GROUP BY agente
  `).all());
});
```

### TAREFA 4: Handoff automatico por score em `orchestrator.js`

**O que falta:** O fluxo documenta handoff automatico por score (>=61 → Lucas, >=81 → Rafael, <31 → Sofia). Verificar se ja existe em `_processAction()` ou se precisa ser adicionado.

**Verificar** se o orchestrator ja faz isso apos o `_updateScore()`. Se nao, adicionar em `processIncoming()` apos atualizar o score:

```javascript
// Apos: const leadAfter = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id);
// Adicionar verificacao de handoff automatico por score:

if (leadAfter.agente_atual === 'carlos' && leadAfter.score_total >= 61) {
  await this.transferLead(lead.id, 'carlos', 'lucas', 'Score automatico >= 61');
} else if (leadAfter.agente_atual === 'lucas' && leadAfter.score_total >= 81) {
  await this.transferLead(lead.id, 'lucas', 'rafael', 'Score automatico >= 81');
} else if (leadAfter.agente_atual === 'carlos' && leadAfter.score_total < 31 && leadAfter.score_total > 0) {
  await this.transferLead(lead.id, 'carlos', 'sofia', 'Score baixo < 31, devolver marketing');
}
```

**IMPORTANTE:** Verificar se isso ja esta implementado antes de duplicar. Ler `_processAction()` e `processIncoming()` completos.

### TAREFA 5: Integrar skills-knowledge novos no fluxo de training

**Conexao entre os dois sistemas:** Quando o supervisor avalia uma resposta como boa (nota >= 4) e extrai um aprendizado, verificar se o aprendizado se encaixa em algum dos task-type filters dos skills-knowledge para melhorar a relevancia.

Em `training.js`, no metodo `learn()`, adicionar tag de taskType quando possivel:

```javascript
learn(agentKey, tipo, regra, contexto = null) {
  const db = getDb();
  
  // Inferir taskType relevante pela regra
  const taskType = this._inferRuleTaskType(regra);
  const enrichedContexto = contexto 
    ? `${contexto} [taskType: ${taskType}]` 
    : `[taskType: ${taskType}]`;
  
  // ... resto do learn existente, usando enrichedContexto no lugar de contexto ...
}

_inferRuleTaskType(regra) {
  const r = (regra || '').toUpperCase();
  if (r.includes('PRECO') || r.includes('CARO') || r.includes('DESCONTO')) return 'pricing';
  if (r.includes('EMAIL') || r.includes('MENSAGEM')) return 'cold-email';
  if (r.includes('DEMO') || r.includes('APRESENTA')) return 'sales';
  if (r.includes('FECHA') || r.includes('CONTRATO')) return 'closing';
  if (r.includes('REGIAO') || r.includes('CIDADE')) return 'lead-research';
  return 'general';
}
```

### TAREFA 6: Testes de integracao

Criar `tests/test-integration.js` que valida toda a chain:

```javascript
// Rodar: cd agentes-sistema && node tests/test-integration.js

const assert = require('assert');
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';

const { initialize } = require('../src/models/database');
initialize();

console.log('\n=== 1. SKILLS KNOWLEDGE ===');
const sk = require('../src/services/skills-knowledge');
const agents = ['carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'diana'];
for (const a of agents) {
  const k = sk.getKnowledgeForAgent(a);
  assert(k && k.length > 100, `${a}: sem knowledge`);
  console.log(`[OK] ${a}: ${k.length} chars`);
}

// Testar que Marcos recebe MULTIPLAS secoes do demandgen.md
const marcosCtx = sk.getCompactContext('marcos', 'demand-gen');
assert(marcosCtx.includes('PLAYBOOK') || marcosCtx.includes('FULL-FUNNEL'), 'Marcos nao recebe demand-gen');
console.log(`[OK] marcos/demand-gen: ${marcosCtx.length} chars`);

// Testar MAX_CONTEXT_CHARS
for (const a of agents) {
  const ctx = sk.getCompactContext(a, 'general');
  assert(ctx.length <= 9000, `${a}: contexto muito grande (${ctx.length})`);
}
console.log('[OK] Todos dentro do limite de chars');

console.log('\n=== 2. TRAINING ===');
const training = require('../src/services/training');
const id = training.learn('carlos', 'abordagem_eficaz', 'ISPs de MG respondem melhor com ROI');
assert(id, 'learn falhou');
training.recordSuccess(id);
const rules = training.getRulesForAgent('carlos');
assert(rules.length > 0, 'sem regras');
const ctx = training.getTrainingContext('carlos');
assert(ctx.includes('ISPs de MG'), 'contexto nao contem regra');
training.disable(id);
console.log('[OK] Training: learn, success, context, disable');

console.log('\n=== 3. TABELA AVALIACOES ===');
const { getDb } = require('../src/models/database');
const db = getDb();
try {
  db.prepare('SELECT COUNT(*) as c FROM avaliacoes').get();
  console.log('[OK] Tabela avaliacoes existe');
} catch (e) {
  console.log('[FAIL] Tabela avaliacoes NAO existe — rodar TAREFA 3a');
}

console.log('\n=== 4. INFERENCIA DE TASK TYPE ===');
const claude = require('../src/services/claude');
if (typeof claude._inferTaskType === 'function') {
  assert(claude._inferTaskType('quanto custa o plano?') === 'pricing', 'pricing nao detectado');
  assert(claude._inferTaskType('quero uma demo') === 'sales', 'sales nao detectado');
  assert(claude._inferTaskType('oi tudo bem') === 'general', 'general nao detectado');
  console.log('[OK] _inferTaskType funciona');
} else {
  console.log('[FAIL] _inferTaskType NAO existe — rodar TAREFA 2');
}

console.log('\n=== DONE ===');
```

---

## RESUMO EXECUTIVO

| # | O que | Arquivo | Status |
|---|-------|---------|--------|
| 1 | Corrigir _extractSection (multi-match) | skills-knowledge.js | BUG — retorna so 1 secao |
| 2 | Adicionar _inferTaskType | claude.js | FALTA — taskType sempre 'general' |
| 3 | Sistema de avaliacao supervisor | training.js + database.js + orchestrator.js + api.js | FALTA — fluxo documentado mas nao implementado |
| 4 | Handoff automatico por score | orchestrator.js | VERIFICAR — pode ja existir |
| 5 | Conectar training com taskType | training.js | MELHORIA — enriquecer contexto |
| 6 | Testes de integracao | tests/test-integration.js | CRIAR |

**Prioridade:** TAREFA 1 e 2 primeiro (afetam toda resposta), depois 3 (core do treinamento continuo), depois 4, 5, 6.

**IMPORTANTE:** Antes de modificar qualquer arquivo, leia o conteudo ATUAL completo. Nao sobrescreva codigo existente que funciona. Faca alteracoes cirurgicas. Rode os testes depois.
