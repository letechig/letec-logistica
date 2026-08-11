const test = require('node:test');
const assert = require('node:assert/strict');

async function adminHeaders(baseUrl) {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-admin-jwt'
  };
}

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon';

const app = require('../server');

function makeState() {
  return {
    customers: [
      { id: 1, nome: 'Alpha Cliente', nome_normalizado: 'ALPHA CLIENTE', telefone: '551111111111', ativo: true, endereco: 'Rua A' },
      { id: 2, nome: 'Beta Cliente', nome_normalizado: 'BETA CLIENTE', telefone: '552222222222', ativo: true, endereco: 'Rua B' },
      { id: 3, nome: 'Beta Cliente', nome_normalizado: 'BETA CLIENTE', telefone: '553333333333', ativo: true, endereco: 'Rua B' }
    ],
    services: [{ id: 10, cliente_id: 2, customer_address_id: 'addr-2', cliente: 'Beta Cliente', endereco: 'Rua B, 20 - Centro - Sao Paulo / SP' }],
    technicians: [{ id: 'tec-1', nome: 'Joao', ativo: true }],
    vehicles: [{ id: 'vei-1', nome: 'Fox', ativo: true }],
    contracts: [{ id: 20, customer_id: 2, tipo_servico: 'Controle de pragas' }],
    customer_service_history: [{ id: 30, customer_id: 2, servico: 'DS' }],
    data_reviews: [{ id: 40, customer_id: 2, tipo_problema: 'possivel_duplicidade' }],
    customer_reminders: [{ id: 'rem-1', customer_id: 2, mensagem: 'x' }],
    customer_addresses: [
      { id: 'addr-1', customer_id: 1, label: 'Principal', endereco: 'Rua A, 10 - Centro - Sao Paulo / SP', endereco_completo: 'Rua A, 10 - Centro - Sao Paulo / SP', cep: '01001000', rua: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Sao Paulo', uf: 'SP', is_primary: true, ativo: true },
      { id: 'addr-2', customer_id: 2, label: 'Principal', endereco: 'Rua B, 20 - Centro - Sao Paulo / SP', endereco_completo: 'Rua B, 20 - Centro - Sao Paulo / SP', cep: '02002000', rua: 'Rua B', numero: '20', bairro: 'Centro', cidade: 'Sao Paulo', uf: 'SP', is_primary: true, ativo: true },
      { id: 'addr-3', customer_id: 3, label: 'Principal', endereco: 'Rua B, 30 - Centro - Sao Paulo / SP', endereco_completo: 'Rua B, 30 - Centro - Sao Paulo / SP', cep: '03003000', rua: 'Rua B', numero: '30', bairro: 'Centro', cidade: 'Sao Paulo', uf: 'SP', is_primary: true, ativo: true }
    ],
    customer_contacts: [],
    customer_aliases: [],
    storage_uploads: [],
    checklists: [
      { id: 50, date: '2026-05-14', motorista: 'Joao', origem: 'admin' },
      { id: 51, date: '2026-05-15', motorista: 'Maria', origem: 'portal_tecnico' }
    ],
    technician_events: [],
    technician_messages: [{ id: 70, date: '2026-05-14', tecnico: 'Joao', mensagem: 'Recado', lido: false }],
    activity_logs: []
    ,app_users: [{ id: 1, auth_user_id: 'auth-admin-1', email: 'letechigienizacaoosp@gmail.com', name: 'Admin Teste', role: 'admin', active: true }]
    ,app_user_sessions: []
  };
}

function makeBuilder(state, table) {
  const builder = {
    _op: 'select',
    _payload: null,
    _filters: [],
    _in: [],
    _limit: null,
    _range: null,
    _count: false,
    select(_cols, options = {}) { builder._count = options.count === 'exact'; return builder; },
    order(key) { builder._order = key; return builder; },
    limit(n) { builder._limit = n; return builder; },
    range(from, to) { builder._range = [from, to]; return builder; },
    eq(key, value) { builder._filters.push({ key, value }); return builder; },
    in(key, values) { builder._in.push({ key, values: values.map(String) }); return builder; },
    or(expr) { builder._or = String(expr); return builder; },
    insert(payload) {
      builder._op = 'insert';
      const rows = Array.isArray(payload) ? payload : [payload];
      builder._pendingInsert = rows;
      return builder;
    },
    update(payload) { builder._op = 'update'; builder._payload = payload; return builder; },
    delete() { builder._op = 'delete'; return builder; },
    then(resolve) { return builder._execute().then(resolve); },
    async _execute() {
      if (builder._op === 'insert') {
        const missingColumns = state.__missingColumns?.[table] || new Set();
        const missingColumn = Object.keys(builder._pendingInsert?.[0] || {}).find(key => missingColumns.has(key));
        if (missingColumn) {
          return {
            data: null,
            error: {
              code: 'PGRST204',
              message: `Could not find the '${missingColumn}' column of '${table}' in the schema cache`
            }
          };
        }
        builder._inserted = (builder._pendingInsert || []).map((row, index) => ({ id: row.id || state[table].length + index + 1, ...row }));
        state[table].push(...builder._inserted);
        return { data: builder._inserted, error: null };
      }
      let rows = builder._rows();
      if (builder._op === 'update') {
        const missingColumns = state.__missingColumns?.[table] || new Set();
        const missingColumn = Object.keys(builder._payload || {}).find(key => missingColumns.has(key));
        if (missingColumn) {
          return {
            data: null,
            error: {
              code: 'PGRST204',
              message: `Could not find the '${missingColumn}' column of '${table}' in the schema cache`
            }
          };
        }
        rows.forEach(row => Object.assign(row, builder._payload));
        return { data: rows, error: null };
      }
      if (builder._op === 'delete') {
        state[table] = state[table].filter(row => !rows.includes(row));
        return { data: rows, error: null };
      }
      const count = rows.length;
      if (builder._order) rows.sort((a, b) => String(a[builder._order] || '').localeCompare(String(b[builder._order] || '')));
      if (builder._range) rows = rows.slice(builder._range[0], builder._range[1] + 1);
      if (builder._limit != null) rows = rows.slice(0, builder._limit);
      return { data: rows, error: null, count: builder._count ? count : null };
    },
    _rows() {
      let rows = [...state[table]];
      for (const filter of builder._filters) rows = rows.filter(row => String(row[filter.key]) === String(filter.value));
      for (const filter of builder._in) rows = rows.filter(row => filter.values.includes(String(row[filter.key])));
      if (builder._or) {
        const terms = builder._or.split(',').map(part => {
          return part.match(/^([^.]+)\.ilike\.%(.+)%$/)
            || part.match(/^([^.]+)\.eq\.(.+)$/);
        }).filter(Boolean);
        rows = rows.filter(row => terms.some(match => {
          const [, key, value] = match;
          if (match[0].includes('.ilike.')) return String(row[key] || '').toLowerCase().includes(value.toLowerCase());
          return String(row[key]) === String(value);
        }));
      }
      return rows;
    }
  };
  return builder;
}

function makeDb(state) {
  return {
    auth: {
      async getUser(token) {
        if (token !== 'test-admin-jwt') return { data: { user: null }, error: { message: 'invalid token' } };
        return { data: { user: { id: 'auth-admin-1', email: 'letechigienizacaoosp@gmail.com' } }, error: null };
      },
      async resetPasswordForEmail(email) {
        state.auth_recovery_requests = state.auth_recovery_requests || [];
        state.auth_recovery_requests.push(email);
        return { data: {}, error: state.__authRecoveryError || null };
      },
      async signInWithOtp({ email }) {
        state.auth_magic_link_requests = state.auth_magic_link_requests || [];
        state.auth_magic_link_requests.push(email);
        return { data: {}, error: null };
      }
    },
    async rpc(name, params) {
      assert.equal(name, 'transition_service_reschedule');
      const original = state.services.find(service => String(service.id) === String(params.p_service_id));
      if (!original) return { data:null, error:{ message:'Servico nao encontrado' } };
      const existing = state.services.find(service => String(service.rescheduled_from_id) === String(original.id));
      if (existing) return { data:{ service:original, new_service:existing, idempotent:true }, error:null };
      Object.assign(original, { status:'reagendado', exec_status:'reagendado', status_reason:params.p_reason });
      const created = {
        ...original, id:params.p_new_id, date:params.p_new_date, data:params.p_new_date,
        horario:params.p_new_time, status:'agendado', exec_status:'agendado', status_reason:null,
        rescheduled_from_id:original.id, chegada_hora:null, inicio_hora:null, fim_hora:null,
        completion_source:null
      };
      state.services.push(created);
      return { data:{ service:original, new_service:created, idempotent:false }, error:null };
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, buffer, options = {}) {
            state.storage_uploads.push({ bucket, path, size: buffer.length, contentType: options.contentType });
            return { data: { path }, error: null };
          },
          async createSignedUrl(path, expiresIn) {
            return { data: { signedUrl: `https://signed.example/${bucket}/${path}?expires=${expiresIn}` }, error: null };
          }
        };
      }
    },
    from(table) {
      assert.ok(state[table], `unexpected table ${table}`);
      return makeBuilder(state, table);
    }
  };
}

