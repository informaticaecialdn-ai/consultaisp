// Apify Run Detail modal (Sprint 7 polish).
// Mostra params + leads importados + acao refresh para runs async pendentes.

(function () {
  const MODAL_ID = 'modal-apify-detail';

  function ensureModal() {
    let m = document.getElementById(MODAL_ID);
    if (!m) {
      m = document.createElement('div');
      m.id = MODAL_ID;
      m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9997;display:none;align-items:center;justify-content:center';
      m.addEventListener('click', (ev) => { if (ev.target === m) close(); });
      document.body.appendChild(m);
    }
    return m;
  }

  function close() {
    const m = document.getElementById(MODAL_ID);
    if (m) m.style.display = 'none';
  }

  async function open(runId) {
    const m = ensureModal();
    m.style.display = 'flex';
    m.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px;width:780px;max-width:95vw;max-height:90vh;overflow:auto">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:14px">
          <h2 style="margin:0;font-size:1.1rem">🌐 Run #${runId}</h2>
          <button class="btn btn-ghost btn-sm" onclick="window.ApifyDetail.close()">✕</button>
        </div>
        <div id="apify-detail-body" style="color:var(--muted);font-size:.85rem">carregando...</div>
      </div>`;

    try {
      const data = await api(`/apify/runs/${runId}`);
      const r = data?.run;
      if (!r) {
        m.querySelector('#apify-detail-body').innerHTML = '<div style="color:var(--red)">Run nao encontrado</div>';
        return;
      }

      let params = {};
      try { params = JSON.parse(r.params || '{}'); } catch {}

      const statusColor = r.status === 'imported' ? 'var(--green)'
        : r.status === 'failed' ? 'var(--red)'
        : r.status === 'running' || r.status === 'pending' ? 'var(--yellow)'
        : 'var(--muted)';

      m.querySelector('#apify-detail-body').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
          <div><strong>Status:</strong> <span style="color:${statusColor};text-transform:uppercase">${r.status}</span></div>
          <div><strong>Actor:</strong> ${r.actor_label || r.actor_id}</div>
          <div><strong>Iniciado:</strong> ${(r.iniciado_em||'').replace('T',' ').slice(0,19)}</div>
          <div><strong>Finalizado:</strong> ${r.finalizado_em ? r.finalizado_em.replace('T',' ').slice(0,19) : '-'}</div>
          <div><strong>Items retornados:</strong> ${r.items_count}</div>
          <div><strong>Duracao:</strong> ${r.duracao_ms ? Math.round(r.duracao_ms/1000) + 's' : '-'}</div>
          <div><strong>Leads novos:</strong> <span style="color:var(--green)">${r.leads_novos}</span></div>
          <div><strong>Duplicados:</strong> ${r.leads_dup}</div>
          <div><strong>Invalidos:</strong> ${r.leads_invalidos}</div>
          <div><strong>Custo:</strong> $${(r.cost_usd||0).toFixed(3)}</div>
        </div>

        ${r.erro ? `<div style="background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);color:var(--red);padding:10px;border-radius:6px;margin-bottom:12px;font-size:.8rem;font-family:monospace;white-space:pre-wrap">${r.erro}</div>` : ''}

        <div style="margin-bottom:12px">
          <strong>Parametros enviados:</strong>
          <pre style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:10px;font-size:.75rem;max-height:200px;overflow:auto">${JSON.stringify(params, null, 2)}</pre>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
          ${(r.status === 'running' || r.status === 'pending') ? `<button class="btn btn-primary btn-sm" onclick="window.ApifyDetail.refresh(${runId})">↻ Refresh status</button>` : ''}
          ${r.leads_novos > 0 ? `<button class="btn btn-outline btn-sm" onclick="window.ApifyDetail.viewLeads(${runId})">Ver ${r.leads_novos} leads</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="window.ApifyDetail.close()">Fechar</button>
        </div>
      `;
    } catch (e) {
      m.querySelector('#apify-detail-body').innerHTML = `<div style="color:var(--red)">Erro: ${e.message}</div>`;
    }
  }

  async function refresh(runId) {
    try {
      const r = await api(`/apify/runs/${runId}/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      alert(`Status atualizado: ${r.status || 'unknown'}${r.stats ? `\n\nLeads novos: ${r.stats.novos}\nDuplicados: ${r.stats.dup}` : ''}`);
      if (typeof window.loadApifyRuns === 'function') await window.loadApifyRuns();
      // reabre o detalhe atualizado
      open(runId);
    } catch (e) {
      alert('Erro ao atualizar: ' + e.message);
    }
  }

  function viewLeads(runId) {
    // Filtra a pagina de leads pela origem apify_google_maps + run_id
    // (sem filtro server-side por run_id ainda — abre lista geral filtrada por origem)
    close();
    if (typeof window.goPage === 'function') window.goPage('leads');
    setTimeout(() => {
      const search = document.querySelector('#leads-search') || document.querySelector('input[placeholder*="buscar" i]');
      if (search) { search.value = 'apify'; search.dispatchEvent(new Event('input')); }
    }, 200);
  }

  window.ApifyDetail = { open, close, refresh, viewLeads };
})();
