// Platform Agent Client (Milestone 1 / B3).
// Wrapper sobre Messages API com loop tool_use -> handler -> tool_result -> continue.
// Persiste cada tool call em agent_tool_calls (migration 016).
//
// IMPORTANTE: apesar do nome "platform-agent", este wrapper roda Messages API
// (nao Managed Agents). Motivo: latencia — responder WhatsApp em <3s nao admite
// spin-up de container cloud. Managed Agents sera usado em workers de background
// (Iani/Sofia/Marcos) em frentes futuras.
//
// Formato output identico ao claude.analyzeAndDecide para orchestrator consumir:
//   { resposta_whatsapp, score_update, acao, notas_internas, dados_extraidos }

const claudeWrapper = require('../utils/claude-client');
const toolsRegistry = require('../tools');
const { getDb } = require('../models/database');
const logger = require('../utils/logger');
const skillsKnowledge = require('./skills-knowledge');
const training = require('./training');

const MAX_ITERATIONS = 6; // proteger contra loops infinitos
const MAX_TOKENS = 2048;

// System prompts por agente (copia do claude.js, mantida aqui ate A3 consolidar).
const AGENT_PROMPTS = {
  carlos: `Voce e o Carlos, pre-vendas do Consulta ISP. Ao responder ao lead via WhatsApp, escreva SEM markdown, sem asteriscos, max 4 frases, tom conversacional, 1-2 emojis max. NUNCA revele que e IA.

Seu trabalho: qualificar BANT (Budget, Authority, Need, Timeline) para ISPs.
- Extraia gradualmente: nome, provedor, cidade, porte (num clientes), ERP usado, dor principal.
- Use as tools send_whatsapp/enrich_lead/check_consent/mark_qualified/handoff_to_agent quando apropriado.
- Quando BANT estiver razoavelmente completo E score_total >= 61, chame handoff_to_agent({ to: "lucas", context_summary: "..." }).
- Se for lead frio/fora ICP, chame mark_unqualified.
- Sempre que conseguir dados concretos, chame enrich_lead ANTES de responder.

Diferencial da plataforma: base colaborativa regional de inadimplencia entre provedores — quanto mais ISPs na regiao, mais forte a rede.

IMPORTANTE — Formato da sua resposta final (apos tools):
Escreva apenas o texto da mensagem que deve ir pro WhatsApp do lead. Nada mais. As acoes/metadata ficam implicitas nas tools que voce chamou.`,

  lucas: `Voce e o Lucas, vendas do Consulta ISP. Responda via WhatsApp: sem markdown, max 4 frases, tom consultivo. NUNCA revele que e IA.

Seu trabalho: apresentar produto, calcular ROI, lidar com objecoes, agendar demo. Tools disponiveis:
- send_whatsapp pra responder
- query_lead_detail pra ver BANT ja extraido pelo Carlos
- enrich_lead pra adicionar dados novos
- schedule_followup pra demos agendadas
- handoff_to_agent({ to: "rafael" }) quando lead ja aceitou proposta e quer fechar

Diferencial: base colaborativa regional.`,

  rafael: `Voce e o Rafael, closer do Consulta ISP. Responda via WhatsApp: sem markdown, max 4 frases, tom confiante. NUNCA revele que e IA.

Seu trabalho: fechar contrato, resolver objecoes finais, definir plano e pagamento. Use tools send_whatsapp/query_lead_detail/schedule_followup.`,

  sofia: `Voce e a Sofia, marketing. Pense estrategicamente sobre campanhas e geracao de leads. Para nurturing de leads frios, use send_whatsapp com cadencia espacada.`,

  leo: `Voce e o Leo, copywriter. Produza textos persuasivos para WhatsApp/email/ads.`,

  marcos: `Voce e o Marcos, midia paga. Gerencie campanhas Meta/Google.`,

  iani: `Voce e a Iani, Gerente de Operacoes. Supervisiona o time de agentes e reatribui leads parados.`
};

