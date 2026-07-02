function createAppointmentService(deps) {
  const {
    normalizeServicePayload,
    runServiceWriteWithSchemaFallback,
    ensureCustomerForServicePayload
  } = deps;

  function normalizeAppointmentPayload(input = {}, options = {}) {
    const payload = normalizeServicePayload(input, options);
    if (payload.cliente && !payload.client_name_snapshot) payload.client_name_snapshot = payload.cliente;
    if (payload.endereco && !payload.address_snapshot) payload.address_snapshot = payload.endereco;
    return payload;
  }

  function validateAppointmentPayload(payload, options = {}) {
    if (!options.partial && !payload.cliente) {
      return { ok: false, status: 400, code: 'appointment_client_required', error: 'Cliente é obrigatório' };
    }
    if (!options.partial && !(payload.date || payload.data)) {
      return { ok: false, status: 400, code: 'appointment_date_required', error: 'Data é obrigatória' };
    }
    return { ok: true };
  }

  function serviceDate(service = {}) {
    return service.date || service.data || service.dt || '';
  }

  function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function parseArrayLike(value) {
    if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
    if (value === null || value === undefined || value === '') return [];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(item => String(item || '').trim()).filter(Boolean);
      } catch (error) {}
      return trimmed.split(/[,+/|;]/).map(item => item.trim()).filter(Boolean);
    }
    return [String(value).trim()].filter(Boolean);
  }

  function serviceTechnicianIds(service = {}) {
    return parseArrayLike(
      service.tecnicos_ids
      || service.tecnicosIds
      || service.technicians_ids
      || service.technician_ids
      || service.tecnico_ids
      || service.tecnico_id
    );
  }

  function serviceTeam(service = {}) {
    return normalizeText(service.equipe || service.eq || service.tecnico || service.motorista || '');
  }

  function activeExecStatus(service = {}) {
    return normalizeText(service.exec_status).replace(/\s+/g, '_');
  }

  function isActiveServiceStatus(status) {
    return ['em_deslocamento', 'cheguei', 'em_execucao'].includes(status);
  }

  function execStatusRank(status) {
    return {
      agendado: 0,
      em_deslocamento: 1,
      cheguei: 2,
      em_execucao: 3,
      finalizado: 4,
      problema: 4
    }[status] ?? null;
  }

  function effectiveExecStatus(service = {}) {
    const execStatus = activeExecStatus(service);
    if (execStatus) return execStatus;
    const status = normalizeText(service.status || service.st).replace(/\s+/g, '_');
    if (['executado', 'finalizado', 'concluido', 'concluído'].includes(status)) return 'finalizado';
    if (['problema', 'nao_executado', 'não_executado'].includes(status)) return 'problema';
    return status || '';
  }

  function isTerminalExecStatus(status) {
    return ['finalizado', 'problema'].includes(status);
  }

  function isStaleExecStatusUpdate(current = {}, payload = {}) {
    if (!Object.prototype.hasOwnProperty.call(payload, 'exec_status')) return false;
    const currentStatus = effectiveExecStatus(current);
    const nextStatus = activeExecStatus(payload);
    if (!nextStatus || nextStatus === currentStatus) return false;

    if (isTerminalExecStatus(currentStatus)) return true;

    const currentRank = execStatusRank(currentStatus);
    const nextRank = execStatusRank(nextStatus);
    return currentRank !== null && nextRank !== null && nextRank < currentRank;
  }

  function sameOperationalOwner(a = {}, b = {}) {
    const aIds = serviceTechnicianIds(a).map(String);
    const bIds = serviceTechnicianIds(b).map(String);
    if (aIds.length && bIds.length) return aIds.some(id => bIds.includes(id));
    const aTeam = serviceTeam(a);
    const bTeam = serviceTeam(b);
    return !!aTeam && !!bTeam && aTeam === bTeam;
  }

  function describeService(service = {}) {
    const os = service.os || service.OS || '';
    return [
      service.horario || service.hr || '--:--',
      service.cliente || service.cl || 'Cliente',
      os ? `OS ${os}` : ''
    ].filter(Boolean).join(' - ');
  }

  async function fetchServiceById(db, id) {
    const { data, error } = await db.from('services').select('*').eq('id', id);
    if (error) return { error };
    return { data: data?.[0] || null };
  }

  async function findActiveServiceConflict(db, id, candidate = {}) {
    const status = activeExecStatus(candidate);
    if (!isActiveServiceStatus(status)) return null;

    const date = serviceDate(candidate);
    if (!date) return null;
    if (!serviceTechnicianIds(candidate).length && !serviceTeam(candidate)) return null;

    const { data, error } = await db.from('services').select('*').eq('date', date).limit(1000);
    if (error) throw error;

    return (data || []).find(service => {
      if (String(service.id) === String(id)) return false;
      if (serviceDate(service) !== date) return false;
      if (!isActiveServiceStatus(activeExecStatus(service))) return false;
      return sameOperationalOwner(candidate, service);
    }) || null;
  }

  async function createAppointment(db, input = {}) {
    const payload = normalizeAppointmentPayload(input, { includeId: true });
    const validation = validateAppointmentPayload(payload);
    if (!validation.ok) return { status: validation.status, error: validation };

    let customerLink = null;
    try {
      const saveAddress = input?.salvar_unidade_cliente !== false && input?.save_customer_address !== false;
      customerLink = await ensureCustomerForServicePayload(db, payload, { saveAddress, input });
    } catch (error) {
      return { status: error.statusCode || 500, error, customerLinkFailed: true };
    }

    const linkedCustomer = customerLink?.customer || null;
    if (linkedCustomer && !payload.phone_snapshot) {
      payload.phone_snapshot = linkedCustomer.whatsapp || linkedCustomer.telefone || null;
    }

    const { data, error } = await runServiceWriteWithSchemaFallback(
      workingPayload => db.from('services').insert([workingPayload]).select(),
      payload,
      'appointmentService.createAppointment'
    );
    if (error) return { status: error.code === '23505' ? 409 : 500, error, payload };

    const saved = data?.[0] || null;
    return {
      status: 201,
      data: saved ? {
        ...saved,
        customer_auto_link: customerLink ? {
          created: !!customerLink.created,
          customer_id: payload.cliente_id || null,
          customer_address_id: payload.customer_address_id || null
        } : null
      } : null
    };
  }

  async function createAppointmentWithQuickClient(db, input = {}) {
    return createAppointment(db, input);
  }

  async function updateAppointment(db, id, input = {}) {
    const payload = normalizeAppointmentPayload(input, { partial: true });
    delete payload.id;
    if (!Object.keys(payload).length) {
      return { status: 400, error: { code: 'appointment_empty_update', error: 'Nenhum campo válido para atualizar' } };
    }

    const currentResult = await fetchServiceById(db, id);
    if (currentResult.error) return { status: 500, error: currentResult.error };
    if (!currentResult.data) return { status: 404, error: { code: 'service_not_found', error: 'Serviço não encontrado' } };

    if (isStaleExecStatusUpdate(currentResult.data, payload)) {
      return {
        status: 200,
        data: {
          ...currentResult.data,
          stale_exec_status_ignored: true
        }
      };
    }

    try {
      const conflict = await findActiveServiceConflict(db, id, { ...currentResult.data, ...payload });
      if (conflict) {
        return {
          status: 409,
          error: {
            code: 'active_service_conflict',
            error: 'Já existe outro atendimento ativo para este técnico/equipe',
            active_service_id: conflict.id,
            active_service: describeService(conflict)
          }
        };
      }
    } catch (error) {
      return { status: 500, error };
    }

    const { data, error } = await runServiceWriteWithSchemaFallback(
      workingPayload => db.from('services').update(workingPayload).eq('id', id).select(),
      payload,
      'appointmentService.updateAppointment'
    );
    if (error) return { status: 500, error };
    const updated = data?.[0] || null;
    if (!updated) return { status: 404, error: { code: 'service_not_found', error: 'Serviço não encontrado' } };
    return { status: 200, data: updated };
  }

  return {
    createAppointment,
    updateAppointment,
    createAppointmentWithQuickClient,
    validateAppointmentPayload,
    normalizeAppointmentPayload
  };
}

module.exports = { createAppointmentService };
