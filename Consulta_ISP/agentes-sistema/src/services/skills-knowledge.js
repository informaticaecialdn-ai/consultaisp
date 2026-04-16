const fs = require('fs');
const path = require('path');

class SkillsKnowledgeService {
  constructor() {
    this.skillsDir = path.join(__dirname, '../../skills-ref');
    this.cache = new Map();
    this.cacheTimestamps = new Map();
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutos
  }

  // Carrega conhecimento de skill para um agente especifico
  getKnowledgeForAgent(agentKey) {
    const now = Date.now();
    const cachedAt = this.cacheTimestamps.get(agentKey) || 0;
    if (this.cache.has(agentKey) && (now - cachedAt) < this.CACHE_TTL) {
      return this.cache.get(agentKey);
    }

    const mapping = {
      marcos: [
        'skills-conhecimento-marcos-leo.md',
        'skills-conhecimento-demandgen.md'
      ],
      leo: [
        'skills-conhecimento-marcos-leo.md',
        'skills-conhecimento-emailseq.md',
        'skills-conhecimento-demandgen.md'
      ],
      carlos: [
        'skills-conhecimento-vendas-sofia.md',
        'skills-conhecimento-prospecao-pricing.md',
        'skills-conhecimento-emailseq.md'
      ],
      lucas: [
        'skills-conhecimento-vendas-sofia.md',
        'skills-conhecimento-prospecao-pricing.md'
      ],
      rafael: [
        'skills-conhecimento-vendas-sofia.md',
        'skills-conhecimento-prospecao-pricing.md'
      ],
      sofia: [
        'skills-conhecimento-vendas-sofia.md',
        'skills-conhecimento-demandgen.md',
        'skills-conhecimento-prospecao-pricing.md'
      ],
      diana: [
        'skills-conhecimento-marcos-leo.md',
        'skills-conhecimento-vendas-sofia.md',
        'skills-conhecimento-agentes-arch.md'
      ]
    };

    const files = mapping[agentKey] || [];
    let knowledge = '';

    for (const file of files) {
      const filePath = path.join(this.skillsDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const section = this._extractSection(content, agentKey);
        if (section) knowledge += section + '\n\n';
      } catch (e) {
        console.log(`[SKILLS] Arquivo ${file} nao encontrado. Skills de referencia desabilitadas para ${agentKey}.`);
      }
    }

    if (knowledge) {
      this.cache.set(agentKey, knowledge);
      this.cacheTimestamps.set(agentKey, now);
    }
    return knowledge || null;
  }

  // Extrai TODAS as secoes relevantes do arquivo de conhecimento (nao so a primeira)
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

  // Gera contexto de skills compacto para injetar na mensagem do agente
  getCompactContext(agentKey, taskType = 'general') {
    const knowledge = this.getKnowledgeForAgent(agentKey);
    if (!knowledge) return '';

    const MAX_CONTEXT_CHARS = 8000;

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
      result = knowledge.length > MAX_CONTEXT_CHARS
        ? knowledge.substring(0, MAX_CONTEXT_CHARS) + '\n\n[... truncado por limite]'
        : knowledge;
      return `\n\nBASE DE CONHECIMENTO:\n${result}`;
    }

    const sections = knowledge.split(/\n(?=##)/);
    const relevant = sections.filter(section => {
      const upper = section.toUpperCase();
      return filters.some(f => upper.includes(f));
    });

    if (relevant.length === 0) return '';

    result = relevant.join('\n\n');
    if (result.length > MAX_CONTEXT_CHARS) {
      result = result.substring(0, MAX_CONTEXT_CHARS) + '\n\n[... truncado por limite]';
    }

    return `\n\nBASE DE CONHECIMENTO (${taskType}):\n${result}`;
  }

  clearCache() {
    this.cache.clear();
    this.cacheTimestamps.clear();
    console.log('[SKILLS] Cache limpo');
  }
}

module.exports = new SkillsKnowledgeService();
