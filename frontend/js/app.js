
  // ═════════════════════════════════════════════════════════════════════════════
  // 🔒 XSS PROTECTION: Sanitization and Safe DOM methods
  // ═════════════════════════════════════════════════════════════════════════════
  
  /**
   * Escapes HTML special characters to prevent XSS attacks
   * @param {string} unsafe - User input string
   * @returns {string} Escaped HTML-safe string
   */
  window.sanitizeHtml = function(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  };

  /**
   * Safe method to set text content (prevents XSS)
   * @param {Element} el - DOM element
   * @param {string} text - Text content (will be automatically escaped)
   */
  window.setTextSafe = function(el, text) {
    if (!el) return;
    el.textContent = text;  // textContent automatically escapes
  };

  /**
   * Safe method to set HTML with sanitized content
   * @param {Element} el - DOM element
   * @param {string} html - HTML string (will be sanitized)
   */
  window.setHtmlSafe = function(el, html) {
    if (!el) return;
    const temp = document.createElement('div');
    temp.innerHTML = html;  // Parse HTML
    // Remove any script tags and onclick handlers
    const scripts = temp.querySelectorAll('script');
    scripts.forEach(s => s.remove());
    temp.querySelectorAll('[onclick]').forEach(el => el.removeAttribute('onclick'));
    el.innerHTML = temp.innerHTML;
  };

  /**
   * Safe method to set attribute with validation
   * @param {Element} el - DOM element
   * @param {string} attr - Attribute name
   * @param {string} value - Attribute value
   */
  window.setAttrSafe = function(el, attr, value) {
    if (!el) return;
    // Block dangerous attributes
    if (['onclick', 'onerror', 'onload', 'onmouseover'].includes(attr.toLowerCase())) {
      console.warn(`[Security] Blocked dangerous attribute: ${attr}`);
      return;
    }
    el.setAttribute(attr, String(value || ''));
  };

  /**
   * Create safe text node (prevents XSS)
   * @param {string} text - Text content
   * @returns {Text} Text node
   */
  window.createTextNodeSafe = function(text) {
    return document.createTextNode(text);
  };

  /**
   * Validate URL to prevent javascript: and data: schemes
   * @param {string} url - URL to validate
   * @returns {string} Safe URL or empty string
   */
  window.getUrlSafe = function(url) {
    if (!url) return '';
    const str = String(url).trim();
    if (str.startsWith('javascript:') || str.startsWith('data:')) {
      console.warn(`[Security] Blocked dangerous URL: ${str.substring(0, 20)}...`);
      return '';
    }
    return str;
  };

  const SUPABASE_URL = 'https://zqrztixmrpnpehppylyr.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_TwfVUWjr87_VdHFzJURGmw_KVmXCiBq';
  const GOOGLE_MAPS_API_KEY = 'AIzaSyCiblls0PJ8xwc8tZogLVeJ3zMzshbtEQY';
  const API_BASE_URL = window.LETEC_API_BASE_URL || localStorage.getItem('letec_api_base_url') || (function() {
    if (window.location.protocol === 'file:') return 'http://localhost:8000';
    return window.location.protocol + '//' + window.location.hostname + (window.location.port ? ':' + window.location.port : '');
  })();
  window.setLeteApiBaseUrl = function(url) {
    const value = String(url || '').trim();
    if (!value) {
      localStorage.removeItem('letec_api_base_url');
      location.reload();
      return;
    }
    localStorage.setItem('letec_api_base_url', value.replace(/\/$/, ''));
    location.reload();
  };
  window.clearLeteApiBaseUrl = function() {
    localStorage.removeItem('letec_api_base_url');
    location.reload();
  };
    // Fix: usar window.supabase.createClient (não supabase.createClient — evita referência circular)
   const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  window.testarSupabase = async function() {
    try {
      // Fix: tabela correta é 'services', não 'check_lists'
      const { data, error } = await supabaseClient.from('services').select('*').limit(1);
      if (error) throw error;
      console.log('✅ Supabase conectado! Dados de teste:', data);
    } catch (e) {
      console.error('❌ Erro no Supabase:', e.message);
    }
  };

  // ── Flag global: habilita salvamento duplo (local + Supabase) ──
  // Setar false para desligar Supabase sem remover o código.
  const USAR_SUPABASE = true;
  window._tecnicos = [];
  window._tiposServico = [];
  let _catalogosServicoPromise = null;

