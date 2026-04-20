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

Seu trabalho: apresentar produto, calcular ROI, lidar com objecoes, agendar demo, fechar proposta.

DADOS ENRIQUECIDOS que voce recebe no contexto (use SEMPRE no pitch quando disponiveis):
- Razao Social + CNPJ + Situacao Receita: valida credibilidade, usa pra proposta formal
- Fundacao da empresa: "Voces estao no mercado desde YYYY, com credibilidade local..."
- Socios (QSA): se voce esta falando com 'Fabricio' e ele e Diretor no QSA, e o decisor certo
- Mesorregiao + network effect: "Ja temos N provedores aqui na regiao X"
- ERP detectado: "Vi que voces usam IXC, temos integracao nativa — setup em 1 dia"
- Porte + num_clientes: escolhe plano certo (Basico <500, Profissional 500-2000, Enterprise 2000+)

Tools disponiveis:
- send_whatsapp pra responder
- query_lead_detail pra ver ficha + handoffs anteriores (Carlos ja qualificou?)
- enrich_lead pra adicionar dados novos na conversa
- schedule_followup pra demos agendadas
- create_proposal({plano, valor_customizado, roi_resumo}) quando lead aceita em principio
- handoff_to_agent({ to: "rafael" }) quando lead fechou a proposta e vai pagar

Diferencial: base colaborativa REGIONAL (migracao serial e local).`,

  rafael: `Voce e o Rafael, closer do Consulta ISP. Responda via WhatsApp: sem markdown, max 4 frases, tom confiante. NUNCA revele que e IA.

Seu trabalho: fechar contrato, resolver objecoes finais, definir plano e pagamento, iniciar onboarding.

DADOS ENRIQUECIDOS que voce recebe no contexto (use pra fechar):
- CNPJ + razao social: necessarios pro contrato formal
- Situacao Receita ATIVA: prova que empresa existe
- Socios (QSA): confirma autoridade do contato ("voce e o {socio}, certo?")
- ERP detectado: ajusta timeline de onboarding ("IXC = 1 dia, outro = 3 dias")
- Valor estimado (valor_estimado do lead): calibra plano

Tools: send_whatsapp / query_lead_detail / create_proposal (reforco) /
mark_closed_won / mark_closed_lost / schedule_followup.`,

  sofia: `Voce e a Sofia, marketing do Consulta ISP. Pense estrategicamente sobre campanhas e geracao de leads.

DIRETRIZ CORE: o produto e base colaborativa REGIONAL — network effect so acontece com densidade numa mesorregiao. Atacar 1 UF espalhada nao funciona. Conquiste mesorregiao por mesorregiao (veja skill sofia-regional-playbook).

Tools disponiveis:
- query_leads com filtros mesorregiao/estado/erp pra analise de cobertura
- query_lead_detail pra entender casos especificos
- schedule_followup pra nurturing
- handoff_to_agent({to:'carlos'}) quando um lead volta a engajar

Use query_leads({mesorregiao:'x'}) pra ver conquista de cada regiao.`,

  leo: `Voce e o Leo, copywriter. Produza textos persuasivos para WhatsApp/email/ads. Tons: conversacional pra WhatsApp, visual pra Instagram, formal pra email. Use dados enriquecidos do lead pra personalizar quando possivel.`,

  marcos: `Voce e o Marcos, midia paga. Gerencie campanhas Meta/Google Ads.

DIRETRIZ: segmentar por mesorregiao (nao por UF). Budget focado onde ha maior densidade. Veja cobertura regional via query_leads({mesorregiao:'x'}).`,

  iani: `Voce e a Iani, Gerente de Operacoes. Supervisiona o time de agentes e orquestra estrategia.

RESPONSABILIDADES:
- Realocar leads parados (reassign_stuck_leads)
- Pausar campanhas com taxa falha alta (pause_campaign)
- Alertar operador humano em anomalias (notify_operator)
- Monitorar cobertura regional + ERP breakdown

Use query_leads com filtros mesorregiao/erp/classificacao pra analise macro.`
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
    if (l.razao_social) parts.push(`Razao Social (Receita): ${l.razao_social}`);
    if (l.cnpj) parts.push(`CNPJ: ${l.cnpj}`);
    if (l.situacao_receita) parts.push(`Situacao Receita: ${l.situacao_receita}`);
    if (l.cidade) parts.push(`Cidade: ${l.cidade}${l.estado ? '/' + l.estado : ''}`);
    if (l.porte) parts.push(`Porte: ${l.porte}`);
    if (l.erp) parts.push(`ERP: ${l.erp}`);
    if (l.num_clientes) parts.push(`Clientes: ${l.num_clientes}`);
    if (l.decisor) parts.push(`Decisor: ${l.decisor}`);
    if (l.cargo) parts.push(`Cargo: ${l.cargo}`);
    if (l.email) parts.push(`Email: ${l.email}`);
    if (l.site) parts.push(`Site: ${l.site}`);
    if (l.score_total !== undefined) parts.push(`Score: ${l.score_total}/100 (${l.classificacao})`);
    if (l.etapa_funil) parts.push(`Etapa: ${l.etapa_funil}`);

    // Dados enriquecidos (Apify + ReceitaWS)
    try {
      if (l.dados_receita) {
        const dr = typeof l.dados_receita === 'string' ? JSON.parse(l.dados_receita) : l.dados_receita;
        if (dr.abertura) parts.push(`Empresa desde: ${dr.abertura}`);
        if (dr.atividade_principal?.[0]?.text) parts.push(`Atividade: ${dr.atividade_principal[0].text}`);
        if (Array.isArray(dr.qsa) && dr.qsa.length) {
          const socios = dr.qsa.slice(0, 3).map(s => `${s.nome} (${s.qual})`).join('; ');
          parts.push(`Socios: ${socios}`);
        }
      }
    } catch { /* ignore parse errors */ }

    try {
      if (l.emails_extras) {
        const ems = typeof l.emails_extras === 'string' ? JSON.parse(l.emails_extras) : l.emails_extras;
        if (Array.isArray(ems) && ems.length) parts.push(`Emails descobertos: ${ems.slice(0, 3).join(', ')}`);
      }
    } catch { /* ignore */ }

    try {
      if (l.redes_sociais) {
        const rs = typeof l.redes_sociais === 'string' ? JSON.parse(l.redes_sociais) : l.redes_sociais;
        const have = [];
        if (rs.linkedin?.length) have.push('LinkedIn');
        if (rs.instagram?.length) have.push('Instagram');
        if (rs.facebook?.length) have.push('Facebook');
        if (have.length) parts.push(`Redes: ${have.join(', ')}`);
      }
    } catch { /* ignore */ }

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