async function withServer(fn) {
  const state = makeState();
  app.locals.supabase = makeDb(state);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`, state);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function requiredAddress(overrides = {}) {
  return {
    endereco: 'Rua Teste, 10',
    endereco_completo: 'Rua Teste, 10 - Centro - Sao Paulo / SP',
    cep: '01001000',
    rua: 'Rua Teste',
    numero: '10',
    bairro: 'Centro',
    cidade: 'Sao Paulo',
    uf: 'SP',
    ...overrides
  };
}

test('GET /api/app-auth/me autoriza Supabase Auth somente com app_users ativo', async () => {
  await withServer(async (baseUrl, state) => {
    const allowed = await fetch(`${baseUrl}/api/app-auth/me`, { headers: await adminHeaders(baseUrl) });
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).auth_type, 'supabase_auth');

    state.app_users[0].active = false;
    const denied = await fetch(`${baseUrl}/api/app-auth/me`, { headers: await adminHeaders(baseUrl) });
    assert.equal(denied.status, 401);
  });
});

test('POST /api/app-auth/recovery responde de forma neutra mesmo se provedor falhar', async () => {
  await withServer(async (baseUrl, state) => {
    state.__authRecoveryError = { message: 'email rate limit exceeded' };
    const response = await fetch(`${baseUrl}/api/app-auth/recovery`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alguem@example.com' })
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).ok, true);
    assert.deepEqual(state.auth_recovery_requests, ['alguem@example.com']);
  });
});

test('GET /api/customers suporta autocomplete limitado e paginação com total', async () => {
  await withServer(async (baseUrl) => {
    const auto = await fetch(`${baseUrl}/api/customers?search=Beta&limit=10`);
    assert.equal(auto.status, 200);
    const autoPayload = await auto.json();
    assert.equal(Array.isArray(autoPayload), true);
    assert.equal(autoPayload.length, 2);
    assert.equal(autoPayload.every(customer => customer.scheduling_eligible === true), true);
    assert.equal(autoPayload.every(customer => Array.isArray(customer.scheduling_blockers)), true);

    const paged = await fetch(`${baseUrl}/api/customers?page=1&limit=2`);
    assert.equal(paged.status, 200);
    const payload = await paged.json();
    assert.equal(payload.items.length, 2);
    assert.equal(payload.total, 3);
    assert.equal(payload.limit, 2);

    const exact = await fetch(`${baseUrl}/api/customers/1`);
    assert.equal(exact.status, 200);
    const exactPayload = await exact.json();
    assert.equal(exactPayload.scheduling_eligible, true);
    assert.equal(exactPayload.scheduling_address_id, 'addr-1');
  });
});

test('clientes normalizam prioridade e status operacionais legados', async () => {
  await withServer(async (baseUrl, state) => {
    state.customers.push({
      id: 4,
      nome: 'Legacy Cliente',
      nome_normalizado: 'LEGACY CLIENTE',
      telefone: '554444444444',
      ativo: true,
      prioridade: 'Media',
      status_operacional: 'Eventual recente'
    });

    const list = await fetch(`${baseUrl}/api/customers?search=Legacy&limit=10`);
    assert.equal(list.status, 200);
    const rows = await list.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].prioridade, 'Média');
    assert.equal(rows[0].status_operacional, 'Eventual');

    const filtered = await fetch(`${baseUrl}/api/customers?status_operacional=Eventual&prioridade=Média&include_inactive=true&limit=10`);
    assert.equal(filtered.status, 200);
    const filteredRows = await filtered.json();
    assert.ok(filteredRows.some(customer => customer.nome === 'Legacy Cliente'));

    const created = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Gamma Cliente',
        telefone: '555555555555',
        categoria: 'eventual',
        prioridade: 'Media',
        status_operacional: 'Eventual antigo',
        ...requiredAddress()
      })
    });
    assert.equal(created.status, 201);
    const createdPayload = await created.json();
    assert.equal(createdPayload.prioridade, 'Média');
    assert.equal(createdPayload.status_operacional, 'Eventual');

    const updated = await fetch(`${baseUrl}/api/customers/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Alpha Cliente',
        telefone: '551111111111',
        categoria: 'eventual',
        prioridade: 'media',
        status_operacional: 'Cancelado',
        ...requiredAddress({ endereco: 'Rua A', rua: 'Rua A' })
      })
    });
    assert.equal(updated.status, 200);
    const updatedPayload = await updated.json();
    assert.equal(updatedPayload.prioridade, 'Média');
    assert.equal(updatedPayload.status_operacional, 'Inativo');
    assert.equal(updatedPayload.ativo, false);
  });
});

