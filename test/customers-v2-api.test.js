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
    customer_aliases: [],
    app_users: [{ id: 1, auth_user_id: 'admin-1', email: 'admin@letec.test', role: 'admin', active: true }]
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
    _range: null,
    select() { return builder; },
    order() { return builder; },
    limit(n) { builder._limit = n; return builder; },
    range(from, to) { builder._range = { from, to }; return builder; },
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
      if (builder._range) return { data: rows.slice(builder._range.from, builder._range.to + 1), error: null };
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
    auth: {
      async getUser(token) {
        if (token === 'admin-token') return { data: { user: { id: 'admin-1', email: 'admin@letec.test' } }, error: null };
        return { data: { user: null }, error: new Error('invalid token') };
      }
    },
    from(table) {
      assert.ok(state[table], `unexpected table ${table}`);
      return makeBuilder(state, table);
    }
  };
}

const adminHeaders = { Authorization: 'Bearer admin-token' };

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

test('Clientes V2 bloqueia novo cadastro com mesmo nome canonico', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: ' rede   moriah ',
        ...requiredAddress({ endereco: 'Outro endereco', endereco_completo: 'Outro endereco, 10 - Centro - Sao Paulo / SP' })
      })
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
      body: JSON.stringify({
        id: 99,
        date: '2026-05-19',
        cliente_id: 1,
        cliente: 'Rede Moriah',
        ...requiredAddress({
          endereco: 'Av. Moaci, 971',
          endereco_completo: 'Av. Moaci, 971 - Moema - Sao Paulo / SP',
          rua: 'Av. Moaci',
          numero: '971',
          bairro: 'Moema'
        })
      })
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

