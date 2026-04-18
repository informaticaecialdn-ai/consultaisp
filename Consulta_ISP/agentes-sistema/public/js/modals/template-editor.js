// Template editor modal (Sprint 4 / T5). Editor com preview live (debounce 500ms).
(function () {
  const MODAL_ID = 'modal-template-editor';

  function ensureModal() {
    if (document.getElementById(MODAL_ID)) return;
    const m = document.createElement('div');
    m.id = MODAL_ID;
    m.className = 'modal';
    m.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9997;align-items:center;justify-content:center';
    m.innerHTML = `
      <div style="background:var(--card,#1a2234);border:1px solid var(--border,#2d3a4f);border-radius:12px;padding:20px;width:760px;max-width:95vw;max-height:90vh;overflow:auto">
        <h2 id="te-title" style="margin:0 0 12px;font-size:1.05rem">Novo Template</h2>

        <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:10px">
          <input id="te-nome" type="text" placeholder="Nome (obrigatorio)" style="padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
          <select id="te-agente" style="padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text)">
            <option value="">(sem agente)</option>
            <option value="carlos">carlos</option><option value="lucas">lucas</option>
            <option value="rafael">rafael</option><option value="sofia">sofia</option>
            <option value="marcos">marcos</option><option value="leo">leo</option>
            <option value="diana">diana</option>
          </select>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px">
          <input id="te-categoria" type="text" placeholder="Categoria (opcional)" style="padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text)" />
          <label style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:.82rem">
            <input id="te-hsm" type="checkbox" /> Aprovado Meta (HSM)
          </label>
        </div>

        <label style="color:var(--muted);font-size:.8rem">Conteudo (use {{nome}}, {{saudacao}}, {{primeiro_nome|cliente}})</label>
        <textarea id="te-conteudo" rows="6" style="width:100%;padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:monospace;margin-bottom:8px"></textarea>
        <div style="color:var(--muted);font-size:.72rem;margin-bottom:12px">
          <span id="te-charcount">0</span> chars
          • <span id="te-vars">sem vars</span>
          • <span id="te-missing" style="color:var(--yellow)"></span>
        </div>

        <div style="background:var(--bg2);border:1px dashed var(--border);border-radius:6px;padding:12px;margin-bottom:12px">
          <div style="color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Preview (sample lead)</div>
          <div id="te-preview" style="white-space:pre-wrap;font-size:.88rem">digite o conteudo para ver o preview...</div>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost" id="te-cancel">Cancelar</button>
          <button class="btn btn-primary" id="te-save">Salvar</button>
        </div>
      </div>`;
    document.body.appendChild(m);

    m.querySelector('#te-cancel').addEventListener('click', close);
    m.querySelector('#te-save').addEventListener('click', save);

    let debounce = null;
    const trigger = () => { clearTimeout(debounce); debounce = setTimeout(updatePreview, 500); };
    m.querySelector('#te-conteudo').addEventListener('input', trigger);
    m.querySelector('#te-nome').addEventListener('input', trigger);
  }

  const SAMPLE_VARS = {
    nome: 'Maria Silva',
    primeiro_nome: 'Maria',
    telefone: '5511988887777',
    provedor: 'NetVille ISP',
    cidade: 'Campinas',
    estado: 'SP',
  };

  async function updatePreview() {
    const m = document.getElementById(MODAL_ID);
    const conteudo = m.querySelector('#te-conteudo').value;
    m.querySelector('#te-charcount').textContent = conteudo.length;
    if (!conteudo.trim()) {
      m.querySelector('#te-preview').textContent = 'digite o conteudo para ver o preview...';
      m.querySelector('#te-vars').textContent = 'sem vars';
      m.querySelector('#te-missing').textContent = '';
      return;
    }
    try {
      const r = await api('/templates/render-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conteudo, vars: SAMPLE_VARS }),
      });
      m.querySelector('#te-preview').textContent = r?.texto || '';
      const usadas = r?.variaveis_usadas || [];
      m.querySelector('#te-vars').textContent = usadas.length ? 'vars: ' + usadas.join(', ') : 'sem vars';
      const faltando = r?.variaveis_faltando || [];
      m.querySelector('#te-missing').textContent = faltando.length
        ? '⚠ sem valor no sample: ' + faltando.join(', ')
        : '';
    } catch {
      m.querySelector('#te-preview').textContent = '(erro no preview)';
    }
  }

  async function open(templateId) {
    ensureModal();
    const m = document.getElementById(MODAL_ID);
    m.dataset.templateId = templateId || '';
    m.querySelector('#te-title').textContent = templateId ? 'Editar Template' : 'Novo Template';

    m.querySelector('#te-nome').value = '';
    m.querySelector('#te-agente').value = '';
    m.querySelector('#te-categoria').value = '';
    m.querySelector('#te-hsm').checked = false;
    m.querySelector('#te-conteudo').value = '';
    m.querySelector('#te-preview').textContent = 'digite o conteudo para ver o preview...';
    m.querySelector('#te-vars').textContent = 'sem vars';
    m.querySelector('#te-missing').textContent = '';
    m.querySelector('#te-charcount').textContent = '0';

    if (templateId) {
      const r = await api(`/templates/${templateId}`);
      const tpl = r?.template;
      if (tpl) {
        m.querySelector('#te-nome').value = tpl.nome || '';
        m.querySelector('#te-agente').value = tpl.agente || '';
        m.querySelector('#te-categoria').value = tpl.categoria || '';
        m.querySelector('#te-hsm').checked = !!tpl.ja_aprovado_meta;
        m.querySelector('#te-conteudo').value = tpl.conteudo || '';
        updatePreview();
      }
    }

    m.style.display = 'flex';
  }

  function close() { const m = document.getElementById(MODAL_ID); if (m) m.style.display = 'none'; }

  async function save() {
    const m = document.getElementById(MODAL_ID);
    const payload = {
      nome: m.querySelector('#te-nome').value.trim(),
      conteudo: m.querySelector('#te-conteudo').value.trim(),
      agente: m.querySelector('#te-agente').value || null,
      categoria: m.querySelector('#te-categoria').value.trim() || null,
      ja_aprovado_meta: m.querySelector('#te-hsm').checked,
    };
    if (!payload.nome || !payload.conteudo) { alert('nome e conteudo obrigatorios'); return; }

    const templateId = m.dataset.templateId;
    const path = templateId ? `/templates/${templateId}` : '/templates';
    const method = templateId ? 'PUT' : 'POST';
    const r = await api(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (r?.template) {
      close();
      if (typeof window.loadTemplates === 'function') window.loadTemplates();
    }
  }

  window.openTemplateEditor = open;
  window.closeTemplateEditor = close;
})();
