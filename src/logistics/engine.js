const DEFAULT_BASE_ADDRESS = '88VH+MR Vila Sao Paulo, São Paulo - SP';

const TEMPO_SERVICO = {
  DS_RES: 60,
  DS_COND: 120,
  DR_RES: 60,
  DR_COND: 120,
  DST: 90,
  DSC_RES: 90,
  DSC_COND: 150,
  LCA: 180,
  HIG: 240,
  MON: 45,
  TERMO: 60,
  VIS: 30,
  REU: 60,
  VISTEC: 60,
  MAN: 45,
  OUTRO: 90,
};

const CONFIG = {
  baseAddress: DEFAULT_BASE_ADDRESS,
  inicioExpedienteMin: 8 * 60,
  jornadaMin: 588 - 60,
  margemMin: 15,
  descansoMin: 600,
  incluirRetornoBase: true,
  deslocamentoMin: 15,
  deslocamentoMax: 45,
  deslocamentoExtremoMin: 90,
  deslocamentoExtremoKm: 40,
};

const BAIRROS_REFERENCIA = [
  'Centro', 'Liberdade', 'Bela Vista', 'Consolação', 'Higienópolis', 'Pacaembu', 'Perdizes',
  'Vila Madalena', 'Pinheiros', 'Vila Mariana', 'Moema', 'Itaim Bibi', 'Jardins', 'Brooklin',
  'Vila Olímpia', 'Vila Olimpia', 'Santana', 'Tatuapé', 'Tatuape', 'Vila Prudente', 'Osasco', 'Barueri',
];

