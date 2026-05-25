(function () {
  function normalizarNome(nome) {
    if (!nome || typeof nome !== 'string') return '';
    return nome.trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function normalizarTecnicosIds(ids) {
    return [...new Set(
      (Array.isArray(ids) ? ids : [])
        .map(id => String(id || '').trim())
        .filter(Boolean)
    )];
  }

  function extrairNomesEquipeLegada(equipeStr) {
    if (!equipeStr || !String(equipeStr).trim()) return [];
    return String(equipeStr)
      .split(/[\/,]+/)
      .map(nome => nome.trim())
      .filter(Boolean);
  }

  function normId(v) {
    if (v === undefined || v === null) return '';
    return String(v).trim();
  }

  function sameId(a, b) {
    const left = normId(a);
    const right = normId(b);
    return !!left && left === right;
  }

  window.normalizarNome = normalizarNome;
  window.normalizarTecnicosIds = normalizarTecnicosIds;
  window.extrairNomesEquipeLegada = extrairNomesEquipeLegada;
  window.normId = normId;
  window.sameId = sameId;
})();
