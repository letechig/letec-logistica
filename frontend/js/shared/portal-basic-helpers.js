(function () {
  function normalizeApiBaseUrl(value) {
    const url = String(value || '').trim();
    if (!url || url.startsWith('javascript:') || url.startsWith('data:')) return '';
    return url.replace(/\/$/, '');
  }

  function isKnownInvalidApiBase(url) {
    try {
      return new URL(url).hostname === 'letec-log-api.onrender.com';
    } catch(e) {
      return false;
    }
  }

  function normalizeText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function slugText(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function splitTeamNames(value) {
    return String(value || '')
      .split(/\s*(?:\/|,|\be\b|\+)\s*/i)
      .map(item => item.trim())
      .filter(Boolean);
  }

  function parseArrayLike(value) {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined || value === '') return [];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return [];
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed;
        } catch(e) {}
      }
      return trimmed.split(/\s*(?:,|;|\/|\|)\s*/).filter(Boolean);
    }
    return [value];
  }

  function titleFromSlug(value) {
    const raw = String(value || '').replace(/[-_]+/g, ' ').trim();
    if (!raw) return 'Tecnico';
    return raw.split(/\s+/).map(part => part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : '').join(' ');
  }

  function formatDateLabel(dateStr) {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function nowTime() {
    return new Date().toTimeString().slice(0,5);
  }

  function minutesBetween(startIso, endIso) {
    if (!startIso || !endIso) return null;
    const diff = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
    return Number.isFinite(diff) && diff >= 0 ? diff : null;
  }

  window.normalizeApiBaseUrl = normalizeApiBaseUrl;
  window.isKnownInvalidApiBase = isKnownInvalidApiBase;
  window.normalizeText = normalizeText;
  window.slugText = slugText;
  window.splitTeamNames = splitTeamNames;
  window.parseArrayLike = parseArrayLike;
  window.titleFromSlug = titleFromSlug;
  window.formatDateLabel = formatDateLabel;
  window.nowIso = nowIso;
  window.nowTime = nowTime;
  window.minutesBetween = minutesBetween;
})();
