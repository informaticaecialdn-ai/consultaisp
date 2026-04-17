// Sprint 5 — Wizard 3 etapas: Audiencia -> Template -> Confirmacao.
(function () {
  const API = '/api';
  const AGENTES = ['carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'diana'];

  const state = {
    step: 1,
    editId: null,
    audiencia_id: null,
    template_id: null,
    agente_remetente: 'carlos',
    nome: '',
    rate_limit_per_min: 20,
    jitter_min_sec: 3,
    jitter_max_sec: 8,
    audiencias: [],
    templates: [],
    preview: null
  };

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderIndicator() {
    const el = document.getElementById('wizard-steps-indicator');
    if (!el) return;
    const steps = [
      { n: 1, label: 'Audiencia' },
      { n: 2, label: 'Template' },
      { n: 3, label: 'Confirmacao' }
    ];
    el.innerHTML = steps.map(s => {
      const done = s.n < state.step;
      const active = s.n === state.step;
      const bg = done ? '#064e3b' : (active ? '#3b82f6' : '#0f172a');
      const color = done ? '#6ee7b7' : (active ? '#fff' : '#64748b');
      const badge = done ? '✓' : s.n;
      return `<div style="flex:1;padding:10px;border-radius:6px;background:${bg};color:${color};font-size:.85rem;text-align:center;font-weight:${active ? 700 : 500}">
        <span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,0.2);line-height:22px;margin-right:6px;font-size:.75rem">${badge}</span>${s.label}
      </div>`;
    }).join('');
  }

  async function loadAudiencias() {
    try {
      const r = await fetch(API + '/audiencias?limit=100');
      const data = await r.json();
      state.audiencias = data.audiencias || [];
    } catch (err) {
      state.audiencias = [];
    }
  }
  async function loadTemplates() {
    try {
      const r = await fetch(API + '/templates?limit=100');
      const data = await r.json();
      state.templates = data.templates || [];
    } catch (err) {
      state.templates = [];
    }
  }

  function renderStep1() {
    const opts = state.audiencias.length
      ? state.audiencias.map(a => `<option value="${a.id}" ${state.audiencia_id == a.id ? 'selected' : ''}>${escapeHtml(a.nome)} (${a.total_leads || 0} leads · ${a.tipo})</option>`).join('')
      : '<option value="">(Nenhuma audiencia — crie uma primeiro via API /api/audiencias ou Sprint 4 UI)</option>';
    return `
      <div style="display:flex;flex-direction:column;gap:12px">
        <div>
          <label style="color:var(--muted);font-size:.85rem">Audiencia</label>
          <select id="w-audiencia" style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:#fff;border-radius:6px;margin-top:4px">
            <option value="">Selecione...</option>
            ${opts}
          </select>
        </div>
        <div style="color:var(--muted);font-size:.8rem">
          ${state.audiencias.length === 0
            ? '<b>Dica:</b> crie uma audiencia via <code>POST /api/audiencias { nome, tipo, lead_ids }</code>.'
            : `${state.audiencias.length} audiencia(s) disponivel(is)`}
        </div>
      </div>
    `;
  }

  function renderStep2() {
    const opts = state.templates.length
      ? state.templates.map(t => `<option value="${t.id}" ${state.template_id == t.id ? 'selected' : ''}>${escapeHtml(t.nome)}${t.ja_aprovado_meta ? ' (HSM)' : ''}</option>`).join('')
      : '<option value="">(Nenhum template — crie um via POST /api/templates)</option>';
    const selected = state.templates.find(t => t.id == state.template_id);
    const preview = selected ? escapeHtml(selected.conteudo) : '';
    return `
      <div style="display:flex;flex-direction:column;gap:12px">
        <div>
          <label style="color:var(--muted);font-size:.85rem">Template</label>
          <select id="w-template" style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:#fff;border-radius:6px;margin-top:4px">
            <option value="">Selecione...</option>
            ${opts}
          </select>
        </div>
        <div>
          <label style="color:var(--muted);font-size:.85rem">Agente remetente</label>
          <select id="w-agente" style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:#fff;border-radius:6px;margin-top:4px">
            ${AGENTES.map(a => `<option value="${a}" ${state.agente_remetente === a ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
        </div>
        ${selected ? `<div style="background:#0a1020;padding:12px;border-radius:6px;font-size:.85rem;color:#cbd5e1">
          <div style="color:#60a5fa;margin-bottom:4px;font-size:.75rem">Conteudo do template:</div>
          <pre style="white-space:pre-wrap;margin:0;font-family:ui-monospace,monospace;font-size:.8rem">${preview}</pre>
        </div>` : ''}
      </div>
    `;
  }

  function renderStep3() {
    const aud = state.audiencias.find(a => a.id == state.audiencia_id);
    const tpl = state.templates.find(t => t.id == state.template_id);
    const totalLeads = aud?.total_leads || 0;
    const estMin = totalLeads > 0 && state.rate_limit_per_min > 0
      ? Math.ceil(totalLeads / state.rate_limit_per_min)
      : 0;
    return `
      <div style="display:flex;flex-direction:column;gap:12px">
        <div>
          <label style="color:var(--muted);font-size:.85rem">Nome da campanha</label>
          <input id="w-nome" value="${escapeHtml(state.nome || (tpl ? tpl.nome + ' — ' + new Date().toISOString().slice(0, 10) : ''))}" style="width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:#fff;border-radius:6px;margin-top:4px" />
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          <div style="background:#1e293b;padding:12px;border-radius:6px;text-align:center">
            <div style="font-size:1.4rem;font-weight:700;color:#60a5fa">${totalLeads}</div>
            <div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;margin-top:2px">Leads na audiencia</div>
          </div>
          <div style="background:#1e293b;padding:12px;border-radius:6px;text-align:center">
            <div style="font-size:1.4rem;font-weight:700;color:#10b981">${state.rate_limit_per_min} msg/min</div>
            <div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;margin-top:2px">Taxa de envio</div>
          </div>
          <div style="background:#1e293b;padding:12px;border-radius:6px;text-align:center">
            <div style="font-size:1.4rem;font-weight:700;color:#fbbf24">~${estMin}min</div>
            <div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;margin-top:2px">Tempo estimado</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          <div>
            <label style="color:var(--muted);font-size:.8rem">Rate (msg/min)</label>
            <input type="number" id="w-rate" value="${state.rate_limit_per_min}" min="1" max="60" style="width:100%;padding:8px;background:#0f172a;border:1px solid #334155;color:#fff;border-radius:6px;margin-top:4px" />
          </div>
          <div>
            <label style="color:var(--muted);font-size:.8rem">Jitter min (s)</label>
            <input type="number" id="w-jmin" value="${state.jitter_min_sec}" min="0" max="60" style="width:100%;padding:8px;background:#0f172a;border:1px solid #334155;color:#fff;border-radius:6px;margin-top:4px" />
          </div>
          <div>
            <label style="color:var(--muted);font-size:.8rem">Jitter max (s)</label>
            <input type="number" id="w-jmax" value="${state.jitter_max_sec}" min="0" max="60" style="width:100%;padding:8px;background:#0f172a;border:1px solid #334155;color:#fff;border-radius:6px;margin-top:4px" />
          </div>
        </div>
        <div style="background:#422006;border:1px solid #f59e0b;padding:12px;border-radius:6px;font-size:.8rem;color:#fcd34d">
          ⚠️ <b>Validacoes automaticas antes do disparo:</b><br>
          • Opt-out (STOP/SAIR/PARAR) bloqueia envio<br>
          • Janela 24h aplica para templates nao-HSM<br>
          • Se taxa de falha &gt; ${(window.BROADCAST_FAILURE_THRESHOLD_PCT || 20)}%, campanha auto-pausa
        </div>
        <div id="w-preview-box"></div>
      </div>
    `;
  }

  function renderFooter() {
    const footer = document.getElementById('wizard-footer');
    if (!footer) return;
    const isLast = state.step === 3;
    const canNext = (state.step === 1 && state.audiencia_id) ||
                    (state.step === 2 && state.template_id) ||
                    (state.step === 3);
    footer.innerHTML = `
      <button class="btn btn-outline" id="w-back" ${state.step === 1 ? 'disabled' : ''}>← Voltar</button>
      <div style="display:flex;gap:8px">
        ${isLast ? '<button class="btn btn-outline" id="w-save-draft">💾 Salvar rascunho</button>' : ''}
        <button class="btn ${isLast ? '' : 'btn-primary'}" id="w-next" ${!canNext ? 'disabled' : ''} ${isLast ? 'style="background:#16a34a;color:#fff"' : ''}>
          ${isLast ? '🚀 Criar e disparar agora' : 'Proximo →'}
        </button>
      </div>
    `;
    document.getElementById('w-back')?.addEventListener('click', () => {
      if (state.step > 1) { state.step--; renderBody(); }
    });
    document.getElementById('w-next')?.addEventListener('click', handleNext);
    document.getElementById('w-save-draft')?.addEventListener('click', () => handleSubmit(false));
  }

  async function renderPreview() {
    if (!state.audiencia_id || !state.template_id) return;
    // Cria rascunho temporario e pede preview
    try {
      const tpl = state.templates.find(t => t.id == state.template_id);
      if (!tpl) return;
      // Renderiza 3 preview hard-coded (sem rascunho real)
      const r = await fetch(API + '/audiencias/' + state.audiencia_id);
      if (!r.ok) return;
      const aud = await r.json();
      const box = document.getElementById('w-preview-box');
      if (box) {
        box.innerHTML = `
          <div style="background:#0a1020;padding:12px;border-radius:6px;font-size:.8rem">
            <div style="color:#60a5fa;margin-bottom:6px;font-size:.75rem">Preview (primeira amostra):</div>
            <pre style="white-space:pre-wrap;margin:0;font-family:ui-monospace,monospace;font-size:.8rem;color:#cbd5e1">${escapeHtml(tpl.conteudo)}</pre>
          </div>
        `;
      }
    } catch {}
  }

  function renderBody() {
    const body = document.getElementById('wizard-step-body');
    if (!body) return;
    renderIndicator();
    if (state.step === 1) body.innerHTML = renderStep1();
    else if (state.step === 2) body.innerHTML = renderStep2();
    else body.innerHTML = renderStep3();
    bindStepInputs();
    renderFooter();
    if (state.step === 3) renderPreview();
  }

  function bindStepInputs() {
    document.getElementById('w-audiencia')?.addEventListener('change', (e) => {
      state.audiencia_id = e.target.value ? parseInt(e.target.value) : null;
      renderFooter();
    });
    document.getElementById('w-template')?.addEventListener('change', (e) => {
      state.template_id = e.target.value ? parseInt(e.target.value) : null;
      renderBody();
    });
    document.getElementById('w-agente')?.addEventListener('change', (e) => {
      state.agente_remetente = e.target.value;
    });
    document.getElementById('w-nome')?.addEventListener('input', (e) => {
      state.nome = e.target.value;
    });
    document.getElementById('w-rate')?.addEventListener('input', (e) => {
      state.rate_limit_per_min = parseInt(e.target.value) || 20;
    });
    document.getElementById('w-jmin')?.addEventListener('input', (e) => {
      state.jitter_min_sec = parseInt(e.target.value) || 0;
    });
    document.getElementById('w-jmax')?.addEventListener('input', (e) => {
      state.jitter_max_sec = parseInt(e.target.value) || 0;
    });
  }

  async function handleNext() {
    if (state.step < 3) {
      state.step++;
      renderBody();
      return;
    }
    await handleSubmit(true);
  }

  async function handleSubmit(startImmediately) {
    const payload = {
      nome: state.nome || `Campanha ${new Date().toISOString().slice(0, 16)}`,
      audiencia_id: state.audiencia_id,
      template_id: state.template_id,
      agente_remetente: state.agente_remetente,
      rate_limit_per_min: state.rate_limit_per_min,
      jitter_min_sec: state.jitter_min_sec,
      jitter_max_sec: state.jitter_max_sec
    };
    try {
      const r = await fetch(API + '/campanhas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const body = await r.text();
        alert('Erro ao criar: ' + body);
        return;
      }
      const data = await r.json();
      const id = data.campanha?.id;
      if (startImmediately && id) {
        const s = await fetch(`${API}/campanhas/${id}/start`, { method: 'POST' });
        if (!s.ok) {
          const body = await s.text();
          alert('Criada, mas falhou ao disparar: ' + body);
        }
      }
      document.getElementById('modal-campanha-wizard')?.classList.remove('show');
      if (window.CampanhasUI) window.CampanhasUI.refresh();
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  }

  async function open(opts = {}) {
    // reset state
    state.step = 1;
    state.editId = opts.editId || null;
    state.audiencia_id = null;
    state.template_id = null;
    state.agente_remetente = 'carlos';
    state.nome = '';
    state.rate_limit_per_min = 20;
    state.jitter_min_sec = 3;
    state.jitter_max_sec = 8;

    await Promise.all([loadAudiencias(), loadTemplates()]);
    document.getElementById('modal-campanha-wizard')?.classList.add('show');
    renderBody();
  }

  window.CampanhaWizard = { open };
})();
