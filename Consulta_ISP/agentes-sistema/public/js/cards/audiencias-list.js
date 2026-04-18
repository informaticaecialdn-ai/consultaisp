// Audiencias list card (Sprint 4 / T4).
// Uso: renderAudienciasList(el, data)  OR  loadAudienciasList(el)
(function () {
  function badge(tipo) {
    const color = tipo === 'dinamica' ? 'var(--purple)' : 'var(--blue)';
    const bg = tipo === 'dinamica' ? 'rgba(167,139,250,.15)' : 'rgba(96,165,250,.15)';
    return `<span class="badge" style="background:${bg};color:${color}">${tipo}</span>`;
  }

  window.renderAudienciasList = function renderAudienciasList(containerEl, data) {
    if (!containerEl) return;
    const items = (data?.audiencias || []).filter(a => a.ativa !== 0);
    if (items.length === 0) {
      containerEl.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px">Nenhuma audiencia cadastrada</div>';
      return;
    }
    const rows = items.map(a => {
      const atualizadoEm = a.total_leads_atualizado_em || a.atualizado_em || '';
      return `
        <tr data-id="${a.id}">
          <td><strong>${a.nome}</strong>${a.descricao ? '<br><span style="color:var(--muted);font-size:.75rem">' + a.descricao + '</span>' : ''}</td>
          <td>${badge(a.tipo)}</td>
          <td><strong style="color:var(--green)">${a.total_leads || 0}</strong></td>
          <td style="color:var(--muted);font-size:.75rem">${atualizadoEm.slice(0, 16).replace('T', ' ')}</td>
          <td>
            <button class="btn btn-sm btn-outline" onclick="window.AudienciasUI.preview(${a.id})">Preview</button>
            <button class="btn btn-sm btn-outline" onclick="window.AudienciasUI.refresh(${a.id})">Atualizar</button>
            <button class="btn btn-sm btn-danger" onclick="window.AudienciasUI.remove(${a.id})">Excluir</button>
          </td>
        </tr>`;
    }).join('');

    containerEl.innerHTML = `
      <table class="table">
        <thead>
          <tr><th>Nome</th><th>Tipo</th><th>Leads</th><th>Atualizado</th><th>Acoes</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  };

  window.loadAudienciasList = async function loadAudienciasList(containerEl) {
    if (!containerEl || typeof api !== 'function') return;
    const data = await api('/audiencias');
    window.renderAudienciasList(containerEl, data);
  };

  // UI handlers (expostos globalmente para usar no HTML inline)
  window.AudienciasUI = {
    async preview(id) {
      const data = await api(`/audiencias/${id}/preview?n=5`);
      const samples = (data?.preview || []).map(l =>
        `- ${l.nome || '(sem nome)'} (${l.telefone || '-'})`
      ).join('\n');
      alert(`Preview (5 amostras):\n\n${samples || 'sem leads'}`);
    },
    async refresh(id) {
      await api(`/audiencias/${id}/refresh-count`, { method: 'POST' });
      if (typeof window.loadAudiencias === 'function') window.loadAudiencias();
    },
    async remove(id) {
      if (!confirm('Tem certeza que deseja excluir (soft delete)?')) return;
      await api(`/audiencias/${id}`, { method: 'DELETE' });
      if (typeof window.loadAudiencias === 'function') window.loadAudiencias();
    },
    openCreate() {
      if (typeof window.openNewAudienciaModal === 'function') window.openNewAudienciaModal();
    },
  };
})();
