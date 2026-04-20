#!/usr/bin/env node
// Gera src/data/mesorregiaos-ibge.json a partir da API oficial do IBGE.
// Roda 1x: node scripts/build-mesorregiaos.js
//
// API IBGE (publica, gratis, sem auth):
//   https://servicodados.ibge.gov.br/api/v1/localidades/estados
//   https://servicodados.ibge.gov.br/api/v1/localidades/estados/{uf}/municipios
//
// Cada municipio retornado inclui 'microrregiao.mesorregiao' com id+nome.
// Agrupa por mesorregiao e gera estrutura:
//   { "PR": { nome: "Parana", mesorregioes: { "<slug>": { nome, cidades: [...] } } } }

const fs = require('fs');
const path = require('path');

// UFs alvo — estados com maior densidade ISP no mercado BR. Pode expandir depois.
const TARGET_UFS = ['MG', 'SP', 'RS', 'PR', 'GO', 'BA', 'SC', 'RJ', 'ES', 'MT', 'MS', 'DF'];

function slugify(str) {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchEstados() {
  const all = await fetchJson('https://servicodados.ibge.gov.br/api/v1/localidades/estados');
  return all.filter((e) => TARGET_UFS.includes(e.sigla));
}

async function fetchMunicipiosDoEstado(uf) {
  return fetchJson(
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`
  );
}

async function main() {
  console.log(`[IBGE] fetching ${TARGET_UFS.length} estados...`);
  const estados = await fetchEstados();

  const output = {};
  let totalCidades = 0;
  let totalMesos = 0;

  for (const est of estados) {
    const uf = est.sigla;
    process.stdout.write(`[IBGE] ${uf} (${est.nome})... `);
    const municipios = await fetchMunicipiosDoEstado(uf);

    const mesorregioes = {};
    for (const m of municipios) {
      const meso = m.microrregiao?.mesorregiao;
      if (!meso) continue;
      const slug = slugify(meso.nome);
      if (!mesorregioes[slug]) {
        mesorregioes[slug] = { ibge_id: meso.id, nome: meso.nome, cidades: [] };
      }
      mesorregioes[slug].cidades.push(m.nome);
    }

    // Ordena cidades alfabeticamente
    for (const slug of Object.keys(mesorregioes)) {
      mesorregioes[slug].cidades.sort((a, b) =>
        a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
      );
    }

    output[uf] = { nome: est.nome, mesorregioes };
    totalMesos += Object.keys(mesorregioes).length;
    totalCidades += municipios.length;
    console.log(`${Object.keys(mesorregioes).length} mesorregioes, ${municipios.length} cidades`);
  }

  const outPath = path.join(__dirname, '..', 'src', 'data', 'mesorregiaos-ibge.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

  const bytes = fs.statSync(outPath).size;
  console.log(`\n[IBGE] OK: ${outPath}`);
  console.log(
    `  ${Object.keys(output).length} UFs | ${totalMesos} mesorregioes | ${totalCidades} cidades | ${(bytes / 1024).toFixed(1)}KB`
  );
}

main().catch((err) => {
  console.error('[IBGE] erro:', err);
  process.exit(1);
});
