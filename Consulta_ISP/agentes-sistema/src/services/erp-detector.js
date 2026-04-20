// ERP Detector — identifica qual ERP um provedor ISP usa a partir de evidencias
// no site/portal. Roda apos o Apify contact-info-scraper e procura footprints:
//  - URLs do portal do assinante
//  - strings/classes/meta tags no HTML
//  - emails corporativos do fornecedor
//
// ERPs suportados (ordem de confianca do match):
//  - ixc       (IXC Soft / IXCSoft) — lider de mercado BR ISP
//  - mk        (MK Solutions / MK-Auth)
//  - sgp       (SGP — Sistema Gerencial Provedor)
//  - hubsoft   (Hubsoft)
//  - voalle    (Voalle)
//  - rbx       (RBX / RBXSoft / RouterBox)
//  - topsapp   (TopSApp)
//  - radiusnet (RadiusNet)
//  - gere      (Gere)
//
// Se nenhum bate, retorna null (lead.erp fica sem ser setado,
// e Carla pergunta o ERP durante a conversa).

const PATTERNS = {
  ixc: {
    label: 'IXC Soft',
    // Fortes (URL path ou subdominio)
    urls: [
      /ixcsoft\.com\.br/i,
      /ixcprovedor\.com/i,
      /central_assinante_web/i,
      /\/central\/ixc\b/i,
      /\.ixc\.com\.br\//i
    ],
    // Moderados (conteudo HTML)
    content: [
      /IXC\s*Soft/i,
      /Powered by IXC/i,
      /ixc-web/i,
      /class="[^"]*ixc-/i,
      /\bixc_soft\b/i,
      /central\s+do\s+assinante\s+ixc/i
    ]
  },
  mk: {
    label: 'MK Solutions',
    urls: [
      /mk-auth\b/i,
      /mkauth\b/i,
      /mksolutions\.com\.br/i,
      /mk\.com\.br/i,
      /central\/mkauth/i,
      /cliente\.mk-auth/i
    ],
    content: [
      /MK\s*Solutions/i,
      /MK-Auth/i,
      /\bmkauth\b/i,
      /Powered by MK/i,
      /central\s+do\s+assinante\s+mk/i
    ]
  },
  sgp: {
    label: 'SGP',
    urls: [
      /sgp\.net\.br/i,
      /sgpweb/i,
      /central\/sgp/i,
      /portal\.sgp/i
    ],
    content: [
      /\bSGP\s*Web\b/i,
      /\bSistema\s+Gerencial\s+de\s+Provedor/i,
      /central\s+do\s+assinante\s+sgp/i,
      /sgp-client/i
    ]
  },
  hubsoft: {
    label: 'Hubsoft',
    urls: [
      /hubsoft\.com\.br/i,
      /\.hubsoft\./i,
      /\/ClienteArea/i,
      /central\/hubsoft/i
    ],
    content: [
      /\bHubsoft\b/i,
      /Powered by Hubsoft/i,
      /class="[^"]*hubsoft-/i,
      /api\.hubsoft/i
    ]
  },
  voalle: {
    label: 'Voalle',
    urls: [
      /voalle\.com\.br/i,
      /grupovoalle\.com\.br/i,
      /central-assinante-voalle/i,
      /central\/voalle/i
    ],
    content: [
      /\bVoalle\b/i,
      /Grupo Voalle/i,
      /voalle-app/i
    ]
  },
  rbx: {
    label: 'RBX ISP',
    urls: [
      /rbxsoft\.com\.br/i,
      /rbx\.com\.br/i,
      /routerbox/i,
      /rbx_server_json\.php/i
    ],
    content: [
      /\bRBX\s*Soft\b/i,
      /\bRouterBox\b/i,
      /\bRBX\s*ISP\b/i
    ]
  },
  topsapp: {
    label: 'TopSApp',
    urls: [/topsapp\.com\.br/i, /tops-app/i],
    content: [/\bTopSApp\b/i, /Tops ERP/i]
  },
  radiusnet: {
    label: 'RadiusNet',
    urls: [/radiusnet\.com\.br/i, /central\/radiusnet/i],
    content: [/\bRadiusNet\b/i, /Radius Net ISP/i]
  },
  gere: {
    label: 'Gere',
    urls: [/gere\.com\.br/i, /geretelecom/i],
    content: [/\bGere ERP\b/i, /gere-cliente/i]
  }
};

// Score por categoria (urls vale mais que content porque e menos ambiguo)
const WEIGHTS = { urls: 10, content: 3 };

// Recebe texto + lista de URLs observadas (emails, sites). Retorna { erp, confidence, evidence } ou null
function detect({ text = '', urls = [] } = {}) {
  if (!text && urls.length === 0) return null;

  const haystackText = String(text);
  const haystackUrls = urls.map(String).join('\n');
  const scores = {}; // erp -> { score, matches: [{ kind, pattern }] }

  for (const [erp, cfg] of Object.entries(PATTERNS)) {
    let score = 0;
    const matches = [];

    // URL patterns (pesam mais)
    for (const pat of cfg.urls || []) {
      if (pat.test(haystackUrls) || pat.test(haystackText)) {
        score += WEIGHTS.urls;
        matches.push({ kind: 'url', pattern: pat.source });
      }
    }
    // Content patterns
    for (const pat of cfg.content || []) {
      if (pat.test(haystackText)) {
        score += WEIGHTS.content;
        matches.push({ kind: 'content', pattern: pat.source });
      }
    }

    if (score > 0) scores[erp] = { score, matches };
  }

  if (Object.keys(scores).length === 0) return null;

  // Vencedor pelo score
  const winner = Object.entries(scores).sort((a, b) => b[1].score - a[1].score)[0];
  const [erp, data] = winner;

  // Confianca: alta se tem 1+ URL match OU 2+ content matches
  const urlMatches = data.matches.filter(m => m.kind === 'url').length;
  const contentMatches = data.matches.filter(m => m.kind === 'content').length;

  let confidence = 'baixa';
  if (urlMatches >= 1) confidence = 'alta';
  else if (contentMatches >= 2) confidence = 'media';

  return {
    erp,
    label: PATTERNS[erp].label,
    confidence,
    score: data.score,
    matches_count: data.matches.length,
    evidence: data.matches.slice(0, 3)
  };
}

// Detecta a partir de um item retornado pelo Apify contact-info-scraper.
// Item tipico tem: url, text, emails, phones, linkedIns, etc.
function detectFromApifyItem(item) {
  if (!item) return null;
  const urls = [];
  if (item.url) urls.push(item.url);
  if (item.loadedUrl) urls.push(item.loadedUrl);
  if (Array.isArray(item.emails)) urls.push(...item.emails);
  // Emails contem padrao @dominio que pode ter o ERP no nome
  const text = JSON.stringify(item); // inclui textos, redes, links
  return detect({ text, urls });
}

function listSuportados() {
  return Object.entries(PATTERNS).map(([slug, cfg]) => ({ slug, label: cfg.label }));
}

module.exports = { detect, detectFromApifyItem, listSuportados, PATTERNS };