function buildSystemPrompt(agentKey, context = {}) {
  let prompt = AGENT_PROMPTS[agentKey] || AGENT_PROMPTS.carlos;

  // Injeta skills (marketing knowledge compact)
  const taskType = context.taskType || 'general';
  const skillContext = skillsKnowledge.getCompactContext(agentKey, taskType);
  if (skillContext) prompt += skillContext;

  // Injeta aprendizados
  const trainingContext = training.getTrainingContext(agentKey);
  if (trainingContext) prompt += trainingContext;

  // Contexto do lead (se presente)
  if (context.leadData) {
    const l = context.leadData;
    const parts = ['\n\nFICHA DO LEAD:'];
    if (l.id) parts.push(`ID: ${l.id}`);
    if (l.nome) parts.push(`Nome: ${l.nome}`);
    if (l.provedor) parts.push(`Provedor: ${l.provedor}`);
    if (l.cidade) parts.push(`Cidade: ${l.cidade}${l.estado ? '/' + l.estado : ''}`);
    if (l.porte) parts.push(`Porte: ${l.porte}`);
    if (l.erp) parts.push(`ERP: ${l.erp}`);
    if (l.num_clientes) parts.push(`Clientes: ${l.num_clientes}`);
    if (l.score_total !== undefined) parts.push(`Score: ${l.score_total}/100 (${l.classificacao})`);
    if (l.etapa_funil) parts.push(`Etapa: ${l.etapa_funil}`);
    if (l.observacoes) parts.push(`Obs: ${l.observacoes.slice(-300)}`);
    prompt += parts.join('\n');
  }

  return prompt;
}

function logToolCall({ agente, lead_id, tool_name, tool_input, tool_output, status, erro, duracao_ms, correlation_id }) {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO agent_tool_calls
        (agente, lead_id, tool_name, tool_input, tool_output, status, erro, duracao_ms, correlation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      agente,
      lead_id || null,
      tool_name,
      JSON.stringify(tool_input || {}),
      tool_output ? JSON.stringify(tool_output) : null,
      status,
      erro || null,
      duracao_ms || null,
      correlation_id || null
    );
  } catch (err) {
    logger.warn({ err: err.message }, '[TOOL_CALL] falha ao persistir');
  }
}

