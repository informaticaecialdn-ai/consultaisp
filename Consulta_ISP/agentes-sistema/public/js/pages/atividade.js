// Atividade 360° — timeline unificada de tudo que os agentes fizeram.
// Agrupa por dia, mostra chips por tipo (tool_call/conversa/handoff/...)
// com cores por agente. Filtros: agente, tipo, lead_id, window.

(function () {
  const REFRESH_MS = 15 * 1000;
  let refreshTimer = null;
  let state = {
    filters: { agente: '', tipo: 'all', lead_id: '', window: '24h' },
    summary: null,
    items: []
  };

  const WINDOWS = {
    '1h':  { label: '1 hora',  since: () => new Date(Date.now() - 1 * 3600_000).toISOString() },
    '24h': { label: '24h',     since: () => new Date(Date.now() - 24 * 3600_000).toISOString() },
    '7d':  { label: '7 dias',  since: () => new Date(Date.now() - 7 * 86400_000).toISOString() },
    '30d': { label: '30 dias', since: () => new Date(Date.now() - 30 * 86400_000).toISOString() },
    'all': { label: 'Tudo',    since: () => null }
  };

  const KIND_META = {
    atividade:  { label: 'Atividade',  icon: 'i-activity',     color: '#4d4c48' },
    tool_call:  { label: 'Tool Call',  icon: 'i-bolt',         color: '#c96442' },
    conversa:   { label: 'Conversa',   icon: 'i-message',      color: '#2a72b3' },
    handoff:    { label: 'Handoff',    icon: 'i-handoff',      color: '#5a4d6e' },
    tarefa:     { label: 'Tarefa',     icon: 'i-checklist',    color: '#8a6d2a' },
    run:        { label: 'Apify Run',  icon: 'i-globe',        color: '#5b7c5e' }
  };

  const AGENT_COLORS = {
    sofia: '#a64d28', leo: '#8a6d2a', carlos: '#3d5a40', carla: '#3d5a40',
    lucas: '#2a72b3', rafael: '#5a4d6e', marcos: '#a64d28',
    iani: '#4d4c48', diana: '#4d4c48', prospector_cron: '#b8923a', apify: '#5b7c5e'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
      const now = new Date();
      const diff = (now - d) / 1000;
      if (diff < 60) return 'agora';
      if (diff < 3600) return `${Math.floor(diff/60)}m`;
      if (diff < 86400) return d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
      return d.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
    } catch { return iso; }
  }

  function groupByDay(items) {
    const groups = {};
    for (const item of items) {
      try {
        const d = new Date(item.criado_em.replace(' ', 'T') + (item.criado_em.endsWith('Z') ? '' : 'Z'));
        const key = d.toISOString().slice(0, 10);
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      } catch {
        if (!groups._unknown) groups._unknown = [];
        groups._unknown.push(item);
      }
    }
    return groups;
  }

  function dayLabel(key) {
    if (key === '_unknown') return 'Sem data';
    const d = new Date(key);
    const today = new Date().toISOString().slice(0, 10);
    const ontem = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    if (key === today) return 'Hoje';
    if (key === ontem) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' });
  }

  async function loadAll() {
    const root = document.getElementById('atividade-panel');
    if (!root) return;
    if (typeof api !== 'function') return;

    try {
      const w = WINDOWS[state.filters.window] || WINDOWS['24h'];
      const since = w.since();

      const qs = new URLSearchParams();
      qs.set('limit', '200');
      if (since) qs.set('since', since);
      if (state.filters.agente) qs.set('agente', state.filters.agente);
      if (state.filters.tipo && state.filters.tipo !== 'all') qs.set('tipo', state.filters.tipo);
      if (state.filters.lead_id) qs.set('lead_id', state.filters.lead_id);

      const sumQs = new URLSearchParams();
      if (since) sumQs.set('since', since);

      const [timeline, summary] = await Promise.all([
        api('/atividade/timeline?' + qs.toString()).catch(() => ({ items: [] })),
        api('/atividade/summary?' + sumQs.toString()).catch(() => ({ }))
      ]);

      state.items = timeline.items || [];
      state.summary = summary;
      render(root);
    } catch (err) {
      root.innerHTML = `<div class="panel"><div class="panel-body" style="color:var(--red);text-align:center">Erro: ${esc(err.message)}</div></div>`;
    }
  }

  function render(root) {
    const windowLabel = WINDOWS[state.filters.window]?.label || '24h';
    const totalItems = state.items.length;
    const groups = groupByDay(state.items);
    const dayKeys = Object.keys(groups).sort().reverse();

    root.innerHTML = `
      ${renderFilters(windowLabel, totalItems)}
      ${renderSummaryCards()}
      ${dayKeys.length === 0 ? renderEmpty() : dayKeys.map(key => renderDay(key, groups[key])).join('')}
    `;

    // Bind change handlers
    const selAgente = document.getElementById('ativ-agente');
    const selTipo = document.getElementById('ativ-tipo');
    const selWindow = document.getElementById('ativ-window');
    const inpLead = document.getElementById('ativ-lead');
    if (selAgente) selAgente.onchange = (e) => { state.filters.agente = e.target.value; loadAll(); };
    if (selTipo) selTipo.onchange = (e) => { state.filters.tipo = e.target.value; loadAll(); };
    if (selWindow) selWindow.onchange = (e) => { state.filters.window = e.target.value; loadAll(); };
    if (inpLead) inpLead.onchange = (e) => { state.filters.lead_id = e.target.value.trim(); loadAll(); };
  }

  function renderFilters(windowLabel, total) {
    return `
      <div class="panel" style="margin-bottom:16px">
        <div style="padding:14px 20px;display:flex;flex-wrap:wrap;gap:12px;align-items:center">
          <div style="flex:1;min-width:140px">
            <div style="color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Janela</div>
            <select id="ativ-window" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid var(--border-warm);background:var(--bg2)">
              ${Object.entries(WINDOWS).map(([k, w]) => `<option value="${k}" ${state.filters.window === k ? 'selected' : ''}>${w.label}</option>`).join('')}
            </select>
          </div>
          <div style="flex:1;min-width:120px">
            <div style="color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Agente</div>
            <select id="ativ-agente" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid var(--border-warm);background:var(--bg2)">
              <option value="">Todos</option>
              <option value="sofia" ${state.filters.agente === 'sofia' ? 'selected' : ''}>Sofia</option>
              <option value="leo" ${state.filters.agente === 'leo' ? 'selected' : ''}>Leo</option>
              <option value="carlos" ${state.filters.agente === 'carlos' ? 'selected' : ''}>Carlos</option>
              <option value="carla" ${state.filters.agente === 'carla' ? 'selected' : ''}>Carla</option>
              <option value="lucas" ${state.filters.agente === 'lucas' ? 'selected' : ''}>Lucas</option>
              <option value="rafael" ${state.filters.agente === 'rafael' ? 'selected' : ''}>Rafael</option>
              <option value="marcos" ${state.filters.agente === 'marcos' ? 'selected' : ''}>Marcos</option>
              <option value="iani" ${state.filters.agente === 'iani' ? 'selected' : ''}>Iani</option>
            </select>
          </div>
          <div style="flex:1;min-width:130px">
            <div style="color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Tipo</div>
            <select id="ativ-tipo" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid var(--border-warm);background:var(--bg2)">
              <option value="all">Tudo</option>
              <option value="atividade" ${state.filters.tipo === 'atividade' ? 'selected' : ''}>Atividades</option>
              <option value="tool_call" ${state.filters.tipo === 'tool_call' ? 'selected' : ''}>Tool calls</option>
              <option value="conversa" ${state.filters.tipo === 'conversa' ? 'selected' : ''}>Conversas</option>
              <option value="handoff" ${state.filters.tipo === 'handoff' ? 'selected' : ''}>Handoffs</option>
              <option value="tarefa" ${state.filters.tipo === 'tarefa' ? 'selected' : ''}>Tarefas</option>
              <option value="run" ${state.filters.tipo === 'run' ? 'selected' : ''}>Apify runs</option>
            </select>
          </div>
          <div style="flex:1;min-width:120px">
            <div style="color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Lead ID</div>
            <input id="ativ-lead" type="text" value="${esc(state.filters.lead_id)}" placeholder="opcional"
                   style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid var(--border-warm);background:var(--bg2)">
          </div>
          <div style="color:var(--muted);font-size:.78rem;padding-top:18px">${total} evento(s) em ${windowLabel}</div>
        </div>
      </div>`;
  }

  function renderSummaryCards() {
    const s = state.summary || {};
    const kinds = [
      ['atividades', 'Atividades', 'i-activity'],
      ['tool_calls', 'Tool calls', 'i-bolt'],
      ['conversas', 'Conversas', 'i-message'],
      ['handoffs', 'Handoffs', 'i-handoff'],
      ['tarefas', 'Tarefas', 'i-checklist']
    ];
    const cards = kinds.map(([k, label, icon]) => `
      <div class="stat-card" style="padding:14px 16px">
        <div class="stat-top"><div class="stat-icon"><svg class="icon"><use href="#${icon}"/></svg></div></div>
        <div style="font-size:1.4rem;font-weight:600">${s[k] || 0}</div>
        <div class="stat-label" style="font-size:.75rem">${label}</div>
      </div>
    `).join('');

    const porAgente = (s.por_agente || []).slice(0, 4);
    const porAgenteCard = porAgente.length ? `
      <div class="stat-card" style="padding:14px 16px">
        <div class="stat-label" style="font-size:.72rem;margin-bottom:8px">Top agentes (periodo)</div>
        ${porAgente.map(a => `
          <div style="display:flex;justify-content:space-between;padding:2px 0;font-size:.8rem">
            <span style="text-transform:capitalize">${esc(a.agente)}</span>
            <strong>${a.total}</strong>
          </div>`).join('')}
      </div>` : '';

    return `
      <div class="stats-grid" style="margin-bottom:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px">
        ${cards}${porAgenteCard}
      </div>`;
  }

  function renderDay(key, items) {
    return `
      <div class="panel" style="margin-bottom:14px">
        <div style="padding:10px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <div style="font-family:'Newsreader',Georgia,serif;font-size:1.05rem;font-weight:500;color:var(--text);text-transform:capitalize">${dayLabel(key)}</div>
          <div style="color:var(--muted);font-size:.78rem">${items.length} eventos</div>
        </div>
        <div style="padding:0">
          ${items.map(renderEvent).join('')}
        </div>
      </div>`;
  }

  function renderEvent(item) {
    const meta = KIND_META[item.kind] || { label: item.kind, icon: 'i-activity', color: '#4d4c48' };
    const agentColor = AGENT_COLORS[item.agente] || '#4d4c48';
    const timeAgo = formatTime(item.criado_em);

    // Subtipo -> label mais legivel
    let subtipoHtml = '';
    if (item.subtipo) {
      if (item.kind === 'conversa') {
        subtipoHtml = `<span class="badge" style="background:${item.subtipo === 'enviada' ? 'rgba(91,124,94,.12)' : 'rgba(42,114,179,.12)'};color:${item.subtipo === 'enviada' ? 'var(--green)' : '#2a72b3'};border-color:transparent;font-size:.65rem">${item.subtipo}</span>`;
      } else if (item.kind === 'tool_call') {
        const statusColor = item.meta1 === 'ok' ? 'var(--green)' : item.meta1 === 'blocked' ? 'var(--yellow)' : 'var(--red)';
        subtipoHtml = `<code style="font-size:.72rem;color:${meta.color}">${esc(item.subtipo)}</code>
                       <span class="badge" style="background:${item.meta1 === 'ok' ? 'rgba(91,124,94,.12)' : 'rgba(181,51,51,.10)'};color:${statusColor};border-color:transparent;font-size:.62rem;margin-left:4px">${esc(item.meta1 || '')}</span>`;
      } else if (item.kind === 'handoff') {
        subtipoHtml = `<span style="color:${meta.color};font-size:.8rem;font-weight:500">→ ${esc(item.subtipo)}</span>`;
      } else {
        subtipoHtml = `<span style="color:${meta.color};font-size:.78rem;font-weight:500">${esc(item.subtipo)}</span>`;
      }
    }

    const duracaoHtml = item.duracao_ms ? `<span style="color:var(--muted);font-size:.7rem">${Math.round(item.duracao_ms)}ms</span>` : '';
    const leadHtml = item.lead_id ? `<a href="#" onclick="event.preventDefault();window.Atividade.filterLead(${item.lead_id})" style="color:var(--muted);font-size:.72rem">lead #${item.lead_id}</a>` : '';

    return `
      <div style="padding:10px 20px;border-bottom:1px solid var(--border);display:grid;grid-template-columns:auto auto 1fr auto;gap:12px;align-items:start;font-size:.85rem">
        <div style="width:28px;height:28px;border-radius:6px;background:${meta.color}14;display:flex;align-items:center;justify-content:center;color:${meta.color};flex-shrink:0">
          <svg class="icon" style="width:14px;height:14px"><use href="#${meta.icon}"/></svg>
        </div>
        <div style="min-width:70px">
          <div style="color:${agentColor};font-weight:500;text-transform:capitalize;font-size:.82rem">${esc(item.agente || '—')}</div>
          <div style="color:var(--muted);font-size:.68rem">${timeAgo}</div>
        </div>
        <div style="min-width:0">
          <div style="margin-bottom:2px">${subtipoHtml}</div>
          <div style="color:var(--text);font-size:.82rem;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.descricao || '').slice(0, 200)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0">
          ${leadHtml}
          ${duracaoHtml}
        </div>
      </div>`;
  }

  function renderEmpty() {
    return `
      <div class="panel">
        <div style="text-align:center;padding:60px 20px;color:var(--muted)">
          <svg style="width:48px;height:48px;opacity:.3;margin-bottom:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <div style="font-family:'Newsreader',Georgia,serif;font-size:1.2rem;color:var(--text);margin-bottom:6px">Sem eventos no periodo</div>
          <div style="font-size:.85rem;max-width:320px;margin:0 auto">
            Ajuste os filtros acima ou espere os agentes gerarem atividade.
            Todos os tool calls, conversas, handoffs e tarefas aparecem aqui em tempo real.
          </div>
        </div>
      </div>`;
  }

  window.Atividade = {
    filterLead(leadId) {
      state.filters.lead_id = String(leadId);
      loadAll();
    },
    clearFilters() {
      state.filters = { agente: '', tipo: 'all', lead_id: '', window: '24h' };
      loadAll();
    }
  };

  window.loadAtividade = function () {
    loadAll();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      const active = document.querySelector('.page.active');
      if (active?.id === 'page-atividade') loadAll();
      else { clearInterval(refreshTimer); refreshTimer = null; }
    }, REFRESH_MS);
  };
})();
