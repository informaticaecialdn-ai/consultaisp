// Sprint 5 / T5 — Kill Switch global UI.
// Sprint 7 patch: usa window.api() (com Bearer auth) em vez de fetch direto,
// e bind do botao "abrir modal" via DOMContentLoaded.

(function () {
  function authHeaders(extra = {}) {
    const tok = (function(){ try { return localStorage.getItem('api_token') || ''; } catch { return ''; } })();
    const h = { 'Content-Type': 'application/json', ...extra };
    if (tok) h['Authorization'] = 'Bearer ' + tok;
    return h;
  }

  async function fetchStatus() {
    try {
      const r = await fetch('/api/admin/broadcast-status', { headers: authHeaders() });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  async function render() {
    const box = document.getElementById('ks-status');
    if (!box) return;
    const st = await fetchStatus();
    if (!st) {
      box.style.background = '#7f1d1d';
      box.style.color = '#fecaca';
      box.textContent = 'Nao foi possivel consultar o status do worker';
      return;
    }
    if (st.kill_switch) {
      box.style.background = '#7f1d1d';
      box.style.color = '#fecaca';
      box.innerHTML = `🛑 <b>Kill Switch ATIVO</b> — broadcast desligado (${(st.campanhas_ativas||[]).length} campanha(s) pausada(s))`;
    } else if (st.worker?.running) {
      box.style.background = '#064e3b';
      box.style.color = '#6ee7b7';
      const last = st.worker.heartbeat?.ts || '?';
      box.innerHTML = `🟢 Worker ATIVO — broadcast operacional. Ultimo heartbeat: ${last}`;
    } else {
      box.style.background = '#422006';
      box.style.color = '#fcd34d';
      box.innerHTML = `⚠️ Worker NAO running. Confirme se o container consulta-isp-worker esta up.`;
    }
  }

  async function activate() {
    const input = document.getElementById('ks-confirm-input');
    if (!input || input.value.trim() !== 'CONFIRMAR') {
      alert('Digite CONFIRMAR exatamente para prosseguir.');
      return;
    }
    try {
      const r = await fetch('/api/admin/kill-broadcast', {
        method: 'POST',
        headers: authHeaders({ 'X-Admin-Confirm': 'yes' }),
        body: '{}'
      });
      if (!r.ok) {
        alert('Erro: HTTP ' + r.status + ' - ' + (await r.text()).slice(0, 200));
        return;
      }
      const data = await r.json();
      alert(`Kill switch ativado. ${data.campanhas_pausadas} campanha(s) pausada(s).`);
      input.value = '';
      await render();
      if (window.CampanhasUI?.refresh) window.CampanhasUI.refresh();
    } catch (e) {
      alert('Falha de rede: ' + e.message);
    }
  }

  async function resume() {
    if (!confirm('Retomar broadcast? (worker voltara a processar envios pendentes)')) return;
    try {
      const r = await fetch('/api/admin/resume-broadcast', {
        method: 'POST',
        headers: authHeaders({ 'X-Admin-Confirm': 'yes' }),
        body: '{}'
      });
      if (!r.ok) {
        alert('Erro: HTTP ' + r.status + ' - ' + (await r.text()).slice(0, 200));
        return;
      }
      alert('Broadcast retomado. Reinicie o container worker se necessario.');
      await render();
    } catch (e) {
      alert('Falha de rede: ' + e.message);
    }
  }

  function open() {
    document.getElementById('modal-kill-switch')?.classList.add('show');
    render();
  }

  function close() {
    document.getElementById('modal-kill-switch')?.classList.remove('show');
  }

  function bindAll() {
    document.getElementById('btn-activate-kill')?.addEventListener('click', activate);
    document.getElementById('btn-resume-broadcast')?.addEventListener('click', resume);
    document.getElementById('btn-kill-switch-open')?.addEventListener('click', open);
    // Close ao clicar no overlay
    const modal = document.getElementById('modal-kill-switch');
    if (modal) {
      modal.addEventListener('click', (ev) => { if (ev.target === modal) close(); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAll);
  } else {
    bindAll();
  }

  window.KillSwitch = { open, close, render };
})();
