// Apify HTTP client (Sprint 7).
// Documentacao: https://docs.apify.com/api/v2
//
// Estrategia: dispara actor (POST /run-sync-get-dataset-items) e aguarda
// resultado em ate timeout. Para actors longos (>5min), usa POST /runs
// async + GET /runs/:id + GET /datasets/:id/items.

const logger = require('../utils/logger');

const BASE_URL = 'https://api.apify.com/v2';

class ApifyClient {
  constructor() {
    this.token = process.env.APIFY_TOKEN || null;
  }

  isConfigured() {
    return !!this.token;
  }

  _headers(extra = {}) {
    if (!this.token) throw new Error('APIFY_TOKEN ausente no .env');
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  // Lista actors do user logado (apenas verifica auth)
  async ping() {
    const r = await fetch(`${BASE_URL}/users/me`, {
      method: 'GET',
      headers: this._headers(),
    });
    if (!r.ok) throw new Error(`Apify ping falhou: HTTP ${r.status}`);
    return r.json();
  }

  // Executa actor de forma assincrona. Retorna run metadata imediato.
  // Use checkRun() + getDatasetItems() para acompanhar.
  async startRun(actorId, input = {}) {
    const url = `${BASE_URL}/acts/${encodeURIComponent(actorId)}/runs`;
    const r = await fetch(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(input),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`Apify startRun falhou: HTTP ${r.status} ${txt.slice(0, 200)}`);
    }
    const body = await r.json();
    return body.data; // { id, actId, status, defaultDatasetId, ... }
  }

  // Run sincrono ate 5min (Apify hard cap = 300s). Retorna direto items[].
  // Util pra actors rapidos como Google Maps Scraper com poucos resultados.
  async runSyncGetItems(actorId, input = {}, { timeoutSec = 240 } = {}) {
    const url = `${BASE_URL}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?timeout=${timeoutSec}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(input),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`Apify runSync falhou: HTTP ${r.status} ${txt.slice(0, 200)}`);
    }
    const items = await r.json();
    return items;
  }

  // GET status de um run (apify_run_id)
  async getRun(apifyRunId) {
    const r = await fetch(`${BASE_URL}/actor-runs/${encodeURIComponent(apifyRunId)}`, {
      headers: this._headers(),
    });
    if (!r.ok) throw new Error(`Apify getRun falhou: HTTP ${r.status}`);
    const body = await r.json();
    return body.data;
  }

  // GET items do dataset associado a um run
  async getDatasetItems(datasetId, { limit = 1000, offset = 0 } = {}) {
    const url = `${BASE_URL}/datasets/${encodeURIComponent(datasetId)}/items?limit=${limit}&offset=${offset}&clean=true&format=json`;
    const r = await fetch(url, {
      headers: this._headers(),
    });
    if (!r.ok) throw new Error(`Apify getDataset falhou: HTTP ${r.status}`);
    return r.json();
  }
}

const client = new ApifyClient();

// Catalogo dos actors mais relevantes pro nosso use case (prospeccao ISPs).
// label/description aparecem na UI; default_input fornece template.
const CATALOG = {
  'compass/crawler-google-places': {
    label: 'Google Maps Scraper',
    description: 'Lista provedores em uma regiao com telefone, endereco, site, reviews',
    cost_estimate_usd_per_1k: 4,
    target: 'leads novos por geografia',
    default_input: {
      searchStringsArray: ['provedor de internet'],
      locationQuery: 'Pouso Alegre, MG, Brazil',
      maxCrawledPlacesPerSearch: 50,
      language: 'pt-BR',
      maxImages: 0,
      includeReviews: false,
    },
  },
  'apify/website-content-crawler': {
    label: 'Website Content Crawler',
    description: 'Extrai texto/HTML de sites (util pra enriquecer leads existentes)',
    cost_estimate_usd_per_1k: 1,
    target: 'enriquecimento',
    default_input: {
      startUrls: [{ url: 'https://exemplo.com.br' }],
      maxRequestsPerCrawl: 10,
      maxResultsPerCrawl: 5,
    },
  },
  'lukaskrivka/google-maps-with-contact-details': {
    label: 'Google Maps + Email Extractor',
    description: 'Google Maps + visita o site pra pegar emails (mais lento, mais completo)',
    cost_estimate_usd_per_1k: 8,
    target: 'leads enriquecidos com email',
    default_input: {
      searchStringsArray: ['provedor de internet'],
      locationQuery: 'Pouso Alegre, MG, Brazil',
      maxCrawledPlacesPerSearch: 30,
      language: 'pt-BR',
    },
  },
  'poidata/email-extractor': {
    label: 'Email Extractor (by URL)',
    description: 'Extrai emails/telefones de uma lista de URLs (enriquece leads existentes sem contato)',
    cost_estimate_usd_per_1k: 2,
    target: 'enriquecimento de contato',
    default_input: {
      startUrls: [{ url: 'https://exemplo.com.br' }],
      maxDepth: 2,
      maxConcurrency: 5,
    },
  },
  'apify/contact-info-scraper': {
    label: 'Contact Info Scraper (social+contato)',
    description: 'Varre site do provedor e extrai: emails, telefones, linkedin, instagram, facebook',
    cost_estimate_usd_per_1k: 3,
    target: 'enriquecimento social + contato',
    default_input: {
      startUrls: [{ url: 'https://exemplo.com.br' }],
      maxDepth: 1,
      proxyConfiguration: { useApifyProxy: true },
    },
  },
};

function listCatalog() {
  return Object.entries(CATALOG).map(([actor_id, meta]) => ({ actor_id, ...meta }));
}

function getCatalogEntry(actorId) {
  return CATALOG[actorId] || null;
}

module.exports = { client, listCatalog, getCatalogEntry, CATALOG };