test('DELETE /api/customers/:id inativa cliente sem apagar histórico', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/customers/1`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.customer.id, 1);
    assert.equal(payload.customer.ativo, false);
    assert.equal(payload.customer.status_operacional, 'Inativo');
    assert.equal(state.customers.find(customer => customer.id === 1).ativo, false);
    assert.equal(state.services.length, 1);

    const activeList = await fetch(`${baseUrl}/api/customers?limit=10`);
    const activeRows = await activeList.json();
    assert.equal(activeRows.some(customer => customer.id === 1), false);

    const inactiveList = await fetch(`${baseUrl}/api/customers?status_operacional=Inativo&include_inactive=true&limit=10`);
    const inactiveRows = await inactiveList.json();
    assert.equal(inactiveRows.some(customer => customer.id === 1), true);
  });
});

test('GET /api/customers esconde status inativo mesmo em cadastro legado ativo', async () => {
  await withServer(async (baseUrl, state) => {
    state.customers.push({
      id: 99,
      nome: 'Cliente Inativo Legado',
      nome_normalizado: 'CLIENTE INATIVO LEGADO',
      telefone: '559999999999',
      ativo: true,
      status_operacional: 'Inativo'
    });

    const activeList = await fetch(`${baseUrl}/api/customers?limit=500`);
    assert.equal(activeList.status, 200);
    const activeRows = await activeList.json();
    assert.equal(activeRows.some(customer => customer.id === 99), false);

    const inactiveList = await fetch(`${baseUrl}/api/customers?status_operacional=Inativo&include_inactive=true&limit=500`);
    assert.equal(inactiveList.status, 200);
    const inactiveRows = await inactiveList.json();
    assert.equal(inactiveRows.some(customer => customer.id === 99), true);
  });
});

test('POST /api/customers/:id/hard-delete apaga cadastro sem historico e limpa auxiliares', async () => {
  await withServer(async (baseUrl, state) => {
    state.customers.push({ id: 77, nome: 'Cliente Erro Cadastro', nome_normalizado: 'CLIENTE ERRO CADASTRO', ativo: true });
    state.customer_addresses.push({ id: 770, customer_id: 77, endereco: 'Rua Errada' });
    state.customer_aliases.push({ id: 771, customer_id: 77, alias: 'Erro' });
    state.contracts.push({ id: 772, customer_id: 77, tipo_servico: 'Rascunho' });
    state.data_reviews.push({ id: 773, customer_id: 77, tipo_problema: 'erro_importacao' });
    state.customer_reminders.push({ id: 774, customer_id: 77, mensagem: 'rascunho' });

    const headers = await adminHeaders(baseUrl);
    const preview = await fetch(`${baseUrl}/api/customers/77/hard-delete-preview`, { headers });
    assert.equal(preview.status, 200);
    const previewPayload = await preview.json();
    assert.equal(previewPayload.can_delete, true);

    const response = await fetch(`${baseUrl}/api/customers/77/hard-delete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ confirmName: 'Cliente Erro Cadastro' })
    });
    assert.equal(response.status, 200);
    assert.equal(state.customers.some(customer => customer.id === 77), false);
    assert.equal(state.customer_addresses.some(item => item.customer_id === 77), false);
    assert.equal(state.customer_aliases.some(item => item.customer_id === 77), false);
    assert.equal(state.contracts.some(item => item.customer_id === 77), false);
    assert.equal(state.data_reviews.some(item => item.customer_id === 77), false);
    assert.equal(state.customer_reminders.some(item => item.customer_id === 77), false);
  });
});

test('POST /api/customers/:id/hard-delete bloqueia cliente com historico operacional', async () => {
  await withServer(async (baseUrl) => {
    const headers = await adminHeaders(baseUrl);
    const response = await fetch(`${baseUrl}/api/customers/2/hard-delete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ confirmName: 'Beta Cliente' })
    });
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.code, 'customer_hard_delete_blocked');
    assert.equal(payload.impact.can_delete, false);
    assert.ok(payload.impact.blocking.some(item => item.count > 0));
  });
});

test('POST /api/customers cria cliente basico mesmo sem colunas opcionais legadas', async () => {
  await withServer(async (baseUrl, state) => {
    state.__missingColumns = {
      customers: new Set(['cep', 'endereco_completo', 'rua', 'numero', 'bairro', 'cidade', 'uf', 'origem', 'observacoes'])
    };

    const response = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Cliente Schema Legado',
        telefone: '(11) 98888-1111',
        origem: 'teste',
        ...requiredAddress({
          endereco: 'Rua Schema, 10',
          endereco_completo: 'Rua Schema, 10 - Centro - Sao Paulo / SP',
          rua: 'Rua Schema'
        })
      })
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.nome, 'Cliente Schema Legado');
    assert.equal(payload.cep, undefined);
    assert.equal(payload.origem, undefined);
    assert.ok(state.customers.some(customer => customer.nome === 'Cliente Schema Legado'));
  });
});

test('POST /api/customers aceita telefone valido mesmo com WhatsApp invalido preenchido', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Cliente Telefone Valido',
        telefone: '(11) 98888-2222',
        whatsapp: 'sem numero',
        ...requiredAddress({
          endereco: 'Rua Telefone, 22',
          endereco_completo: 'Rua Telefone, 22 - Centro - Sao Paulo / SP',
          rua: 'Rua Telefone',
          numero: '22'
        })
      })
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.nome, 'Cliente Telefone Valido');
    assert.equal(state.customers.some(customer => customer.nome === 'Cliente Telefone Valido'), true);
  });
});

test('POST /api/customers continua rejeitando cadastro sem telefone ou WhatsApp valido', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Cliente Sem Contato Valido',
        telefone: '123',
        whatsapp: '456',
        ...requiredAddress({ endereco: 'Rua Sem Contato, 30', rua: 'Rua Sem Contato', numero: '30' })
      })
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.code, 'client_contact_required');
  });
});

test('POST /api/customers/quick cria cliente incompleto sem endereco obrigatorio', async () => {
  await withServer(async (baseUrl, state) => {
    const addressCount = state.customer_addresses.length;
    const response = await fetch(`${baseUrl}/api/customers/quick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Cliente Rapido',
        whatsapp: '(11) 98888-7777',
        categoria_principal: 'Comercial',
        vendedor_responsavel: 'Ana',
        origem: 'prospeccao'
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.nome, 'Cliente Rapido');
    assert.equal(payload.is_incomplete, true);
    assert.equal(state.customers.some(customer => customer.nome === 'Cliente Rapido'), true);
    assert.equal(state.customer_addresses.some(address => address.customer_id === payload.id), false);
    assert.equal(state.customer_addresses.length, addressCount);

    const listed = await fetch(`${baseUrl}/api/customers?search=Cliente%20Rapido&limit=10`);
    const customers = await listed.json();
    assert.equal(customers[0].scheduling_eligible, false);
    assert.equal(customers[0].is_incomplete, true);
    assert.ok(customers[0].scheduling_blockers.includes('service_customer_address_required'));
  });
});

