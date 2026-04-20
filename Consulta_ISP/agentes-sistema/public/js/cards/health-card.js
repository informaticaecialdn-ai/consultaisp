// Health card (Sprint 3 / T4 — refatorado pra Claude design system).

(function () {
  const STATUS = {
    ok:       { label: 'OK',       color: 'var(--green)',  icon: 'i-shield-check', bg: 'rgba(91,124,94,.12)' },
    degraded: { label: 'DEGRADED', color: 'var(--yellow)', icon: 'i-alert',        bg: 'rgba(184,146,58,.10)' },
    down:     { label: 'DOWN',     color: 'var(--red)',    icon: 'i-shield-x',     bg: 'rgba(181,51,51,.10)' },
  };

  window.renderHealthCard = function renderHealthCard(containerEl, data) {
    if (!containerEl) return;
    const overall = (data?.status || 'unknown').toLowerCase();
    const st = STATUS[overall] || { label: 'UNKNOWN', color: 'var(--muted)', icon: 'i-alert', bg: 'var(--card2)' };
    const checks = data?.checks || {};
    const failed = Object.entries(checks).filter(([, v]) => v.status !== 'ok');

    const details = failed.length
      ? failed.map(([k, v]) => `<li style="display:flex;justify-content:space-between;padding:2px 0"><span>${k}</span><span style="color:${v.status === 'down' ? 'var(--red)' : 'var(--yellow)'}">${v.status}</span></li>`).join('')
      : '<li style="color:var(--green)">todos os checks OK</li>';

    containerEl.innerHTML = `
      <div class="stat-card" data-card="system-health">
        <div class="stat-top">
          <div class="stat-icon" style="background:${st.bg};border-color:transparent;color:${st.color}"><svg class="icon"><use href="#${st.icon}"/></svg></div>
        </div>
        <div class="stat-val" style="color:${st.color}">${st.label}</div>
        <div class="stat-label">System Health</div>
        <ul style="margin-top:10px;padding:0;list-style:none;font-size:.74rem;color:var(--muted);max-height:60px;overflow:hidden">
          ${details}
        </ul>
      </div>`;
  };

  window.loadHealthCard = async function loadHealthCard(containerEl) {
    if (!containerEl) return;
    if (typeof api !== 'function') return;
    try {
      const data = await api('/health/deep');
      window.renderHealthCard(containerEl, data);
    } catch {
      containerEl.innerHTML = '<div class="stat-card"><div class="stat-label" style="text-align:center;padding:20px">Health indisponivel</div></div>';
    }
  };
})();