function normalizarNome(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function unique(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function getServiceDateValue(service) {
  return service?.dt || service?.date || service?.data || '';
}

function parseHorarioMinuto(horario) {
  if (!horario) return null;
  const match = String(horario).trim().match(/^(\d{1,2})[:hH]?(\d{2})$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

function getHorarioServicoMin(service) {
  return parseHorarioMinuto(service?.horario || service?.hr || '');
}

function formatarHora(totalMin) {
  if (totalMin === null || totalMin === undefined || Number.isNaN(totalMin)) return null;
  const min = Math.max(0, Math.round(totalMin)) % 1440;
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function formatarMinutos(totalMin) {
  const min = Math.max(0, Math.round(Number(totalMin) || 0));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}min`;
  if (!m) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}min`;
}

function minutesBetweenTimestamps(start, end) {
  if (!start || !end) return null;
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const diff = Math.round((b.getTime() - a.getTime()) / 60000);
  return diff > 0 ? diff : null;
}

function getTimestampMinNoDia(value, dt) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const min = date.getHours() * 60 + date.getMinutes();
  if (!dt) return min;
  const dateStr = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  if (dateStr > dt) return min + 1440;
  if (dateStr < dt) return min - 1440;
  return min;
}

function extrairBairroProxy(addr) {
  const texto = String(addr || '').trim();
  if (!texto) return 'Sem endereço';
  const lower = texto.toLowerCase();
  const conhecido = BAIRROS_REFERENCIA.find(n => lower.includes(n.toLowerCase()));
  if (conhecido) return conhecido;
  const partes = texto.split(',').map(p => p.trim()).filter(Boolean);
  const candidato = [...partes].reverse().find(p => (
    p.length >= 4 &&
    !/\d/.test(p) &&
    !/s(ã|a)o paulo|^sp$|brasil|cep|rua|avenida|av\.?|travessa|alameda|rodovia|estrada/i.test(p)
  ));
  return candidato || partes[1] || partes[0] || texto;
}

function normalizarEnderecoOperacional(addr) {
  return normalizarNome(addr)
    .replace(/\b(estrada|est|est\.|avenida|av|av\.|rua|r\.|alameda|travessa|rodovia|rod|rod\.)\b/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairNumeroEndereco(addr) {
  const match = String(addr || '').match(/\b(\d{1,6})\b/);
  return match ? match[1] : '';
}

function extrairTokensEnderecoOperacional(addr) {
  const stopwords = new Set([
    'de', 'da', 'do', 'das', 'dos', 'sao', 'paulo', 'sp', 'cep',
    'rua', 'r', 'avenida', 'av', 'alameda', 'travessa', 'estrada', 'rodovia',
    'vila', 'jd', 'jardim', 'parque', 'santa', 'santo', 'jose',
  ]);
  return normalizarEnderecoOperacional(addr)
    .split(' ')
    .map(t => t.trim())
    .filter(t => t.length >= 4 && !stopwords.has(t));
}

function isSameOperationalAddress(addr1, addr2) {
  const a1 = String(addr1 || '').trim();
  const a2 = String(addr2 || '').trim();
  if (!a1 || !a2) return false;
  const normalizedA = normalizarEnderecoOperacional(a1);
  const normalizedB = normalizarEnderecoOperacional(a2);
  if (normalizedA && normalizedA === normalizedB) return true;
  const numeroA = extrairNumeroEndereco(a1);
  const numeroB = extrairNumeroEndereco(a2);
  const bairroA = normalizarNome(extrairBairroProxy(a1));
  const bairroB = normalizarNome(extrairBairroProxy(a2));
  const bairroTokens = new Set([
    ...extrairTokensEnderecoOperacional(extrairBairroProxy(a1)),
    ...extrairTokensEnderecoOperacional(extrairBairroProxy(a2)),
  ]);
  const tokensA = extrairTokensEnderecoOperacional(a1).filter(token => !bairroTokens.has(token));
  const tokensB = extrairTokensEnderecoOperacional(a2).filter(token => !bairroTokens.has(token));
  const tokensIguais = tokensA.filter(a => tokensB.includes(a));
  if (numeroA && numeroB && numeroA === numeroB && bairroA && bairroA === bairroB && tokensIguais.length >= 1) return true;
  if (numeroA && numeroB && numeroA === numeroB && tokensIguais.length >= 2) return true;
  return false;
}

function isSameOperationalStop(a, b) {
  if (!a || !b) return false;
  if (isSameOperationalAddress(a.endereco || '', b.endereco || '')) return true;
  const osA = normalizarNome(a.OS || a.os || '');
  const osB = normalizarNome(b.OS || b.os || '');
  if (osA && osB && osA === osB && isSameOperationalAddress(a.endereco || '', b.endereco || '')) return true;
  const clienteA = normalizarNome(a.cliente || a.cl || '');
  const clienteB = normalizarNome(b.cliente || b.cl || '');
  return !!clienteA && clienteA === clienteB && isSameOperationalAddress(a.endereco || '', b.endereco || '');
}

function estimateDistance(addr1, addr2) {
  const a1 = String(addr1 || '').trim();
  const a2 = String(addr2 || '').trim();
  if (!a1 || !a2) return 25;
  if (isSameOperationalAddress(a1, a2)) return 0;
  const n1 = extrairBairroProxy(a1);
  const n2 = extrairBairroProxy(a2);
  if (n1 === n2 && n1 !== 'Sem endereço') return 5;
  if (BAIRROS_REFERENCIA.includes(n1) && BAIRROS_REFERENCIA.includes(n2)) return 15;
  return 28;
}

function estimateTravelMinutes(origem, destino) {
  if (isSameOperationalAddress(origem, destino)) return 0;
  const km = estimateDistance(origem, destino);
  if (km <= 0) return CONFIG.deslocamentoMin;
  if (km <= 5) return 20;
  if (km <= 10) return 25;
  if (km <= 18) return 32;
  if (km <= 25) return 38;
  return CONFIG.deslocamentoMax;
}

function createDistanceCache(distanceClient) {
  if (distanceClient?.__logisticsDistanceCache) return distanceClient;
  const cache = new Map();

  function keyEndereco(addr) {
    return normalizarEnderecoOperacional(addr || '');
  }

  return {
    __logisticsDistanceCache: true,
    async getDistance(origem, destino) {
      const key = `${keyEndereco(origem)}||${keyEndereco(destino)}`;
      if (!cache.has(key)) {
        const promise = Promise.resolve(distanceClient.getDistance(origem, destino))
          .catch(error => {
            cache.delete(key);
            throw error;
          });
        cache.set(key, promise);
      }
      return await cache.get(key);
    },
  };
}

function normalizeServiceTypes(serviceTypes = []) {
  return (serviceTypes || []).map(t => ({
    ...t,
    sigla: String(t.sigla || '').toUpperCase(),
    nomeNorm: normalizarNome(t.nome || ''),
    duracao_minutos: Number(t.duracao_minutos),
  }));
}

function extrairTiposServico(service) {
  const rawTipos = Array.isArray(service?.tipos) ? service.tipos : [];
  const raw = [...rawTipos, service?.tipoServico || service?.tiposervico || '', service?.sc || ''].join(' ');
  const normalizado = raw.toUpperCase()
    .replace(/[+\/,&]/g, ' ')
    .replace(/\b(E|DE|COM)\b/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const validos = ['DS', 'DR', 'DST', 'DSC', 'LCA', 'HIG', 'MON', 'TERMO', 'ISCA', 'PC', 'VIS', 'REU', 'VISTEC', 'MAN'];
  const encontrados = [];
  normalizado.split(' ').forEach(t => {
    if (validos.includes(t) && !encontrados.includes(t)) encontrados.push(t);
  });
  if (!encontrados.length) {
    const first = normalizado.split(' ')[0];
    if (first) encontrados.push(first);
  }
  return encontrados.length ? encontrados : ['OUTRO'];
}

function ehCondominio(service) {
  const haystack = [
    service?.cliente || service?.cl || '',
    service?.endereco || '',
    service?.observacoes || service?.obs || '',
    service?.tipoServico || service?.tiposervico || service?.sc || '',
  ].join(' ').toLowerCase();
  return /\bcond\b|condom[ií]n|edif[íi]c|cond\./.test(haystack);
}

function tempoParaTipo(tipo, isCond) {
  switch (tipo) {
    case 'DS': return isCond ? TEMPO_SERVICO.DS_COND : TEMPO_SERVICO.DS_RES;
    case 'DR': return isCond ? TEMPO_SERVICO.DR_COND : TEMPO_SERVICO.DR_RES;
    case 'DSC': return isCond ? TEMPO_SERVICO.DSC_COND : TEMPO_SERVICO.DSC_RES;
    case 'DST': return TEMPO_SERVICO.DST;
    case 'LCA': return TEMPO_SERVICO.LCA;
    case 'HIG': return TEMPO_SERVICO.HIG;
    case 'MON':
    case 'ISCA': return TEMPO_SERVICO.MON;
    case 'TERMO': return TEMPO_SERVICO.TERMO;
    case 'VIS': return TEMPO_SERVICO.VIS;
    case 'REU': return TEMPO_SERVICO.REU;
    case 'VISTEC': return TEMPO_SERVICO.VISTEC;
    case 'MAN': return TEMPO_SERVICO.MAN;
    default: return TEMPO_SERVICO.OUTRO;
  }
}

function getCatalogDurationForTipo(tipo, serviceTypes) {
  const key = String(tipo || '').toUpperCase();
  const normKey = normalizarNome(key);
  const item = normalizeServiceTypes(serviceTypes).find(t => t.sigla === key || t.nomeNorm === normKey);
  return Number.isFinite(item?.duracao_minutos) && item.duracao_minutos > 0 ? Math.round(item.duracao_minutos) : null;
}

function calcularTempoServicoBase(service) {
  const tipos = extrairTiposServico(service);
  const isCond = ehCondominio(service);
  return Math.max(tipos.reduce((acc, tipo) => acc + tempoParaTipo(tipo, isCond), 0), 30);
}

function resolverDuracao(service, serviceTypes = []) {
  const real = minutesBetweenTimestamps(service?.inicio_hora, service?.fim_hora);
  if (real !== null) return { minutos: real, origem: 'inicio_fim', mensagens: [] };
  const saved = Number(service?.tempo_execucao);
  if (Number.isFinite(saved) && saved > 0) return { minutos: Math.round(saved), origem: 'tempo_execucao', mensagens: [] };
  const tipos = extrairTiposServico(service);
  const catalogo = tipos.map(tipo => getCatalogDurationForTipo(tipo, serviceTypes)).filter(n => Number.isFinite(n) && n > 0);
  if (catalogo.length) return { minutos: catalogo.reduce((acc, n) => acc + n, 0), origem: 'service_types', mensagens: [] };
  const tabela = calcularTempoServicoBase(service);
  if (Number.isFinite(tabela) && tabela > 0 && !tipos.includes('OUTRO')) return { minutos: Math.round(tabela), origem: 'tabela_padrao', mensagens: [] };
  return {
    minutos: ehCondominio(service) ? 120 : 90,
    origem: 'fallback',
    mensagens: ['Duração estimada por fallback. Revise o tipo de serviço.'],
  };
}

function normalizarTecnicosIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))];
}

function extrairNomesEquipeLegada(equipe) {
  return String(equipe || '')
    .split(/\s*(?:\/|\+|,|;|\be\b|\&)\s*/i)
    .map(nome => nome.trim())
    .filter(Boolean);
}

function getTechnicianMaps(technicians = []) {
  const byId = new Map();
  const byName = new Map();
  (technicians || []).forEach(t => {
    if (!t) return;
    const id = String(t.id || '').trim();
    const nome = String(t.nome || t.name || '').trim();
    if (id) byId.set(id, { id, nome: nome || `Técnico ${id}` });
    if (nome && id) byName.set(normalizarNome(nome), id);
  });
  return { byId, byName };
}

function getServiceTechnicians(service, technicians = []) {
  const { byId, byName } = getTechnicianMaps(technicians);
  const ids = normalizarTecnicosIds(service?.tecnicos_ids || service?.tecnicosIds || service?.technicians_ids);
  const fromIds = ids.map(id => byId.get(id) || { id, nome: `Técnico ${id}` });
  if (fromIds.length) return fromIds;
  return extrairNomesEquipeLegada(service?.equipe || service?.eq || '')
    .map(nome => {
      const id = byName.get(normalizarNome(nome)) || `legacy:${normalizarNome(nome)}`;
      return { id, nome };
    });
}

function serviceStatusInfo(service) {
  const status = normalizarNome(service?.status || service?.st || 'agendado').replace(/\s+/g, '_');
  const execStatus = normalizarNome(service?.exec_status || '').replace(/\s+/g, '_');
  const cancelado = status === 'cancelado';
  const reagendado = status === 'reagendado';
  const finalizado = status === 'executado' || execStatus === 'finalizado';
  const problema = status === 'problema' || execStatus === 'problema';
  const naoExecutado = ['nao_executado', 'não_executado', 'nao-executado', 'não-executado'].includes(status);
  const emExecucao = ['em_execucao', 'em_atendimento'].includes(execStatus) || ['em_execucao', 'em_atendimento'].includes(status);
  const cheguei = execStatus === 'cheguei';
  return {
    status,
    execStatus,
    cancelado,
    reagendado,
    finalizado,
    problema,
    naoExecutado,
    emExecucao,
    cheguei,
    ativo: !cancelado && !reagendado && !finalizado,
  };
}

function montarJanela(service, serviceTypes = []) {
  const dt = getServiceDateValue(service);
  const duracao = resolverDuracao(service, serviceTypes);
  const horarioMin = getHorarioServicoMin(service);
  const inicioRealMin = getTimestampMinNoDia(service?.inicio_hora || service?.chegada_hora, dt);
  const fimRealMin = getTimestampMinNoDia(service?.fim_hora, dt);
  const inicioBaseMin = inicioRealMin !== null ? inicioRealMin : horarioMin;
  const fimBaseMin = fimRealMin !== null ? fimRealMin : (inicioBaseMin !== null ? inicioBaseMin + duracao.minutos : null);
  return {
    inicioBaseMin,
    fimBaseMin,
    inicioPrevisto: horarioMin !== null ? formatarHora(horarioMin) : null,
    fimPrevisto: horarioMin !== null ? formatarHora(horarioMin + duracao.minutos) : null,
    duracaoMin: duracao.minutos,
    origemDuracao: duracao.origem,
    mensagens: duracao.mensagens,
  };
}

function intervaloEntre(a, b) {
  if (!a || !b || a.inicioBaseMin === null || a.fimBaseMin === null || b.inicioBaseMin === null || b.fimBaseMin === null) {
    return { intervaloDisponivelMin: null, sobreposicao: false };
  }
  if (a.inicioBaseMin < b.fimBaseMin && b.inicioBaseMin < a.fimBaseMin) {
    const overlap = Math.min(a.fimBaseMin - b.inicioBaseMin, b.fimBaseMin - a.inicioBaseMin);
    return { intervaloDisponivelMin: -Math.abs(overlap), sobreposicao: true };
  }
  if (a.fimBaseMin <= b.inicioBaseMin) return { intervaloDisponivelMin: b.inicioBaseMin - a.fimBaseMin, sobreposicao: false };
  return { intervaloDisponivelMin: a.inicioBaseMin - b.fimBaseMin, sobreposicao: false };
}

function shiftDate(dateStr, deltaDays) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().split('T')[0];
}

function calcularInicioPermitidoAposDescanso(prevFimMin, config) {
  const fimAnteriorAbs = Number(prevFimMin);
  if (!Number.isFinite(fimAnteriorAbs)) return null;
  const inicioPermitidoAbs = fimAnteriorAbs + config.descansoMin;
  return Math.max(inicioPermitidoAbs, 1440 + config.inicioExpedienteMin);
}

function avaliarDescansoMinimo(service, universe, technicians, serviceTypes, config) {
  const dt = getServiceDateValue(service);
  const janela = montarJanela(service, serviceTypes);
  if (!dt || janela.inicioBaseMin === null) return [];
  const prevDate = shiftDate(dt, -1);
  const currentTechIds = new Set(getServiceTechnicians(service, technicians).map(t => String(t.id)));
  if (!currentTechIds.size) return [];
  const reasons = [];
  currentTechIds.forEach(techId => {
    const prev = (universe || [])
      .filter(s => getServiceDateValue(s) === prevDate)
      .filter(s => getServiceTechnicians(s, technicians).some(t => String(t.id) === techId))
      .map(s => {
        const j = montarJanela(s, serviceTypes);
        return j.fimBaseMin !== null ? { service: s, fim: j.fimBaseMin } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.fim - a.fim)[0];
    if (!prev) return;
    const inicioAtualAbs = 1440 + janela.inicioBaseMin;
    const inicioPermitidoAbs = calcularInicioPermitidoAposDescanso(prev.fim, config);
    if (inicioPermitidoAbs !== null && inicioAtualAbs < inicioPermitidoAbs) reasons.push('Descanso mínimo comprometido');
  });
  return unique(reasons);
}

function compareSeverity(a, b) {
  const weight = { ok: 0, pre_agendamento: 1, alerta: 2, critico: 3 };
  return (weight[b] || 0) - (weight[a] || 0);
}

async function validateService(service, options = {}) {
  const config = { ...CONFIG, ...(options.config || {}) };
  const universe = Array.isArray(options.services) ? options.services : [];
  const serviceTypes = options.serviceTypes || [];
  const technicians = options.technicians || [];
  const distanceClient = createDistanceCache(options.distanceClient || { getDistance: async (origem, destino) => ({
    km: Number(estimateDistance(origem, destino).toFixed(1)),
    minutos: estimateTravelMinutes(origem, destino),
    origem: 'estimado',
  }) });
  const ignoreId = options.ignoreId ?? null;
  const dt = getServiceDateValue(service);
  const janela = montarJanela(service, serviceTypes);
  const tecnicos = getServiceTechnicians(service, technicians);
  const mensagens = [...janela.mensagens];
  const sugestoes = [];
  let result = {
    status: 'ok',
    podeSalvar: true,
    exigeJustificativa: false,
    motivo: 'Serviço livre para encaixe operacional.',
    detalhes: {
      tecnico: tecnicos.map(t => t.nome).join(' / ') || 'Sem técnico definido',
      servicoAtualId: service?.id ?? null,
      servicoRelacionadoId: null,
      inicioPrevisto: janela.inicioPrevisto,
      fimPrevisto: janela.fimPrevisto,
      duracaoMin: janela.duracaoMin,
      origemDuracao: janela.origemDuracao,
      intervaloDisponivelMin: null,
      deslocamentoEstimadoMin: null,
      margemMin: config.margemMin,
      tempoNecessarioMin: null,
      diferencaMin: null,
      regraAplicada: 'livre',
    },
    mensagens,
    sugestoes,
  };

  function apply(candidate) {
    if (compareSeverity(result.status, candidate.status) > 0) result = { ...result, ...candidate };
    else {
      result.mensagens.push(...(candidate.mensagens || []));
      result.sugestoes.push(...(candidate.sugestoes || []));
    }
  }

  if (!tecnicos.length) {
    result.status = 'pre_agendamento';
    result.motivo = 'Serviço sem técnico definido. Validação logística será concluída depois.';
    result.detalhes.regraAplicada = 'sem_tecnico';
    result.sugestoes.push('Definir técnico ou equipe antes de confirmar o roteiro');
    result.mensagens = unique(result.mensagens);
    result.sugestoes = unique(result.sugestoes);
    return result;
  }

  if (!dt || janela.inicioBaseMin === null) {
    result.status = 'alerta';
    result.motivo = !dt ? 'Data ausente para validar logística.' : 'Horário previsto ausente para validar logística.';
    result.detalhes.regraAplicada = !dt ? 'data_ausente' : 'horario_ausente';
    result.mensagens.push('Dados insuficientes para validação completa.');
  }

  const techIds = new Set(tecnicos.map(t => String(t.id)));
  const candidatos = (universe || [])
    .filter(s => getServiceDateValue(s) === dt)
    .filter(s => ignoreId === null || String(s.id) !== String(ignoreId))
    .filter(s => String(s.id) !== String(service?.id))
    .filter(s => !serviceStatusInfo(s).cancelado && !serviceStatusInfo(s).reagendado)
    .filter(s => getServiceTechnicians(s, technicians).some(t => techIds.has(String(t.id))));

  for (const other of candidatos) {
    const statusOther = serviceStatusInfo(other);
    const janelaOther = montarJanela(other, serviceTypes);
    const cmp = intervaloEntre(janela, janelaOther);
    const otherName = other?.cliente || other?.cl || `Serviço ${other?.id || ''}`;
    if (cmp.sobreposicao && statusOther.ativo) {
      apply({
        status: 'critico',
        podeSalvar: true,
        exigeJustificativa: true,
        motivo: 'Conflito crítico: técnico já possui serviço no mesmo horário.',
        detalhes: {
          ...result.detalhes,
          servicoRelacionadoId: other?.id ?? null,
          intervaloDisponivelMin: cmp.intervaloDisponivelMin,
          diferencaMin: cmp.intervaloDisponivelMin,
          regraAplicada: 'sobreposicao',
        },
        mensagens: [`Sobreposição com ${otherName}.`],
        sugestoes: ['Revisar horário do atendimento', 'Validar outro técnico para o mesmo horário'],
      });
      continue;
    }

    if (cmp.intervaloDisponivelMin !== null && cmp.intervaloDisponivelMin >= 0) {
      const serviceBefore = janela.fimBaseMin !== null && janelaOther.inicioBaseMin !== null && janela.fimBaseMin <= janelaOther.inicioBaseMin;
      const origem = serviceBefore ? (service.endereco || '') : (other.endereco || '');
      const destino = serviceBefore ? (other.endereco || '') : (service.endereco || '');
      const desloc = await distanceClient.getDistance(origem, destino);
      const tempoNecessario = Number(desloc.minutos ?? 0) + config.margemMin;
      if (desloc.origem !== 'google' && desloc.origem !== 'mesmo_local') {
        apply({
          status: 'alerta',
          podeSalvar: true,
          exigeJustificativa: false,
          motivo: 'Deslocamento real não confirmado por Google Maps.',
          detalhes: {
            ...result.detalhes,
            servicoRelacionadoId: other?.id ?? null,
            intervaloDisponivelMin: cmp.intervaloDisponivelMin,
            deslocamentoEstimadoMin: desloc.minutos ?? null,
            tempoNecessarioMin: tempoNecessario,
            diferencaMin: cmp.intervaloDisponivelMin - tempoNecessario,
            regraAplicada: 'deslocamento_estimado',
          },
          mensagens: ['Google Maps indisponível; usando estimativa operacional.'],
          sugestoes: ['Validar deslocamento real antes de confirmar'],
        });
      }
      if (cmp.intervaloDisponivelMin < tempoNecessario) {
        apply({
          status: 'alerta',
          podeSalvar: true,
          exigeJustificativa: false,
          motivo: 'Risco de atraso por deslocamento.',
          detalhes: {
            ...result.detalhes,
            servicoRelacionadoId: other?.id ?? null,
            intervaloDisponivelMin: cmp.intervaloDisponivelMin,
            deslocamentoEstimadoMin: desloc.minutos ?? null,
            tempoNecessarioMin: tempoNecessario,
            diferencaMin: cmp.intervaloDisponivelMin - tempoNecessario,
            regraAplicada: 'deslocamento_maior_que_intervalo',
          },
          mensagens: [`Deslocamento de ${desloc.minutos}min para ${cmp.intervaloDisponivelMin}min disponíveis.`],
          sugestoes: ['Ajustar horário ou confirmar deslocamento com a equipe'],
        });
      }
    }
  }

  const jornadaRoute = await buildRouteForGroup({
    id: 'validacao-jornada',
    equipe: tecnicos.map(t => t.nome).join(' / '),
    tecnicos_ids: [...techIds],
    svcs: [service, ...candidatos.filter(s => serviceStatusInfo(s).ativo)],
  }, {
    config,
    serviceTypes,
    distanceClient,
  });
  const jornadaTotal = jornadaRoute.tempoTotalMin;
  if (jornadaTotal > config.jornadaMin) {
    apply({
      status: jornadaTotal > config.jornadaMin * 1.25 ? 'critico' : 'alerta',
      podeSalvar: true,
      exigeJustificativa: jornadaTotal > config.jornadaMin * 1.25,
      motivo: 'Jornada operacional acima do limite previsto.',
      detalhes: { ...result.detalhes, regraAplicada: 'jornada_estourada' },
      mensagens: [`Jornada estimada em ${formatarMinutos(jornadaTotal)} incluindo deslocamentos${config.incluirRetornoBase ? ' e retorno à base' : ''}.`],
      sugestoes: ['Revisar distribuição dos serviços do dia'],
    });
  }

  const descanso = avaliarDescansoMinimo(service, universe, technicians, serviceTypes, config);
  if (descanso.length) {
    apply({
      status: 'critico',
      podeSalvar: true,
      exigeJustificativa: true,
      motivo: 'Descanso mínimo comprometido para o técnico analisado.',
      detalhes: { ...result.detalhes, regraAplicada: 'descanso_minimo' },
      mensagens: descanso,
      sugestoes: ['Confirmar viabilidade da jornada com a operação'],
    });
  }

  result.exigeJustificativa = result.status === 'critico';
  result.mensagens = unique(result.mensagens);
  result.sugestoes = unique(result.sugestoes);
  return result;
}

function groupServicesByTechnician(services = [], technicians = []) {
  const groups = new Map();
  (services || []).forEach(service => {
    const serviceTechs = getServiceTechnicians(service, technicians);
    if (!serviceTechs.length) {
      if (!groups.has('sem-equipe')) groups.set('sem-equipe', { id: 'sem-equipe', equipe: 'Sem equipe', tecnicos_ids: [], svcs: [] });
      groups.get('sem-equipe').svcs.push(service);
      return;
    }
    const ids = [...new Set(serviceTechs.map(t => String(t.id)).filter(Boolean))].sort();
    const key = ids.length > 1 ? `shared:${ids.join('|')}` : ids[0];
    const equipe = ids.length > 1 ? serviceTechs.map(t => t.nome).join(' / ') : serviceTechs[0].nome;
    if (!groups.has(key)) groups.set(key, { id: key, equipe, tecnicos_ids: ids, svcs: [] });
    groups.get(key).svcs.push(service);
  });
  return [...groups.values()].sort((a, b) => String(a.equipe).localeCompare(String(b.equipe)));
}

async function buildRouteForGroup(group, options = {}) {
  const config = { ...CONFIG, ...(options.config || {}) };
  const serviceTypes = options.serviceTypes || [];
  const distanceClient = createDistanceCache(options.distanceClient || { getDistance: async (origem, destino) => ({
    km: Number(estimateDistance(origem, destino).toFixed(1)),
    minutos: estimateTravelMinutes(origem, destino),
    origem: 'estimado',
  }) });
  const restantes = [...(group.svcs || [])].sort((a, b) => (getHorarioServicoMin(a) ?? 9999) - (getHorarioServicoMin(b) ?? 9999));
  const sequencia = [];
  let cursor = config.inicioExpedienteMin;
  let currentAddress = config.baseAddress;
  let tempoServicoMin = 0;
  let tempoDeslocamentoMin = 0;
  let kmTotal = 0;
  let retornoBaseMin = 0;
  let retornoBaseKm = 0;
  let retornoBaseOrigem = '';
  const warnings = [];
  const blocks = [];

  while (restantes.length) {
    let escolha = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < restantes.length; i += 1) {
      const candidate = restantes[i];
      const h = getHorarioServicoMin(candidate);
      const dist = await distanceClient.getDistance(currentAddress, candidate.endereco || '');
      const chegada = cursor + (dist.minutos || 0);
      const espera = h !== null ? Math.max(0, h - chegada) : 0;
      const atraso = h !== null ? Math.max(0, chegada - h) : 0;
      const score = (dist.minutos || 0) + atraso * 2 + espera * 0.3;
      if (score < bestScore) {
        bestScore = score;
        escolha = i;
      }
    }

    const service = restantes.splice(escolha, 1)[0];
    const dist = sequencia.length && isSameOperationalStop(sequencia[sequencia.length - 1].servico, service)
      ? { km: 0, minutos: 0, origem: 'mesmo_local' }
      : await distanceClient.getDistance(currentAddress, service.endereco || '');
    const duracao = resolverDuracao(service, serviceTypes);
    const scheduled = getHorarioServicoMin(service);
    const inicio = Math.max(cursor + (dist.minutos || 0), scheduled ?? config.inicioExpedienteMin);
    const fim = inicio + duracao.minutos;

    if (dist.origem !== 'google' && dist.origem !== 'mesmo_local') warnings.push('Google Maps indisponível; roteiro usa estimativa operacional.');
    if ((dist.minutos || 0) > config.deslocamentoExtremoMin || (dist.km || 0) > config.deslocamentoExtremoKm) blocks.push('Inviável por deslocamento extremo');

    sequencia.push({
      servico: service,
      ordem: sequencia.length + 1,
      bairro: extrairBairroProxy(service.endereco || ''),
      deslocamentoMin: dist.minutos || 0,
      km: Number(dist.km || 0),
      deslocamentoOrigem: dist.origem,
      duracaoServicoMin: duracao.minutos,
      origemDuracao: duracao.origem,
      horarioAgendadoMin: scheduled,
      inicioSugeridoMin: inicio,
      fimSugeridoMin: fim,
      inicioPrevisto: formatarHora(inicio),
      fimPrevisto: formatarHora(fim),
    });
    cursor = fim;
    currentAddress = service.endereco || currentAddress;
    tempoServicoMin += duracao.minutos;
    tempoDeslocamentoMin += dist.minutos || 0;
    kmTotal += Number(dist.km || 0);
  }

  if (config.incluirRetornoBase && sequencia.length) {
    const retorno = await distanceClient.getDistance(currentAddress, config.baseAddress);
    retornoBaseMin = retorno.minutos || 0;
    retornoBaseKm = Number(retorno.km || 0);
    retornoBaseOrigem = retorno.origem || '';
    tempoDeslocamentoMin += retornoBaseMin;
    kmTotal += retornoBaseKm;
    if (retorno.origem !== 'google' && retorno.origem !== 'mesmo_local') {
      warnings.push('Retorno à base usa estimativa operacional.');
    }
    if (retornoBaseMin > config.deslocamentoExtremoMin || retornoBaseKm > config.deslocamentoExtremoKm) {
      blocks.push('Retorno à base com deslocamento extremo');
    }
  }

  const tempoTotalMin = tempoServicoMin + tempoDeslocamentoMin;
  if (tempoTotalMin > config.jornadaMin) blocks.push('Inviável por jornada');
  const severity = blocks.length ? 'critico' : warnings.length ? 'alerta' : 'ok';
  return {
    ...group,
    sequencia,
    tempoServicoMin,
    tempoDeslocamentoMin,
    tempoTotalMin,
    kmTotal: Number(kmTotal.toFixed(1)),
    retornoBaseMin,
    retornoBaseKm: Number(retornoBaseKm.toFixed(1)),
    retornoBaseOrigem,
    livreMin: Math.max(0, config.jornadaMin - tempoTotalMin),
    ocupacaoPct: config.jornadaMin > 0 ? Math.round((tempoTotalMin / config.jornadaMin) * 100) : 0,
    status: severity,
    warnings: unique(warnings),
    blocks: unique(blocks),
  };
}

async function buildDayRoutes(services = [], options = {}) {
  const groups = groupServicesByTechnician(services, options.technicians || []);
  const distanceClient = createDistanceCache(options.distanceClient || { getDistance: async (origem, destino) => ({
    km: Number(estimateDistance(origem, destino).toFixed(1)),
    minutos: estimateTravelMinutes(origem, destino),
    origem: 'estimado',
  }) });
  const routes = await Promise.all(groups.map(group => buildRouteForGroup(group, {
    ...options,
    distanceClient,
  })));
  return {
    date: options.date || '',
    totalServices: services.length,
    totalGroups: routes.length,
    routes,
    totals: {
      tempoTotalMin: routes.reduce((acc, r) => acc + r.tempoTotalMin, 0),
      kmTotal: Number(routes.reduce((acc, r) => acc + r.kmTotal, 0).toFixed(1)),
      criticalRoutes: routes.filter(r => r.status === 'critico').length,
      warningRoutes: routes.filter(r => r.status === 'alerta').length,
    },
  };
}

module.exports = {
  CONFIG,
  estimateDistance,
  estimateTravelMinutes,
  isSameOperationalAddress,
  resolverDuracao,
  validateService,
  groupServicesByTechnician,
  buildRouteForGroup,
  buildDayRoutes,
  getServiceDateValue,
  getServiceTechnicians,
};
