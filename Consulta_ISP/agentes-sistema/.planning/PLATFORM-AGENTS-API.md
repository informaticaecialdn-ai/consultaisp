# Platform Agents API — Research B1

**Data:** 2026-04-19
**Autor:** Claude (Opus 4.7)
**Status:** Research concluida — recomendacao arquitetural abaixo

---

## 1. O que sao os agentes em `platform.claude.com/workspaces`

Sao **Claude Managed Agents** (public beta desde **2026-04-08**). Documentacao:
- Overview: https://platform.claude.com/docs/en/managed-agents/overview
- Quickstart: https://platform.claude.com/docs/en/managed-agents/quickstart
- Beta header obrigatorio: `anthropic-beta: managed-agents-2026-04-01`

**NAO existe** endpoint simples do tipo `POST /v1/agents/{id}/invoke`. O modelo e mais rico:

### Conceitos
| Conceito | O que e |
|----------|---------|
| **Agent** | Config imutavel: model, system prompt, tools, MCP servers, skills. Tem `id` + `version`. |
| **Environment** | Template de container cloud: Python/Node/Go pre-instalado, regras de rede. Tem `id`. |
| **Session** | Instancia rodando do agent num environment. Tem `id` + file system persistente. |
| **Events** | Mensagens SSE trocadas: `user.message`, `agent.message`, `agent.tool_use`, `session.status_idle`. |

### Fluxo de invocacao (4 passos)
```
1. POST /v1/agents               → cria agent (1x, ja feito via UI)
2. POST /v1/environments         → cria environment cloud (1x por config)
3. POST /v1/sessions             → cria session { agent, environment_id }
4. POST /v1/sessions/{id}/events → envia user.message
5. GET  /v1/sessions/{id}/stream → SSE stream de eventos
```

### Exemplo Node.js (oficial)
```js
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic();

// 1. Agent (ja existe — pegamos por ID do .env)
// 2. Environment (criamos uma vez)
const env = await client.beta.environments.create({
  name: 'consulta-isp-env',
  config: { type: 'cloud', networking: { type: 'unrestricted' } }
});

// 3. Session (por interacao ou por lead)
const session = await client.beta.sessions.create({
  agent: process.env.AGENT_CARLOS_ID,
  environment_id: env.id,
  title: `Lead ${leadId} — Carlos`
});

// 4. Envia + 5. Stream
const stream = await client.beta.sessions.events.stream(session.id);
await client.beta.sessions.events.send(session.id, {
  events: [{ type: 'user.message', content: [{ type: 'text', text: inboundMsg }] }]
});

for await (const ev of stream) {
  if (ev.type === 'agent.message') { /* enviar pro WhatsApp */ }
  if (ev.type === 'agent.tool_use') { /* log */ }
  if (ev.type === 'session.status_idle') break;
}
```

### Rate limits
- Creates: 60/min (agents, sessions, environments)
- Reads: 600/min (stream, retrieve)

### Tools dos Managed Agents
Pre-built (dentro do container cloud):
- `agent_toolset_20260401`: bash, file operations, web search, web fetch
- **MCP servers**: CLAUDE CHAMA TOOLS NOSSAS via HTTP MCP

Custom tools arbitrarios (nosso codigo) **nao sao suportados diretamente** — a ponte e MCP.

### Features em research preview (requer request access)
- **Outcomes** (structured outputs)
- **Multi-agent** (subagents — nosso caso de Diana->Carlos->Lucas)
- **Memory** (cross-session)

---

## 2. Diagnose — encaixa no nosso caso?

### Caso A — Conversa WhatsApp em tempo real (Carlos/Lucas/Rafael)
```
Lead manda msg -> webhook Z-API -> Carlos responde em <3s
```

**Managed Agents NAO encaixa:**
- Cria container cloud por session → **latencia alta** (segundos de provisioning)
- Tools do agent rodam em container sandbox → precisaria MCP pra chamar nosso DB/Z-API
- MCP server adiciona mais um hop → mais latencia
- Cliente espera resposta rapida no WhatsApp

