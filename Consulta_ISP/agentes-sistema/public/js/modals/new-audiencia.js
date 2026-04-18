// Modal "Nova Audiencia" (Sprint 4 / T4). Tabs Estatica | Dinamica.
// Tab Dinamica: preview live de count com debounce 500ms.
(function () {
  const MODAL_ID = 'modal-new-audiencia';

  function ensureModal() {
    if (document.getElementById(MODAL_ID)) return;
    const m = document.createElement('div');
    m.id = MODAL_ID;
    m.className = 'modal';
    m.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9997;align-items:center;justify-content:center';
    m.innerHTML = `
      <div style="background:var(--card,#1a2234);border:1px solid var(--border,#2d3a4f);border-radius:12px;padding:24px;width:520px;max-width:92vw">
        <h2 style="margin:0 0 16px;font-size:1.1rem">Nova Audiencia</h2>
        <div style="display:flex;gap:8px;border-bottom:1px solid var(--border);margin-bottom:16px">
          <button data-tab="estatica" class="btn btn-ghost btn-sm" style="border-bottom:2px solid var(--blue)">Estatica</button>
          <button data-tab="dinamica" class="btn btn-ghost btn-sm">Dinamica</button>
        </div>

        <input id="na-nome" type="text" placeholder="Nome" style="width:100%;margin-bottom:8px;padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
        <input id="na-descricao" type="text" placeholder="Descricao (opcional)" style="width:100%;margin-bottom:12px;padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text)" />

        <div id="na-tab-estatica">
          <label style="color:var(--muted);font-size:.8rem">Lead IDs (um por linha, ou CSV)</label>
          <textarea id="na-lead-ids" rows="5" placeholder="1
2
3" style="width:100%;padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:monospace"></textarea>
        </div>

        <div id="na-tab-dinamica" style="display:none">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
            <select id="na-classificacao" style="padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text)">
              <option value="">(qualquer classificacao)</option>
              <option value="frio">frio</option><option value="morno">morno</option>
              <option value="quente">quente</option><option value="ultra_quente">ultra_quente</option>
            </select>
            <select id="na-etapa" style="padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text)">
              <option value="">(qualquer etapa)</option>
              <option value="novo">novo</option><option value="prospeccao">prospeccao</option>
              <option value="qualificacao">qualificacao</option><option value="demo_agendada">demo_agendada</option>
              <option value="proposta_enviada">proposta_enviada</option><option value="negociacao">negociacao</option>
              <option value="convertido">convertido</option><option value="nurturing">nurturing</option>
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
            <input id="na-score-min" type="number" min="0" max="100" placeholder="score_min" style="padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
            <input id="na-score-max" type="number" min="0" max="100" placeholder="score_max" style="padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
          </div>
          <input id="na-regiao" type="text" placeholder="regiao (opcional)" style="width:100%;margin-bottom:8px;padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
          <label style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:.82rem;margin-bottom:12px">
            <input id="na-tem-optin" type="checkbox" />
            Apenas leads com opt-in explicito
          </label>
          <div id="na-count" style="padding:10px;background:var(--bg2);border:1px dashed var(--border);border-radius:6px;font-size:.85rem;color:var(--muted);margin-bottom:12px">
            Preview: <strong id="na-count-val">--</strong> leads correspondem
          </div>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost" id="na-cancel">Cancelar</button>
          <button class="btn btn-primary" id="na-save">Criar</button>
        </div>
      </div>`;
    document.body.appendChild(m);

    // Handlers
    m.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        m.querySelectorAll('[data-tab]').forEach(b => b.style.borderBottom = '2px solid transparent');
        btn.style.borderBottom = '2px solid var(--blue)';
        const tab = btn.dataset.tab;
        m.querySelector('#na-tab-estatica').style.display = tab === 'estatica' ? 'block' : 'none';
        m.querySelector('#na-tab-dinamica').style.display = tab === 'dinamica' ? 'block' : 'none';
        m.dataset.tipo = tab;
      });
    });
    m.dataset.tipo = 'estatica';

    m.querySelector('#na-cancel').addEventListener('click', close);
    m.querySelector('#na-save').addEventListener('click', save);

    // Debounced live count
    let debounce = null;
    const inputs = ['#na-classificacao', '#na-etapa', '#na-score-min', '#na-score-max', '#na-regiao', '#na-tem-optin'];
    inputs.forEach(sel => {
      m.querySelector(sel).addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(updateCount, 500);
      });
    });
  }

  function readFiltros() {
    const m = document.getElementById(MODAL_ID);
    const filtros = {};
    const c = m.querySelector('#na-classificacao').value;
    if (c) filtros.classificacao = c;
    const e = m.querySelector('#na-etapa').value;
    if (e) filtros.etapa_funil = e;
    const smin = parseInt(m.querySelector('#na-score-min').value);
    if (Number.isFinite(smin)) filtros.score_min = smin;
    const smax = parseInt(m.querySelector('#na-score-max').value);
    if (Number.isFinite(smax)) filtros.score_max = smax;
    const r = m.querySelector('#na-regiao').value.trim();
    if (r) filtros.regiao = r;
    if (m.querySelector('#na-tem-optin').checked) filtros.tem_optin = true;
    return filtros;
  }

  async function updateCount() {
    const m = document.getElementById(MODAL_ID);
    if (m.dataset.tipo !== 'dinamica') return;
    const filtros = readFiltros();
    try {
      const r = await api('/audiencias/count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filtros }),
      });
      m.querySelector('#na-count-val').textContent = r.total ?? '--';
    } catch {
      m.querySelector('#na-count-val').textContent = '?';
    }
  }

  function open() { ensureModal(); document.getElementById(MODAL_ID).style.display = 'flex'; }
  function close() { const m = document.getElementById(MODAL_ID); if (m) m.style.display = 'none'; }

  async function save() {
    const m = document.getElementById(MODAL_ID);
    const nome = m.querySelector('#na-nome').value.trim();
    const descricao = m.querySelector('#na-descricao').value.trim() || null;
    const tipo = m.dataset.tipo;
    if (!nome) { alert('nome obrigatorio'); return; }

    const body = { tipo, nome, descricao };
    if (tipo === 'estatica') {
      const raw = m.querySelector('#na-lead-ids').value.trim();
      body.lead_ids = raw
        .split(/[\s,;\n]+/)
        .map(s => parseInt(s))
        .filter(Number.isFinite);
    } else {
      body.filtros = readFiltros();
    }

    const res = await api('/audiencias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res?.audiencia) {
      close();
      if (typeof window.loadAudiencias === 'function') window.loadAudiencias();
    }
  }

  window.openNewAudienciaModal = open;
  window.closeNewAudienciaModal = close;
})();
