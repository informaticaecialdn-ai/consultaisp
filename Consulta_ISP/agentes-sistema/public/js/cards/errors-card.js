// Errors card (Sprint 3 / T5).
(function () {
  window.renderErrorsCard = function renderErrorsCard(containerEl, data) {
    if (!containerEl) return;
    const unresolved = Number(data?.unresolved || 0);
    const last24 = Number(data?.last_24h || 0);
    const color = unresolved > 0 ? 'var(--red)' : 'var(--green)';
    const icon = unresolved > 0 ? '⚠️' : '✅';

    containerEl.innerHTML = `
      <div class="stat-card" data-card="errors">
        <div class="stat-top">
          <div class="stat-icon" style="background:rgba(248,113,113,.12)">${icon}</div>
        </div>
        <div class="stat-val" style="color:${color}">${unresolved}</div>
        <div class="stat-label">Erros nao resolvidos</div>
        <div style="margin-top:8px;font-size:.72rem;color:var(--muted)">
          Ultimas 24h: <strong style="color:var(--text)">${last24}</strong>
        </div>
      </div>`;
  };

  window.loadErrorsCard = async function loadErrorsCard(containerEl) {
    if (!containerEl) return;
    if (typeof api !== 'function') return;
    try {
      const data = await api('/errors/count');
      window.renderErrorsCard(containerEl, data);
    } catch {
      containerEl.innerHTML = '<div class="stat-card"><div class="stat-label">Errors indisponivel</div></div>';
    }
  };
})();
