// Health card — refinado: status acima compacto, texto "DEGRADED" menor,
// foco em DESTACAR o problema (qual check esta ruim) sem alarme visual
// em serif gigante quando e apenas um check degraded.

(function () {
  const STATUS = {
    ok:       { label: 'Tudo OK',      color: 'var(--green)',  icon: 'i-shield-check', bg: 'rgba(91,124,94,.12)',  short: 'OK' },
    degraded: { label: 'Atencao',      color: 'var(--yellow)', icon: 'i-alert',        bg: 'rgba(184,146,58,.10)', short: 'Degraded' },
    down:     { label: 'Fora do ar',   color: 'var(--red)',    icon: 'i-shield-x',     bg: 'rgba(181,51,51,.10)',  short: 'Down' },
  };

  // Traducao amigavel de nomes tecnicos de check
  const CHECK_LABELS = {
    database: 'Banco',
    anthropic: 'Claude',
    zapi: 'WhatsApp',
    backup: 'Backup',
    disk: 'Disco',
    memory: 'Memoria',
    uptime: 'Uptime',
  };

  window.renderHealthCard = function renderHealthCard(containerEl, data) {
    if (!containerEl) return;
    const overall = (data?.status || 'unknown').toLowerCase();
    const st = STATUS[overall] || { label: 'Desconhecido', color: 'var(--muted)', icon: 'i-alert', bg: 'var(--card2)', short: '?' };
    const checks = data?.checks || {};
    const failed = Object.entries(checks).filter(([, v]) => v.status !== 'ok');
    const totalChecks = Object.keys(checks).length;

    // Texto principal: nao gritar "DEGRADED" em serif gigante.
    // Se 1 check degraded num total de 7, contexto importa mais que alarm.
    const okCount = totalChecks - failed.length;
    const mainMetric = failed.length === 0
      ? `<div style="color:${st.color};font-size:1.8rem;font-weight:600;line-height:1.1">${okCount}/${totalChecks}</div>
         <div style="color:var(--muted);font-size:.74rem;margin-top:2px">checks OK</div>`
      : `<div style="color:${st.color};font-size:1.8rem;font-weight:600;line-height:1.1">${okCount}/${totalChecks}</div>
         <div style="color:${st.color};font-size:.74rem;margin-top:2px">${failed.length} com atencao</div>`;

    const details = failed.length
      ? failed.map(([k, v]) => {
          const label = CHECK_LABELS[k] || k;
          const sColor = v.status === 'down' ? 'var(--red)' : 'var(--yellow)';
          return `<li style="display:flex;justify-content:space-between;padding:3px 0;font-size:.72rem">
                    <span style="color:var(--text)">${label}</span>
                    <span style="color:${sColor}">${v.status}</span>
                  </li>`;
        }).join('')
      : '<li style="color:var(--green);font-size:.72rem;padding:3px 0">todos os checks OK</li>';

    containerEl.innerHTML = `
      <div class="stat-card" data-card="system-health">
        <div class="stat-top">
          <div class="stat-icon" style="background:${st.bg};border-color:transparent;color:${st.color}">
            <svg class="icon"><use href="#${st.icon}"/></svg>
          </div>
          <span class="badge" style="background:${st.bg};color:${st.color};border-color:transparent;font-size:.68rem">${st.short}</span>
        </div>
        ${mainMetric}
        <div class="stat-label">System Health</div>
        <ul style="margin-top:10px;padding:0;list-style:none;max-height:70px;overflow:hidden">
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