test('GET e PUT /api/customers/:id/contacts salvam multiplos contatos', async () => {
  await withServer(async (baseUrl, state) => {
    const saved = await fetch(`${baseUrl}/api/customers/1/contacts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contacts: [
          { nome: 'Maria Sindica', funcao: 'Síndico', whatsapp: '(11) 99999-0000', recebe_lembrete: true, is_primary: true },
          { nome: 'Joao Financeiro', funcao: 'Financeiro', email: 'financeiro@example.com', recebe_cobranca: true }
        ]
      })
    });
    const savedPayload = await saved.json();
    assert.equal(saved.status, 200);
    assert.equal(savedPayload.length, 2);
    assert.equal(savedPayload[0].is_primary, true);
    assert.equal(state.customer_contacts.filter(contact => contact.customer_id === 1 && contact.ativo !== false).length, 2);

    const listed = await fetch(`${baseUrl}/api/customers/1/contacts`);
    const listPayload = await listed.json();
    assert.equal(listed.status, 200);
    assert.equal(listPayload.length, 2);
    assert.equal(listPayload.some(contact => contact.recebe_cobranca === true), true);
  });
});

test('DELETE /api/technicians/:id remove tecnico freelancer', async () => {
  await withServer(async (baseUrl, state) => {
    state.technicians.push({ id: 'free-1', nome: 'Freelancer', ativo: false });
    const response = await fetch(`${baseUrl}/api/technicians/free-1`, { method: 'DELETE' });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.technician.id, 'free-1');
    assert.equal(state.technicians.some(item => item.id === 'free-1'), false);

    const missing = await fetch(`${baseUrl}/api/technicians/free-1`, { method: 'DELETE' });
    assert.equal(missing.status, 404);
  });
});

test('POST /api/customers bloqueia duplicidade por WhatsApp e CPF/CNPJ', async () => {
  await withServer(async (baseUrl, state) => {
    state.customers[0].whatsapp = '11988887777';
    state.customers[0].cpf_cnpj = '12345678000199';

    const byWhatsapp = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Outro Cliente Whatsapp',
        telefone: '551177776666',
        whatsapp: '(11) 98888-7777',
        ...requiredAddress()
      })
    });
    assert.equal(byWhatsapp.status, 409);
    const byWhatsappPayload = await byWhatsapp.json();
    assert.equal(byWhatsappPayload.code, 'possible_duplicate');

    const byCpf = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Outro Cliente Documento',
        telefone: '551166665555',
        cpf_cnpj: '12.345.678/0001-99',
        ...requiredAddress({ numero: '11' })
      })
    });
    assert.equal(byCpf.status, 409);
    const byCpfPayload = await byCpf.json();
    assert.equal(byCpfPayload.code, 'possible_duplicate');
  });
});

test('PUT /api/customers/:id/contracts aceita campos novos com fallback de schema', async () => {
  await withServer(async (baseUrl, state) => {
    state.__missingColumns = {
      contracts: new Set(['local_atendido', 'data_ultimo_atendimento', 'data_proximo_atendimento', 'numero_proposta', 'vigencia_inicial', 'vigencia_final', 'tecnico_preferencial', 'tempo_estimado', 'observacao_servico'])
    };
    const response = await fetch(`${baseUrl}/api/customers/1/contracts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contracts: [{
          tipo_servico: 'DS',
          periodicidade: 'mensal',
          status_contrato: 'Ativo',
          local_atendido: 'Principal',
          data_ultimo_atendimento: '2026-07-01',
          data_proximo_atendimento: '2026-08-01',
          numero_proposta: 'PROP-1',
          vigencia_inicial: '2026-01-01',
          vigencia_final: '2026-12-31',
          tecnico_preferencial: 'Joao',
          tempo_estimado: '90min',
          observacao_servico: 'Usar gel'
        }]
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.length, 1);
    assert.equal(payload[0].tipo_servico, 'DS');
    assert.equal(payload[0].local_atendido, undefined);
    assert.equal(state.contracts.filter(contract => contract.customer_id === 1).length, 1);
  });
});

test('PUT /api/services/:id exige endpoint de transicao para encerramento administrativo', async () => {
  await withServer(async (baseUrl, state) => {
    state.services[0].tipos = ['DS'];
    state.services[0].tecnicos_ids = ['tec-1'];
    state.services[0].status = 'agendado';

    const response = await fetch(`${baseUrl}/api/services/10`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cliente_id: 1,
        cliente: 'Alpha Cliente',
        tipos: ['DS', 'DR'],
        tecnicos_ids: ['tec-2'],
        status: 'executado',
        exec_status: 'finalizado'
      })
    });

    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.code, 'service_transition_required');
    assert.equal(state.services[0].status, 'agendado');
  });
});

