const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon';

const app = require('../server');

function makeState() {
  return {
    customers: [
      { id: 1, nome: 'Rede Moriah', nome_normalizado: 'REDE MORIAH', ativo: true, endereco: 'Av. Moaci, 974', status_operacional: 'Ativo', categoria: 'contrato' },
      { id: 2, nome: 'REDE MORIAH', nome_normalizado: 'REDE MORIAH', ativo: true, endereco: 'Av. Moaci, 3236', status_operacional: 'Ativo', categoria: 'contrato' },
      { id: 3, nome: 'Hospital Moriah', nome_normalizado: 'HOSPITAL MORIAH', ativo: true, endereco: 'Av. Moaci, 974', status_operacional: 'Eventual' }
    ],
    services: [{ id: 10, cliente_id: 2, cliente: 'REDE MORIAH', endereco: 'Av. Moaci, 3236' }],
    contracts: [{ id: 20, customer_id: 2, tipo_servico: 'Contrato' }],
    customer_service_history: [{ id: 30, customer_id: 2 }],
    data_reviews: [{ id: 40, customer_id: 2 }],
    customer_reminders: [{ id: 'rem-1', customer_id: 2 }],
    customer_addresses: [],
    customer_aliases: []
  };
}

function makeBuilder(state, table) {
  const builder = {
    _op: 'select',
    _payload: null,
    _filters: [],
    _in: [],
    _or: null,
    _limit: null,
    select() { return builder; },
    order() { return builder; },
    limit(n) { builder._limit = n; return builder; },
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
    then(resolve) { return builder._execute().then(resolve); },
    async _execute() {
      if (builder._op === 'insert') return { data: builder._inserted, error: null };
      const rows = builder._rows();
      if (builder._op === 'update') {
        rows.forEach(row => Object.assign(row, builder._payload));
        return { data: rows, error: null };
      }
      return { data: builder._limit != null ? rows.slice(0, builder._limit) : rows, error: null };
    },
    _rows() {
      let rows = [...state[table]];
      for (const filter of builder._filters) rows = rows.filter(row => String(row[filter.key]) === String(filter.value));
      for (const filter of builder._in) rows = rows.filter(row => filter.values.includes(String(row[filter.key])));
      if (builder._or) {
        const terms = builder._or.split(',').map(part => part.match(/^([^.]+)\.ilike\.%(.+)%$/)).filter(Boolean);
        rows = rows.filter(row => terms.some(match => String(row[match[1]] || '').toLowerCase().includes(match[2].toLowerCase())));
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

test('Clientes V2 bloqueia novo cadastro com mesmo nome canonico', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: ' rede   moriah ', endereco: 'Outro endereco' })
    });
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.code, 'possible_duplicate');
    assert.equal(payload.duplicate.id, 1);
    assert.equal(state.customers.length, 3);
  });
});

test('Clientes V2 cria unidade ao salvar servico com cliente existente e endereco novo', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 99, date: '2026-05-19', cliente_id: 1, cliente: 'Rede Moriah', endereco: 'Av. Moaci, 971' })
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.cliente_id, 1);
    assert.equal(state.customer_addresses.length, 1);
    assert.equal(state.customer_addresses[0].customer_id, 1);
    assert.equal(state.customer_addresses[0].endereco, 'Av. Moaci, 971');
    assert.equal(state.services.find(service => service.id === 99).customer_address_id, state.customer_addresses[0].id);
  });
});

test('Clientes V2 merge canonico cria unidades e aliases sem apagar historico textual', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/customers/canonical-merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryId: 1, duplicateIds: [2] })
    });
    assert.equal(response.status, 200);
    assert.equal(state.customers.find(customer => customer.id === 2).ativo, false);
    assert.equal(state.services[0].cliente_id, 1);
    assert.equal(state.services[0].cliente, 'REDE MORIAH');
    assert.equal(state.contracts[0].customer_id, 1);
    assert.equal(state.customer_addresses.some(address => address.customer_id === 1 && address.endereco === 'Av. Moaci, 3236'), true);
    assert.equal(state.customer_aliases.some(alias => alias.customer_id === 1 && alias.alias_normalizado === 'REDE MORIAH'), true);
  });
});
