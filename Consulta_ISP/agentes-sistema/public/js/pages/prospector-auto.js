// Prospector IA — pagina reformulada com region picker IBGE.
// Foco: regionalizar (mesorregiao) em vez de UF solta, UX limpa e visual.

(function () {
  const REFRESH_MS = 20 * 1000;
  let refreshTimer = null;
  let state = {
    cfg: null,
    stats: null,
    out: null,
    enrich: null,
    cobertura: null,
    editMode: false,
    pickerUf: null,
    pickerSelecionadas: [] // [{ uf, slug, nome }]
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function loadAll() {
    const root = document.getElementById('prospector-auto-panel');
    if (!root) return;
    if (typeof api !== 'function') return;

    try {
      const [cfg, stats, out, enrich, cobertura, erpBreakdown] = await Promise.all([
        api('/prospector/config').catch(() => null),
        api('/prospector/stats').catch(() => null),
        api('/outbound/stats').catch(() => null),
        api('/enricher/stats').catch(() => null),
        api('/regioes/cobertura').catch(() => null),
        api('/regioes/erp-breakdown').catch(() => null)
      ]);
      state.cfg = cfg;
      state.stats = stats;
      state.out = out;
      state.enrich = enrich;
      state.cobertura = cobertura;
      state.erpBreakdown = erpBreakdown;
      if (!state.pickerSelecionadas.length && cfg?.mesorregioes?.length) {
        state.pickerSelecionadas = cfg.mesorregioes.slice();
      }
      render(root);
    } catch (err) {
      root.innerHTML = `<div class="panel"><div class="panel-body" style="color:var(--red);text-align:center">Erro: ${esc(err.message)}</div></div>`;
    }
  }

  function render(root) {
    const { cfg, stats, out, enrich } = state;
    const pipe = stats || { queue: { by_status: [] }, leads_importados: 0, leads_ultimos_7d: 0, runs_recentes: [] };
    const queueByStatus = {};
    for (const r of (pipe.queue?.by_status || [])) queueByStatus[r.status] = r.c;

    const outboundStatus = out?.worker || {};
    const budgetRemaining = outboundStatus.budget_remaining != null ? outboundStatus.budget_remaining : '—';
    const isKilled = !!outboundStatus.paused;

    const enrichedPct = enrich?.enriched_pct || 0;
    const enrichColor = enrichedPct >= 70 ? 'green' : enrichedPct >= 30 ? 'yellow' : 'muted';

    root.innerHTML = `
      ${renderActionsBar(cfg, isKilled)}
      ${renderStatsRow({ pipe, out, outboundStatus, budgetRemaining, queueByStatus })}
      ${renderEnrichRow(enrich, enrichedPct, enrichColor)}
      ${state.editMode ? renderRegionPicker() : renderConfigView(cfg)}
      ${renderErpBreakdown()}
      ${renderCoberturaTable()}
      ${renderRecentRuns(pipe.runs_recentes || [])}
    `;
  }

  function renderErpBreakdown() {
    const data = state.erpBreakdown;
    if (!data) return '';
    const porErp = data.por_erp || [];
    const suportados = data.erps_suportados || [];
    const semErp = data.total_sem_erp || 0;
    const comErp = data.total_com_erp || 0;

    if (porErp.length === 0 && semErp === 0) return '';

    const erpLabels = {};
    for (const s of suportados) erpLabels[s.slug] = s.label;

    const rows = porErp.map(r => {
      const label = erpLabels[r.erp] || r.erp;
      const pct = comErp ? Math.round((r.total / comErp) * 100) : 0;
      return `
        <tr style="border-bottom:1px solid var(--border)">
          <td style="padding:8px 10px"><strong>${esc(label)}</strong> <span style="color:var(--muted);font-size:.7rem">${esc(r.erp)}</span></td>
          <td style="padding:8px 10px;text-align:right"><strong>${r.total}</strong></td>
          <td style="padding:8px 10px;text-align:right;color:${r.quentes > 0 ? 'var(--green)' : 'var(--muted)'}">${r.quentes}</td>
          <td style="padding:8px 10px;text-align:right;color:${r.ganhos > 0 ? 'var(--green)' : 'var(--muted)'}">${r.ganhos}</td>
          <td style="padding:8px 10px;text-align:right">
            <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px">
              <div style="width:60px;height:5px;background:var(--border-warm);border-radius:3px;overflow:hidden">
                <div style="width:${pct}%;height:100%;background:var(--terracotta)"></div>
              </div>
              <span style="font-size:.72rem;color:var(--muted);min-width:30px">${pct}%</span>
            </div>
          </td>
        </tr>`;
    }).join('');

    const total = comErp + semErp;
    const pctDetectado = total ? Math.round((comErp / total) * 100) : 0;

    return `
      <div class="panel" style="margin-bottom:18px">
        <div class="panel-header">
          <h2>ERPs detectados nos leads</h2>
          <span style="color:var(--muted);font-size:.78rem">${pctDetectado}% dos prospects ja identificados</span>
        </div>
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:14px">
            <div style="padding:10px 14px;background:var(--bg2);border-radius:8px;border:1px solid var(--border)">
              <div style="font-size:.72rem;color:var(--muted);text-transform:uppercase">Com ERP</div>
              <div style="font-size:1.4rem;font-weight:600;color:var(--green)">${comErp}</div>
            </div>
            <div style="padding:10px 14px;background:var(--bg2);border-radius:8px;border:1px solid var(--border)">
              <div style="font-size:.72rem;color:var(--muted);text-transform:uppercase">Sem ERP (Carlos pergunta)</div>
              <div style="font-size:1.4rem;font-weight:600;color:var(--muted)">${semErp}</div>
            </div>
            <div style="padding:10px 14px;background:var(--bg2);border-radius:8px;border:1px solid var(--border)">
              <div style="font-size:.72rem;color:var(--muted);text-transform:uppercase">Suportados</div>
              <div style="font-size:1.4rem;font-weight:600;color:var(--terracotta)">${suportados.length}</div>
            </div>
          </div>
          ${porErp.length ? `
            <table style="width:100%;border-collapse:collapse;font-size:.85rem">
              <thead>
                <tr style="border-bottom:1px solid var(--border)">
                  <th style="text-align:left;padding:8px 10px">ERP</th>
                  <th style="text-align:right;padding:8px 10px">Leads</th>
                  <th style="text-align:right;padding:8px 10px">Quentes</th>
                  <th style="text-align:right;padding:8px 10px">Ganhos</th>
                  <th style="text-align:right;padding:8px 10px">% do total</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          ` : '<div style="color:var(--muted);text-align:center;padding:10px">nenhum ERP detectado ainda — rode enrichment pra popular</div>'}
          <div style="margin-top:10px;font-size:.72rem;color:var(--muted)">
            Suportados: ${suportados.map(s => esc(s.label)).join(', ')}. Outros ERPs podem ser cadastrados manualmente pelo Carlos via tool <code>enrich_lead</code>.
          </div>
        </div>
      </div>`;
  }

  // --- BARRA DE AÇÕES (topo, destacada) ---
  function renderActionsBar(cfg, isKilled) {
    const enabled = !!cfg?.enabled;
    const hasRegions = (cfg?.mesorregioes?.length || 0) > 0;
    const hasTermos = (cfg?.termos?.length || 0) > 0;
    const ready = enabled && hasRegions && hasTermos;

    return `
      <div class="panel" style="margin-bottom:18px;border-left:4px solid ${ready ? 'var(--green)' : 'var(--yellow)'}">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-weight:600;font-size:1.05rem">
              ${ready
                ? `<span style="color:var(--green)">●</span> Prospector configurado e pronto`
                : `<span style="color:var(--yellow)">●</span> Configurar antes de rodar`}
            </div>
            <div style="color:var(--muted);font-size:.82rem;margin-top:2px">
              ${ready
                ? `${cfg.mesorregioes.length} mesorregiao(oes) selecionada(s), ${cfg.termos.length} termo(s) de busca`
                : 'Escolha estado → mesorregiao → termos nas seções abaixo'}
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" onclick="window.ProspectorAuto.runScraping()" ${ready ? '' : 'disabled'}>
              <svg class="icon icon-sm"><use href="#i-rocket"/></svg>
              Rodar scraping
            </button>
            <button class="btn btn-outline" onclick="window.ProspectorAuto.runValidation()">
              <svg class="icon icon-sm"><use href="#i-shield-check"/></svg>
              Validar fila
            </button>
            <button class="btn btn-outline" onclick="window.ProspectorAuto.runEnrichment()">
              <svg class="icon icon-sm"><use href="#i-globe"/></svg>
              Enriquecer
            </button>
            <button class="btn btn-outline" onclick="window.ProspectorAuto.runOutboundBatch()">
              <svg class="icon icon-sm"><use href="#i-broadcast"/></svg>
              Outbound
            </button>
            ${isKilled ? `<button class="btn btn-danger btn-sm" onclick="window.ProspectorAuto.resetCircuit()">Resetar circuit</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  // --- STATS ROW 1 (pipeline) ---
  function renderStatsRow({ pipe, out, outboundStatus, budgetRemaining, queueByStatus }) {
    return `
      <div class="stats-grid" style="margin-bottom:14px">
        ${statCard('Pendentes na fila', queueByStatus.pending || 0, 'aguardando validacao', 'i-activity', queueByStatus.pending > 50 ? 'yellow' : 'muted')}
        ${statCard('Aprovados 7 dias', pipe.leads_ultimos_7d || 0, 'leads prospector_auto importados', 'i-shield-check', 'green')}
        ${statCard('Cold hoje (Carlos)', out?.cold_hoje || 0, `max diario: ${outboundStatus.budget_remaining != null ? (out?.cold_hoje || 0) + budgetRemaining : '—'}`, 'i-broadcast', 'terracotta')}
        ${statCard('Qualificados 7d', out?.qualificados_7d || 0, 'handoffs Carlos → Lucas', 'i-users', 'green')}
      </div>`;
  }

  // --- STATS ROW 2 (enrichment) ---
  function renderEnrichRow(enrich, pct, color) {
    return `
      <div class="stats-grid" style="margin-bottom:20px">
        ${statCard('Enriquecidos', `${pct}%`, `${enrich?.enriched || 0} de ${enrich?.total || 0}`, 'i-globe', color)}
        ${statCard('Com CNPJ', enrich?.com_cnpj || 0, 'dados Receita Federal', 'i-shield-check', enrich?.com_cnpj > 0 ? 'green' : 'muted')}
        ${statCard('Com email extra', enrich?.com_email || 0, 'emails descobertos no site', 'i-message', enrich?.com_email > 0 ? 'green' : 'muted')}
        ${statCard('Pendentes enrich', enrich?.pending || 0, 'com site mas nao enriquecidos', 'i-activity', enrich?.pending > 0 ? 'yellow' : 'muted')}
      </div>`;
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

  // --- CONFIG VIEW (modo leitura) ---
  function renderConfigView(cfg) {
    if (!cfg) return '<div style="color:var(--muted)">config nao carregada</div>';
    const mesorregioes = Array.isArray(cfg.mesorregioes) ? cfg.mesorregioes : [];
    const termos = Array.isArray(cfg.termos) ? cfg.termos : [];
    const enabled = !!cfg.enabled;

    const mesoHtml = mesorregioes.length
      ? mesorregioes.map(m => `
          <span class="badge" style="background:rgba(201,100,66,.1);color:var(--terracotta);border-color:rgba(201,100,66,.3);padding:4px 10px;margin:2px;display:inline-block">
            ${esc(m.nome || m.slug)} <span style="opacity:.6">(${m.uf})</span>
          </span>`).join('')
      : '<span style="color:var(--muted);font-style:italic">nenhuma selecionada — clique "Configurar regioes"</span>';

    const termosHtml = termos.length
      ? termos.map(t => `<code style="margin-right:6px">${esc(t)}</code>`).join('')
      : '<span style="color:var(--muted);font-style:italic">nenhum</span>';

    return `
      <div class="panel" style="margin-bottom:18px">
        <div class="panel-header">
          <h2 style="display:flex;align-items:center;gap:10px">
            Configuracao
            <span class="badge" style="background:${enabled ? 'rgba(91,124,94,.12)' : 'rgba(77,76,72,.08)'};color:${enabled ? 'var(--green)' : 'var(--muted)'};border-color:transparent;font-size:.72rem">
              ${enabled ? 'ATIVO' : 'desativado'}
            </span>
          </h2>
          <button class="btn btn-primary btn-sm" onclick="window.ProspectorAuto.openEdit()">
            <svg class="icon icon-sm"><use href="#i-edit"/></svg>
            Configurar regioes
          </button>
        </div>
        <div class="panel-body">
          <div style="margin-bottom:14px">
            <div style="font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Mesorregioes alvo</div>
            <div>${mesoHtml}</div>
          </div>
          <div style="margin-bottom:14px">
            <div style="font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Termos de busca no Google Maps</div>
            <div>${termosHtml}</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;font-size:.82rem;color:var(--muted);padding-top:12px;border-top:1px solid var(--border)">
            <div>Max leads/run: <strong style="color:var(--text)">${cfg.max_leads_por_run || 50}</strong></div>
            <div>Min rating: <strong style="color:var(--text)">${cfg.min_rating || 3.5}</strong></div>
            <div>Min reviews: <strong style="color:var(--text)">${cfg.min_reviews || 3}</strong></div>
            <div>Cron scraping: <code style="font-size:.72rem">${esc(cfg.scraping_cron || '0 8 * * 1,3,5')}</code></div>
          </div>
        </div>
      </div>`;
  }

  // --- REGION PICKER (modo edicao — wizard) ---
  function renderRegionPicker() {
    const cfg = state.cfg || {};
    const selecionadas = state.pickerSelecionadas;
    const termos = Array.isArray(cfg.termos) && cfg.termos.length ? cfg.termos.join('\n') : 'provedor de internet\nfibra otica';

    return `
      <div class="panel" style="margin-bottom:18px">
        <div class="panel-header">
          <h2>Configurar prospeccao regional</h2>
          <div style="display:flex;gap:8px">
            <button class="btn btn-outline btn-sm" onclick="window.ProspectorAuto.cancelEdit()">Cancelar</button>
            <button class="btn btn-primary btn-sm" onclick="window.ProspectorAuto.saveFromPicker()">
              <svg class="icon icon-sm"><use href="#i-shield-check"/></svg>
              Salvar
            </button>
          </div>
        </div>
        <div class="panel-body">
          <!-- STEP 1: estado -->
          <div style="margin-bottom:20px">
            <div style="font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
              1 · Escolha o estado
            </div>
            <div id="picker-estados-row" style="display:flex;flex-wrap:wrap;gap:6px">
              <span style="color:var(--muted)">carregando...</span>
            </div>
          </div>

          <!-- STEP 2: mesorregioes do estado -->
          <div style="margin-bottom:20px;min-height:120px" id="picker-mesorregioes-block">
            <div style="font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
              2 · Mesorregioes ${state.pickerUf ? 'de ' + state.pickerUf : '(escolha um estado acima)'}
            </div>
            <div id="picker-mesorregioes-list" style="color:var(--muted);font-style:italic">
              ${state.pickerUf ? 'carregando...' : 'selecione um estado'}
            </div>
          </div>

          <!-- STEP 3: selecionadas -->
          <div style="margin-bottom:20px">
            <div style="font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
              3 · Mesorregioes selecionadas (${selecionadas.length})
            </div>
            <div id="picker-selecionadas" style="min-height:40px;padding:10px;background:var(--bg2);border-radius:8px;border:1px solid var(--border-warm)">
              ${renderSelecionadasBadges()}
            </div>
          </div>

          <!-- STEP 4: termos -->
          <div style="margin-bottom:20px">
            <div style="font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
              4 · Termos de busca (Google Maps)
            </div>
            <textarea id="picker-termos" rows="3" style="font-family:inherit" placeholder="provedor de internet&#10;fibra otica">${esc(termos)}</textarea>
            <div style="font-size:.72rem;color:var(--muted);margin-top:4px">
              1 termo por linha. Cada termo × cada cidade da mesorregiao = 1 search Google Maps.
            </div>
          </div>

          <!-- STEP 5: parametros -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:14px">
            <div class="form-group">
              <label>Max leads por run</label>
              <input type="number" id="picker-max" value="${cfg.max_leads_por_run || 50}" min="5" max="200">
            </div>
            <div class="form-group">
              <label>Min rating Google</label>
              <input type="number" id="picker-rating" value="${cfg.min_rating || 3.5}" min="0" max="5" step="0.1">
            </div>
            <div class="form-group">
              <label>Min reviews</label>
              <input type="number" id="picker-reviews" value="${cfg.min_reviews || 3}" min="0">
            </div>
            <div class="form-group" style="display:flex;align-items:flex-end">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="picker-enabled" ${cfg.enabled ? 'checked' : ''}>
                <strong>Ativar prospeccao</strong>
              </label>
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderSelecionadasBadges() {
    const sel = state.pickerSelecionadas;
    if (!sel.length) return '<span style="color:var(--muted);font-style:italic">nenhuma ainda — clique nas mesorregioes acima pra adicionar</span>';
    return sel.map((m, i) => `
      <span class="badge" style="background:rgba(201,100,66,.12);color:var(--terracotta);border-color:rgba(201,100,66,.35);padding:5px 12px;margin:3px;display:inline-flex;align-items:center;gap:6px">
        ${esc(m.nome)} <span style="opacity:.6">(${m.uf})</span>
        <button onclick="window.ProspectorAuto.removeMeso(${i})" style="background:transparent;border:none;color:var(--terracotta);cursor:pointer;padding:0;font-weight:bold;font-size:1.1rem;line-height:.8" title="Remover">×</button>
      </span>`).join('');
  }

  // --- COBERTURA TABLE ---
  function renderCoberturaTable() {
    const cobertura = state.cobertura?.cobertura || [];
    const ativas = cobertura.filter(c => c.leads_prospectados > 0).sort((a, b) => b.leads_prospectados - a.leads_prospectados).slice(0, 15);

    if (!ativas.length) {
      return `
        <div class="panel" style="margin-bottom:18px">
          <div class="panel-header"><h2>Cobertura regional</h2></div>
          <div class="panel-body" style="text-align:center;color:var(--muted);padding:20px">
            nenhuma regiao com leads ainda — rode o scraping pra popular
          </div>
        </div>`;
    }

    return `
      <div class="panel" style="margin-bottom:18px">
        <div class="panel-header">
          <h2>Cobertura regional (top 15)</h2>
          <span style="color:var(--muted);font-size:.78rem">atualizado em tempo real</span>
        </div>
        <div class="panel-body">
          <table style="width:100%;border-collapse:collapse;font-size:.85rem">
            <thead>
              <tr style="border-bottom:1px solid var(--border)">
                <th style="text-align:left;padding:8px 10px">Mesorregiao</th>
                <th style="text-align:left;padding:8px 10px">UF</th>
                <th style="text-align:right;padding:8px 10px">Leads</th>
                <th style="text-align:right;padding:8px 10px">Quentes</th>
                <th style="text-align:right;padding:8px 10px">Ganhos</th>
                <th style="text-align:right;padding:8px 10px">Enriq.</th>
                <th style="text-align:right;padding:8px 10px">Densidade</th>
              </tr>
            </thead>
            <tbody>
              ${ativas.map(r => {
                const densidade = r.total_cidades ? Math.min(100, Math.round((r.leads_prospectados / r.total_cidades) * 100)) : 0;
                const barColor = densidade >= 50 ? 'var(--green)' : densidade >= 20 ? 'var(--yellow)' : 'var(--terracotta)';
                return `
                  <tr style="border-bottom:1px solid var(--border)">
                    <td style="padding:8px 10px;color:var(--text)"><strong>${esc(r.nome)}</strong></td>
                    <td style="padding:8px 10px;color:var(--muted)">${r.uf}</td>
                    <td style="padding:8px 10px;text-align:right"><strong>${r.leads_prospectados}</strong></td>
                    <td style="padding:8px 10px;text-align:right;color:${r.leads_quentes > 0 ? 'var(--green)' : 'var(--muted)'}">${r.leads_quentes}</td>
                    <td style="padding:8px 10px;text-align:right;color:${r.ganhos > 0 ? 'var(--green)' : 'var(--muted)'}">${r.ganhos}</td>
                    <td style="padding:8px 10px;text-align:right;color:var(--muted)">${r.enriquecidos}</td>
                    <td style="padding:8px 10px;text-align:right">
                      <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px">
                        <div style="width:60px;height:6px;background:var(--border-warm);border-radius:3px;overflow:hidden">
                          <div style="width:${densidade}%;height:100%;background:${barColor}"></div>
                        </div>
                        <span style="font-size:.72rem;color:var(--muted);min-width:32px">${densidade}%</span>
                      </div>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  // --- RUNS RECENTES ---
  function renderRecentRuns(runs) {
    if (!runs.length) return '';
    return `
      <div class="panel">
        <div class="panel-header"><h2>Ultimas runs Apify</h2></div>
        <div class="panel-body">
          <table style="width:100%;border-collapse:collapse;font-size:.8rem">
            <thead>
              <tr style="border-bottom:1px solid var(--border)">
                <th style="text-align:left;padding:6px 10px">ID</th>
                <th style="text-align:left;padding:6px 10px">Status</th>
                <th style="text-align:right;padding:6px 10px">Itens</th>
                <th style="text-align:right;padding:6px 10px">Novos</th>
                <th style="text-align:right;padding:6px 10px">Duracao</th>
                <th style="text-align:left;padding:6px 10px">Inicio</th>
              </tr>
            </thead>
            <tbody>
              ${runs.slice(0, 10).map(r => `
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:6px 10px"><code>#${r.id}</code></td>
                  <td style="padding:6px 10px">
                    <span class="badge" style="background:${r.status === 'succeeded' ? 'rgba(91,124,94,.12)' : r.status === 'failed' ? 'rgba(181,51,51,.10)' : 'var(--card2)'};color:${r.status === 'succeeded' ? 'var(--green)' : r.status === 'failed' ? 'var(--red)' : 'var(--muted)'}">${r.status}</span>
                  </td>
                  <td style="padding:6px 10px;text-align:right">${r.items_count || 0}</td>
                  <td style="padding:6px 10px;text-align:right"><strong>${r.leads_novos || 0}</strong></td>
                  <td style="padding:6px 10px;text-align:right;color:var(--muted)">${r.duracao_ms ? Math.round(r.duracao_ms/1000) + 's' : '—'}</td>
                  <td style="padding:6px 10px;color:var(--muted);font-size:.75rem">${r.iniciado_em || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  // === Actions ===
  window.ProspectorAuto = {
    load: loadAll,

    async openEdit() {
      state.editMode = true;
      // Pre-popula selecionadas do cfg atual
      state.pickerSelecionadas = (state.cfg?.mesorregioes || []).slice();
      render(document.getElementById('prospector-auto-panel'));
      await populatePickerEstados();
    },

    cancelEdit() {
      state.editMode = false;
      state.pickerSelecionadas = (state.cfg?.mesorregioes || []).slice();
      state.pickerUf = null;
      render(document.getElementById('prospector-auto-panel'));
    },

    async pickUf(uf) {
      state.pickerUf = uf;
      const block = document.getElementById('picker-mesorregioes-block');
      if (block) {
        block.querySelector('div:first-child').textContent = `2 · Mesorregioes de ${uf}`;
      }
      const list = document.getElementById('picker-mesorregioes-list');
      if (list) list.innerHTML = 'carregando...';
      try {
        const data = await api(`/regioes/${uf}/mesorregioes`);
        const mesos = data.mesorregioes || [];
        if (list) {
          list.innerHTML = mesos.map(m => {
            const jaSelecionada = state.pickerSelecionadas.some(s => s.uf === m.uf && s.slug === m.slug);
            return `
              <div onclick="window.ProspectorAuto.toggleMeso('${esc(m.uf)}','${esc(m.slug)}','${esc(m.nome)}')"
                   style="cursor:pointer;padding:10px 14px;margin:4px 4px 4px 0;display:inline-block;border-radius:8px;
                          border:1px solid ${jaSelecionada ? 'var(--terracotta)' : 'var(--border-warm)'};
                          background:${jaSelecionada ? 'rgba(201,100,66,.1)' : 'var(--bg2)'};
                          color:${jaSelecionada ? 'var(--terracotta)' : 'var(--text)'};
                          font-size:.85rem;transition:all .15s">
                ${jaSelecionada ? '✓ ' : '+ '}${esc(m.nome)}
                <span style="color:var(--muted);font-size:.72rem;margin-left:6px">${m.total_cidades} cidades</span>
              </div>`;
          }).join('');
        }
        // Atualiza destaque dos estados
        document.querySelectorAll('[data-uf]').forEach(el => {
          if (el.dataset.uf === uf) el.style.background = 'var(--terracotta)', el.style.color = '#faf9f5';
          else el.style.background = 'var(--bg2)', el.style.color = 'var(--text)';
        });
      } catch (err) {
        if (list) list.innerHTML = `<span style="color:var(--red)">Erro: ${esc(err.message)}</span>`;
      }
    },

    toggleMeso(uf, slug, nome) {
      const idx = state.pickerSelecionadas.findIndex(s => s.uf === uf && s.slug === slug);
      if (idx >= 0) state.pickerSelecionadas.splice(idx, 1);
      else state.pickerSelecionadas.push({ uf, slug, nome });
      // Re-render so o bloco 3 + lista mesorregioes atual
      const sel = document.getElementById('picker-selecionadas');
      if (sel) sel.innerHTML = renderSelecionadasBadges();
      this.pickUf(uf);
    },

    removeMeso(idx) {
      state.pickerSelecionadas.splice(idx, 1);
      const sel = document.getElementById('picker-selecionadas');
      if (sel) sel.innerHTML = renderSelecionadasBadges();
      if (state.pickerUf) this.pickUf(state.pickerUf);
    },

    async saveFromPicker() {
      const enabled = document.getElementById('picker-enabled').checked;
      const termos = document.getElementById('picker-termos').value
        .split('\n').map(s => s.trim()).filter(Boolean);
      const max_leads_por_run = parseInt(document.getElementById('picker-max').value) || 50;
      const min_rating = parseFloat(document.getElementById('picker-rating').value) || 3.5;
      const min_reviews = parseInt(document.getElementById('picker-reviews').value) || 3;

      if (!state.pickerSelecionadas.length) {
        alert('Selecione ao menos 1 mesorregiao.');
        return;
      }
      if (!termos.length) {
        alert('Adicione ao menos 1 termo de busca.');
        return;
      }

      try {
        await api('/prospector/config', {
          method: 'PATCH',
          body: JSON.stringify({
            enabled,
            mesorregioes: state.pickerSelecionadas,
            regioes: [], // limpa UFs soltas
            termos,
            max_leads_por_run, min_rating, min_reviews
          })
        });
        state.editMode = false;
        state.pickerUf = null;
        await loadAll();
      } catch (err) {
        alert('Erro ao salvar: ' + err.message);
      }
    },

    async runScraping() {
      const btn = event?.target?.closest('button');
      if (btn) { btn.disabled = true; btn.textContent = 'Rodando...'; }
      try {
        const r = await api('/prospector/run-scraping', { method: 'POST' });
        if (r.skipped) alert(`Skipped: ${r.reason || 'config desabilitada'}`);
        else alert(`OK: ${r.executed || 0}/${r.total_targets || 0} targets scrapados (~${(r.results || []).reduce((s,x) => s + (x.items || 0), 0)} items)`);
        await loadAll();
      } catch (err) {
        alert('Erro: ' + err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    },

    async runValidation() {
      const btn = event?.target?.closest('button');
      if (btn) { btn.disabled = true; btn.textContent = 'Validando...'; }
      try {
        const r = await api('/prospector/run-validation', { method: 'POST' });
        if (r.skipped) alert(`Skipped: ${r.reason}`);
        else alert(`Aprovados: ${r.validation?.aprovados || 0}, rejeitados: ${r.validation?.rejeitados || 0}, duplicados: ${r.validation?.duplicados || 0}. Importados: ${r.import?.importados || 0}`);
        await loadAll();
      } catch (err) {
        alert('Erro: ' + err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    },

    async runEnrichment() {
      const btn = event?.target?.closest('button');
      if (btn) { btn.disabled = true; btn.textContent = 'Enriquecendo...'; }
      try {
        const r = await api('/enricher/run', { method: 'POST', body: JSON.stringify({ limit: 20 }) });
        if (r.reason === 'no_candidates') alert('Nada pra enriquecer — todos ja foram ou sem site.');
        else if (r.reason === 'apify_not_configured') alert('APIFY_TOKEN nao configurado');
        else alert(`Enriquecidos: ${r.enriched || 0} de ${r.total || 0}\nCNPJ: ${r.cnpj_found || 0} | ReceitaWS: ${r.receita_ok || 0}`);
        await loadAll();
      } catch (err) {
        alert('Erro: ' + err.message);
      } finally {
        if (btn) btn.disabled = false;
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
        if (btn) btn.disabled = false;
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

  async function populatePickerEstados() {
    try {
      const data = await api('/regioes/estados');
      const estados = data.estados || [];
      const row = document.getElementById('picker-estados-row');
      if (!row) return;
      row.innerHTML = estados.map(e => `
        <button data-uf="${esc(e.uf)}" onclick="window.ProspectorAuto.pickUf('${esc(e.uf)}')"
                style="padding:8px 14px;border-radius:8px;border:1px solid var(--border-warm);
                       background:var(--bg2);color:var(--text);cursor:pointer;font-size:.82rem;
                       transition:all .15s;font-weight:500">
          ${esc(e.uf)}
          <span style="color:var(--muted);font-size:.7rem;margin-left:4px">${esc(e.nome)}</span>
        </button>
      `).join('');
    } catch (err) {
      const row = document.getElementById('picker-estados-row');
      if (row) row.innerHTML = `<span style="color:var(--red)">Erro carregando estados: ${esc(err.message)}</span>`;
    }
  }

  // Chamado pelo router quando entra na pagina
  window.loadProspectorAuto = function () {
    state.editMode = false;
    state.pickerUf = null;
    state.pickerSelecionadas = [];
    loadAll();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      const active = document.querySelector('.page.active');
      if (active?.id === 'page-prospector-auto' && !state.editMode) loadAll();
      else if (!active || active?.id !== 'page-prospector-auto') { clearInterval(refreshTimer); refreshTimer = null; }
    }, REFRESH_MS);
  };
})();
