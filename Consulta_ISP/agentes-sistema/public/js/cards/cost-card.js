// Cost card (Sprint 3 / T2 — refatorado pra Claude design system).
// Sem inline hex; usa CSS vars do index.html.

(function () {
  function formatUsd(v) {
    return '$' + (Number(v || 0)).toFixed(2);
  }

  // Status semantico: cor warm pelo % do threshold
  function statusFor(total, threshold) {
    if (!threshold || threshold <= 0) return { label: 'ok', color: 'var(--green)' };
    const pct = total / threshold;
    if (pct >= 1.0) return { label: 'over', color: 'var(--red)' };
    if (pct >= 0.7) return { label: 'warning', color: 'var(--yellow)' };
    return { label: 'ok', color: 'var(--green)' };
  }

  window.renderCostCard = function renderCostCard(containerEl, data) {
    if (!containerEl) return;
    const today = Number(data?.today?.totals?.total_usd || 0);
    const month = Number(data?.month?.totals?.total_usd || 0);
    const threshold = Number(data?.threshold_usd || 25);
    const st = statusFor(today, threshold);
    const pct = threshold ? Math.min(100, Math.round((today / threshold) * 100)) : 0;

    containerEl.innerHTML = `
      <div class="stat-card" data-card="claude-cost">
        <div class="stat-top">
          <div class="stat-icon"><svg class="icon"><use href="#i-dollar"/></svg></div>
          <span class="badge" style="background:${st.color === 'var(--red)' ? 'rgba(181,51,51,.10)' : st.color === 'var(--yellow)' ? 'rgba(184,146,58,.10)' : 'rgba(91,124,94,.12)'};color:${st.color};border-color:transparent">${pct}%</span>
        </div>
        <div class="stat-val" style="color:${st.color}">${formatUsd(today)}</div>
        <div class="stat-label">Custo Claude (hoje)</div>
        <div style="margin-top:10px;font-size:.74rem;color:var(--muted);display:flex;justify-content:space-between">
          <span>Mes <strong style="color:var(--text)">${formatUsd(month)}</strong></span>
          <span>Limite <strong style="color:var(--text)">${formatUsd(threshold)}</strong></span>
        </div>
        <div style="margin-top:8px;height:3px;background:var(--border-warm);border-radius:9999px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${st.color};transition:width .3s ease-out"></div>
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
    } catch {
      containerEl.innerHTML = '<div class="stat-card"><div class="stat-label" style="text-align:center;padding:20px">Custo Claude indisponivel</div></div>';
    }
  };
})();
