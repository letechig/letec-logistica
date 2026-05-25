(function () {
  function extrairTiposServico(servico) {
    const tiposArray = Array.isArray(servico?.tipos) ? servico.tipos : [];
    const raw = [
      ...tiposArray,
      servico.tipoServico || '',
      servico.sc || '',
    ].join(' ');

    const normalizado = raw
      .toUpperCase()
      .replace(/[+\/,&]/g, ' ')
      .replace(/\bE\b/g, ' ')
      .replace(/\bDE\b/g, ' ')
      .replace(/\bCOM\b/g, ' ')
      .replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const TIPOS_VALIDOS = ['DS','DR','DST','DSC','LCA','HIG','MON','TERMO','ISCA','PC','VIS','REU','VISTEC','MAN'];
    const encontrados = [];
    const tokens = normalizado.split(' ');
    tokens.forEach(t => {
      if (TIPOS_VALIDOS.includes(t) && !encontrados.includes(t)) {
        encontrados.push(t);
      }
    });

    if (encontrados.length === 0) {
      const ts = (servico.tipoServico || '').toUpperCase().split(/[\s/,+]/)[0];
      if (ts && ts.length > 0) encontrados.push(ts);
    }

    return encontrados.length > 0 ? encontrados : ['OUTRO'];
  }

  function tipoChipsHtml(s, opts) {
    const { fontSize = '10px', compact = false } = opts || {};
    const tipos = extrairTiposServico(s);
    return tipos.map(t => {
      const meta = TIPO_SERVICO[t] || TIPO_SERVICO.OUTRO;
      const cor = meta.cor;
      const lbl = compact ? t : (meta.label || t);
      return `<span style="font-family:var(--mono);font-size:${fontSize};color:${cor};background:${cor}18;padding:1px 6px;border-radius:4px;border:1px solid ${cor}40;white-space:nowrap">${lbl}</span>`;
    }).join(' ');
  }

  function tipoComboLabel(s) {
    const tipos = extrairTiposServico(s);
    return tipos.join(' + ') || (s.tipoServico || s.sc || '—');
  }

  function getTiposServicoCatalogo(selected = []) {
    const selectedNorm = (Array.isArray(selected) ? selected : [])
      .map(t => String(t || '').trim().toUpperCase())
      .filter(Boolean);

    const tiposDb = Array.isArray(window._tiposServico) && window._tiposServico.length
      ? window._tiposServico
          .map(t => ({
            sigla: String(t?.sigla || '').trim().toUpperCase(),
            nome: String(t?.nome || t?.sigla || '').trim()
          }))
          .filter(t => t.sigla)
      : [];

    const fallbackTipos = TIPOS_CATALOGO.map(tc => ({
      sigla: String(tc.key || '').trim().toUpperCase(),
      nome: String((tc.label.split('—')[1] || tc.label.split('-')[1])?.trim() || tc.label || tc.key || '').trim()
    }));

    const tiposBase = tiposDb.length ? tiposDb : fallbackTipos;
    const tiposMap = new Map();

    tiposBase.forEach(tipo => {
      if (!tiposMap.has(tipo.sigla)) tiposMap.set(tipo.sigla, tipo);
    });

    selectedNorm.forEach(sigla => {
      if (!tiposMap.has(sigla)) tiposMap.set(sigla, { sigla, nome: sigla });
    });

    return [...tiposMap.values()];
  }

  window.extrairTiposServico = extrairTiposServico;
  window.tipoChipsHtml = tipoChipsHtml;
  window.tipoComboLabel = tipoComboLabel;
  window.getTiposServicoCatalogo = getTiposServicoCatalogo;
})();
