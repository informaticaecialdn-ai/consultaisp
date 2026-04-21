// Gerador de landing page estatica por mesorregiao.
// Salva em public/landings/<slug>.html — servido direto pelo Express
// via public/ (ja configurado como static). Template Claude design.

const fs = require('fs');
const path = require('path');

const LANDINGS_DIR = path.join(__dirname, '../../public/landings');

function ensureDir() {
  if (!fs.existsSync(LANDINGS_DIR)) fs.mkdirSync(LANDINGS_DIR, { recursive: true });
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderTemplate({
  mesorregiao_slug,
  mesorregiao_nome,
  uf,
  cidades_principais = [],
  headline,
  subheadline,
  case_texto,
  num_provedores_regiao,
  cta_whatsapp_url,
  cta_calendly_url
}) {
  const cidadesList = cidades_principais.slice(0, 6).join(' · ');
  const headlineFinal = escHtml(headline || `Rede colaborativa de credito pra ISPs ${escHtml(mesorregiao_nome)}`);
  const subheadlineFinal = escHtml(subheadline || `Detecte calote antes da instalacao. Ja somos ${num_provedores_regiao || 'varios'} provedores ativos em ${escHtml(mesorregiao_nome)}.`);
  const caseTexto = escHtml(case_texto || `Provedores da regiao ja cortaram 40% da inadimplencia em 60 dias usando a base colaborativa.`);
  const whatsappUrl = escHtml(cta_whatsapp_url || 'https://wa.me/5535999999999');
  const calendlyUrl = escHtml(cta_calendly_url || process.env.CALENDLY_DEMO_URL || '#');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Consulta ISP — ${escHtml(mesorregiao_nome)} (${escHtml(uf)})</title>
<meta name="description" content="${subheadlineFinal}">
<meta property="og:title" content="Consulta ISP — ${escHtml(mesorregiao_nome)}">
<meta property="og:description" content="${subheadlineFinal}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
:root{--bg:#f5f4ed;--bg2:#faf9f5;--card:#fff;--border:#f0eee6;--border-warm:#e8e6dc;--text:#141413;--text-sec:#4d4c48;--muted:#5e5d59;--terracotta:#c96442;--coral:#d97757;--green:#5b7c5e}
body{background:var(--bg);color:var(--text);line-height:1.6}
.container{max-width:1080px;margin:0 auto;padding:0 24px}
header{padding:20px 0;border-bottom:1px solid var(--border-warm)}
.header-row{display:flex;justify-content:space-between;align-items:center}
.logo{font-family:'Newsreader',Georgia,serif;font-size:1.5rem;font-weight:500}
.cta-nav{padding:8px 18px;background:var(--terracotta);color:#faf9f5;border-radius:9999px;text-decoration:none;font-weight:500;font-size:.9rem}
.cta-nav:hover{background:#b85531}
.hero{padding:80px 0 60px;text-align:center}
h1{font-family:'Newsreader',Georgia,serif;font-size:3.2rem;font-weight:500;letter-spacing:-0.02em;line-height:1.1;color:var(--text);margin-bottom:24px}
.subheadline{font-size:1.2rem;color:var(--text-sec);max-width:720px;margin:0 auto 36px;line-height:1.55}
.pill-regiao{display:inline-block;padding:6px 16px;background:rgba(201,100,66,.1);color:var(--terracotta);border-radius:9999px;font-size:.82rem;font-weight:500;margin-bottom:20px;border:1px solid rgba(201,100,66,.3)}
.hero-ctas{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
.btn{display:inline-block;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:600;font-size:.95rem;transition:all .2s;border:1px solid transparent}
.btn-primary{background:var(--terracotta);color:#faf9f5;box-shadow:0 1px 3px rgba(201,100,66,.3)}
.btn-primary:hover{background:#b85531;transform:translateY(-1px)}
.btn-outline{background:var(--card);color:var(--text);border-color:var(--border-warm)}
.btn-outline:hover{background:var(--bg2)}
section{padding:60px 0;border-top:1px solid var(--border-warm)}
h2{font-family:'Newsreader',Georgia,serif;font-size:2rem;font-weight:500;margin-bottom:24px;letter-spacing:-0.01em}
.grid-3{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
.feature{background:var(--card);padding:28px;border-radius:14px;border:1px solid var(--border);box-shadow:0 0 0 1px var(--border-warm),rgba(0,0,0,.04) 0 2px 8px}
.feature h3{font-size:1.15rem;margin-bottom:10px}
.feature p{color:var(--text-sec);font-size:.95rem}
.case-box{background:var(--bg2);border:1px solid var(--border-warm);border-left:4px solid var(--terracotta);padding:28px;border-radius:12px;margin:24px 0;font-style:italic;color:var(--text-sec)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:20px;text-align:center}
.stat-big{font-family:'Newsreader',Georgia,serif;font-size:2.8rem;font-weight:500;color:var(--terracotta);line-height:1}
.stat-label{color:var(--muted);font-size:.85rem;margin-top:6px;text-transform:uppercase;letter-spacing:.5px}
.cta-final{text-align:center;background:var(--text);color:#faf9f5;padding:80px 24px;border-radius:16px;margin-top:40px}
.cta-final h2{color:#faf9f5}
.cta-final p{color:rgba(250,249,245,.7);margin-bottom:32px;font-size:1.1rem}
footer{padding:40px 0;color:var(--muted);font-size:.82rem;text-align:center}
.cidades-line{color:var(--muted);font-size:.9rem;margin-top:14px;font-style:italic}
@media (max-width:640px){h1{font-size:2.2rem}.subheadline{font-size:1.05rem}.hero{padding:50px 0 40px}section{padding:40px 0}}
</style>
</head>
<body>

<header>
  <div class="container header-row">
    <div class="logo">Consulta ISP</div>
    <a href="${whatsappUrl}" class="cta-nav">Falar com vendas</a>
  </div>
</header>

<section class="hero">
  <div class="container">
    <div class="pill-regiao">${escHtml(mesorregiao_nome)} · ${escHtml(uf)}</div>
    <h1>${headlineFinal}</h1>
    <p class="subheadline">${subheadlineFinal}</p>
    <div class="hero-ctas">
      <a href="${calendlyUrl}" class="btn btn-primary">Agendar demo 15min</a>
      <a href="${whatsappUrl}" class="btn btn-outline">Falar no WhatsApp</a>
    </div>
    ${cidadesList ? `<div class="cidades-line">Atendendo: ${escHtml(cidadesList)}</div>` : ''}
  </div>
</section>

<section>
  <div class="container">
    <div class="stats">
      <div><div class="stat-big">${escHtml(num_provedores_regiao || '—')}</div><div class="stat-label">Provedores na regiao</div></div>
      <div><div class="stat-big">40%</div><div class="stat-label">Corte inadimplencia</div></div>
      <div><div class="stat-big">&lt;2s</div><div class="stat-label">Tempo consulta</div></div>
      <div><div class="stat-big">R$690</div><div class="stat-label">Prejuizo medio/calote</div></div>
    </div>
  </div>
</section>

<section>
  <div class="container">
    <h2>Por que funciona em ${escHtml(mesorregiao_nome)}</h2>
    <p style="color:var(--text-sec);max-width:760px;margin-bottom:30px">
      Calote em provedor de internet e um fenomeno LOCAL. Cliente que deu calote numa ISP da regiao vai tentar contratar em outra ISP da mesma regiao — nao vai procurar provedor em Sao Paulo se voce ta no interior. Por isso a base colaborativa funciona melhor quando varios provedores da mesma mesorregiao participam.
    </p>
    <div class="case-box">${caseTexto}</div>
  </div>
</section>

<section>
  <div class="container">
    <h2>O que voce ganha</h2>
    <div class="grid-3">
      <div class="feature">
        <h3>Score colaborativo regional</h3>
        <p>Consulte CPF/CNPJ e veja o historico de inadimplencia em OUTROS provedores da sua regiao. Score em &lt;2 segundos.</p>
      </div>
      <div class="feature">
        <h3>Anti-fraude migracao serial</h3>
        <p>Alerta via WhatsApp &lt;5s quando um CPF e consultado por outro provedor da regiao — sinal de que cliente ta migrando pra calotear.</p>
      </div>
      <div class="feature">
        <h3>Rastreamento de equipamento</h3>
        <p>ONU/router/modem vinculados ao CPF. Cliente tenta contratar em outro provedor? O sistema avisa que ele ta com seu hardware.</p>
      </div>
      <div class="feature">
        <h3>Integracao ERP nativa</h3>
        <p>IXC, MK Solutions, SGP, Hubsoft, Voalle, RBX — sincronizacao direta. Zero entrada manual de dados.</p>
      </div>
      <div class="feature">
        <h3>Consulta em lote (500 CPFs)</h3>
        <p>Upload CSV com ate 500 CPFs — resultado em segundos. Util pra validar carteira atual.</p>
      </div>
      <div class="feature">
        <h3>LGPD compliant</h3>
        <p>Dados entre provedores sempre mascarados (nome parcial, faixa de valor). Fundamento legitimo interesse (art. 7 IX).</p>
      </div>
    </div>
  </div>
</section>

<section>
  <div class="container cta-final">
    <h2>Sua regiao esta esperando</h2>
    <p>Quanto mais provedores de ${escHtml(mesorregiao_nome)} entrarem, mais forte a rede. Venha agora — primeiros tem vantagem competitiva real.</p>
    <a href="${calendlyUrl}" class="btn btn-primary" style="background:var(--coral);font-size:1.05rem;padding:16px 36px">Agendar demo 15min</a>
  </div>
</section>

<footer>
  <div class="container">
    Consulta ISP — SaaS de analise de credito colaborativa pra provedores regionais<br>
    Pagina gerada para ${escHtml(mesorregiao_nome)} (${escHtml(uf)}) · LGPD · <a href="/lgpd" style="color:var(--muted)">Termos</a>
  </div>
</footer>

</body>
</html>`;
}

function buildLanding(params) {
  ensureDir();
  if (!params.mesorregiao_slug) throw new Error('mesorregiao_slug obrigatorio');
  const html = renderTemplate(params);
  const filename = `${params.mesorregiao_slug}.html`;
  const fullPath = path.join(LANDINGS_DIR, filename);
  fs.writeFileSync(fullPath, html, 'utf8');
  const publicUrl = `/landings/${filename}`;
  return { path: fullPath, filename, publicUrl, bytes: html.length };
}

function listLandings() {
  ensureDir();
  return fs.readdirSync(LANDINGS_DIR)
    .filter((f) => f.endsWith('.html'))
    .map((f) => ({ filename: f, publicUrl: `/landings/${f}`, slug: f.replace('.html', '') }));
}

module.exports = { buildLanding, listLandings, renderTemplate };
