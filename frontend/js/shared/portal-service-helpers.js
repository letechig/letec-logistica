(function () {
  function execStatus(s) {
    if (s?.exec_status) return s.exec_status;
    const st = String(s?.status || '').toLowerCase();
    if (st === 'executado') return 'finalizado';
    return 'agendado';
  }

  function statusLabel(status) {
    return {
      agendado: 'Agendado',
      em_deslocamento: 'Em deslocamento',
      cheguei: 'Cheguei',
      em_execucao: 'Em execucao',
      finalizado: 'Finalizado',
      problema: 'Problema'
    }[status] || 'Agendado';
  }

  function serviceTimeMinutes(s) {
    const raw = String(s?.horario || s?.hr || '').trim();
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return Number.MAX_SAFE_INTEGER;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return Number.MAX_SAFE_INTEGER;
    return hour * 60 + minute;
  }

  function serviceOperationalRank(s) {
    return {
      em_execucao: 0,
      cheguei: 1,
      em_deslocamento: 2,
      agendado: 3,
      problema: 4,
      finalizado: 5,
    }[execStatus(s)] ?? 3;
  }

  function sortServicesByTime(items) {
    return [...(items || [])].sort((a, b) => {
      const rankDiff = serviceOperationalRank(a) - serviceOperationalRank(b);
      if (rankDiff) return rankDiff;
      const timeDiff = serviceTimeMinutes(a) - serviceTimeMinutes(b);
      if (timeDiff) return timeDiff;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
  }

  function shortAddress(address) {
    const text = String(address || '').trim();
    return text.length > 72 ? `${text.slice(0, 69)}...` : text;
  }

  function isActiveServiceStatus(status) {
    return ['em_deslocamento','cheguei','em_execucao'].includes(status);
  }

  function serviceAddress(s) {
    return String(s?.endereco || '').trim();
  }

  function describeService(s) {
    if (!s) return 'Servico nao identificado';
    const os = s.os || s.OS || '';
    return [
      s.horario || s.hr || '--:--',
      s.cliente || s.cl || 'Cliente',
      os ? `OS ${os}` : '',
      shortAddress(serviceAddress(s))
    ].filter(Boolean).join(' - ');
  }

  window.execStatus = execStatus;
  window.statusLabel = statusLabel;
  window.serviceTimeMinutes = serviceTimeMinutes;
  window.serviceOperationalRank = serviceOperationalRank;
  window.sortServicesByTime = sortServicesByTime;
  window.shortAddress = shortAddress;
  window.isActiveServiceStatus = isActiveServiceStatus;
  window.serviceAddress = serviceAddress;
  window.describeService = describeService;
})();