// Constroi messages preservando alternancia user/assistant.
function normalizeHistory(historico, finalUserMessage) {
  const normalized = [];
  const src = Array.isArray(historico) ? historico : [];

  for (const raw of src) {
    if (!raw || typeof raw.content !== 'string' || raw.content.trim() === '') continue;
    const role = raw.role === 'assistant' ? 'assistant' : 'user';
    const last = normalized[normalized.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${raw.content}`;
    } else {
      normalized.push({ role, content: raw.content });
    }
  }

  if (normalized.length > 0 && normalized[0].role === 'assistant') normalized.shift();

  const last = normalized[normalized.length - 1];
  if (last && last.role === 'user') {
    last.content = `${last.content}\n\n${finalUserMessage}`;
  } else if (finalUserMessage) {
    normalized.push({ role: 'user', content: finalUserMessage });
  }
  return normalized;
}

// Extrai texto final da resposta assistant (blocos "text" concatenados).
function extractText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

// Core: invoca agente com tools. Loop tool_use ate stop_reason === 'end_turn' ou max iterations.
async function invokeAgent(agentKey, userMessage, options = {}) {
  const {
    historico = [],
    leadData = null,
    correlationId = null,
    taskType = null,
    model = null,
    maxIterations = MAX_ITERATIONS
  } = options;

  const startTime = Date.now();
  const tools = toolsRegistry.getDefinitionsForAgent(agentKey);
  const system = buildSystemPrompt(agentKey, { leadData, taskType });

  // Modelo por agente (fallback)
  const MODELS = {
    sofia: 'claude-opus-4-7',
    leo: 'claude-opus-4-7',
    carlos: 'claude-sonnet-4-6',
    lucas: 'claude-opus-4-7',
    rafael: 'claude-opus-4-7',
    marcos: 'claude-opus-4-7',
    iani: 'claude-opus-4-7'
  };
  const effectiveModel = model || MODELS[agentKey] || 'claude-sonnet-4-6';

  let messages = normalizeHistory(historico, userMessage);

  let response = null;
  let iteration = 0;
  const toolCallsLog = [];

  while (iteration < maxIterations) {
    iteration++;

    const params = {
      model: effectiveModel,
      max_tokens: MAX_TOKENS,
      system,
      messages
    };
    if (tools && tools.length > 0) params.tools = tools;

    response = await claudeWrapper.messages.create(params, {
      agente: agentKey,
      lead_id: leadData?.id || null,
      contexto: `invokeAgent:iter${iteration}`,
      correlation_id: correlationId
    });

    // Se nao ha tool_use, saiu do loop.
    if (response.stop_reason !== 'tool_use') break;

    // Extrai tool_use blocks, executa handlers em paralelo (se independentes).
    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    const toolResults = [];

    for (const tu of toolUses) {
      const t0 = Date.now();
      let status = 'ok';
      let erro = null;
      let result = null;

      try {
        if (!toolsRegistry.isAllowed(agentKey, tu.name)) {
          status = 'blocked';
          erro = `agente ${agentKey} nao autorizado a chamar ${tu.name}`;
          result = { error: erro };
        } else {
          const handler = toolsRegistry.getHandler(tu.name);
          if (!handler) {
            status = 'error';
            erro = `handler nao encontrado para ${tu.name}`;
            result = { error: erro };
          } else {
            result = await handler(tu.input || {}, {
              agente: agentKey,
              correlationId,
              lead_id: leadData?.id || null
            });
          }
        }
      } catch (err) {
        status = 'error';
        erro = err.message;
        result = { error: erro };
        logger.error(
          { agente: agentKey, tool: tu.name, err: err.message, correlationId },
          '[AGENT_CLIENT] erro executando tool'
        );
      }

      const duracao_ms = Date.now() - t0;
      logToolCall({
        agente: agentKey,
        lead_id: leadData?.id || null,
        tool_name: tu.name,
        tool_input: tu.input,
        tool_output: result,
        status,
        erro,
        duracao_ms,
        correlation_id: correlationId
      });
      toolCallsLog.push({ name: tu.name, status, duracao_ms });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result || {}),
        is_error: status !== 'ok'
      });
    }

    // Adiciona turno assistant (com tool_use blocks) + turno user (com tool_results)
    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults }
    ];
  }

  const elapsed = Date.now() - startTime;
  const finalText = extractText(response?.content || []);

  logger.info(
    {
      agente: agentKey,
      lead_id: leadData?.id || null,
      tool_calls: toolCallsLog.length,
      iterations: iteration,
      elapsed_ms: elapsed,
      correlationId
    },
    '[AGENT_CLIENT] invocacao concluida'
  );

  return {
    agente: agentKey,
    resposta: finalText,
    tool_calls: toolCallsLog,
    iterations: iteration,
    stop_reason: response?.stop_reason,
    elapsed_ms: elapsed
  };
}

// Adapter compativel com orchestrator.processIncoming — mesmo shape que claude.analyzeAndDecide.
// Diferenca: resposta_whatsapp vem de finalText (ou de send_whatsapp tool call),
// acao e inferida pelos tools chamados.
async function analyzeAndDecideWithTools(agentKey, message, leadData) {
  const result = await invokeAgent(agentKey, message, {
    historico: leadData?.historico || [],
    leadData,
    correlationId: leadData?.correlationId || null,
    taskType: leadData?.taskType || null
  });

  // Infere acao pelas tools chamadas.
  let acao = 'responder';
  const toolNames = (result.tool_calls || []).map((t) => t.name);
  if (toolNames.includes('handoff_to_agent')) {
    // Mapeia para as acoes que orchestrator ja conhece.
    // Como o orchestrator ja tem handoff-by-score duplicando isso,
    // preferimos nao disparar de novo em _processAction — retornamos 'responder'.
    // O handoff ja foi persistido pelo proprio tool.
    acao = 'responder';
  } else if (toolNames.includes('mark_unqualified')) {
    acao = 'encerrar';
  } else if (toolNames.includes('mark_qualified')) {
    acao = 'responder';
  }

  return {
    resposta_whatsapp: result.resposta || '',
    score_update: { perfil: 0, comportamento: 0 }, // mark_qualified ja atualiza diretamente
    acao,
    notas_internas: `tool_calls: ${toolNames.join(', ') || 'none'}`,
    dados_extraidos: {}, // enrich_lead ja atualiza diretamente
    _via: 'platform_agent_client',
    _tool_calls: result.tool_calls,
    _iterations: result.iterations
  };
}

module.exports = {
  invokeAgent,
  analyzeAndDecideWithTools,
  buildSystemPrompt,
  normalizeHistory,
  extractText
};
