const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon';

const app = require('../server');

function makeState() {
  return {
    customers: [
      { id: 1, nome: 'Alpha Cliente', nome_normalizado: 'ALPHA CLIENTE', telefone: '5511999999999', ativo: true, endereco: 'Rua A' }
    ],
    services: [],
    customer_addresses: [
      { id: 'addr-1', customer_id: 1, ativo: true, is_primary: true, cep: '01001000', rua: 'Rua A', numero: '99', bairro: 'Centro', cidade: 'Sao Paulo', uf: 'SP', endereco: 'Rua A, 99 - Centro - Sao Paulo / SP', endereco_completo: 'Rua A, 99 - Centro - Sao Paulo / SP' }
    ],
    customer_contacts: [],
    customer_aliases: [],
    activity_logs: []
  };
}

function makeBuilder(state, table) {
  const builder = {
    _op: 'select',
    _payload: null,
    _filters: [],
    _in: [],
    _limit: null,
    select() { return builder; },
    order() { return builder; },
    limit(n) { builder._limit = n; return builder; },
    eq(key, value) { builder._filters.push({ key, value }); return builder; },
    in(key, values) { builder._in.push({ key, values: values.map(String) }); return builder; },
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
      for (const filter of builder._in) rows = rows.filter(row => filter.values.includes(String(row[filter.key])));
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

test('POST /api/services usa cliente e unidade cadastrados como snapshots canonicos', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 103,
        date: '2026-05-13',
        cliente_id: 1,
        customer_address_id: 'addr-1',
        cliente: 'Nome adulterado',
        endereco: 'Endereco adulterado'
      })
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.cliente_id, 1);
    assert.equal(payload.customer_address_id, 'addr-1');
    assert.equal(payload.cliente, 'Alpha Cliente');
    assert.equal(payload.endereco, 'Rua A, 99 - Centro - Sao Paulo / SP');
    assert.equal(payload.client_name_snapshot, 'Alpha Cliente');
    assert.equal(payload.address_snapshot, 'Rua A, 99 - Centro - Sao Paulo / SP');
  });
});

test('POST /api/services rejeita nome solto e nao cria cliente nem OS', async () => {
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

    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.code, 'service_customer_required');
    assert.equal(state.customers.length, beforeCustomers);
    assert.equal(state.services.some(service => service.id === 104), false);
  });
});
