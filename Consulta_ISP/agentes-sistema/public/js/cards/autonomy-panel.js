// Autonomy panel (Milestone 3 / H) — painel de controle da autonomia.
// Monta em containerEl: status flags + kill switches + pipeline e2e + tool calls.

(function () {
  window.loadAutonomyPanel = async function loadAutonomyPanel(containerEl) {
    if (!containerEl) return;
    if (typeof api !== 'function') return;

    try {
      const data = await api('/autonomy/dashboard');
      const flags = data.flags || {};
      const ks = data.kill_switches?.kill_switches || {};
      const pipe = data.pipeline || {};
      const ultima = data.ultima_acao_por_agente || [];
      const tools = data.tool_calls_24h || [];

      const flagRow = (label, on, envVar) => `
        <tr>
          <td style="padding:6px 10px">${label}</td>
          <td style="padding:6px 10px;color:${on ? 'var(--green)' : 'var(--muted)'}">
            ${on ? '<strong>ON</strong>' : 'off'}
          </td>
          <td style="padding:6px 10px;color:var(--muted);font-family:monospace;font-size:.72rem">${envVar}</td>
        </tr>`;

      const killRow = (worker, meta) => `
        <tr>
          <td style="padding:6px 10px;text-transform:capitalize">${worker}</td>
          <td style="padding:6px 10px;color:var(--red)">
            <strong>PAUSADO</strong>
          </td>
          <td style="padding:6px 10px;color:var(--muted);font-size:.72rem">
            ${meta.reason || '—'}
            ${meta.at ? '<br><span style="font-size:.65rem">' + meta.at + '</span>' : ''}
          </td>
          <td>
            <button class="btn btn-sm btn-outline" onclick="window.AutonomyPanel.clearKill('${worker}')">Reativar</button>
          </td>
        </tr>`;

      const killsHtml = Object.keys(ks).length
        ? Object.entries(ks)
            .map(([w, m]) => killRow(w, m))
            .join('')
        : `<tr><td colspan="4" style="padding:10px;text-align:center;color:var(--green)">Nenhum kill switch ativo</td></tr>`;

      const toolsHtml = tools.length
        ? tools
            .map(
              (t) =>
                `<li style="display:flex;justify-content:space-between;padding:3px 0;font-size:.8rem">
                   <span><strong>${t.agente}</strong> <code style="background:var(--bg);padding:1px 6px;border-radius:4px;font-size:.7rem">${t.tool_name}</code></span>
                   <strong style="color:var(--text)">${t.c}</strong>
                 </li>`
            )
            .join('')
        : '<li style="color:var(--muted);padding:3px 0">nenhuma chamada nas ultimas 24h</li>';

      const ultimaHtml = ultima.length
        ? ultima
            .map(
              (a) =>
                `<li style="display:flex;justify-content:space-between;padding:3px 0;font-size:.8rem">
                   <span><strong style="text-transform:capitalize">${a.agente}</strong></span>
                   <span style="color:var(--muted)">${a.total} acoes</span>
                 </li>`
            )
            .join('')
        : '<li style="color:var(--muted)">nenhuma atividade hoje</li>';

      containerEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-bottom:18px">
          <div class="stat-card">
            <div class="stat-label" style="margin-bottom:12px">Pipeline E2E (24h/7d)</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:.8rem">
              <div><div style="color:var(--muted);font-size:.7rem">Prospectados 24h</div><div style="font-size:1.4rem;font-weight:600">${pipe.prospectados_24h || 0}</div></div>
              <div><div style="color:var(--muted);font-size:.7rem">Qualificacao</div><div style="font-size:1.4rem;font-weight:600">${pipe.em_qualificacao || 0}</div></div>
              <div><div style="color:var(--muted);font-size:.7rem">Negociacao</div><div style="font-size:1.4rem;font-weight:600">${pipe.em_negociacao || 0}</div></div>
              <div><div style="color:var(--muted);font-size:.7rem">Propostas</div><div style="font-size:1.4rem;font-weight:600">${pipe.com_proposta || 0}</div></div>
              <div><div style="color:var(--muted);font-size:.7rem">Ganhos 7d</div><div style="font-size:1.4rem;font-weight:600;color:var(--green)">${pipe.ganhos_7d || 0}</div></div>
              <div><div style="color:var(--muted);font-size:.7rem">Perdidos 7d</div><div style="font-size:1.4rem;font-weight:600;color:var(--red)">${pipe.perdidos_7d || 0}</div></div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-label" style="margin-bottom:12px">Atividade hoje por agente</div>
            <ul style="margin:0;padding:0;list-style:none">${ultimaHtml}</ul>
          </div>
          <div class="stat-card">
            <div class="stat-label" style="margin-bottom:12px">Tool calls (24h) top 20</div>
            <ul style="margin:0;padding:0;list-style:none;max-height:200px;overflow-y:auto">${toolsHtml}</ul>
          </div>
        </div>

        <div class="card" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="margin:0;font-size:1rem">Workers (feature flags .env)</h3>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:.85rem">
            <tbody>
              ${flagRow('Tool Calling Agents (autonomia core)', flags.USE_TOOL_CALLING_AGENTS, 'USE_TOOL_CALLING_AGENTS')}
              ${flagRow('Prospector (scraping + validation)', flags.PROSPECTOR_WORKER_ENABLED, 'PROSPECTOR_WORKER_ENABLED')}
              ${flagRow('Outbound (Carlos SDR cold)', flags.OUTBOUND_WORKER_ENABLED, 'OUTBOUND_WORKER_ENABLED')}
              ${flagRow('Supervisor (Iani cron 1h)', flags.SUPERVISOR_WORKER_ENABLED, 'SUPERVISOR_WORKER_ENABLED')}
              ${flagRow('Broadcast (campanhas)', flags.BROADCAST_WORKER_ENABLED, 'BROADCAST_WORKER_ENABLED')}
              ${flagRow('Followup (cron 5min)', flags.FOLLOWUP_WORKER_ENABLED, 'FOLLOWUP_WORKER_ENABLED')}
            </tbody>
          </table>
          <div style="margin-top:10px;font-size:.72rem;color:var(--muted)">
            Edite em <code>/opt/consulta-isp-agentes/.env</code> e reinicie o worker (<code>docker compose up -d --force-recreate worker</code>).
          </div>
        </div>

        <div class="card" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="margin:0;font-size:1rem">Kill Switches (runtime)</h3>
            <div>
              <button class="btn btn-sm btn-outline" onclick="window.AutonomyPanel.killAll()" style="margin-right:6px">Kill ALL</button>
              <button class="btn btn-sm btn-outline" onclick="window.AutonomyPanel.clearAll()">Clear ALL</button>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:.85rem">
            <tbody>${killsHtml}</tbody>
          </table>
          <div style="margin-top:10px;font-size:.72rem;color:var(--muted)">
            Kill switches bloqueiam o worker em runtime sem precisar mudar .env. Auto-healer liga automaticamente se ultrapassar thresholds (custo/erro/Z-API).
          </div>
        </div>`;
    } catch (err) {
      containerEl.innerHTML = `<div class="stat-card"><div class="stat-label" style="color:var(--red);text-align:center;padding:20px">Falha ao carregar painel: ${err.message}</div></div>`;
    }
  };

  window.AutonomyPanel = {
    async clearKill(worker) {
      await api(`/autonomy/kill-switches/${worker}`, { method: 'DELETE' });
      const el = document.getElementById('autonomy-panel');
      if (el) window.loadAutonomyPanel(el);
    },
    async killAll() {
      if (!confirm('Parar TODOS os workers autonomos? (kill switches em runtime)')) return;
      await api('/autonomy/kill-switches/all', {
        method: 'POST',
        body: JSON.stringify({ reason: 'kill-all manual via UI' })
      });
      const el = document.getElementById('autonomy-panel');
      if (el) window.loadAutonomyPanel(el);
    },
    async clearAll() {
      await api('/autonomy/kill-switches/all', { method: 'DELETE' });
      const el = document.getElementById('autonomy-panel');
      if (el) window.loadAutonomyPanel(el);
    },
    async forceCheck() {
      await api('/autonomy/healer/check', { method: 'POST' });
      const el = document.getElementById('autonomy-panel');
      if (el) window.loadAutonomyPanel(el);
    }
  };
})();