test('Clientes V2 merge canonico deduplica unidades com enderecos equivalentes', async () => {
  await withServer(async (baseUrl, state) => {
    state.customers = [
      { id: 20, nome: 'Brink Condominio', nome_normalizado: 'BRINK CONDOMINIO', ativo: true, endereco: 'Estrada da Itapecerica, 2100 - Vila Prel', status_operacional: 'Ativo' },
      { id: 21, nome: 'Brink Condominio', nome_normalizado: 'BRINK CONDOMINIO', ativo: true, endereco: 'Estrada de Itapecerica, 2100 - Vila Prel', status_operacional: 'Ativo' },
      { id: 22, nome: 'Brink Condominio', nome_normalizado: 'BRINK CONDOMINIO', ativo: true, endereco: 'Estrada Itapecerica, 2100 - Vila Prel', status_operacional: 'Ativo' },
      { id: 23, nome: 'Brink Condominio', nome_normalizado: 'BRINK CONDOMINIO', ativo: true, endereco: 'Estrada de Itapecerica da Serra', status_operacional: 'Ativo' }
    ];
    state.services = [{ id: 40, cliente_id: 21, cliente: 'Brink Condominio', endereco: 'Estrada de Itapecerica, 2100 - Vila Prel' }];
    state.contracts = [];
    state.customer_service_history = [];
    state.data_reviews = [];
    state.customer_reminders = [];
    state.customer_addresses = [];
    state.customer_aliases = [];

    const preview = await fetch(`${baseUrl}/api/customers/duplicates`);
    assert.equal(preview.status, 200);
    const groups = await preview.json();
    const brinkGroup = groups.find(group => group.group.some(customer => customer.id === 20));
    assert.ok(brinkGroup);
    assert.equal(brinkGroup.addresses_to_create.length, 0);

    const response = await fetch(`${baseUrl}/api/customers/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryId: 20, duplicateIds: [21, 22, 23] })
    });
    assert.equal(response.status, 200);
    assert.equal(state.services[0].cliente_id, 20);
    assert.equal(state.customers.filter(customer => customer.ativo !== false).length, 1);
    assert.equal(state.customer_addresses.length, 1);
    assert.equal(state.customer_addresses[0].customer_id, 20);
  });
});

test('auditoria de saneamento percorre mais de 1000 clientes e classifica duplicidades claras', async () => {
  await withServer(async (baseUrl, state) => {
    state.customers = Array.from({ length: 1005 }, (_, index) => ({
      id: index + 100,
      nome: `Cliente Unico ${index + 1}`,
      nome_normalizado: `CLIENTE UNICO ${index + 1}`,
      ativo: true,
      endereco: `Rua ${index + 1}, ${index + 10}`,
      bairro: `Bairro ${index + 1}`,
      status_operacional: 'Ativo'
    }));
    state.customers.push(
      { id: 2001, nome: 'Celso', nome_normalizado: 'CELSO', ativo: true, bairro: 'Brooklin', status_operacional: 'Eventual' },
      { id: 2002, nome: 'Celso', nome_normalizado: 'CELSO', ativo: true, bairro: 'Brooklin', status_operacional: 'Eventual' },
      { id: 2003, nome: 'Cibo buono', nome_normalizado: 'CIBO BUONO', ativo: true, endereco: '4649 - Santo Amaro', status_operacional: 'Eventual' },
      { id: 2004, nome: 'Cibo Buono', nome_normalizado: 'CIBO BUONO', ativo: true, endereco: '4649 Santo Amaro', status_operacional: 'Eventual' },
      { id: 2005, nome: 'Cíntia', nome_normalizado: 'CINTIA', ativo: true, endereco: '95 - praia vermelha', status_operacional: 'Eventual' },
      { id: 2006, nome: 'Cintia', nome_normalizado: 'CINTIA', ativo: true, endereco: '95 praia vermelha', status_operacional: 'Eventual' },
      { id: 2007, nome: 'Cintia Kawakami', nome_normalizado: 'CINTIA KAWAKAMI', ativo: true, endereco: '3411 - Vila Do Encontro', status_operacional: 'Eventual' },
      { id: 2008, nome: 'Cintia Kawakami', nome_normalizado: 'CINTIA KAWAKAMI', ativo: true, endereco: '3411 Vila Do Encontro', status_operacional: 'Eventual' },
      { id: 2009, nome: 'Maria Silva', nome_normalizado: 'MARIA SILVA', ativo: true, endereco: 'Rua A, 1 - Centro', status_operacional: 'Ativo' },
      { id: 2010, nome: 'Maria Silva', nome_normalizado: 'MARIA SILVA', ativo: true, endereco: 'Avenida B, 2 - Zona Sul', status_operacional: 'Ativo' }
    );
    state.services = [];
    state.contracts = [];
    state.customer_service_history = [];
    state.data_reviews = [];
    state.customer_reminders = [];

    const response = await fetch(`${baseUrl}/api/customers/deduplication-audit`, { headers: adminHeaders });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.total_customers, 1015);
    const groupIds = group => group.group.map(customer => customer.id).sort((a, b) => a - b);
    const hasGroup = ids => payload.groups.find(group => JSON.stringify(groupIds(group)) === JSON.stringify(ids));
    assert.equal(hasGroup([2001, 2002]).confidence, 'alta');
    assert.equal(hasGroup([2003, 2004]).confidence, 'alta');
    assert.equal(hasGroup([2005, 2006]).confidence, 'alta');
    assert.equal(hasGroup([2007, 2008]).confidence, 'alta');
    assert.equal(hasGroup([2009, 2010]), undefined);
  });
});

test('auditoria marca nome parecido com endereco compativel como revisao', async () => {
  await withServer(async (baseUrl, state) => {
    state.customers = [
      { id: 3001, nome: 'Cintia Kawakami', nome_normalizado: 'CINTIA KAWAKAMI', ativo: true, endereco: 'Rua Azul, 10', status_operacional: 'Ativo' },
      { id: 3002, nome: 'Cintia Kawa', nome_normalizado: 'CINTIA KAWA', ativo: true, endereco: 'Rua Azul 10', status_operacional: 'Ativo' }
    ];
    state.services = [];
    state.contracts = [];
    state.customer_service_history = [];
    state.data_reviews = [];
    state.customer_reminders = [];

    const response = await fetch(`${baseUrl}/api/customers/deduplication-audit`, { headers: adminHeaders });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.groups.length, 1);
    assert.equal(payload.groups[0].confidence, 'revisar');
    assert.equal(payload.groups[0].requires_manual, true);
  });
});

test('saneamento mescla grupos em lote e preserva texto historico do servico', async () => {
  await withServer(async (baseUrl, state) => {
    state.customers.push(
      { id: 4, nome: 'Cibo Buono', nome_normalizado: 'CIBO BUONO', ativo: true, endereco: '4649 Santo Amaro', status_operacional: 'Ativo' },
      { id: 5, nome: 'Cibo buono', nome_normalizado: 'CIBO BUONO', ativo: true, endereco: '4649 - Santo Amaro', status_operacional: 'Ativo' }
    );
    state.services.push({ id: 11, cliente_id: 5, cliente: 'Cibo buono', endereco: '4649 - Santo Amaro' });
    state.contracts.push({ id: 21, customer_id: 5, tipo_servico: 'Contrato' });

    const response = await fetch(`${baseUrl}/api/customers/deduplication-merge`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groups: [
          { primaryId: 1, duplicateIds: [2] },
          { primaryId: 4, duplicateIds: [5] }
        ]
      })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.merged_groups, 2);
    assert.equal(state.customers.find(customer => customer.id === 2).ativo, false);
    assert.equal(state.customers.find(customer => customer.id === 5).ativo, false);
    assert.equal(state.services.find(service => service.id === 10).cliente_id, 1);
    assert.equal(state.services.find(service => service.id === 10).cliente, 'REDE MORIAH');
    assert.equal(state.services.find(service => service.id === 11).cliente_id, 4);
    assert.equal(state.services.find(service => service.id === 11).cliente, 'Cibo buono');
    assert.equal(state.contracts.find(contract => contract.id === 20).customer_id, 1);
    assert.equal(state.contracts.find(contract => contract.id === 21).customer_id, 4);
  });
});