test('PUT /api/services/:id retorna service_not_found quando agenda nao existe no banco', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/services/999999`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente: 'Servico Inexistente' })
    });

    assert.equal(response.status, 404);
    const payload = await response.json();
    assert.equal(payload.code, 'service_not_found');
  });
});

test('PUT /api/services/:id nao remove vinculo e bloqueia edicao administrativa legada', async () => {
  await withServer(async (baseUrl, state) => {
    const unlink = await fetch(`${baseUrl}/api/services/10`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id: null })
    });
    assert.equal(unlink.status, 422);
    assert.equal((await unlink.json()).code, 'service_customer_required');
    assert.equal(state.services[0].cliente_id, 2);

    state.services.push({ id: 19, cliente: 'Legado sem vinculo', status: 'agendado', exec_status: 'agendado' });
    const legacyEdit = await fetch(`${baseUrl}/api/services/19`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ observacoes: 'Tentativa administrativa' })
    });
    assert.equal(legacyEdit.status, 422);
    assert.equal((await legacyEdit.json()).code, 'service_customer_required');
    assert.equal(state.services.find(service => service.id === 19).observacoes, undefined);
  });
});

test('PUT /api/services/:id bloqueia outro atendimento ativo do mesmo tecnico', async () => {
  await withServer(async (baseUrl, state) => {
    state.services = [
      {
        id: 10,
        cliente_id: 1,
        customer_address_id: 'addr-1',
        date: '2026-05-25',
        cliente: 'Cliente Ativo',
        horario: '10:30',
        os: '3543',
        equipe: 'Lucas Eduardo',
        tecnicos_ids: ['tec-1'],
        exec_status: 'cheguei'
      },
      {
        id: 11,
        cliente_id: 1,
        customer_address_id: 'addr-1',
        date: '2026-05-25',
        cliente: 'Outro Cliente',
        horario: '',
        equipe: 'Lucas Eduardo',
        tecnicos_ids: ['tec-1'],
        exec_status: 'agendado'
      }
    ];

    const response = await fetch(`${baseUrl}/api/services/11`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exec_status: 'em_deslocamento' })
    });

    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.code, 'active_service_conflict');
    assert.equal(payload.active_service_id, 10);
    assert.equal(state.services.find(service => service.id === 11).exec_status, 'agendado');
  });
});

test('PUT /api/services/:id permite avancar o proprio atendimento ativo', async () => {
  await withServer(async (baseUrl, state) => {
    state.services = [
      {
        id: 10,
        cliente_id: 1,
        customer_address_id: 'addr-1',
        date: '2026-05-25',
        cliente: 'Cliente Ativo',
        equipe: 'Lucas Eduardo',
        tecnicos_ids: ['tec-1'],
        exec_status: 'cheguei'
      }
    ];

    const response = await fetch(`${baseUrl}/api/services/10`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exec_status: 'em_execucao', inicio_hora: '2026-05-25T13:30:00.000Z' })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.exec_status, 'em_execucao');
    assert.equal(state.services[0].inicio_hora, '2026-05-25T13:30:00.000Z');
  });
});

test('PUT /api/services/:id ignora atualizacao operacional atrasada que voltaria status', async () => {
  await withServer(async (baseUrl, state) => {
    state.services = [
      {
        id: 10,
        cliente_id: 1,
        customer_address_id: 'addr-1',
        date: '2026-05-25',
        cliente: 'Cliente Ativo',
        equipe: 'Lucas Eduardo',
        tecnicos_ids: ['tec-1'],
        exec_status: 'cheguei',
        chegada_hora: '2026-05-25T13:20:00.000Z'
      }
    ];

    const response = await fetch(`${baseUrl}/api/services/10`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exec_status: 'em_deslocamento' })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.exec_status, 'cheguei');
    assert.equal(payload.stale_exec_status_ignored, true);
    assert.equal(state.services[0].exec_status, 'cheguei');
  });
});

test('PUT /api/services/:id libera novo atendimento quando anterior esta finalizado ou problema', async () => {
  await withServer(async (baseUrl, state) => {
    state.services = [
      {
        id: 10,
        cliente_id: 1,
        customer_address_id: 'addr-1',
        date: '2026-05-25',
        cliente: 'Cliente Finalizado',
        equipe: 'Lucas Eduardo',
        tecnicos_ids: ['tec-1'],
        exec_status: 'finalizado'
      },
      {
        id: 11,
        cliente_id: 1,
        customer_address_id: 'addr-1',
        date: '2026-05-25',
        cliente: 'Cliente Problema',
        equipe: 'Lucas Eduardo',
        tecnicos_ids: ['tec-1'],
        exec_status: 'problema'
      },
      {
        id: 12,
        cliente_id: 1,
        customer_address_id: 'addr-1',
        date: '2026-05-25',
        cliente: 'Proximo Cliente',
        equipe: 'Lucas Eduardo',
        tecnicos_ids: ['tec-1'],
        exec_status: 'agendado'
      }
    ];

    const response = await fetch(`${baseUrl}/api/services/12`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exec_status: 'em_deslocamento' })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.exec_status, 'em_deslocamento');
  });
});

test('PUT /api/services/:id ignora execucao ativa legada quando status administrativo e terminal', async () => {
  await withServer(async (baseUrl, state) => {
    state.services = [
      { id:10, cliente_id:1, customer_address_id:'addr-1', date:'2026-05-25', status:'executado', exec_status:'em_deslocamento', tecnicos_ids:['tec-1'] },
      { id:11, cliente_id:1, customer_address_id:'addr-1', date:'2026-05-25', status:'agendado', exec_status:'agendado', tecnicos_ids:['tec-1'] }
    ];
    const response = await fetch(`${baseUrl}/api/services/11`, {
      method:'PUT', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ exec_status:'em_deslocamento' })
    });
    assert.equal(response.status, 200);
    assert.equal(state.services[1].exec_status, 'em_deslocamento');
  });
});

test('POST /api/services/:id/transition conclui manualmente com motivo e origem', async () => {
  await withServer(async (baseUrl, state) => {
    state.services = [{ id:10, date:'2026-07-23', status:'agendado', exec_status:'em_execucao' }];
    const response = await fetch(`${baseUrl}/api/services/10/transition`, {
      method:'POST', headers:await adminHeaders(baseUrl),
      body:JSON.stringify({ action:'complete_manual', reason:'Tecnico sem acesso ao portal' })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.service.status, 'executado');
    assert.equal(payload.service.exec_status, 'finalizado');
    assert.equal(payload.service.completion_source, 'admin_manual');
    assert.equal(payload.service.fim_hora, undefined);
  });
});

test('POST /api/services/:id/transition mantem problema pendente ate resolucao com ressalva', async () => {
  await withServer(async (baseUrl, state) => {
    state.services = [{ id:10, date:'2026-07-23', status:'agendado', exec_status:'problema', problema_descricao:'Cliente ausente' }];
    const response = await fetch(`${baseUrl}/api/services/10/transition`, {
      method:'POST', headers:await adminHeaders(baseUrl),
      body:JSON.stringify({ action:'resolve_problem_complete', reason:'Visita realizada parcialmente' })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.service.status, 'executado');
    assert.equal(payload.service.exec_status, 'problema');
    assert.equal(payload.service.completion_source, 'admin_problem_resolution');
  });
});

test('POST /api/services/:id/transition cancela fluxo ativo e exige motivo', async () => {
  await withServer(async (baseUrl, state) => {
    state.services = [{ id:10, date:'2026-07-23', status:'agendado', exec_status:'em_deslocamento' }];
    const headers = await adminHeaders(baseUrl);
    const invalid = await fetch(`${baseUrl}/api/services/10/transition`, { method:'POST', headers, body:JSON.stringify({ action:'cancel', reason:'' }) });
    assert.equal(invalid.status, 400);
    const response = await fetch(`${baseUrl}/api/services/10/transition`, { method:'POST', headers, body:JSON.stringify({ action:'cancel', reason:'Cancelado pelo cliente' }) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.service.status, 'cancelado');
    assert.equal(payload.service.exec_status, 'cancelado');
  });
});

test('POST /api/services/:id/transition reagenda criando uma unica visita vinculada', async () => {
  await withServer(async (baseUrl, state) => {
    state.services = [{ id:10, cliente_id:1, customer_address_id:'addr-1', date:'2026-07-23', data:'2026-07-23', horario:'10:00', cliente:'Alpha', status:'agendado', exec_status:'problema' }];
    const headers = await adminHeaders(baseUrl);
    const body = JSON.stringify({ action:'reschedule', reason:'Cliente solicitou nova data', new_date:'2026-07-30', new_time:'14:30' });
    const first = await fetch(`${baseUrl}/api/services/10/transition`, { method:'POST', headers, body });
    assert.equal(first.status, 200);
    const created = await first.json();
    assert.equal(created.service.status, 'reagendado');
    assert.equal(created.new_service.status, 'agendado');
    assert.equal(created.new_service.rescheduled_from_id, 10);
    const second = await fetch(`${baseUrl}/api/services/10/transition`, { method:'POST', headers, body });
    assert.equal(second.status, 200);
    const repeated = await second.json();
    assert.equal(repeated.idempotent, true);
    assert.equal(state.services.filter(service => String(service.rescheduled_from_id) === '10').length, 1);
  });
});

test('PUT /api/customers/:id/addresses ignora colunas opcionais ausentes em schema legado', async () => {
  await withServer(async (baseUrl, state) => {
    state.__missingColumns = {
      customer_addresses: new Set(['updated_at', 'endereco_completo', 'cep', 'rua', 'numero'])
    };

    const response = await fetch(`${baseUrl}/api/customers/1/addresses`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        addresses: [{
          label: 'Principal',
          endereco: 'Rua Legado, 10',
          endereco_completo: 'Rua Legado, 10',
          cep: '01001000',
          rua: 'Rua Legado',
          numero: '10',
          bairro: 'Centro',
          cidade: 'Sao Paulo',
          uf: 'SP',
          is_primary: true
        }]
      })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.length, 1);
    assert.equal(payload[0].customer_id, 1);
    assert.equal(payload[0].endereco, 'Rua Legado, 10');
    assert.equal(payload[0].endereco_completo, 'Rua Legado, 10');
    assert.equal(payload[0].cep, null);
  });
});

test('PUT /api/services/:id falha explicitamente sem customer_address_id no schema', async () => {
  await withServer(async (baseUrl, state) => {
    state.__missingColumns = {
      services: new Set(['date', 'data', 'exec_status', 'customer_address_id', 'tecnicos_ids'])
    };

    const response = await fetch(`${baseUrl}/api/services/10`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: '2026-05-20',
        data: '2026-05-20',
        cliente_id: 1,
        status: 'agendado',
        customer_address_id: 'addr-1',
        tecnicos_ids: ['tec-2']
      })
    });

    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.equal(payload.code, 'PGRST204');
    assert.match(payload.message, /customer_address_id/);
    assert.equal(state.services[0].customer_address_id, 'addr-2');
  });
});

test('DELETE /api/services/:id exclui serviço e retorna registro removido', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/services/10`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.service.id, 10);
    assert.equal(state.services.some(service => service.id === 10), false);
  });
});