### Caso B — Tarefas autonomas de background (Diana/Sofia/Marcos)
```
Cron 1h em 1h -> Diana analisa funil, decide realocacoes
Cron semanal -> Sofia analisa conversoes, ajusta ICP
Cron diario -> Marcos A/B testa copys
```

**Managed Agents ENCAIXA:**
- Task longa (minutos) — ok
- Pode usar `bash` + `file ops` pra analisar dados
- MCP server local expoe nossas tools (query_leads, reassign_stuck, etc.)
- Latencia nao importa (cron)

---

## 3. Decisao arquitetural — HIBRIDO

### Path 1 (runtime principal, 95% dos casos): Messages API com tools custom

Para **conversa WhatsApp em tempo real**, migrar `claude.js` pra usar **Messages API com tools** (feature estavel, sem beta header, baixa latencia):

```js
// src/services/claude.js (alvo)
const response = await claudeWrapper.messages.create({
  model: agent.model,
  max_tokens: 2048,
  system: await this._getSystemPromptFromPlatform(agentKey),  // NOVO: cache do platform
  messages: [...historia, { role: 'user', content: message }],
  tools: toolsRegistry.getForAgent(agentKey)  // NOVO: 18 tools locais
}, { /* tracking ... */ });

// Loop tool_use -> handler -> tool_result -> continue
while (response.stop_reason === 'tool_use') {
  const toolUses = response.content.filter(b => b.type === 'tool_use');
  const toolResults = await Promise.all(toolUses.map(handleToolCall));
  response = await claudeWrapper.messages.create({
    model: agent.model,
    system: systemPrompt,
    messages: [...messages, { role: 'assistant', content: response.content }, { role: 'user', content: toolResults }],
    tools: tools
  });
}
```

**Vantagens:**
- Baixa latencia (sem container spin-up)
- Tools chamam nosso DB local diretamente (sync, sem MCP hop)
- Ja funciona com o `claude-client.js` wrapper (tracking de custo)
- `AGENT_*_ID` pode ser usado pra BUSCAR o system prompt via `GET /v1/agents/{id}` (sync do platform)

### Path 2 (autonomia background, 5% dos casos): Managed Agents + MCP

Para **tarefas autonomas de longa duracao** (Diana hourly, Sofia weekly, Marcos daily):

```js
// src/workers/supervisor.js (novo)
const session = await client.beta.sessions.create({
  agent: process.env.AGENT_DIANA_ID,
  environment_id: sharedEnvId,
  title: `Diana supervision ${new Date().toISOString()}`
});

// Injeta MCP config apontando pro nosso backend expondo tools
// Diana usa bash + file ops pra extrair snapshots + MCP tools pra executar decisoes
```

Requer:
- Expor MCP server local (`src/mcp-server.js`) com tools `reassign_stuck_leads`, `pause_campaign`, etc.
- 1 `environment` shared entre Diana/Sofia/Marcos
- Request access pro feature **multi-agent** (research preview)

**Por enquanto** (Milestone 1-2): **somente Path 1**. Managed Agents (Path 2) vira Milestone 3+.

---

## 4. Como sincronizar prompts do platform.claude.com com o codigo

**Hoje:** `claude.js:236-252` tem system prompts **hardcoded** (duplicados do platform).

**Alvo:** buscar do platform via `GET /v1/agents/{id}` com cache local 1h:

```js
// src/services/agent-config-sync.js (novo)
async function getAgentConfig(agentId) {
  const cached = cache.get(agentId);
  if (cached && Date.now() - cached.fetchedAt < 3600_000) return cached.data;

  const agent = await client.beta.agents.retrieve(agentId);
  const data = {
    name: agent.name,
    model: agent.model,
    system: agent.system,
    tools_on_platform: agent.tools,  // pode ignorar, usamos nossas tools locais
  };
  cache.set(agentId, { data, fetchedAt: Date.now() });
  return data;
}
```

