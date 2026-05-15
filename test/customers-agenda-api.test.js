const test = require('node:test');
const assert = require('node:assert/strict');

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
    services: [{ id: 10, cliente_id: 2, cliente: 'Beta Cliente', endereco: 'Rua B' }],
    technicians: [{ id: 'tec-1', nome: 'Joao', ativo: true }],
    vehicles: [{ id: 'vei-1', nome: 'Fox', ativo: true }],
    contracts: [{ id: 20, customer_id: 2, tipo_servico: 'Controle de pragas' }],
    customer_service_history: [{ id: 30, customer_id: 2, servico: 'DS' }],
    data_reviews: [{ id: 40, customer_id: 2, tipo_problema: 'possivel_duplicidade' }],
    customer_reminders: [{ id: 'rem-1', customer_id: 2, mensagem: 'x' }],
    checklists: [
      { id: 50, date: '2026-05-14', motorista: 'Joao', origem: 'admin' },
      { id: 51, date: '2026-05-15', motorista: 'Maria', origem: 'portal_tecnico' }
    ],
    technician_events: [],
    technician_messages: [{ id: 70, date: '2026-05-14', tecnico: 'Joao', mensagem: 'Recado', lido: false }]
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
      builder._inserted = rows.map((row, index) => ({ id: row.id || state[table].length + index + 1, ...row }));
      state[table].push(...builder._inserted);
      return builder;
    },
    update(payload) { builder._op = 'update'; builder._payload = payload; return builder; },
    delete() { builder._op = 'delete'; return builder; },
    then(resolve) { return builder._execute().then(resolve); },
    async _execute() {
      if (builder._op === 'insert') return { data: builder._inserted, error: null };
      let rows = builder._rows();
      if (builder._op === 'update') {
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

test('GET /api/customers suporta autocomplete limitado e paginação com total', async () => {
  await withServer(async (baseUrl) => {
    const auto = await fetch(`${baseUrl}/api/customers?search=Beta&limit=10`);
    assert.equal(auto.status, 200);
    const autoPayload = await auto.json();
    assert.equal(Array.isArray(autoPayload), true);
    assert.equal(autoPayload.length, 2);

    const paged = await fetch(`${baseUrl}/api/customers?page=1&limit=2`);
    assert.equal(paged.status, 200);
    const payload = await paged.json();
    assert.equal(payload.items.length, 2);
    assert.equal(payload.total, 3);
    assert.equal(payload.limit, 2);
  });
});

test('PUT /api/services/:id atualiza agenda preservando campos operacionais', async () => {
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

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.cliente_id, 1);
    assert.equal(payload.cliente, 'Alpha Cliente');
    assert.deepEqual(payload.tipos, ['DS', 'DR']);
    assert.deepEqual(payload.tecnicos_ids, ['tec-2']);
    assert.equal(payload.status, 'executado');
    assert.equal(payload.exec_status, 'finalizado');
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
      body: JSON.stringify({ id: 99, date: '2026-05-13', cliente_id: 1, cliente: 'Alpha Cliente' })
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.id, 99);
    assert.equal(payload.cliente_id, 1);
    assert.equal(payload.cliente, 'Alpha Cliente');
    assert.equal(payload.data, '2026-05-13');
  });
});

test('POST /api/services vincula cliente existente por nome sem duplicar cadastro', async () => {
  await withServer(async (baseUrl, state) => {
    const beforeCustomers = state.customers.length;
    const response = await fetch(`${baseUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 100, date: '2026-05-13', cliente: 'Alpha Cliente', endereco: 'Rua A' })
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.cliente_id, 1);
    assert.equal(state.customers.length, beforeCustomers);
    assert.equal(state.services.find(service => service.id === 100).cliente_id, 1);
  });
});

test('POST /api/services rejeita cliente ambíguo sem criar serviço ou duplicata', async () => {
  await withServer(async (baseUrl, state) => {
    const beforeCustomers = state.customers.length;
    const beforeServices = state.services.length;
    const response = await fetch(`${baseUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 102, date: '2026-05-13', cliente: 'Beta Cliente' })
    });
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.code, 'customer_link_ambiguous');
    assert.equal(state.customers.length, beforeCustomers);
    assert.equal(state.services.length, beforeServices);
  });
});

test('POST /api/services cria cliente automaticamente quando agenda usa cliente novo', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 101, date: '2026-05-13', cliente: 'Cliente Novo Agenda', endereco: 'Rua Nova, 123' })
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    const created = state.customers.find(customer => customer.nome === 'Cliente Novo Agenda');
    assert.ok(created);
    assert.equal(created.origem, 'agenda');
    assert.equal(payload.cliente_id, created.id);
    assert.equal(state.services.find(service => service.id === 101).cliente_id, created.id);
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
