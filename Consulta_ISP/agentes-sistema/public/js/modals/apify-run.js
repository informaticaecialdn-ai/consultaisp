// Modal "Prospeccao Apify" (Sprint 7).
// Lista actors do catalogo, deixa configurar input, dispara sync e mostra resultado.

(function () {
  const MODAL_ID = 'modal-apify-run';

  async function openModal() {
    let m = document.getElementById(MODAL_ID);
    if (!m) {
      m = document.createElement('div');
      m.id = MODAL_ID;
      m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9997;display:flex;align-items:center;justify-content:center';
      document.body.appendChild(m);
    }

    m.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px;width:640px;max-width:95vw;max-height:90vh;overflow:auto">
        <h2 style="margin:0 0 16px;font-size:1.1rem">🌐 Prospeccao via Apify</h2>
        <div id="apify-status" style="padding:10px;background:var(--bg2);border-radius:6px;margin-bottom:14px;color:var(--muted);font-size:.85rem">carregando...</div>

        <div class="field" style="margin-bottom:12px">
          <label style="display:block;font-size:.78rem;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">Actor</label>
          <select id="apify-actor" style="width:100%;padding:9px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text)">
            <option value="">carregando...</option>
          </select>
          <div id="apify-actor-info" style="font-size:.72rem;color:var(--muted);margin-top:6px"></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div>
            <label style="display:block;font-size:.78rem;color:var(--muted);margin-bottom:6px">Termo de busca</label>
            <input id="apify-search" type="text" value="provedor de internet" style="width:100%;padding:9px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
          </div>
          <div>
            <label style="display:block;font-size:.78rem;color:var(--muted);margin-bottom:6px">Localizacao</label>
            <input id="apify-location" type="text" value="Pouso Alegre, MG, Brazil" style="width:100%;padding:9px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
          <div>
            <label style="display:block;font-size:.78rem;color:var(--muted);margin-bottom:6px">Max resultados</label>
            <input id="apify-max" type="number" value="50" min="5" max="500" style="width:100%;padding:9px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
          </div>
          <div>
            <label style="display:block;font-size:.78rem;color:var(--muted);margin-bottom:6px">Modo</label>
            <select id="apify-sync" style="width:100%;padding:9px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text)">
              <option value="true">Sincrono (aguarda ate 4min)</option>
              <option value="false">Assincrono (dispara e acompanha)</option>
            </select>
          </div>
        </div>

        <div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.3);color:var(--yellow);padding:10px;border-radius:6px;font-size:.75rem;margin-bottom:14px">
          <strong>Custo estimado:</strong> <span id="apify-cost-est">--</span> USD &middot; auto-importa leads novos no fim
        </div>

        <div id="apify-result" style="display:none;margin-bottom:14px;padding:14px;background:var(--bg2);border-radius:8px;font-size:.85rem;font-family:monospace;white-space:pre-wrap;max-height:200px;overflow:auto"></div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost" onclick="document.getElementById('${MODAL_ID}').remove()">Fechar</button>
          <button class="btn btn-primary" id="apify-run-btn">Executar</button>
        </div>
      </div>`;

    // Carrega catalogo
    const cat = await api('/apify/catalog');
    const statusEl = m.querySelector('#apify-status');
    if (!cat?.configured) {
      statusEl.textContent = 'APIFY_TOKEN ausente no .env do servidor — set e reinicie';
      statusEl.style.color = 'var(--red)';
      m.querySelector('#apify-run-btn').disabled = true;
    } else {
      statusEl.textContent = 'Apify conectado. Selecione actor abaixo.';
      statusEl.style.color = 'var(--green)';
    }

    const sel = m.querySelector('#apify-actor');
    sel.innerHTML = (cat?.actors || []).map(a =>
      `<option value="${a.actor_id}">${a.label} ($${a.cost_estimate_usd_per_1k}/1k)</option>`
    ).join('');

    function updateInfo() {
      const sa = (cat?.actors || []).find(a => a.actor_id === sel.value);
      m.querySelector('#apify-actor-info').textContent = sa ? sa.description : '';
      const max = parseInt(m.querySelector('#apify-max').value) || 50;
      const cost = sa ? ((max / 1000) * sa.cost_estimate_usd_per_1k).toFixed(3) : '--';
      m.querySelector('#apify-cost-est').textContent = cost;
    }
    sel.addEventListener('change', updateInfo);
    m.querySelector('#apify-max').addEventListener('input', updateInfo);
    updateInfo();

    m.querySelector('#apify-run-btn').addEventListener('click', async () => {
      const actor = sel.value;
      const search = m.querySelector('#apify-search').value.trim();
      const location = m.querySelector('#apify-location').value.trim();
      const max = parseInt(m.querySelector('#apify-max').value) || 50;
      const sync = m.querySelector('#apify-sync').value === 'true';

      const btn = m.querySelector('#apify-run-btn');
      btn.disabled = true;
      btn.textContent = sync ? 'Executando (ate 4min)...' : 'Disparando...';

      const resEl = m.querySelector('#apify-result');
      resEl.style.display = 'block';
      resEl.textContent = `Iniciando ${actor}...\nBusca: ${search}\nLocal: ${location}\nMax: ${max}\n\n`;

      try {
        const r = await api('/apify/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actor_id: actor,
            sync,
            input: {
              searchStringsArray: [search],
              locationQuery: location,
              maxCrawledPlacesPerSearch: max,
              language: 'pt-BR',
              maxImages: 0,
              includeReviews: false,
            },
          }),
        });

        if (sync) {
          resEl.textContent += `OK!\n\nItems retornados: ${r.items_count}\nLeads novos: ${r.stats?.novos}\nDuplicados: ${r.stats?.dup}\nInvalidos: ${r.stats?.invalidos}\n\nrun_id: ${r.run_id}`;
        } else {
          resEl.textContent += `Run iniciado em modo async.\napify_run_id: ${r.apify_run_id}\nrun_id (DB): ${r.run_id}\n\nUse "Refrescar" abaixo para ver progresso.`;
        }
        btn.textContent = 'Executar de novo';
        btn.disabled = false;
      } catch (err) {
        resEl.textContent += `ERRO: ${err.message}`;
        btn.textContent = 'Tentar novamente';
        btn.disabled = false;
      }
    });
  }

  window.openApifyModal = openModal;
})();
