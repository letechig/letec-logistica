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

  async function createAppointment(db, input = {}) {
    const payload = normalizeAppointmentPayload(input, { includeId: true });
    const validation = validateAppointmentPayload(payload);
    if (!validation.ok) return { status: validation.status, error: validation };

    let customerLink = null;
    try {
      const saveAddress = input?.salvar_unidade_cliente !== false && input?.save_customer_address !== false;
      customerLink = await ensureCustomerForServicePayload(db, payload, { saveAddress });
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
