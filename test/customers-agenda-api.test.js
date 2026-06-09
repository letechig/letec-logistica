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
    customer_addresses: [],
    customer_aliases: [],
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
        status_operacional: 'Eventual antigo'
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
        status_operacional: 'Cancelado'
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
        endereco: 'Rua Schema, 10',
        cep: '01001000',
        origem: 'teste'
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

test('PUT /api/services/:id bloqueia outro atendimento ativo do mesmo tecnico', async () => {
  await withServer(async (baseUrl, state) => {
    state.services = [
      {
        id: 10,
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
        date: '2026-05-25',
        cliente: 'Cliente Finalizado',
        equipe: 'Lucas Eduardo',
        tecnicos_ids: ['tec-1'],
        exec_status: 'finalizado'
      },
      {
        id: 11,
        date: '2026-05-25',
        cliente: 'Cliente Problema',
        equipe: 'Lucas Eduardo',
        tecnicos_ids: ['tec-1'],
        exec_status: 'problema'
      },
      {
        id: 12,
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

test('PUT /api/services/:id ignora colunas opcionais ausentes em schema legado', async () => {
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
        cliente: 'Cliente Editado',
        endereco: 'Rua Editada',
        status: 'executado',
        exec_status: 'finalizado',
        customer_address_id: 'addr-1',
        tecnicos_ids: ['tec-2']
      })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.cliente, 'Cliente Editado');
    assert.equal(payload.endereco, 'Rua Editada');
    assert.equal(payload.status, 'executado');
    assert.equal(payload.date, undefined);
    assert.equal(payload.exec_status, undefined);
    assert.equal(payload.customer_address_id, undefined);
    assert.equal(payload.tecnicos_ids, undefined);
    assert.equal(payload.data, undefined);
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
    assert.equal(state.customer_addresses.length, 1);
    assert.equal(state.services.find(service => service.id === 100).customer_address_id, state.customer_addresses[0].id);
    assert.equal(state.customer_addresses[0].customer_id, 1);
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
    assert.equal(state.customer_aliases.some(alias => alias.customer_id === created.id && alias.alias_normalizado === 'CLIENTE NOVO AGENDA'), true);
    assert.equal(state.customer_addresses.some(address => address.customer_id === created.id && address.endereco === 'Rua Nova, 123'), true);
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
    assert.equal(appliedPayload.linked, 3);
    assert.equal(appliedPayload.created, 1);
    assert.equal(appliedPayload.ambiguous, 1);
    assert.equal(state.services.find(service => service.id === 11).cliente_id, 1);
    assert.ok(state.services.find(service => service.id === 12).cliente_id);
    assert.equal(state.services.find(service => service.id === 14).cliente_id, state.services.find(service => service.id === 12).cliente_id);
    assert.equal(state.services.find(service => service.id === 13).cliente_id, undefined);
    assert.equal(state.customers.length, originalCustomers + 1);
    const created = state.customers.find(customer => customer.nome === 'Cliente Novo Agenda');
    assert.equal(created.tipo_cliente, 'Eventual');
    assert.equal(created.origem, 'agenda_repair');
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
