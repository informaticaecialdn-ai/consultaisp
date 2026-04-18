// Cost card (Sprint 3 / T2). Funcao pura — chama via renderCostCard(el, data).
// data = { today: {total_usd, ...}, month: {total_usd, ...}, threshold_usd }

(function () {
  function formatUsd(v) {
    return '$' + (Number(v || 0)).toFixed(2);
  }

  function colorFor(total, threshold) {
    if (!threshold || threshold <= 0) return 'var(--blue)';
    const pct = total / threshold;
    if (pct >= 1.0) return 'var(--red)';
    if (pct >= 0.7) return 'var(--yellow)';
    return 'var(--green)';
  }

  window.renderCostCard = function renderCostCard(containerEl, data) {
    if (!containerEl) return;
    const today = Number(data?.today?.totals?.total_usd || 0);
    const month = Number(data?.month?.totals?.total_usd || 0);
    const threshold = Number(data?.threshold_usd || 25);
    const todayColor = colorFor(today, threshold);

    containerEl.innerHTML = `
      <div class="stat-card" data-card="claude-cost">
        <div class="stat-top">
          <div class="stat-icon" style="background:rgba(96,165,250,.12)">🤖</div>
        </div>
        <div class="stat-val" style="color:${todayColor}">${formatUsd(today)}</div>
        <div class="stat-label">Custo Claude (hoje)</div>
        <div style="margin-top:8px;font-size:.72rem;color:var(--muted)">
          Mes: <strong style="color:var(--text)">${formatUsd(month)}</strong>
          &nbsp;&middot;&nbsp;
          Limite diario: ${formatUsd(threshold)}
        </div>
      </div>`;
  };

  window.loadCostCard = async function loadCostCard(containerEl) {
    if (!containerEl) return;
    if (typeof api !== 'function') return;
    try {
      const [today, month] = await Promise.all([
        api('/costs/today'),
        api('/costs/month'),
      ]);
      const threshold_usd = 25;
      window.renderCostCard(containerEl, { today, month, threshold_usd });
    } catch (e) {
      containerEl.innerHTML = '<div class="stat-card"><div class="stat-label">Custo Claude indisponivel</div></div>';
    }
  };
})();
