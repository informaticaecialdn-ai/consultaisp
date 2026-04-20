// Tool calls card (Milestone 1 / B8) — observabilidade da autonomia.
// Mostra total de tool calls hoje + breakdown por agente.

(function () {
  window.renderToolCallsCard = function renderToolCallsCard(containerEl, data) {
    if (!containerEl) return;
    const hoje = data?.hoje || { total: 0, ok: 0, erro: 0, blocked: 0 };
    const total = Number(hoje.total || 0);
    const erro = Number(hoje.erro || 0);
    const blocked = Number(hoje.blocked || 0);
    const ok = Number(hoje.ok || 0);
    const errorRate = total ? Math.round(((erro + blocked) / total) * 100) : 0;

    // Cor pelo error rate
    let color = 'var(--green)';
    let bg = 'rgba(91,124,94,.12)';
    if (errorRate >= 10) {
      color = 'var(--red)';
      bg = 'rgba(181,51,51,.10)';
    } else if (errorRate >= 3) {
      color = 'var(--yellow)';
      bg = 'rgba(184,146,58,.10)';
    }

    const porAgente = (data?.por_agente || []).slice(0, 3);
    const porAgenteHtml = porAgente.length
      ? porAgente
          .map(
            (a) =>
              `<li style="display:flex;justify-content:space-between;padding:2px 0">
                 <span style="text-transform:capitalize">${a.agente}</span>
                 <strong style="color:var(--text)">${a.chamadas}</strong>
               </li>`
          )
          .join('')
      : `<li style="color:var(--muted)">sem chamadas ainda</li>`;

    const migPending = data?.migration_pending
      ? `<div style="margin-top:10px;padding:6px 10px;background:rgba(184,146,58,.08);color:var(--yellow);border:1px solid rgba(184,146,58,.2);border-radius:6px;font-size:.72rem">migration 016 pendente</div>`
      : '';

    containerEl.innerHTML = `
      <div class="stat-card" data-card="tool-calls">
        <div class="stat-top">
          <div class="stat-icon" style="background:${bg};border-color:transparent;color:${color}">
            <svg class="icon"><use href="#i-activity"/></svg>
          </div>
          ${blocked > 0 ? `<span class="badge" style="background:rgba(181,51,51,.10);color:var(--red);border-color:transparent">${blocked} bloq</span>` : ''}
        </div>
        <div class="stat-val" style="color:${color}">${total}</div>
        <div class="stat-label">Tool calls (hoje)</div>
        <ul style="margin-top:10px;padding:0;list-style:none;font-size:.74rem;color:var(--muted);max-height:70px;overflow:hidden">
          ${porAgenteHtml}
        </ul>
        <div style="margin-top:8px;display:flex;justify-content:space-between;font-size:.7rem;color:var(--muted)">
          <span>ok <strong style="color:var(--green)">${ok}</strong></span>
          <span>erro <strong style="color:var(--red)">${erro}</strong></span>
          <span>${errorRate}%</span>
        </div>
        ${migPending}
      </div>`;
  };

  window.loadToolCallsCard = async function loadToolCallsCard(containerEl) {
    if (!containerEl) return;
    if (typeof api !== 'function') return;
    try {
      const data = await api('/tool-calls/stats');
      window.renderToolCallsCard(containerEl, data);
    } catch {
      containerEl.innerHTML =
        '<div class="stat-card"><div class="stat-label" style="text-align:center;padding:20px">Tool calls indisponivel</div></div>';
    }
  };
})();