test('POST e GET /api/checklists criam e filtram por data', async () => {
  await withServer(async (baseUrl, state) => {
    const created = await fetch(`${baseUrl}/api/checklists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 99, date: '2026-05-14', motorista: 'Joao', vei: 'Palio', origem: 'portal_tecnico' })
    });
    assert.equal(created.status, 201);
    const payload = await created.json();
    assert.equal(payload.origem, 'portal_tecnico');
    assert.equal(state.checklists.some(item => item.id === 99), true);

    const list = await fetch(`${baseUrl}/api/checklists?date=2026-05-14`);
    assert.equal(list.status, 200);
    const rows = await list.json();
    assert.equal(rows.every(item => item.date === '2026-05-14'), true);
  });
});

test('POST /api/checklists salva metadados do checklist digital', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/checklists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 100,
        date: '2026-05-14',
        tipo: 'diario',
        equipe: 'Equipe A',
        motorista: 'Joao',
        assistente: 'Maria',
        vei: 'Fox',
        status: 'problema',
        fotos_saida: [{ categoria: 'frente', bucket: 'checklist-photos', path: 'checklists/2026-05-14/fox/100/frente.jpg', content_type: 'image/jpeg' }],
        ocorrencias: [{ tipo: 'veiculo_equipamento', descricao: 'Arranhao registrado', foto: { bucket: 'checklist-photos', path: 'checklists/2026-05-14/fox/100/ocorrencia.jpg' } }],
        itens: {
          saida: [
            { etapa: 'saida', categoria: 'DS - Desinsetizacao', item: 'Balde', presente: true },
            { etapa: 'saida', categoria: 'DS - Desinsetizacao', item: 'Cx de gel', presente: false }
          ],
          retorno: [],
          conferidos: ['Balde'],
          faltantes: ['Cx de gel']
        },
        equip: { conferidos: ['EPIs'] },
        origem: 'portal_tecnico'
      })
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.equipe, 'Equipe A');
    assert.equal(payload.status, 'problema');
    assert.equal(payload.fotos_saida[0].path.includes('base64'), false);
    assert.equal(payload.ocorrencias[0].foto.path.endsWith('ocorrencia.jpg'), true);
    assert.deepEqual(payload.itens.faltantes, ['Cx de gel']);
    assert.equal(payload.itens.saida[1].presente, false);
    assert.equal(state.checklists.some(item => item.id === 100 && item.fotos_saida.length === 1), true);
  });
});

test('POST /api/checklists bloqueia segunda saida da mesma equipe e veiculo no dia', async () => {
  await withServer(async (baseUrl, state) => {
    state.checklists.push({ id: 110, date: '2026-05-14', equipe: 'Equipe A', motorista: 'Joao', vei: 'Fox', status: 'saida_aberta', origem: 'portal_tecnico' });
    const response = await fetch(`${baseUrl}/api/checklists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 111, date: '2026-05-14', equipe: 'Equipe A', motorista: 'Joao', vei: 'Fox', origem: 'portal_tecnico' })
    });

    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.code, 'daily_checklist_exists');
    assert.equal(payload.checklist_id, 110);
  });
});

