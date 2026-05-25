(function () {
  function sanitize(str) {
    return String(str || '')
      .replace(/[<>&"']/g, c => ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#x27;'
      }[c]));
  }

  function escapeHtmlAttr(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function jsArg(v) {
    return escapeHtmlAttr(JSON.stringify(v ?? null));
  }

  window.sanitize = sanitize;
  window.escapeHtmlAttr = escapeHtmlAttr;
  window.jsArg = jsArg;
})();
