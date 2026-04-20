// Errors card (Sprint 3 / T5 — refatorado pra Claude design system).

(function () {
  window.renderErrorsCard = function renderErrorsCard(containerEl, data) {
    if (!containerEl) return;
    const unresolved = Number(data?.unresolved || 0);
    const last24 = Number(data?.last_24h || 0);
    const hasErrors = unresolved > 0;
    const color = hasErrors ? 'var(--red)' : 'var(--green)';
    const iconId = hasErrors ? 'i-alert' : 'i-shield-check';
    const bg = hasErrors ? 'rgba(181,51,51,.10)' : 'rgba(91,124,94,.12)';

    containerEl.innerHTML = `
      <div class="stat-card" data-card="errors">
        <div class="stat-top">
          <div class="stat-icon" style="background:${bg};border-color:transparent;color:${color}"><svg class="icon"><use href="#${iconId}"/></svg></div>
          ${hasErrors ? `<span class="badge" style="background:rgba(181,51,51,.10);color:var(--red);border-color:transparent">novo</span>` : ''}
        </div>
        <div class="stat-val" style="color:${color}">${unresolved}</div>
        <div class="stat-label">Erros nao resolvidos</div>
        <div style="margin-top:10px;font-size:.74rem;color:var(--muted)">
          Ultimas 24h <strong style="color:var(--text)">${last24}</strong>
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
      containerEl.innerHTML = '<div class="stat-card"><div class="stat-label" style="text-align:center;padding:20px">Errors indisponivel</div></div>';
    }
  };
})();
