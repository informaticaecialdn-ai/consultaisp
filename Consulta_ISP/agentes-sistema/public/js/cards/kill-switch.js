// Sprint 5 / T5 — Kill Switch global UI.
(function () {
  const API = '/api';

  async function fetchStatus() {
    try {
      const r = await fetch(API + '/admin/broadcast-status');
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
      box.innerHTML = `🛑 <b>Kill Switch ATIVO</b> — broadcast desligado (${st.campanhas_ativas.length} campanha(s) pausada(s))`;
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
    const r = await fetch(API + '/admin/kill-broadcast', {
      method: 'POST',
      headers: { 'X-Admin-Confirm': 'yes', 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!r.ok) {
      alert('Erro: ' + (await r.text()));
      return;
    }
    const data = await r.json();
    alert(`Kill switch ativado. ${data.campanhas_pausadas} campanha(s) pausada(s).`);
    input.value = '';
    await render();
    if (window.CampanhasUI) window.CampanhasUI.refresh();
  }

  async function resume() {
    if (!confirm('Retomar broadcast? (worker voltara a processar envios pendentes)')) return;
    const r = await fetch(API + '/admin/resume-broadcast', {
      method: 'POST',
      headers: { 'X-Admin-Confirm': 'yes', 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!r.ok) {
      alert('Erro: ' + (await r.text()));
      return;
    }
    alert('Broadcast retomado. Reinicie o container worker se necessario.');
    await render();
  }

  function open() {
    document.getElementById('modal-kill-switch')?.classList.add('show');
    render();
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-activate-kill')?.addEventListener('click', activate);
    document.getElementById('btn-resume-broadcast')?.addEventListener('click', resume);
  });

  window.KillSwitch = { open, render };
})();
