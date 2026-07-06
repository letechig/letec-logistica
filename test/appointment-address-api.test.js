const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon';

const app = require('../server');

function makeState() {
  return {
    customers: [
      { id: 1, nome: 'Alpha Cliente', nome_normalizado: 'ALPHA CLIENTE', ativo: true, endereco: 'Rua A' }
    ],
    services: [],
    customer_addresses: [],
    customer_aliases: []
  };
}

function makeBuilder(state, table) {
  const builder = {
    _op: 'select',
    _payload: null,
    _filters: [],
    _limit: null,
    select() { return builder; },
    limit(n) { builder._limit = n; return builder; },
    eq(key, value) { builder._filters.push({ key, value }); return builder; },
    insert(payload) {
      builder._op = 'insert';
      builder._pendingInsert = Array.isArray(payload) ? payload : [payload];
      return builder;
    },
    then(resolve) { return builder._execute().then(resolve); },
    async _execute() {
      if (builder._op === 'insert') {
        const inserted = builder._pendingInsert.map((row, index) => ({ id: row.id || state[table].length + index + 1, ...row }));
        state[table].push(...inserted);
        return { data: inserted, error: null };
      }
      let rows = [...state[table]];
      for (const filter of builder._filters) rows = rows.filter(row => String(row[filter.key]) === String(filter.value));
      if (builder._limit != null) rows = rows.slice(0, builder._limit);
      return { data: rows, error: null };
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

test('POST /api/services salva cliente existente sem exigir CEP para nova unidade', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 103,
        date: '2026-05-13',
        cliente: 'Alpha Cliente',
        endereco: 'Rua A, 99 - Centro'
      })
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.cliente_id, 1);
    assert.equal(state.services.find(service => service.id === 103).endereco, 'Rua A, 99 - Centro');
    assert.equal(state.customer_addresses.length, 0);
  });
});

test('POST /api/services salva cliente novo sem bloquear por CEP ausente', async () => {
  await withServer(async (baseUrl, state) => {
    const beforeCustomers = state.customers.length;
    const response = await fetch(`${baseUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 104,
        date: '2026-05-13',
        cliente: 'Cliente Livre Agenda',
        endereco: 'Endereco informado pelo operador'
      })
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.id, 104);
    assert.equal(payload.cliente_id, null);
    assert.equal(state.customers.length, beforeCustomers);
    assert.equal(state.services.find(service => service.id === 104).cliente, 'Cliente Livre Agenda');
  });
});
