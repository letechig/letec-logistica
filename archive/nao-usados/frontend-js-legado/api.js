window.testarSupabase = async function() {
  try {
    const { data, error } = await supabaseClient.from('services').select('*').limit(1);
    if (error) throw error;
    console.log('✅ Supabase conectado! Dados de teste:', data);
  } catch (e) {
    console.error('❌ Erro no Supabase:', e.message);
  }
};

window._tecnicos = window._tecnicos || [];
window._tiposServico = window._tiposServico || [];

async function carregarTecnicos(){
  try {
    const { data, error } = await supabaseClient
      .from('technicians')
      .select('id, nome')
      .eq('ativo', true)
      .order('nome');
    if (error) throw error;
    window._tecnicos = data || [];
    console.log('Técnicos carregados:', window._tecnicos);
  } catch(e) {
    console.error('Erro ao carregar técnicos:', e);
    window._tecnicos = [];
  }
}

async function carregarTiposServico(){
  try {
    const response = await fetch(`${API_BASE_URL}/api/service-types`);
    if (!response.ok) throw new Error(`Erro ao carregar tipos: ${response.status}`);
    const data = await response.json();

    window._tiposServico = data || [];
    (data || []).forEach(t => {
      if (!t.sigla) return;
      TIPO_SERVICO[t.sigla] = {
        label: t.nome,
        cor: t.cor || '#94a3b8',
        duracao: t.duracao_minutos,
        categoria: t.categoria || 'geral',
        tipoAtendimento: t.tipo_atendimento || 'eventual',
        duracaoContrato: t.duracao_contrato_meses || null,
        id: t.id
      };
    });

    if (data && data.length) {
      const grupoMap = { geral: 'Geral', residencial: 'Residencial', comercial: 'Comercial', condominio: 'Condomínio', industrial: 'Industrial' };
      TIPOS_CATALOGO.length = 0;
      data.forEach(t => {
        TIPOS_CATALOGO.push({
          key: t.sigla,
          grupo: grupoMap[t.categoria] || 'Geral',
          label: `${t.sigla} — ${t.nome}`,
          cor: t.cor || '#94a3b8',
          duracao: t.duracao_minutos
        });
      });
      TIPOS_CATALOGO.push({ key: 'OUTRO', grupo: 'Operacional', label: 'Outro', cor: '#94a3b8', duracao: 60 });
    }
  } catch(e) {
    console.warn('Tipos de serviço não carregados do banco, usando hardcoded:', e.message);
    window._tiposServico = [];
  }
}

function carregarCatalogosServico() {
  if (!_catalogosServicoPromise) {
    _catalogosServicoPromise = Promise.all([carregarTecnicos(), carregarTiposServico()]).then(() => {
      if (typeof normalizarTecnicosIdsServicos === 'function') normalizarTecnicosIdsServicos();
      if (typeof refreshPages === 'function') refreshPages();
    });
  }
  return _catalogosServicoPromise;
}

window.prepararParaSupabase = function(servico, omitId = false) {
  const s = servico;
  const payload = {
    date: s.data || s.dt || null,
    cliente: s.cliente || s.cl || '',
    endereco: s.endereco || '',
    horario: s.horario || s.hr || '',
    tiposervico: s.tipoServico || s.sc || '',
    tipos: Array.isArray(s.tipos) ? s.tipos : (s.tipoServico ? [s.tipoServico] : []),
    equipe: typeof getServiceEquipeLabel === 'function' ? getServiceEquipeLabel(s) : (s.equipe || s.eq || ''),
    veiculo: s.veiculo || '',
    os: s.OS || s.os || '',
    observacoes: s.observacoes || s.obs || '',
    status: s.status || s.st || 'agendado'
  };
  if (!omitId && s.id !== undefined) payload.id = s.id;
  return payload;
};

window.cloneServiceState = function(servico) {
  if (!servico) return null;
  return {
    ...servico,
    tipos: Array.isArray(servico.tipos) ? [...servico.tipos] : [],
    tecnicos_ids: Array.isArray(servico.tecnicos_ids) ? [...servico.tecnicos_ids] : []
  };
};

window.rollbackInsertedService = function(serviceId) {
  if (serviceId === undefined || serviceId === null) return;
  services = services.filter(s => !sameId(s.id, serviceId));
  if (typeof saveSvcs === 'function') saveSvcs();
  if (typeof refreshPages === 'function') refreshPages();
  if (typeof updateBadges === 'function') updateBadges();
};

window.rollbackUpdatedService = function(previousService) {
  const snapshot = cloneServiceState(previousService);
  if (!snapshot) return;
  const idx = services.findIndex(s => sameId(s.id, snapshot.id));
  if (idx === -1) services.unshift(snapshot);
  else services[idx] = snapshot;
  if (typeof dedupeServicesById === 'function') services = dedupeServicesById(services);
  if (typeof saveSvcs === 'function') saveSvcs();
  if (typeof refreshPages === 'function') refreshPages();
  if (typeof updateBadges === 'function') updateBadges();
};

window.salvarServicoSupabase = async function(servico) {
  const queuedService = cloneServiceState(servico);
  const result = await safeSupabaseAction(
    () => supabaseClient.from('services').insert([prepararParaSupabase(queuedService)]),
    { op: 'insert', service: queuedService },
    () => rollbackInsertedService(queuedService?.id),
    { rollbackOnOffline: false, rollbackOnFailure: false, queueOnFailure: true }
  );
  if (typeof carregarServicesDoSupabase === 'function') await carregarServicesDoSupabase();
  return result;
};

window.atualizarServicoSupabase = async function(servico, previousService) {
  const queuedService = cloneServiceState(servico);
  const rollbackSnapshot = cloneServiceState(previousService);
  return await safeSupabaseAction(
    () => supabaseClient.from('services').upsert([prepararParaSupabase(queuedService)], { onConflict: 'id' }),
    { op: 'update', service: queuedService },
    rollbackSnapshot ? () => rollbackUpdatedService(rollbackSnapshot) : null,
    { rollbackOnOffline: false, rollbackOnFailure: false, queueOnFailure: true }
  );
};
