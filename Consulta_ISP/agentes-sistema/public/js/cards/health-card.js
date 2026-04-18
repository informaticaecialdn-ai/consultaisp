// Health card (Sprint 3 / T4).
(function () {
  const EMOJI = { ok: '🟢', degraded: '🟡', down: '🔴' };
  const COLOR = { ok: 'var(--green)', degraded: 'var(--yellow)', down: 'var(--red)' };

  window.renderHealthCard = function renderHealthCard(containerEl, data) {
    if (!containerEl) return;
    const overall = data?.status || 'unknown';
    const emoji = EMOJI[overall] || '⚪';
    const color = COLOR[overall] || 'var(--muted)';
    const checks = data?.checks || {};
    const failed = Object.entries(checks).filter(([, v]) => v.status !== 'ok');

    const details = failed.length
      ? failed.map(([k, v]) => `<li>${k}: <strong>${v.status}</strong></li>`).join('')
      : '<li>todos os checks OK</li>';

    containerEl.innerHTML = `
      <div class="stat-card" data-card="system-health">
        <div class="stat-top">
          <div class="stat-icon" style="background:rgba(255,255,255,.06)">${emoji}</div>
        </div>
        <div class="stat-val" style="color:${color};text-transform:uppercase">${overall}</div>
        <div class="stat-label">System Health</div>
        <ul style="margin-top:8px;padding-left:16px;font-size:.72rem;color:var(--muted);max-height:60px;overflow:hidden">
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
      containerEl.innerHTML = '<div class="stat-card"><div class="stat-label">Health indisponivel</div></div>';
    }
  };
})();