test('POST /api/checklists/photos envia foto para Storage e retorna path', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/checklists/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checklist_id: 101,
        date: '2026-05-14',
        veiculo: 'Fox',
        categoria: 'frente',
        etapa: 'saida',
        filename: 'frente.jpg',
        content_type: 'image/jpeg',
        data_url: `data:image/jpeg;base64,${Buffer.from('fake image').toString('base64')}`
      })
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.bucket, 'checklist-photos');
    assert.equal(payload.path.startsWith('checklists/2026-05-14/fox/101/'), true);
    assert.equal(payload.path.includes('base64'), false);
    assert.equal(state.storage_uploads.length, 1);
    assert.equal(state.storage_uploads[0].bucket, 'checklist-photos');
    assert.equal(state.storage_uploads[0].contentType, 'image/jpeg');
  });
});

test('PUT /api/checklists/:id atualiza retorno do checklist do dia', async () => {
  await withServer(async (baseUrl, state) => {
    state.checklists.push({ id: 120, date: '2026-05-14', motorista: 'Joao', vei: 'Fox', kms: 1000, hrs: '08:00', status: 'saida_aberta' });
    const response = await fetch(`${baseUrl}/api/checklists/120`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kmc: 1080, hrc: '17:30', status: 'completo', ocorrencias: [] })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.kmc, 1080);
    assert.equal(payload.kmd, 80);
    assert.equal(payload.hrc, '17:30');
    assert.equal(payload.status, 'completo');
  });
});

test('POST /api/checklists/photos/signed-url retorna link temporario autenticado', async () => {
  await withServer(async (baseUrl) => {
    const headers = await adminHeaders(baseUrl);
    const response = await fetch(`${baseUrl}/api/checklists/photos/signed-url`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ bucket: 'checklist-photos', path: 'checklists/2026-05-14/fox/101/frente.jpg' })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.expires_in, 600);
    assert.equal(payload.url.includes('checklists/2026-05-14/fox/101/frente.jpg'), true);
  });
});

test('POST /api/checklists/photos/signed-url exige autenticacao', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/checklists/photos/signed-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket: 'checklist-photos', path: 'checklists/2026-05-14/fox/101/frente.jpg' })
    });

    assert.equal(response.status, 401);
  });
});

test('DELETE /api/checklists/:id remove checklist', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/checklists/50`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.checklist.id, 50);
    assert.equal(state.checklists.some(item => item.id === 50), false);
  });
});

test('POST /api/technician-events salva evento do portal', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/technician-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 88, date: '2026-05-14', tecnico: 'Joao', tipo: 'chegada', titulo: 'Chegada registrada' })
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.tipo, 'chegada');
    assert.equal(state.technician_events.some(item => item.id === 88), true);
  });
});

test('POST /api/technician-events evita duplicar evento operacional do mesmo servico', async () => {
  await withServer(async (baseUrl, state) => {
    state.technician_events.push({
      id: 88,
      date: '2026-05-27',
      tecnico: 'Andrey',
      service_id: 3323,
      tipo: 'inicio',
      titulo: 'Servico iniciado',
      detalhes: '09:00 - Cond Feel - OS 3323 / 3140 - Rua da Chibata, 61'
    });

    const response = await fetch(`${baseUrl}/api/technician-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 99,
        date: '2026-05-27',
        tecnico: 'Andrey',
        service_id: 3323,
        tipo: 'inicio',
        titulo: 'Servico iniciado',
        detalhes: '09:00 - Cond Feel - OS 3323 / 3140 - Rua da Chibata, 61'
      })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.id, 88);
    assert.equal(payload.deduplicated, true);
    assert.equal(state.technician_events.length, 1);
  });
});

test('PUT /api/technician-events/:id atualiza evento sem apagar campos existentes', async () => {
  await withServer(async (baseUrl, state) => {
    state.technician_events.push({
      id: 89,
      date: '2026-05-14',
      tecnico: 'Joao',
      tipo: 'ajuda',
      titulo: 'Pedido de ajuda',
      detalhes: 'Detalhe original',
      visto: false
    });

    const response = await fetch(`${baseUrl}/api/technician-events/89`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visto: true, status: 'visto' })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.visto, true);
    assert.equal(payload.status, 'visto');
    assert.equal(payload.titulo, 'Pedido de ajuda');
  });
});

test('PUT /api/technician-messages/:id/read marca mensagem como lida', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/technician-messages/70/read`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lido_em: '2026-05-14T10:00:00.000Z' })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.lido, true);
    assert.equal(state.technician_messages[0].lido, true);
  });
});

test('POST /api/services salva cliente_id no agendamento', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 99,
        date: '2026-05-13',
        cliente_id: 1,
        customer_address_id: 'addr-1',
        cliente: 'Nome nao confiavel',
        endereco: 'Endereco nao confiavel'
      })
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.id, 99);
    assert.equal(payload.cliente_id, 1);
    assert.equal(payload.customer_address_id, 'addr-1');
    assert.equal(payload.cliente, 'Alpha Cliente');
    assert.equal(payload.endereco, 'Rua A, 10 - Centro - Sao Paulo / SP');
    assert.equal(payload.client_name_snapshot, 'Alpha Cliente');
    assert.equal(payload.address_snapshot, 'Rua A, 10 - Centro - Sao Paulo / SP');
    assert.equal(payload.data, '2026-05-13');
  });
});

test('POST /api/services rejeita nome identico sem IDs e nao tenta vinculo automatico', async () => {
  await withServer(async (baseUrl, state) => {
    const beforeCustomers = state.customers.length;
    const beforeServices = state.services.length;
    const response = await fetch(`${baseUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 100,
        date: '2026-05-13',
        cliente: 'Alpha Cliente',
        ...requiredAddress({ endereco: 'Rua A', endereco_completo: 'Rua A, 10 - Centro - Sao Paulo / SP', rua: 'Rua A' })
      })
    });
    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.code, 'service_customer_required');
    assert.equal(state.customers.length, beforeCustomers);
    assert.equal(state.services.length, beforeServices);
  });
});

