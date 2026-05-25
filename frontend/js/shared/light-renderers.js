(function () {
  function renderTecnicos(selectedIds = [], containerId = 'tecnicos-container') {
    const container = document.getElementById(containerId);
    const lista = window._tecnicos || [];
    const selectedSet = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(id => String(id)));

    if (!container) return;

    container.innerHTML = lista.map(t => `
      <label style="display:block; margin-bottom:4px;">
        <input type="checkbox" value="${escapeHtmlAttr(t.id)}"
          ${selectedSet.has(String(t.id)) ? 'checked' : ''}>
        ${sanitize(t.nome)}
      </label>
    `).join('');
  }

  function renderTiposCheckbox(selected = [], containerId = 'tipos-container') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const selectedNorm = (Array.isArray(selected) ? selected : [])
      .map(t => String(t || '').trim().toUpperCase())
      .filter(Boolean);
    const tipos = getTiposServicoCatalogo(selectedNorm);

    container.innerHTML = tipos.map(t => {
      const meta = TIPO_SERVICO[t.sigla] || TIPO_SERVICO.OUTRO;
      if (containerId === 'ed-tipos-container' || containerId === 'ns-tipos-container') {
        return `
          <label class="svc-edit-type-option">
            <input type="checkbox" value="${sanitize(t.sigla)}"
              ${selectedNorm.includes(t.sigla) ? 'checked' : ''}>
            <span class="svc-edit-type-code" style="color:${meta?.cor || '#2563eb'}">${sanitize(t.sigla)}</span>
            <span class="svc-edit-type-name">${sanitize(t.nome || t.sigla)}</span>
          </label>
        `;
      }
      return `
        <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12px;padding:2px 0">
          <input type="checkbox" value="${sanitize(t.sigla)}"
            ${selectedNorm.includes(t.sigla) ? 'checked' : ''}
            style="width:14px;height:14px;accent-color:${meta?.cor || '#2563eb'}">
          <span style="color:${meta?.cor || '#64748b'};font-family:var(--mono);font-size:10px;min-width:50px">${sanitize(t.sigla)}</span>
          <span style="color:var(--text2)">${sanitize(t.nome || t.sigla)}</span>
        </label>
      `;
    }).join('');
  }

  function updateTiposPreview(previewId, containerId = 'tipos-container') {
    const prev = document.getElementById(previewId);
    if (!prev) return;
    const sel = Array.from(
      document.querySelectorAll(`#${containerId} input:checked`)
    ).map(el => el.value);
    prev.textContent = sel.length ? sel.join(' + ') : 'Nenhum tipo selecionado';
  }

  function bindTiposPreview(previewId, containerId = 'tipos-container') {
    document.querySelectorAll(`#${containerId} input[type="checkbox"]`).forEach(chk => {
      chk.addEventListener('change', () => updateTiposPreview(previewId, containerId));
    });
    updateTiposPreview(previewId, containerId);
  }

  window.renderTecnicos = renderTecnicos;
  window.renderTiposCheckbox = renderTiposCheckbox;
  window.updateTiposPreview = updateTiposPreview;
  window.bindTiposPreview = bindTiposPreview;
})();
