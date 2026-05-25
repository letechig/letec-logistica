(function () {
  function parseHorarioMinuto(horario) {
    if (!horario) return null;
    const match = String(horario).trim().match(/^(\d{1,2})[:hH]?(\d{2})$/);
    if (!match) return null;
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (hh > 23 || mm > 59) return null;
    return (hh * 60) + mm;
  }

  function getHorarioServicoMin(servico) {
    return parseHorarioMinuto(servico?.horario || servico?.hr || '');
  }

  function formatarHoraDoDia(totalMin) {
    if (totalMin === null || totalMin === undefined || Number.isNaN(totalMin)) return '--:--';
    const min = Math.max(0, Math.round(totalMin));
    const minutoDoDia = min % 1440;
    const hh = String(Math.floor(minutoDoDia / 60)).padStart(2, '0');
    const mm = String(minutoDoDia % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function periodoAllLabel() {
    const info = getAnoInfo();
    return info.mode === 'single' ? `Ano inteiro ${info.year}` : `Período ${info.label}`;
  }

  function mesLabel(code) {
    if (code === 'all') return periodoAllLabel();
    const nome = MESES_NOME[code] || code;
    const info = getAnoInfo();
    return info.mode === 'single' ? `${nome} ${info.year}` : nome;
  }

  function svcMesMatches(s, codigo) {
    if (!codigo) return true;
    if ((s.ms || '') === codigo) return true;
    const mmNum = MS_MAP_NUM[codigo];
    const dt = s.dt || s.data || '';
    return mmNum && dt.slice(5, 7) === mmNum;
  }

  window.parseHorarioMinuto = parseHorarioMinuto;
  window.getHorarioServicoMin = getHorarioServicoMin;
  window.formatarHoraDoDia = formatarHoraDoDia;
  window.periodoAllLabel = periodoAllLabel;
  window.mesLabel = mesLabel;
  window.svcMesMatches = svcMesMatches;
})();
