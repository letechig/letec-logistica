(function () {
  function formatarMinutosHM(totalMin) {
    const min = Math.max(0, Math.round(Number(totalMin) || 0));
    const horas = Math.floor(min / 60);
    const minutos = min % 60;
    if (!horas) return `${minutos}min`;
    if (!minutos) return `${horas}h`;
    return `${horas}h ${String(minutos).padStart(2, '0')}min`;
  }

  window.formatarMinutosHM = formatarMinutosHM;
})();
