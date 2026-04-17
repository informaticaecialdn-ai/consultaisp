// Sprint 5 — Broadcast Engine UI: lista de campanhas + polling metricas live.
(function () {
  const API = '/api';
  const POLL_MS = 5000;
  let pollTimer = null;

  function statusBadge(status) {
    const map = {
      rascunho: { bg: '#475569', color: '#cbd5e1', label: 'Rascunho' },
      agendada: { bg: '#1e3a8a', color: '#93c5fd', label: '📅 Agendada' },
      enviando: { bg: '#1e40af', color: '#93c5fd', label: '⚡ Enviando' },
      pausada: { bg: '#92400e', color: '#fcd34d', label: '⏸ Pausada' },
      concluida: { bg: '#064e3b', color: '#6ee7b7', label: '✓ Concluida' },
      falhou: { bg: '#7f1d1d', color: '#fecaca', label: '✗ Falhou' },
      cancelada: { bg: '#334155', color: '#94a3b8', label: 'Cancelada' }
    };
    const s = map[status] || map.rascunho;
    return `<span style="display:inline-block;padding:4px 10px;border-radius:12px;font-size:.7rem;font-weight:600;background:${s.bg};color:${s.color}">${s.label}</span>`;
  }

  function metric(value, label, tone) {
    const color = tone === 'success' ? '#10b981'
      : tone === 'warning' ? '#fbbf24'
      : tone === 'danger' ? '#ef4444'
      : '#60a5fa';
    return `
      <div style="text-align:center;padding:8px;background:#0a1020;border-radius:6px">
        <div style="font-size:1.3rem;font-weight:700;color:${color}">${value ?? 0}</div>
        <div style="font-size:.65rem;color:#64748b;text-transform:uppercase;margin-top:2px">${label}</div>
      </div>`;
  }

  function actions(c) {
    const isActive = c.status === 'enviando';
    const isPaused = c.status === 'pausada';
    const isDraft = c.status === 'rascunho';
    const buttons = [];
    if (isDraft) {
      buttons.push(`<button class="btn btn-primary btn-sm" data-camp-start="${c.id}">🚀 Disparar</button>`);
      buttons.push(`<button class="btn btn-outline btn-sm" data-camp-edit="${c.id}">✎ Editar</button>`);
      buttons.push(`<button class="btn btn-ghost btn-sm" data-camp-delete="${c.id}">🗑 Deletar</button>`);
    }
    if (isActive) {
      buttons.push(`<button class="btn btn-sm" data-camp-pause="${c.id}" style="background:#b45309;color:#fff">⏸ Pausar</button>`);
    }
    if (isPaused) {
      buttons.push(`<button class="btn btn-primary btn-sm" data-camp-resume="${c.id}">▶ Retomar</button>`);
      buttons.push(`<button class="btn btn-ghost btn-sm" data-camp-cancel="${c.id}">✕ Cancelar</button>`);
    }
    buttons.push(`<button class="btn btn-outline btn-sm" data-camp-view="${c.id}">👁 Detalhes</button>`);
    return buttons.join(' ');
  }

  function render(campanhas) {
    const container = document.getElementById('campanhas-list');
    if (!container) return;
    if (!campanhas.length) {
      container.innerHTML = `<div class="panel"><div class="panel-body" style="text-align:center;color:var(--muted);padding:40px">
        Nenhuma campanha ainda. Clique em <b>+ Nova Campanha</b> para comecar.
      </div></div>`;
      return;
    }
    const count = document.getElementById('nav-campanhas-count');
    if (count) count.textContent = campanhas.filter(c => c.status === 'enviando').length;

    container.innerHTML = campanhas.map(c => {
      const progresso = c.total_envios > 0
        ? Math.round(((c.enviados_count + c.falhas_count + c.bloqueados_count) / c.total_envios) * 100)
        : 0;
      const restantes = Math.max(0, c.total_envios - c.enviados_count - c.falhas_count - c.bloqueados_count);
      return `
        <div class="panel" data-campanha-id="${c.id}">
          <div class="panel-body">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;gap:12px">
              <div>
                <div style="font-weight:700;font-size:1.05rem">${escapeHtml(c.nome)}</div>
                <div style="color:var(--muted);font-size:.75rem;margin-top:2px">
                  Audiencia: ${escapeHtml(c.audiencia_nome || '?')} (${c.audiencia_total || 0}) ·
                  Template: ${escapeHtml(c.template_nome || '?')}${c.template_hsm ? ' (HSM)' : ''} ·
                  ${escapeHtml(c.agente_remetente)} · ${c.rate_limit_per_min} msg/min
                </div>
              </div>
              ${statusBadge(c.status)}
            </div>
            <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:8px">
              ${metric(c.enviados_count, 'Enviados', 'success')}
              ${metric(c.entregues_count, 'Entregues', 'success')}
              ${metric(c.lidos_count, 'Lidos')}
              ${metric(c.respondidos_count, 'Respondidos', 'success')}
              ${metric(c.falhas_count, 'Falhas', c.falhas_count > 0 ? 'warning' : null)}
              ${metric(restantes, 'Restantes')}
            </div>
            <div style="height:6px;background:#334155;border-radius:3px;margin-top:12px;overflow:hidden">
              <div style="height:100%;background:linear-gradient(90deg,#3b82f6,#10b981);width:${progresso}%;transition:width .3s"></div>
            </div>
            <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
              ${actions(c)}
            </div>
          </div>
        </div>`;
    }).join('');
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function fetchList() {
    try {
      const r = await fetch(API + '/campanhas?limit=100');
      if (!r.ok) return;
      const data = await r.json();
      render(data.campanhas || []);
    } catch (err) {
      console.error('[campanhas] list error', err);
    }
  }

  async function invokeAction(id, verb) {
    const confirmMap = {
      pause: 'Pausar campanha?',
      cancel: 'Cancelar campanha? (envios feitos serao preservados)',
      delete: 'Deletar rascunho?',
      resume: null,
      start: 'Disparar campanha AGORA?'
    };
    const msg = confirmMap[verb];
    if (msg && !confirm(msg)) return;

    let url, method;
    if (verb === 'delete') { url = `${API}/campanhas/${id}`; method = 'DELETE'; }
    else { url = `${API}/campanhas/${id}/${verb}`; method = 'POST'; }

    const r = await fetch(url, { method });
    if (!r.ok) {
      const body = await r.text();
      alert('Erro: ' + body);
      return;
    }
    await fetchList();
  }

  async function pauseAll() {
    if (!confirm('Pausar TODAS as campanhas em andamento?')) return;
    const r = await fetch(API + '/campanhas/pause-all', { method: 'PUT' });
    if (!r.ok) {
      alert('Erro ao pausar todas');
      return;
    }
    const data = await r.json();
    alert(`Pausadas ${data.affected} campanha(s)`);
    await fetchList();
  }

  async function viewDetails(id) {
    const r = await fetch(`${API}/campanhas/${id}`);
    if (!r.ok) return;
    const data = await r.json();
    const stats = data.stats;
    alert(
      `Campanha #${data.campanha.id}: ${data.campanha.nome}\n\n` +
      `Status: ${data.campanha.status}\n` +
      `Total: ${stats.total_envios}\n` +
      `Enviados: ${stats.enviados}\n` +
      `Entregues: ${stats.entregues}\n` +
      `Lidos: ${stats.lidos}\n` +
      `Respondidos: ${stats.respondidos}\n` +
      `Falhas: ${stats.falhas}\n` +
      `Bloqueados: ${stats.bloqueados}\n` +
      `Restantes: ${stats.restantes}\n` +
      `Progresso: ${stats.progresso_pct}%`
    );
  }

  function bindActions() {
    const container = document.getElementById('campanhas-list');
    if (!container) return;
    container.addEventListener('click', (ev) => {
      const t = ev.target;
      const id = t.dataset.campStart || t.dataset.campPause || t.dataset.campResume
              || t.dataset.campCancel || t.dataset.campDelete || t.dataset.campView
              || t.dataset.campEdit;
      if (!id) return;
      if (t.dataset.campStart) invokeAction(id, 'start');
      else if (t.dataset.campPause) invokeAction(id, 'pause');
      else if (t.dataset.campResume) invokeAction(id, 'resume');
      else if (t.dataset.campCancel) invokeAction(id, 'cancel');
      else if (t.dataset.campDelete) invokeAction(id, 'delete');
      else if (t.dataset.campView) viewDetails(id);
      else if (t.dataset.campEdit) window.CampanhaWizard && window.CampanhaWizard.open({ editId: parseInt(id) });
    });

    document.getElementById('btn-new-campanha')?.addEventListener('click', () => {
      if (window.CampanhaWizard) window.CampanhaWizard.open();
    });
    document.getElementById('btn-pause-all-campanhas')?.addEventListener('click', pauseAll);
    document.getElementById('btn-kill-switch-open')?.addEventListener('click', () => {
      if (window.KillSwitch) window.KillSwitch.open();
    });
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      const active = document.querySelector('.page.active');
      if (active && active.id === 'page-campanhas') fetchList();
      else stopPolling();
    }, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  window.CampanhasUI = {
    load: async () => {
      bindActions();
      await fetchList();
      startPolling();
    },
    refresh: fetchList
  };

  // Bind listeners at page load (idempotent)
  document.addEventListener('DOMContentLoaded', bindActions);
})();
