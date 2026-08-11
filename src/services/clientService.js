function createClientService(deps) {
  const {
    maybeSingle,
    normalizePhone,
    normalizeEmail,
    normalizeUf,
    normalizeCustomerName,
    normalizeCustomerOperationalStatus,
    normalizeCustomerPriority,
    buildCustomerAddress,
    findDuplicateCustomer,
    runCustomerWriteWithSchemaFallback,
    ensureCustomerAlias,
    ensureCustomerAddress,
    listCustomerAddresses,
    runCustomerAddressWriteWithSchemaFallback,
    isMissingRelationError,
    publicDbErrorDetails
  } = deps;

  const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source || {}, key);

  function isValidOperationalContact(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('55')) return [12, 13].includes(digits.length);
    return [10, 11].includes(digits.length);
  }

  function normalizeClientPayload(input = {}) {
    const ufNormalizada = normalizeUf(input.uf);
    const enderecoEstruturado = buildCustomerAddress({
      rua: input.rua,
      numero: input.numero,
      bairro: input.bairro,
      cidade: input.cidade,
      uf: ufNormalizada,
      complemento: input.complemento,
      referencia: input.referencia
    });
    const categoria = input.categoria || (input.tipo_cliente === 'Contrato' ? 'contrato' : 'eventual');
    const clienteRecorrente = input.cliente_recorrente === true || String(input.cliente_recorrente) === 'true';
    const dataUltimoServicoISO = input.data_ultimo_servico ? new Date(input.data_ultimo_servico).toISOString() : null;
    const statusOperacionalNormalizado = normalizeCustomerOperationalStatus(input.status_operacional);
    const prioridadeNormalizada = normalizeCustomerPriority(input.prioridade);
    const enderecoFinal = input.endereco ? String(input.endereco).trim() : enderecoEstruturado;
    const enderecoCompletoFinal = input.endereco_completo ? String(input.endereco_completo).trim() : enderecoEstruturado;

    return {
      nome: input.nome ? String(input.nome).trim() : '',
      nome_normalizado: normalizeCustomerName(input.nome),
      telefone: normalizePhone(input.telefone),
      whatsapp: normalizePhone(input.whatsapp) || null,
      email: normalizeEmail(input.email),
      cep: String(input.cep || '').replace(/\D/g, '') || null,
      endereco: enderecoFinal,
      endereco_completo: enderecoCompletoFinal,
      rua: input.rua ? String(input.rua).trim() : null,
      numero: input.numero ? String(input.numero).trim() : null,
      bairro: input.bairro ? String(input.bairro).trim() : null,
      cidade: input.cidade ? String(input.cidade).trim() : null,
      uf: ufNormalizada,
      complemento: input.complemento ? String(input.complemento).trim() : null,
      referencia: input.referencia ? String(input.referencia).trim() : null,
      latitude: input.latitude ? parseFloat(input.latitude) : null,
      longitude: input.longitude ? parseFloat(input.longitude) : null,
      location_source: ['address', 'cep', 'manual_map', 'technician_arrival'].includes(String(input.location_source || '').toLowerCase()) ? String(input.location_source).toLowerCase() : null,
      location_precision: ['exact', 'approximate', 'verified'].includes(String(input.location_precision || '').toLowerCase()) ? String(input.location_precision).toLowerCase() : null,
      location_verified_at: input.location_precision === 'verified' ? (input.location_verified_at || new Date().toISOString()) : null,
      tipo_local: input.tipo_local ? String(input.tipo_local).trim() : null,
      restricoes_operacionais: input.restricoes_operacionais ? String(input.restricoes_operacionais).trim() : null,
      nome_fantasia: input.nome_fantasia ? String(input.nome_fantasia).trim() : null,
      tags: Array.isArray(input.tags) ? input.tags.filter(Boolean).map(String) : (input.tags ? String(input.tags).trim() : null),
      categoria_principal: input.categoria_principal ? String(input.categoria_principal).trim() : null,
      vendedor_responsavel: input.vendedor_responsavel ? String(input.vendedor_responsavel).trim() : null,
      observacao_comercial: input.observacao_comercial ? String(input.observacao_comercial).trim() : null,
      cadastro_quality_score: Number.isFinite(Number(input.cadastro_quality_score)) ? Number(input.cadastro_quality_score) : null,
      cadastro_quality_flags: Array.isArray(input.cadastro_quality_flags) ? input.cadastro_quality_flags.filter(Boolean).map(String) : null,
      possui_animais: hasOwn(input, 'possui_animais') ? (input.possui_animais === true || String(input.possui_animais) === 'true') : null,
      animais_quais: Array.isArray(input.animais_quais) ? input.animais_quais.filter(Boolean).map(String) : (input.animais_quais ? String(input.animais_quais).trim() : null),
      restricao_horario: input.restricao_horario ? String(input.restricao_horario).trim() : null,
      acesso_local: input.acesso_local ? String(input.acesso_local).trim() : null,
      precisa_agendar_portaria: hasOwn(input, 'precisa_agendar_portaria') ? (input.precisa_agendar_portaria === true || String(input.precisa_agendar_portaria) === 'true') : null,
      precisa_autorizacao_previa: hasOwn(input, 'precisa_autorizacao_previa') ? (input.precisa_autorizacao_previa === true || String(input.precisa_autorizacao_previa) === 'true') : null,
      tem_chave_portaria: hasOwn(input, 'tem_chave_portaria') ? (input.tem_chave_portaria === true || String(input.tem_chave_portaria) === 'true') : null,
      risco_especial: hasOwn(input, 'risco_especial') ? (input.risco_especial === true || String(input.risco_especial) === 'true') : null,
      epis_obrigatorios: input.epis_obrigatorios ? String(input.epis_obrigatorios).trim() : null,
      melhor_periodo_atendimento: input.melhor_periodo_atendimento ? String(input.melhor_periodo_atendimento).trim() : null,
      tempo_medio_local: input.tempo_medio_local ? String(input.tempo_medio_local).trim() : null,
      nivel_urgencia_padrao: input.nivel_urgencia_padrao || 'normal',
      observacoes_operacionais: input.observacoes_operacionais ? String(input.observacoes_operacionais).trim() : null,
      cliente_recorrente: clienteRecorrente,
      periodicidade: categoria === 'contrato' || clienteRecorrente ? input.periodicidade : null,
      data_ultimo_servico: dataUltimoServicoISO,
      tipo: input.tipo || 'PF',
      cpf_cnpj: input.cpf_cnpj,
      contato: input.contato ? String(input.contato).trim() : null,
      zona: input.zona ? String(input.zona).trim() : null,
      tipo_cliente: input.tipo_cliente ? String(input.tipo_cliente).trim() : (categoria === 'contrato' ? 'Contrato' : 'Eventual'),
      status_operacional: statusOperacionalNormalizado,
      prioridade: prioridadeNormalizada,
      origem: input.origem ? String(input.origem).trim() : null,
      observacoes: input.observacoes,
      is_incomplete: hasOwn(input, 'is_incomplete') ? (input.is_incomplete === true || String(input.is_incomplete) === 'true') : false,
      ativo: statusOperacionalNormalizado === 'Inativo' ? false : true,
      _meta: {
        categoria,
        clienteRecorrente,
        enderecoFinal,
        enderecoCompletoFinal,
        ufNormalizada
      }
    };
  }

  function validateClientPayload(payload) {
    if (!payload.nome) return { ok: false, status: 400, error: 'Nome é obrigatório', code: 'client_name_required' };
    const validContact = [payload.whatsapp, payload.telefone].some(isValidOperationalContact);
    if (!validContact) {
      return { ok: false, status: 400, error: 'Telefone ou WhatsApp valido e obrigatorio', code: 'client_contact_required' };
    }
    if (payload._meta?.categoria === 'contrato' && !payload.periodicidade) {
      return { ok: false, status: 400, error: 'Periodicidade é obrigatória para clientes de contrato', code: 'client_periodicity_required' };
    }
    if (payload._meta?.clienteRecorrente && !payload.periodicidade) {
      return { ok: false, status: 400, error: 'Periodicidade é obrigatória para clientes recorrentes', code: 'client_periodicity_required' };
    }
    if (!payload.cep || String(payload.cep).replace(/\D/g, '').length !== 8) {
      return { ok: false, status: 400, error: 'CEP e obrigatorio para validar o endereco do cliente', code: 'client_cep_required' };
    }
    if (!payload.numero) {
      return { ok: false, status: 400, error: 'Numero do endereco e obrigatorio', code: 'client_address_number_required' };
    }
    if (!payload.rua || !payload.bairro || !payload.cidade || !payload.uf) {
      return { ok: false, status: 400, error: 'Rua, bairro, cidade e UF sao obrigatorios apos buscar o CEP', code: 'client_structured_address_required' };
    }
    return { ok: true };
  }

  function dbPayload(payload) {
    const { _meta, ...rest } = payload;
    return rest;
  }

  async function findClientById(db, id) {
    if (!id) return null;
    return maybeSingle(db.from('customers').select('*').eq('id', id));
  }

  async function searchClients(db, options = {}) {
    const search = String(options.search || '').trim();
    const limit = Math.min(Number(options.limit || 50), 200);
    let query = db.from('customers').select('*').order('nome', { ascending: true }).limit(limit);
    if (search) {
      const safe = search.replace(/[%_,]/g, '');
      query = query.or(`nome.ilike.%${safe}%,telefone.ilike.%${safe}%,whatsapp.ilike.%${safe}%,endereco.ilike.%${safe}%`);
    }
    if (!options.includeInactive) query = query.eq('ativo', true);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function findDuplicateClients(db, payload, ignoreId = null) {
    const duplicate = await findDuplicateCustomer({
      id: ignoreId,
      nome: payload.nome,
      telefone: payload.telefone,
      whatsapp: payload.whatsapp,
      cpf_cnpj: payload.cpf_cnpj,
      endereco: payload.endereco,
      endereco_completo: payload.endereco_completo,
      cep: payload.cep,
      rua: payload.rua,
      numero: payload.numero,
      bairro: payload.bairro,
      cidade: payload.cidade,
      uf: payload.uf,
      db
    });
    return duplicate ? [duplicate] : [];
  }

  async function createClient(db, input = {}) {
    const normalized = normalizeClientPayload(input);
    const validation = validateClientPayload(normalized);
    if (!validation.ok) return { status: validation.status, error: validation };
    normalized.is_incomplete = false;

    const duplicates = await findDuplicateClients(db, normalized);
    if (duplicates.length && input.allow_duplicate !== true) {
      return {
        status: 409,
        error: {
          code: 'possible_duplicate',
          error: `Cliente potencialmente duplicado: ${duplicates[0].nome}`,
          duplicateId: duplicates[0].id,
          duplicate: duplicates[0]
        }
      };
    }

    const { data, error } = await runCustomerWriteWithSchemaFallback(
      payload => db.from('customers').insert([payload]).select(),
      dbPayload(normalized),
      'clientService.createClient'
    );
    if (error) return { status: error.code === '23505' ? 409 : 500, error };

    const created = data?.[0] || null;
    if (created?.id) {
      try { await ensureCustomerAlias(db, created.id, created.nome || normalized.nome, input.origem || 'cadastro'); } catch (e) {}
      try {
        const address = await ensureCustomerAddress(db, created.id, { ...dbPayload(normalized), origem: input.origem || 'cadastro' }, { origem: input.origem || 'cadastro', is_primary: true, label: 'Principal' });
        if (!address?.id) {
          return {
            status: 503,
            error: {
              code: 'customer_address_persistence_required',
              error: 'Cliente criado, mas a unidade obrigatoria nao foi persistida. Aplique migration-clientes-unidades.sql antes de agendar.'
            }
          };
        }
      } catch (error) {
        return {
          status: 503,
          error: {
            code: 'customer_address_persistence_required',
            error: 'Cliente criado, mas a unidade obrigatoria nao foi persistida. Corrija o schema antes de agendar.',
            details: publicDbErrorDetails(error)
          }
        };
      }
    }
    return { status: 201, data: created };
  }

  async function updateClient(db, id, input = {}) {
    const normalized = normalizeClientPayload(input);
    const validation = validateClientPayload(normalized);
    if (!validation.ok) return { status: validation.status, error: validation };
    normalized.is_incomplete = false;

    const duplicates = await findDuplicateClients(db, normalized, id);
    if (duplicates.length && input.allow_duplicate !== true) {
      return {
        status: 409,
        error: {
          code: 'possible_duplicate',
          error: `Cliente potencialmente duplicado: ${duplicates[0].nome}`,
          duplicateId: duplicates[0].id,
          duplicate: duplicates[0]
        }
      };
    }

    const { data, error } = await runCustomerWriteWithSchemaFallback(
      payload => db.from('customers').update(payload).eq('id', id).select(),
      dbPayload(normalized),
      'clientService.updateClient'
    );
    if (error) return { status: 500, error };
    const updated = data?.[0] || null;
    if (updated?.id) {
      try {
        const address = await ensureCustomerAddress(db, updated.id, { ...dbPayload(normalized), origem: input.origem || 'cadastro' }, { origem: input.origem || 'cadastro', is_primary: true, label: 'Principal' });
        if (!address?.id) {
          return {
            status: 503,
            error: {
              code: 'customer_address_persistence_required',
              error: 'A unidade obrigatoria do cliente nao foi persistida. Aplique migration-clientes-unidades.sql.'
            }
          };
        }
      } catch (addressError) {
        return {
          status: 503,
          error: {
            code: 'customer_address_persistence_required',
            error: 'A unidade obrigatoria do cliente nao foi persistida. Corrija o schema antes de agendar.',
            details: publicDbErrorDetails(addressError)
          }
        };
      }
    }
    return { status: 200, data: updated };
  }

  async function createQuickClient(db, input = {}) {
    const normalized = normalizeClientPayload({
      ...input,
      nome: input.nome || input.apelido || input.nome_fantasia,
      tipo: input.tipo || 'PF',
      tipo_cliente: input.tipo_cliente || 'Eventual',
      origem: input.origem || 'agenda',
      is_incomplete: input.is_incomplete !== false
    });
    if (!normalized.nome) {
      return { status: 400, error: { code: 'client_name_required', error: 'Nome ou apelido e obrigatorio' } };
    }

    normalized.is_incomplete = true;
    normalized.ativo = normalized.status_operacional === 'Inativo' ? false : true;

    const duplicates = await findDuplicateClients(db, normalized);
    if (duplicates.length && input.allow_duplicate !== true) {
      return {
        status: 409,
        error: {
          code: 'possible_duplicate',
          error: `Cliente potencialmente duplicado: ${duplicates[0].nome}`,
          duplicateId: duplicates[0].id,
          duplicate: duplicates[0]
        }
      };
    }

    const { data, error } = await runCustomerWriteWithSchemaFallback(
      payload => db.from('customers').insert([payload]).select(),
      dbPayload(normalized),
      'clientService.createQuickClient'
    );
    if (error) return { status: error.code === '23505' ? 409 : 500, error };

    const created = data?.[0] || null;
    if (created?.id) {
      try { await ensureCustomerAlias(db, created.id, created.nome || normalized.nome, input.origem || 'cliente_rapido'); } catch (e) {}
    }
    return { status: 201, data: created };
  }

  async function listClientLocations(db, customerId, options = {}) {
    return listCustomerAddresses(db, customerId, options);
  }

  async function createClientLocation(db, customerId, input = {}, options = {}) {
    return ensureCustomerAddress(db, customerId, input, options);
  }

  async function updateClientLocation(db, customerId, addresses = []) {
    const invalid = (addresses || []).find(item => {
      const cep = String(item.cep || '').replace(/\D/g, '');
      return !cep || cep.length !== 8 || !item.numero || !item.rua || !item.bairro || !item.cidade || !normalizeUf(item.uf);
    });
    if (invalid) {
      return {
        status: 400,
        error: {
          code: 'customer_address_required_fields',
          error: 'Todas as unidades precisam de CEP, numero, rua, bairro, cidade e UF.'
        }
      };
    }

    const deactivated = await runCustomerAddressWriteWithSchemaFallback(
      payload => db.from('customer_addresses').update(payload).eq('customer_id', customerId),
      { ativo: false, updated_at: new Date().toISOString() },
      'clientService.updateClientLocation.deactivate'
    );
    if (deactivated.error) {
      if (isMissingRelationError(deactivated.error)) {
        return { status: 503, error: { error: 'A migration migration-clientes-unidades.sql ainda nao foi aplicada.', migration_required: true } };
      }
      return { status: 500, error: deactivated.error };
    }
    for (const item of addresses) {
      await ensureCustomerAddress(db, customerId, { ...item, origem: item.origem || 'cadastro' }, { origem: item.origem || 'cadastro', is_primary: item.is_primary === true });
    }
    return { status: 200, data: await listCustomerAddresses(db, customerId, { includeInactive: false }) };
  }

  return {
    findClientById,
    searchClients,
    createClient,
    updateClient,
    createQuickClient,
    createClientLocation,
    updateClientLocation,
    listClientLocations,
    findDuplicateClients,
    normalizeClientPayload,
    validateClientPayload,
    publicDbErrorDetails
  };
}

module.exports = { createClientService };
