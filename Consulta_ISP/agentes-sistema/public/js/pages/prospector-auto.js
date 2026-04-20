// Prospector IA — pagina de controle e acompanhamento em tempo real
// Monta em #prospector-auto-panel, auto-refresh 20s.

(function () {
  const REFRESH_MS = 20 * 1000;
  let refreshTimer = null;
  let currentConfig = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function loadAll() {
    const root = document.getElementById('prospector-auto-panel');
    if (!root) return;
    if (typeof api !== 'function') return;

    try {
      const [cfg, stats, out] = await Promise.all([
        api('/prospector/config').catch(() => null),
        api('/prospector/stats').catch(() => null),
        api('/outbound/stats').catch(() => null),
      ]);
      currentConfig = cfg;
      render(root, cfg, stats, out);
    } catch (err) {
      root.innerHTML = `<div class="panel"><div class="panel-body" style="color:var(--red);text-align:center">Erro: ${esc(err.message)}</div></div>`;
    }
  }

  function render(root, cfg, stats, out) {
    const enabled = !!cfg?.enabled;
    const regioes = Array.isArray(cfg?.regioes) ? cfg.regioes : [];
    const termos = Array.isArray(cfg?.termos) ? cfg.termos : [];

    const pipe = stats || { queue: { by_status: [] }, leads_importados: 0, leads_ultimos_7d: 0, runs_recentes: [] };
    const queueByStatus = {};
    for (const r of (pipe.queue?.by_status || [])) queueByStatus[r.status] = r.c;

    const outboundStatus = out?.worker || {};
    const budgetRemaining = outboundStatus.budget_remaining != null ? outboundStatus.budget_remaining : '—';
    const isKilled = !!outboundStatus.paused;

    root.innerHTML = `
      <!-- Header status -->
      <div class="stats-grid" style="margin-bottom:20px">
        ${statCard('Pendentes na fila', queueByStatus.pending || 0, 'aguardando validacao', 'i-clock', queueByStatus.pending > 50 ? 'yellow' : 'muted')}
        ${statCard('Aprovados 7 dias', pipe.leads_ultimos_7d || 0, 'leads importados com origem=prospector_auto', 'i-check', 'green')}
        ${statCard('Cold hoje (Carlos)', out?.cold_hoje || 0, `max diario: ${outboundStatus.budget_remaining != null ? (out?.cold_hoje || 0) + budgetRemaining : '—'}`, 'i-send', 'terracotta')}
        ${statCard('Qualificados 7d', out?.qualificados_7d || 0, 'handoffs Carlos -> Lucas', 'i-user-check', 'green')}
      </div>

      <!-- Worker status -->
      <div class="grid-2" style="margin-bottom:20px">
        <div class="panel">
          <div class="panel-header"><h2>Status Workers</h2></div>
          <div class="panel-body">
            <table style="width:100%;border-collapse:collapse;font-size:.85rem">
              <tbody>
                <tr>
                  <td style="padding:8px 0"><strong>Prospector</strong></td>
                  <td style="text-align:right;color:${enabled ? 'var(--green)' : 'var(--muted)'}">${enabled ? 'LIGADO' : 'desligado'}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0"><strong>Outbound (Carlos)</strong></td>
                  <td style="text-align:right;color:${outboundStatus.running ? 'var(--green)' : 'var(--muted)'}">${outboundStatus.running ? 'rodando' : 'parado'}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:var(--muted)">Horario comercial agora?</td>
                  <td style="text-align:right">${outboundStatus.business_hour ? 'sim' : 'nao'}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:var(--muted)">Kill switch?</td>
                  <td style="text-align:right;color:${isKilled ? 'var(--red)' : 'var(--muted)'}">${isKilled ? 'ATIVO' : '—'}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:var(--muted)">Orcamento restante cold</td>
                  <td style="text-align:right">${budgetRemaining}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><h2>Acoes manuais</h2></div>
          <div class="panel-body">
            <button class="btn btn-primary" onclick="window.ProspectorAuto.runScraping()" style="width:100%;margin-bottom:8px">
              <svg class="icon icon-sm"><use href="#i-rocket"/></svg> Rodar scraping agora
            </button>
            <button class="btn btn-outline" onclick="window.ProspectorAuto.runValidation()" style="width:100%;margin-bottom:8px">
              <svg class="icon icon-sm"><use href="#i-check"/></svg> Validar fila agora
            </button>
            <button class="btn btn-outline" onclick="window.ProspectorAuto.runOutboundBatch()" style="width:100%;margin-bottom:8px">
              <svg class="icon icon-sm"><use href="#i-send"/></svg> Rodar batch outbound (Carlos)
            </button>
            ${isKilled ? `
              <button class="btn btn-danger" onclick="window.ProspectorAuto.resetCircuit()" style="width:100%">
                Resetar circuit breaker
              </button>` : ''}
            <div style="margin-top:10px;font-size:.72rem;color:var(--muted)">
              Ativa o worker so se <code>PROSPECTOR_WORKER_ENABLED=true</code> no .env.
              Acoes manuais rodam mesmo com worker desligado.
            </div>
          </div>
        </div>
      </div>

      <!-- Config editor -->
      <div class="panel" style="margin-bottom:20px">
        <div class="panel-header">
          <h2>Configuracao</h2>
          <button class="btn btn-sm btn-outline" onclick="window.ProspectorAuto.toggleEdit()" id="cfg-edit-btn">Editar</button>
        </div>
        <div class="panel-body" id="cfg-body">
          ${renderConfigView(cfg)}
        </div>
      </div>

      <!-- Runs recentes -->
      <div class="panel">
        <div class="panel-header"><h2>Ultimas runs (Apify)</h2></div>
        <div class="panel-body">
          ${pipe.runs_recentes?.length ? renderRunsTable(pipe.runs_recentes) : '<div style="text-align:center;color:var(--muted);padding:20px">nenhuma run ainda — clique em "Rodar scraping agora" pra testar</div>'}
        </div>
      </div>
    `;
  }

  function statCard(label, value, sub, icon, color) {
    const colorMap = {
      green: 'var(--green)',
      yellow: 'var(--yellow)',
      terracotta: 'var(--terracotta)',
      muted: 'var(--muted)'
    };
    return `
      <div class="stat-card">
        <div class="stat-top">
          <div class="stat-icon"><svg class="icon"><use href="#${icon}"/></svg></div>
        </div>
        <div class="stat-val" style="color:${colorMap[color] || 'var(--text)'}">${value}</div>
        <div class="stat-label">${label}</div>
        <div style="margin-top:6px;font-size:.72rem;color:var(--muted)">${sub}</div>
      </div>`;
  }

  function renderConfigView(cfg) {
    if (!cfg) return '<div style="color:var(--muted)">config nao carregada</div>';
    const regioes = (cfg.regioes || []).join(', ');
    const termos = (cfg.termos || []).map(t => `"${t}"`).join(', ');
    return `
      <div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:.88rem">
        <div style="color:var(--muted)">Ativo</div>
        <div><strong style="color:${cfg.enabled ? 'var(--green)' : 'var(--muted)'}">${cfg.enabled ? 'ativado' : 'desativado'}</strong></div>

        <div style="color:var(--muted)">Regioes (UF)</div>
        <div>${regioes || '<span style="color:var(--muted)">nenhuma</span>'}</div>

        <div style="color:var(--muted)">Termos de busca</div>
        <div>${termos || '<span style="color:var(--muted)">nenhum</span>'}</div>

        <div style="color:var(--muted)">Max leads por run</div>
        <div>${cfg.max_leads_por_run}</div>

        <div style="color:var(--muted)">Min rating Google</div>
        <div>${cfg.min_rating}</div>

        <div style="color:var(--muted)">Min reviews</div>
        <div>${cfg.min_reviews}</div>

        <div style="color:var(--muted)">Cron scraping</div>
        <div><code>${esc(cfg.scraping_cron || '')}</code></div>

        <div style="color:var(--muted)">Cron validacao</div>
        <div><code>${esc(cfg.validation_cron || '')}</code></div>
      </div>`;
  }

  function renderConfigEdit(cfg) {
    const c = cfg || {};
    return `
      <div style="display:grid;gap:14px">
        <div>
          <label style="display:flex;align-items:center;gap:8px;font-size:.88rem">
            <input type="checkbox" id="cfg-enabled" ${c.enabled ? 'checked' : ''}>
            <strong>Habilitar prospeccao autonoma</strong>
            <span style="color:var(--muted);font-size:.75rem">(tambem precisa PROSPECTOR_WORKER_ENABLED=true no .env)</span>
          </label>
        </div>
        <div class="form-group">
          <label>Regioes (UFs separadas por virgula)</label>
          <input type="text" id="cfg-regioes" value="${esc((c.regioes || []).join(', '))}" placeholder="MG, SP, RS, PR">
          <div style="font-size:.72rem;color:var(--muted);margin-top:4px">Use UFs de 2 letras. Uma busca sera feita por cada regiao x termo.</div>
        </div>
        <div class="form-group">
          <label>Termos de busca (um por linha)</label>
          <textarea id="cfg-termos" rows="4">${esc((c.termos || []).join('\n'))}</textarea>
          <div style="font-size:.72rem;color:var(--muted);margin-top:4px">Ex: "provedor internet", "fibra otica". Cada termo vira 1 search no Google Maps.</div>
        </div>
        <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          <div class="form-group">
            <label>Max leads por run</label>
            <input type="number" id="cfg-max" value="${c.max_leads_por_run || 50}" min="1" max="200">
          </div>
          <div class="form-group">
            <label>Min rating Google (0-5)</label>
            <input type="number" id="cfg-rating" value="${c.min_rating || 3.5}" min="0" max="5" step="0.1">
          </div>
          <div class="form-group">
            <label>Min reviews</label>
            <input type="number" id="cfg-reviews" value="${c.min_reviews || 3}" min="0">
          </div>
        </div>
        <details>
          <summary style="cursor:pointer;color:var(--muted);font-size:.85rem">Avancado: cron schedules</summary>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px">
            <div class="form-group">
              <label>Cron scraping <span style="color:var(--muted);font-weight:400">(min hora dom-sem)</span></label>
              <input type="text" id="cfg-cron-scrap" value="${esc(c.scraping_cron || '0 8 * * 1,3,5')}">
              <div style="font-size:.7rem;color:var(--muted);margin-top:2px">default: seg/qua/sex 8h BR</div>
            </div>
            <div class="form-group">
              <label>Cron validacao</label>
              <input type="text" id="cfg-cron-val" value="${esc(c.validation_cron || '0 9 * * *')}">
              <div style="font-size:.7rem;color:var(--muted);margin-top:2px">default: diariamente 9h BR</div>
            </div>
          </div>
        </details>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button class="btn btn-primary" onclick="window.ProspectorAuto.saveConfig()">Salvar</button>
          <button class="btn btn-outline" onclick="window.ProspectorAuto.cancelEdit()">Cancelar</button>
        </div>
      </div>`;
  }

  function renderRunsTable(runs) {
    return `
      <table class="table" style="width:100%;font-size:.85rem">
        <thead>
          <tr>
            <th>ID</th>
            <th>Status</th>
            <th>Itens</th>
            <th>Novos</th>
            <th>Duracao</th>
            <th>Inicio</th>
          </tr>
        </thead>
        <tbody>
          ${runs.map(r => `
            <tr>
              <td><code>#${r.id}</code></td>
              <td><span class="badge" style="background:${r.status === 'succeeded' ? 'rgba(91,124,94,.12)' : r.status === 'failed' ? 'rgba(181,51,51,.10)' : 'var(--card2)'};color:${r.status === 'succeeded' ? 'var(--green)' : r.status === 'failed' ? 'var(--red)' : 'var(--muted)'}">${r.status}</span></td>
              <td>${r.items_count || 0}</td>
              <td><strong>${r.leads_novos || 0}</strong></td>
              <td style="color:var(--muted)">${r.duracao_ms ? Math.round(r.duracao_ms / 1000) + 's' : '—'}</td>
              <td style="color:var(--muted);font-size:.78rem">${r.iniciado_em || ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  }

  // === Actions API ===
  window.ProspectorAuto = {
    load: loadAll,

    toggleEdit() {
      const body = document.getElementById('cfg-body');
      const btn = document.getElementById('cfg-edit-btn');
      if (!body) return;
      if (btn.textContent === 'Editar') {
        body.innerHTML = renderConfigEdit(currentConfig);
        btn.textContent = 'Ver';
      } else {
        body.innerHTML = renderConfigView(currentConfig);
        btn.textContent = 'Editar';
      }
    },

    cancelEdit() {
      const body = document.getElementById('cfg-body');
      const btn = document.getElementById('cfg-edit-btn');
      if (!body || !btn) return;
      body.innerHTML = renderConfigView(currentConfig);
      btn.textContent = 'Editar';
    },

    async saveConfig() {
      const enabled = document.getElementById('cfg-enabled').checked;
      const regioes = document.getElementById('cfg-regioes').value
        .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const termos = document.getElementById('cfg-termos').value
        .split('\n').map(s => s.trim()).filter(Boolean);
      const max_leads_por_run = parseInt(document.getElementById('cfg-max').value) || 50;
      const min_rating = parseFloat(document.getElementById('cfg-rating').value) || 3.5;
      const min_reviews = parseInt(document.getElementById('cfg-reviews').value) || 3;
      const scraping_cron = document.getElementById('cfg-cron-scrap')?.value || '0 8 * * 1,3,5';
      const validation_cron = document.getElementById('cfg-cron-val')?.value || '0 9 * * *';

      try {
        await api('/prospector/config', {
          method: 'PATCH',
          body: JSON.stringify({
            enabled, regioes, termos,
            max_leads_por_run, min_rating, min_reviews,
            scraping_cron, validation_cron
          })
        });
        await loadAll();
      } catch (err) {
        alert('Erro ao salvar: ' + err.message);
      }
    },

    async runScraping() {
      const btn = event?.target?.closest('button');
      if (btn) { btn.disabled = true; btn.textContent = 'Rodando... (ate 5min)'; }
      try {
        const r = await api('/prospector/run-scraping', { method: 'POST' });
        alert(r.skipped ? `Skipped: ${r.reason || 'config desabilitada'}` : `OK: ${(r.results || []).length} regioes scrapadas`);
        await loadAll();
      } catch (err) {
        alert('Erro: ' + err.message);
      } finally {
        if (btn) { btn.disabled = false; loadAll(); }
      }
    },

    async runValidation() {
      const btn = event?.target?.closest('button');
      if (btn) { btn.disabled = true; btn.textContent = 'Validando...'; }
      try {
        const r = await api('/prospector/run-validation', { method: 'POST' });
        if (r.skipped) alert(`Skipped: ${r.reason}`);
        else alert(`Validacao: ${r.validation?.aprovados || 0} aprovados, ${r.validation?.rejeitados || 0} rejeitados, ${r.validation?.duplicados || 0} duplicados. Importados: ${r.import?.importados || 0}`);
        await loadAll();
      } catch (err) {
        alert('Erro: ' + err.message);
      } finally {
        if (btn) { btn.disabled = false; loadAll(); }
      }
    },

    async runOutboundBatch() {
      const btn = event?.target?.closest('button');
      if (btn) { btn.disabled = true; btn.textContent = 'Disparando...'; }
      try {
        const r = await api('/outbound/run-batch', { method: 'POST' });
        alert(r.skipped ? `Skipped: ${r.reason}` : `OK: ${r.sent || 0} enviados de ${r.processed || 0} tentados`);
        await loadAll();
      } catch (err) {
        alert('Erro: ' + err.message);
      } finally {
        if (btn) { btn.disabled = false; loadAll(); }
      }
    },

    async resetCircuit() {
      try {
        await api('/outbound/reset-circuit', { method: 'POST' });
        await loadAll();
      } catch (err) {
        alert('Erro: ' + err.message);
      }
    }
  };

  // Chamado pelo router quando entra na pagina
  window.loadProspectorAuto = function () {
    loadAll();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      const active = document.querySelector('.page.active');
      if (active?.id === 'page-prospector-auto') loadAll();
      else { clearInterval(refreshTimer); refreshTimer = null; }
    }, REFRESH_MS);
  };
})();