**Beneficio:** usuario edita Carlos em platform.claude.com → mudanca reflete em ate 1h sem deploy.

---

## 5. Tools customizadas — formato Messages API

Ja estavel, nao requer beta:

```js
const tools = [
  {
    name: 'send_whatsapp',
    description: 'Envia mensagem WhatsApp ao lead via Z-API. Retorna confirmacao.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'integer', description: 'ID do lead no DB' },
        text: { type: 'string', description: 'Texto da mensagem — sem markdown, max 4 frases' }
      },
      required: ['lead_id', 'text']
    }
  },
  {
    name: 'check_consent',
    description: 'Verifica se o lead deu opt-in e ainda nao pediu opt-out.',
    input_schema: {
      type: 'object',
      properties: { lead_id: { type: 'integer' } },
      required: ['lead_id']
    }
  },
  // ... 16 mais (ver B2)
];
```

Handler local resolve:
```js
// src/tools/send_whatsapp.js
module.exports = {
  name: 'send_whatsapp',
  async handler({ lead_id, text }, { correlationId }) {
    const zapi = require('../services/zapi');
    const consent = require('../services/consent');
    const ok = consent.canSendTo(lead_id);
    if (!ok) return { error: 'no_consent' };
    const result = await zapi.sendMessage({ leadId: lead_id, text, correlationId });
    return { sent: true, messageId: result.messageId };
  }
};
```

---

## 6. Handoff entre agentes — como fazer

**Nao existe** handoff nativo no Messages API. Implementamos como tool:

```js
{
  name: 'handoff_to_agent',
  description: 'Transfere a conversa pra outro agente (ex: Carlos→Lucas apos qualificacao).',
  input_schema: {
    type: 'object',
    properties: {
      to: { type: 'string', enum: ['sofia', 'leo', 'carlos', 'lucas', 'rafael', 'marcos', 'diana'] },
      reason: { type: 'string', description: 'Motivo do handoff (ex: BANT qualificado, score 72)' },
      context_summary: { type: 'string', description: 'Resumo do que ja foi conversado' }
    },
    required: ['to', 'reason']
  }
}

// Handler:
async handler({ to, reason, context_summary }, { lead_id, correlationId }) {
  const db = getDb();
  db.prepare('INSERT INTO handoffs (lead_id, de_agente, para_agente, motivo, contexto) VALUES (?,?,?,?,?)')
    .run(lead_id, currentAgent, to, reason, context_summary);
  db.prepare('UPDATE leads SET agente_responsavel = ?, etapa_funil = ? WHERE id = ?')
    .run(to, mapAgentToEtapa(to), lead_id);
  return { handed_off: true, new_agent: to };
}
```

---

## 7. Proximos passos (B2-B8 do plano)

1. **B2** — Criar `src/tools/*.js` com 18 handlers.
2. **B3** — Criar `src/services/platform-agent-client.js` com loop tool_use.
3. **B4** — Migration 016 (`agent_tool_calls` para auditoria).
4. **B5** — Refatorar `orchestrator.processIncoming` pra usar novo client.
5. **B6** — PULAR (nao precisamos cadastrar tools no platform — sao locais).
6. **B7** — Feature flag `USE_PLATFORM_AGENTS=false` (default) → quando `true`, usa novo path.
   - **Renomear** pra `USE_TOOL_CALLING_AGENTS=true` pra nao confundir com Managed Agents.
7. **B8** — Tests E2E + dashboard card "Tool calls hoje".

**Milestone 3+ opcional**: Path 2 (Managed Agents pra Diana/Sofia/Marcos background).

---

## 8. Referencias

- [Managed Agents Overview](https://platform.claude.com/docs/en/managed-agents/overview)
- [Managed Agents Quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart)
- [Messages API Tool Use](https://docs.claude.com/en/docs/agents-and-tools/tool-use)
- [Anthropic Agents | Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/agents/providers/anthropic)
