// Tools registry — Milestone 1 (B2).
// Cada tool exporta { name, description, input_schema, handler(input, ctx) }.
// Este arquivo agrega + distribui tools por agente (autorizacoes).

const send_whatsapp = require('./send_whatsapp');
const check_consent = require('./check_consent');
const check_window_24h = require('./check_window_24h');
const query_lead_detail = require('./query_lead_detail');
const query_leads = require('./query_leads');
const mark_qualified = require('./mark_qualified');
const mark_unqualified = require('./mark_unqualified');
const schedule_followup = require('./schedule_followup');
const enrich_lead = require('./enrich_lead');
const handoff_to_agent = require('./handoff_to_agent');
// Milestone 2/3 tools
const create_proposal = require('./create_proposal');
const mark_closed_won = require('./mark_closed_won');
const mark_closed_lost = require('./mark_closed_lost');
const reassign_stuck_leads = require('./reassign_stuck_leads');
const notify_operator = require('./notify_operator');
const { pause: pause_campaign, resume: resume_campaign } = require('./pause_campaign');
const lookup_cnpj = require('./lookup_cnpj');

const ALL_TOOLS = {
  send_whatsapp,
  check_consent,
  check_window_24h,
  query_lead_detail,
  query_leads,
  mark_qualified,
  mark_unqualified,
  schedule_followup,
  enrich_lead,
  handoff_to_agent,
  create_proposal,
  mark_closed_won,
  mark_closed_lost,
  reassign_stuck_leads,
  notify_operator,
  pause_campaign,
  resume_campaign,
  lookup_cnpj
};

// Autorizacao por agente (quem pode chamar o que).
// Sofia/Leo/Marcos tem tools adicionais que vem em frentes futuras (D, F).
// Diana tem leitura ampla + reassign (vem em F1).
const AGENT_TOOLS = {
  carlos: [
    'send_whatsapp',
    'check_consent',
    'check_window_24h',
    'query_lead_detail',
    'query_leads',
    'mark_qualified',
    'mark_unqualified',
    'schedule_followup',
    'enrich_lead',
    'handoff_to_agent',
    'lookup_cnpj'
  ],
  lucas: [
    'send_whatsapp',
    'check_consent',
    'check_window_24h',
    'query_lead_detail',
    'query_leads',
    'mark_qualified',
    'mark_unqualified',
    'schedule_followup',
    'enrich_lead',
    'handoff_to_agent',
    'create_proposal',
    'lookup_cnpj'
  ],
  rafael: [
    'send_whatsapp',
    'check_consent',
    'check_window_24h',
    'query_lead_detail',
    'query_leads',
    'schedule_followup',
    'enrich_lead',
    'handoff_to_agent',
    'create_proposal',
    'mark_closed_won',
    'mark_closed_lost',
    'lookup_cnpj'
  ],
  sofia: [
    'query_leads',
    'query_lead_detail',
    'schedule_followup',
    'handoff_to_agent',
    'lookup_cnpj'
    // + get_campaign_stats, suggest_icp_adjust, request_copy_from_leo (Frente F)
  ],
  leo: [
    'query_leads',
    'query_lead_detail'
    // + generate_copy_variant, save_template, query_templates, ab_test_setup (Frente F)
  ],
  marcos: [
    'query_leads'
    // + query_campaign_performance, ab_test_setup, ab_test_conclude, adjust_rate_limit (Frente F)
  ],
  diana: [
    'query_leads',
    'query_lead_detail',
    'handoff_to_agent',
    'reassign_stuck_leads',
    'notify_operator',
    'pause_campaign',
    'resume_campaign',
    'lookup_cnpj'
  ]
};

// Retorna array de tool definitions no formato Anthropic Messages API.
function getDefinitionsForAgent(agentKey) {
  const allowed = AGENT_TOOLS[agentKey] || [];
  return allowed.map((name) => {
    const t = ALL_TOOLS[name];
    if (!t) throw new Error(`Tool nao registrada: ${name}`);
    return {
      name: t.name,
      description: t.description,
      input_schema: t.input_schema
    };
  });
}

// Retorna handler por nome (para executar apos tool_use).
function getHandler(name) {
  const t = ALL_TOOLS[name];
  return t ? t.handler : null;
}

function isAllowed(agentKey, toolName) {
  const allowed = AGENT_TOOLS[agentKey] || [];
  return allowed.includes(toolName);
}

function listAll() {
  return Object.keys(ALL_TOOLS);
}

module.exports = {
  ALL_TOOLS,
  AGENT_TOOLS,
  getDefinitionsForAgent,
  getHandler,
  isAllowed,
  listAll
};
