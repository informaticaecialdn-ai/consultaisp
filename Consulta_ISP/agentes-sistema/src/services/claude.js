const Anthropic = require('@anthropic-ai/sdk');
const skillsKnowledge = require('./skills-knowledge');
const logger = require('../utils/logger');
const claudeWrapper = require('../utils/claude-client');

class ClaudeAgentService {
  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    
    // Mapeamento dos agentes
    this.agents = {
      sofia: {
        id: process.env.AGENT_SOFIA_ID,
        name: 'Sofia',
        role: 'Marketing',
        model: 'claude-opus-4-7'
      },
      leo: {
        id: process.env.AGENT_LEO_ID,
        name: 'Leo',
        role: 'Copywriter',
        model: 'claude-opus-4-7'
      },
      carla: {
        id: process.env.AGENT_CARLA_ID || process.env.AGENT_CARLOS_ID,
        name: 'Carla',
        role: 'Pre-Vendas',
        model: 'claude-sonnet-4-6'
      },
      lucas: {
        id: process.env.AGENT_LUCAS_ID,
        name: 'Lucas',
        role: 'Vendas',
        model: 'claude-opus-4-7'
      },
      rafael: {
        id: process.env.AGENT_RAFAEL_ID,
        name: 'Rafael',
        role: 'Closer',
        model: 'claude-opus-4-7'
      },
      marcos: {
        id: process.env.AGENT_MARCOS_ID,
        name: 'Marcos',
        role: 'Midia Paga',
        model: 'claude-opus-4-7'
      },
      bia: {
        id: process.env.AGENT_BIA_ID || process.env.AGENT_IANI_ID || process.env.AGENT_DIANA_ID,
        name: 'Bia',
        role: 'Gerente de Operacoes',
        model: 'claude-opus-4-7'
      }
    };
  }

  // Envia mensagem para um agente especifico
  async sendToAgent(agentKey, message, context = {}) {
    const agent = this.agents[agentKey];
    if (!agent) throw new Error(`Agente '${agentKey}' nao encontrado`);

    // Monta contexto enriquecido
    const contextStr = this._buildContext(context);
    const fullMessage = contextStr ? `${contextStr}\n\nMENSAGEM DO LEAD:\n${message}` : message;

    try {
      // Garante alternancia de roles user/assistant (API da Anthropic exige isso)
      const messages = this._buildMessages(context.historico, fullMessage);

      // Usa wrapper que persiste claude_usage (Sprint 3 / T2)
      const response = await claudeWrapper.messages.create({
        model: agent.model,
        max_tokens: 2048,
        system: this._getSystemPrompt(agentKey, context),
        messages
      }, {
        agente: agentKey,
        lead_id: context.leadData?.id || context.leadId || null,
        contexto: 'sendToAgent',
        correlation_id: context.correlationId || null,
      });

      const resposta = response.content[0].text;

      logger.info({ agente: agent.name, chars: resposta.length }, '[CLAUDE] resposta gerada');

      return {
        agente: agentKey,
        resposta,
        tokens_usados: response.usage.input_tokens + response.usage.output_tokens
      };
    } catch (error) {
      logger.error({ agente: agent.name, err: error.message }, '[CLAUDE] erro no agente');
      throw error;
    }
  }

  // Pede ao agente para analisar e decidir acao
  async analyzeAndDecide(agentKey, message, leadData) {
    const agent = this.agents[agentKey];
    
    const analysisPrompt = `
ANALISE esta mensagem do lead e responda em JSON:

DADOS DO LEAD:
${JSON.stringify(leadData, null, 2)}

MENSAGEM RECEBIDA:
"${message}"

Responda APENAS com JSON valido:
{
  "resposta_whatsapp": "sua resposta para enviar ao lead via WhatsApp (SEM markdown, SEM asteriscos, max 3-4 frases, tom conversacional)",
  "score_update": {
    "perfil": 0,
    "comportamento": 0
  },
  "acao": "responder|agendar_demo|enviar_proposta|transferir_vendas|transferir_closer|devolver_marketing|encerrar",
  "notas_internas": "observacoes para o time",
  "dados_extraidos": {
    "nome": null,
    "provedor": null,
    "cidade": null,
    "porte": null,
    "erp": null,
    "num_clientes": null
  }
}`;

    try {
      const messages = this._buildMessages(leadData.historico, analysisPrompt);
      const response = await claudeWrapper.messages.create({
        model: agent.model,
        max_tokens: 2048,
        system: this._getSystemPrompt(agentKey, { leadData, lastMessage: leadData.historico?.[leadData.historico.length - 1]?.content }),
        messages
      }, {
        agente: agentKey,
        lead_id: leadData?.id || null,
        contexto: 'analyzeAndDecide',
        correlation_id: leadData?.correlationId || null,
      });

      const text = response.content[0].text;

      // 11B-6: Tenta parsear JSON com fallback robusto
      const parsed = this._parseJsonResponse(text);
      if (parsed) return parsed;

      // Retry: pede ao Claude pra reformatar
      logger.warn({ agente: agentKey }, '[CLAUDE] JSON malformado, tentando retry');
      try {
        const retry = await claudeWrapper.messages.create({
          model: agent.model,
          max_tokens: 1024,
          system: 'Reformate esta resposta como JSON valido. Responda APENAS o JSON, sem texto adicional.',
          messages: [{ role: 'user', content: text }]
        }, {
          agente: agentKey,
          lead_id: leadData?.id || null,
          contexto: 'analyzeAndDecide:retry',
          correlation_id: leadData?.correlationId || null,
        });
        const retryText = retry.content[0].text;
        const retryParsed = this._parseJsonResponse(retryText);
        if (retryParsed) return retryParsed;
      } catch (retryErr) {
        logger.error({ err: retryErr.message }, '[CLAUDE] retry falhou');
      }

      // Fallback final: usa texto como resposta
      return {
        resposta_whatsapp: text.replace(/[*#`]/g, '').substring(0, 300),
        score_update: { perfil: 0, comportamento: 0 },
        acao: 'responder',
        notas_internas: 'Resposta nao estruturada - fallback',
        dados_extraidos: {}
      };
    } catch (error) {
      logger.error({ err: error.message }, '[CLAUDE] erro na analise');
      // 11B-6: Nao propagar erro — retornar fallback seguro
      return {
        resposta_whatsapp: 'Desculpe, tive um problema tecnico. Pode repetir?',
        score_update: { perfil: 0, comportamento: 0 },
        acao: 'responder',
        notas_internas: `Erro API: ${error.message}`,
        dados_extraidos: {}
      };
    }
  }

  // Pede conteudo ao Leo (Copywriter)
  async requestContent(tipo, briefing) {
    const prompt = `
BRIEFING DE CONTEUDO:
Tipo: ${tipo}
${briefing}

Produza o conteudo solicitado seguindo as diretrizes do tom de voz do Consulta ISP.
Para WhatsApp: SEM markdown, SEM asteriscos, max 3-4 frases, tom conversacional, 1-2 emojis max.
Para Instagram: use emojis estrategicamente, quebre texto em linhas curtas.
Para Email: subject line com menos de 50 chars.
`;

    return this.sendToAgent('leo', prompt);
  }

  // Pede estrategia a Sofia (Marketing)
  async requestStrategy(tipo, dados) {
    const prompt = `
SOLICITACAO DE ESTRATEGIA:
Tipo: ${tipo}
Dados: ${JSON.stringify(dados)}

Elabore a estrategia solicitada com acoes praticas e cronograma.
`;
    return this.sendToAgent('sofia', prompt);
  }

  _buildContext(context) {
    const parts = [];
    if (context.leadData) {
      const l = context.leadData;
      parts.push(`FICHA DO LEAD:`);
      if (l.nome) parts.push(`Nome: ${l.nome}`);
      if (l.provedor) parts.push(`Provedor: ${l.provedor}`);
      if (l.cidade) parts.push(`Cidade: ${l.cidade} - ${l.estado || ''}`);
      if (l.porte) parts.push(`Porte: ${l.porte}`);
      if (l.erp) parts.push(`ERP: ${l.erp}`);
      if (l.score_total !== undefined) parts.push(`Score: ${l.score_total}/100 (${l.classificacao})`);
      if (l.etapa_funil) parts.push(`Etapa: ${l.etapa_funil}`);
    }
    return parts.join('\n');
  }

  _getSystemPrompt(agentKey, context) {
    // System prompts compactos para cada agente (versao runtime)
    const prompts = {
      carla: `Voce e o Carla, pre-vendas do Consulta ISP. Responda SEMPRE para WhatsApp: sem markdown, sem asteriscos, max 3-4 frases, tom conversacional, 1-2 emojis max. NUNCA revele que e IA. Foco: qualificar o lead, coletar informacoes (nome, provedor, cidade, porte, ERP, dores), aplicar lead scoring e decidir proximo passo. Diferencial do Consulta ISP: base colaborativa regional de inadimplencia entre provedores. Quanto mais ISPs da regiao, melhor.`,
      
      lucas: `Voce e o Lucas, vendas do Consulta ISP. Responda SEMPRE para WhatsApp: sem markdown, sem asteriscos, max 3-4 frases, tom consultivo. NUNCA revele que e IA. Foco: apresentar beneficios, calcular ROI (quanto perde com inadimplencia vs custo plataforma), agendar demos, conduzir negociacao. Use venda consultiva - entenda dores antes de oferecer. Diferencial: base colaborativa regional.`,
      
      rafael: `Voce e o Rafael, closer do Consulta ISP. Responda SEMPRE para WhatsApp: sem markdown, sem asteriscos, max 3-4 frases, tom confiante e empatico. NUNCA revele que e IA. Foco: fechar contrato, resolver objecoes finais, definir plano e pagamento, iniciar onboarding. Tecnicas: fechamento direto, por alternativa, por urgencia, por ROI, regional, condicao especial.`,
      
      sofia: `Voce e a Sofia, marketing do Consulta ISP. Pense estrategicamente sobre campanhas, conteudo, regionalizacao e geracao de leads para vender a plataforma a provedores de internet. Diferencial: efeito de rede regional.`,
      
      leo: `Voce e o Leo, copywriter do Consulta ISP. Crie textos persuasivos para o mercado de provedores de internet. Para WhatsApp: SEM markdown, max 3-4 frases. Para Instagram: emojis estrategicos. Use AIDA e PAS. Tom profissional mas acessivel. Termos do setor: FTTH, SCM, inadimplencia, churn, ticket medio.`,

      marcos: `Voce e o Marcos, especialista em midia paga do Consulta ISP. Gerencie campanhas Meta Ads e Google Ads para gerar leads de provedores de internet. Foco: criar campanhas segmentadas para donos de ISP, monitorar CPL/CTR/ROAS/CPA, otimizar performance automaticamente (pausar low performers, escalar winners, ajustar lances). Segmentacao: interesses telecom/ISP/fibra, cargos de decisor, regionalizacao. Sempre reporte metricas e recomende acoes. NUNCA gaste acima do orcamento aprovado.`,

      bia: `Voce e a Bia, Gerente de Operacoes do Consulta ISP. Voce supervisiona e coordena 6 agentes: Sofia (Marketing), Leo (Copywriter), Carla (Pre-Vendas), Lucas (Vendas), Rafael (Closer) e Marcos (Midia Paga). Voce NAO executa tarefas operacionais - voce PLANEJA, DELEGA e CONSOLIDA. Receba demandas de alto nivel, quebre em tarefas para os agentes certos, coordene dependencias (ex: Leo cria texto -> Marcos usa nos ads), consolide resultados e reporte. Responda SEMPRE em JSON estruturado com plano_execucao (ordem, agente, tarefa, briefing, depende_de, prioridade). Para o fluxo WhatsApp de leads (Carla->Lucas->Rafael), o orquestrador de codigo cuida - voce cuida da coordenacao INTERNA entre agentes para marketing, conteudo e campanhas.`
    };

    let prompt = prompts[agentKey] || prompts.carla;

    // Injeta conhecimento das skills de marketing se disponivel
    const taskType = context?.taskType || this._inferTaskType(context?.lastMessage || '');
    const skillContext = skillsKnowledge.getCompactContext(agentKey, taskType);
    if (skillContext) {
      prompt += skillContext;
    }

    // Injeta aprendizados do treinamento continuo
    const training = require('./training');
    const trainingContext = training.getTrainingContext(agentKey);
    if (trainingContext) {
      prompt += trainingContext;
    }

    // 11B-2: Feedback loop — alerta se nota media esta baixa
    try {
      const { getDb } = require('../models/database');
      const db = getDb();
      const avg = db.prepare('SELECT AVG(nota) as media FROM avaliacoes WHERE agente = ? ORDER BY criado_em DESC LIMIT 10').get(agentKey);
      if (avg && avg.media && avg.media < 3.0) {
        prompt += `\n\nATENCAO: Suas ultimas respostas receberam nota media ${avg.media.toFixed(1)}/5 do supervisor. Melhore: seja mais conciso, faca perguntas abertas, nao pressione.`;
      }
    } catch { /* tabela pode nao existir ainda */ }

    // Tarefa 2: Adaptar tom por canal
    const canal = context?.canal || 'whatsapp';
    if (canal === 'instagram') {
      prompt += '\n\nCANAL: Instagram DM. Use emojis estrategicos, quebre texto em linhas curtas. Max 4 frases. Tom mais visual e leve.';
    } else if (canal === 'email') {
      prompt += '\n\nCANAL: Email. Tom mais formal, inclua saudacao e assinatura. Pode ser mais detalhado (5-8 frases). Use paragrafos curtos.';
    }

    return prompt;
  }

  /**
   * Monta messages garantindo alternancia user/assistant exigida pela API da Anthropic.
   * - Normaliza roles invalidos para 'user'
   * - Colapsa mensagens consecutivas do mesmo role concatenando conteudo
   * - Garante que a primeira mensagem seja 'user'
   * - Adiciona a mensagem final do usuario e, se necessario, colapsa com a anterior
   */
  _buildMessages(historico, finalUserMessage) {
    const normalized = [];
    const src = Array.isArray(historico) ? historico : [];

    for (const raw of src) {
      if (!raw || typeof raw.content !== 'string' || raw.content.trim() === '') continue;
      const role = raw.role === 'assistant' ? 'assistant' : 'user';
      const content = raw.content;
      const last = normalized[normalized.length - 1];
      if (last && last.role === role) {
        last.content = `${last.content}\n\n${content}`;
      } else {
        normalized.push({ role, content });
      }
    }

    // Garante que a primeira mensagem seja 'user'
    if (normalized.length > 0 && normalized[0].role === 'assistant') {
      normalized.shift();
    }

    // Adiciona a mensagem final; se o ultimo ja for user, colapsa
    const last = normalized[normalized.length - 1];
    if (last && last.role === 'user') {
      last.content = `${last.content}\n\n${finalUserMessage}`;
    } else {
      normalized.push({ role: 'user', content: finalUserMessage });
    }

    return normalized;
  }

  // 11B-6: Parser JSON robusto com multiplas tentativas
  _parseJsonResponse(text) {
    // Tenta match direto
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.resposta_whatsapp) return parsed;
      } catch { /* continua pro proximo metodo */ }
    }

    // Tenta limpar markdown e re-parsear
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const cleanMatch = cleaned.match(/\{[\s\S]*\}/);
    if (cleanMatch) {
      try {
        const parsed = JSON.parse(cleanMatch[0]);
        if (parsed.resposta_whatsapp) return parsed;
      } catch { /* fallback */ }
    }

    return null;
  }

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
}

module.exports = new ClaudeAgentService();