async function carregarTecnicos(){
  try {
    const { data, error } = await supabaseClient
      .from('technicians')
      .select('id, nome')
        .eq('ativo', true)
        .order('nome');

    if(error) throw error;

    window._tecnicos = data || [];
    console.log('Técnicos carregados:', window._tecnicos);
  } catch(e){
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

      // Hidrata TIPO_SERVICO e TIPOS_CATALOGO dinamicamente a partir do banco
      (data || []).forEach(t => {
        if (!t.sigla) return;
        TIPO_SERVICO[t.sigla] = {
          label:              t.nome,
          cor:                t.cor || '#94a3b8',
          duracao:            t.duracao_minutos,
          categoria:          t.categoria || 'geral',
          tipoAtendimento:    t.tipo_atendimento || 'eventual',
          duracaoContrato:    t.duracao_contrato_meses || null,
          id:                 t.id
        };
      });

      if (data && data.length) {
        const grupoMap = { geral: 'Geral', residencial: 'Residencial', comercial: 'Comercial', condominio: 'Condomínio', industrial: 'Industrial' };
        TIPOS_CATALOGO.length = 0;
        data.forEach(t => {
          TIPOS_CATALOGO.push({
            key:     t.sigla,
            grupo:   grupoMap[t.categoria] || 'Geral',
            label:   `${t.sigla} — ${t.nome}`,
            cor:     t.cor || '#94a3b8',
            duracao: t.duracao_minutos
          });
        });
        TIPOS_CATALOGO.push({ key: 'OUTRO', grupo: 'Operacional', label: 'Outro', cor: '#94a3b8', duracao: 60 });
      }
    } catch(e){
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

  // ── Sanitizador: mapeia campos internos → colunas do Supabase ─
  // O objeto interno usa aliases legados (dt, cl, hr, eq, st) que NÃO
  // existem no schema do banco. Esta função extrai apenas as colunas
  // reais antes de qualquer operação remota, sem alterar nada localmente.
  window.prepararParaSupabase = function(servico, omitId = false) {
    const s = servico;
    const payload = {
      date:         s.data        || s.dt        || null,
      cliente:      s.cliente     || s.cl        || '',
      endereco:     s.endereco    || '',
      horario:      s.horario     || s.hr        || '',
      tiposervico:  s.tipoServico || s.sc        || '',
      tipos:        Array.isArray(s.tipos) ? s.tipos : (s.tipoServico ? [s.tipoServico] : []),
      equipe:       typeof getServiceEquipeLabel === 'function' ? getServiceEquipeLabel(s) : (s.equipe || s.eq || ''),
      veiculo:      s.veiculo     || '',
      os:           s.OS          || s.os        || '',
      observacoes:  s.observacoes || s.obs       || '',
      status:       s.status      || s.st        || 'agendado',
    };
    if (!omitId && s.id !== undefined) {
      payload.id = s.id;
    }
    return payload;
  };

  window.cloneServiceState = function(servico) {
    if (!servico) return null;
    return {
      ...servico,
      tipos: Array.isArray(servico.tipos) ? [...servico.tipos] : [],
      tecnicos_ids: Array.isArray(servico.tecnicos_ids) ? [...servico.tecnicos_ids] : [],
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
    if (typeof dedupeServicesById === 'function') {
      services = dedupeServicesById(services);
    }
    if (typeof saveSvcs === 'function') saveSvcs();
    if (typeof refreshPages === 'function') refreshPages();
    if (typeof updateBadges === 'function') updateBadges();
  };

  // ── Salvar novo serviço no Supabase ───────────────────────────
  window.salvarServicoSupabase = async function(servico) {
    const queuedService = cloneServiceState(servico);
    const result = await safeSupabaseAction(
      () => supabaseClient.from('services').insert([prepararParaSupabase(queuedService)]),
      { op: 'insert', service: queuedService },
      () => rollbackInsertedService(queuedService?.id),
      { rollbackOnOffline: false, rollbackOnFailure: false, queueOnFailure: true }
    );
    if (typeof carregarServicesDoSupabase === 'function') {
      await carregarServicesDoSupabase();
    }
    return result;
  };

  // ── Atualizar serviço existente no Supabase (upsert por id) ──
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
