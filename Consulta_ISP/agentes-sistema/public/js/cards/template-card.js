// Template card (Sprint 4 / T5). Grid de cards.
(function () {
  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function parseVars(json) {
    try { return JSON.parse(json || '[]'); } catch { return []; }
  }

  window.renderTemplateCard = function renderTemplateCard(tpl) {
    const vars = parseVars(tpl.variaveis);
    const ativo = tpl.ativo !== 0;
    return `
      <div class="panel" data-template-id="${tpl.id}" style="padding:0">
        <div class="panel-header" style="align-items:flex-start">
          <div>
            <h2 style="font-size:.95rem;margin:0">${escapeHtml(tpl.nome)}</h2>
            <div style="color:var(--muted);font-size:.72rem;margin-top:4px">
              ${tpl.agente ? '<span class="badge b-' + tpl.agente + '" style="margin-right:4px">' + tpl.agente + '</span>' : ''}
              ${tpl.categoria ? '<span style="color:var(--muted);margin-right:4px">' + escapeHtml(tpl.categoria) + '</span>' : ''}
              v${tpl.versao || 1}
              ${ativo ? '' : ' • <span style="color:var(--red)">INATIVO</span>'}
              ${tpl.ja_aprovado_meta ? ' • <span style="color:var(--green)">HSM</span>' : ''}
            </div>
          </div>
        </div>
        <div class="panel-body" style="padding:12px 20px">
          <div style="font-size:.82rem;white-space:pre-wrap;color:var(--text);max-height:120px;overflow:auto;background:var(--bg2);padding:10px;border-radius:6px">${escapeHtml(tpl.conteudo)}</div>
          ${vars.length ? '<div style="margin-top:8px;font-size:.72rem;color:var(--muted)">Vars: ' + vars.map(v => '<code>' + escapeHtml(v) + '</code>').join(' ') + '</div>' : ''}
          <div style="display:flex;gap:6px;margin-top:10px">
            <button class="btn btn-sm btn-outline" onclick="window.TemplatesUI.edit(${tpl.id})">Editar</button>
            <button class="btn btn-sm btn-outline" onclick="window.TemplatesUI.clone(${tpl.id})">Clonar</button>
            <button class="btn btn-sm btn-danger" onclick="window.TemplatesUI.remove(${tpl.id})">Excluir</button>
          </div>
        </div>
      </div>`;
  };

  window.loadTemplatesGrid = async function loadTemplatesGrid(containerEl) {
    if (!containerEl || typeof api !== 'function') return;
    const data = await api('/templates');
    const items = (data?.templates || []).filter(t => t.ativo !== 0);
    if (items.length === 0) {
      containerEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px">Nenhum template cadastrado. Clique em "+ Novo Template" para comecar.</div>';
      return;
    }
    containerEl.innerHTML = items.map(window.renderTemplateCard).join('');
  };

  window.TemplatesUI = {
    openCreate() { window.openTemplateEditor && window.openTemplateEditor(null); },
    edit(id) { window.openTemplateEditor && window.openTemplateEditor(id); },
    async clone(id) {
      const r = await api(`/templates/${id}/clone`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (r?.template) { if (typeof window.loadTemplates === 'function') window.loadTemplates(); }
    },
    async remove(id) {
      if (!confirm('Desativar este template (soft delete)?')) return;
      await api(`/templates/${id}`, { method: 'DELETE' });
      if (typeof window.loadTemplates === 'function') window.loadTemplates();
    },
  };
})();