test('POST /api/services rejeita unidade pertencente a outro cliente', async () => {
  await withServer(async (baseUrl, state) => {
    const beforeCustomers = state.customers.length;
    const beforeServices = state.services.length;
    const response = await fetch(`${baseUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 102, date: '2026-05-13', cliente_id: 1, customer_address_id: 'addr-2' })
    });
    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.code, 'service_customer_address_mismatch');
    assert.equal(state.customers.length, beforeCustomers);
    assert.equal(state.services.length, beforeServices);
  });
});

test('POST /api/services nunca cria cliente automaticamente quando recebe apenas nome novo', async () => {
  await withServer(async (baseUrl, state) => {
    const customerCount = state.customers.length;
    const serviceCount = state.services.length;
    const response = await fetch(`${baseUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 101,
        date: '2026-05-13',
        cliente: 'Cliente Novo Agenda',
        ...requiredAddress({
          endereco: 'Rua Nova, 123',
          endereco_completo: 'Rua Nova, 123 - Centro - Sao Paulo / SP',
          rua: 'Rua Nova',
          numero: '123'
        })
      })
    });
    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.code, 'service_customer_required');
    assert.equal(state.customers.length, customerCount);
    assert.equal(state.services.length, serviceCount);
  });
});

test('POST /api/services rejeita cliente inativo, sem contato ou sem unidade', async () => {
  await withServer(async (baseUrl, state) => {
    state.customers[0].ativo = false;
    const inactive = await fetch(`${baseUrl}/api/services`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 110, date: '2026-05-13', cliente_id: 1, customer_address_id: 'addr-1' })
    });
    assert.equal(inactive.status, 409);
    assert.equal((await inactive.json()).code, 'service_customer_inactive');

    state.customers[0].ativo = true;
    state.customers[0].telefone = '';
    const withoutContact = await fetch(`${baseUrl}/api/services`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 111, date: '2026-05-13', cliente_id: 1, customer_address_id: 'addr-1' })
    });
    assert.equal(withoutContact.status, 422);
    assert.equal((await withoutContact.json()).code, 'service_customer_contact_required');

    state.customers[0].telefone = '551111111111';
    const withoutAddress = await fetch(`${baseUrl}/api/services`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 112, date: '2026-05-13', cliente_id: 1 })
    });
    assert.equal(withoutAddress.status, 422);
    assert.equal((await withoutAddress.json()).code, 'service_customer_address_required');
    assert.equal(state.services.some(service => [110, 111, 112].includes(service.id)), false);
  });
});

test('POST /api/services falha explicitamente se cliente_id nao existe no schema', async () => {
  await withServer(async (baseUrl, state) => {
    state.__missingColumns = { services: new Set(['cliente_id']) };
    const response = await fetch(`${baseUrl}/api/services`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 113, date: '2026-05-13', cliente_id: 1, customer_address_id: 'addr-1' })
    });
    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.equal(payload.code, 'service_create_failed');
    assert.equal(payload.details, 'Coluna ausente no schema: cliente_id');
    assert.equal(state.services.some(service => service.id === 113), false);
  });
});

test('GET /api/services/customer-link-audit classifica vínculos pendentes da agenda', async () => {
  await withServer(async (baseUrl, state) => {
    state.services.push(
      { id: 11, cliente: 'Alpha Cliente', endereco: 'Rua A', status: 'agendado' },
      { id: 12, cliente: 'Cliente Novo Agenda', endereco: 'Rua Nova', status: 'agendado' },
      { id: 13, cliente: 'Beta Cliente', endereco: 'Rua B', status: 'agendado' }
    );

    const response = await fetch(`${baseUrl}/api/services/customer-link-audit`);
    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.counts.link_auto_seguro, 1);
    assert.equal(payload.counts.criar_cliente, 1);
    assert.equal(payload.counts.revisao_manual, 1);
    assert.equal(payload.items.link_auto_seguro[0].service.id, 11);
    assert.equal(payload.items.link_auto_seguro[0].suggested_customer.id, 1);
    assert.equal(payload.items.criar_cliente[0].service.id, 12);
    assert.equal(payload.items.revisao_manual[0].service.id, 13);
  });
});

test('POST /api/services/customer-link-repair respeita dry-run e aplica apenas casos seguros', async () => {
  await withServer(async (baseUrl, state) => {
    state.services.push(
      { id: 11, cliente: 'Alpha Cliente', endereco: 'Rua A', status: 'agendado' },
      { id: 12, cliente: 'Cliente Novo Agenda', endereco: 'Rua Nova', status: 'agendado' },
      { id: 14, cliente: 'Cliente Novo Agenda', endereco: 'Rua Nova', status: 'agendado' },
      { id: 13, cliente: 'Beta Cliente', endereco: 'Rua B', status: 'agendado' }
    );
    const originalCustomers = state.customers.length;

    const dryRun = await fetch(`${baseUrl}/api/services/customer-link-repair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: true })
    });
    assert.equal(dryRun.status, 200);
    const dryPayload = await dryRun.json();
    assert.equal(dryPayload.dry_run, true);
    assert.equal(state.services.find(service => service.id === 11).cliente_id, undefined);
    assert.equal(state.customers.length, originalCustomers);

    const applied = await fetch(`${baseUrl}/api/services/customer-link-repair?apply=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apply: true })
    });
    assert.equal(applied.status, 200);
    const appliedPayload = await applied.json();
    assert.equal(appliedPayload.linked, 1);
    assert.equal(appliedPayload.created, 0);
    assert.equal(appliedPayload.ambiguous, 1);
    assert.equal(appliedPayload.requires_customer_creation, 2);
    assert.equal(state.services.find(service => service.id === 11).cliente_id, 1);
    assert.equal(state.services.find(service => service.id === 12).cliente_id, undefined);
    assert.equal(state.services.find(service => service.id === 14).cliente_id, undefined);
    assert.equal(state.services.find(service => service.id === 13).cliente_id, undefined);
    assert.equal(state.customers.length, originalCustomers);
  });
});

test('GET /api/diagnostics/operational retorna checks sem segredos', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/diagnostics/operational`);
    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(typeof payload.serverTime, 'string');
    assert.equal(payload.features.supabaseConfigured, true);
    assert.equal(payload.checks.services.ok, true);
    assert.equal(payload.checks.customers.ok, true);
    assert.equal(payload.checks.vehicles.ok, true);

    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes(process.env.SUPABASE_ANON_KEY), false);
    assert.equal(serialized.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
    assert.equal(serialized.includes('EVOLUTION_API_KEY'), false);
  });
});

test('POST /api/customers/merge reaponta histórico sem alterar texto do serviço', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/customers/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryId: 1, duplicateIds: [2] })
    });
    assert.equal(response.status, 200);
    assert.equal(state.services[0].cliente_id, 1);
    assert.equal(state.services[0].cliente, 'Beta Cliente');
    assert.equal(state.contracts[0].customer_id, 1);
    assert.equal(state.customer_service_history[0].customer_id, 1);
    assert.equal(state.data_reviews[0].customer_id, 1);
    assert.equal(state.customer_reminders[0].customer_id, 1);
    assert.equal(state.customers.find(c => c.id === 2).ativo, false);
  });
});
