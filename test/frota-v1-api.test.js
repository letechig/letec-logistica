const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon';

const app = require('../server');

function makeState() {
  return {
    technicians: [{ id: 'tec-1', nome: 'Joao', ativo: true }],
    vehicles: [
      { id: 'veh-1', nome: 'Palio', placa: 'ABC1234', ativo: true, status: 'ativo', quilometragem_atual: 9500, tecnico_responsavel_id: 'tec-1' },
      { id: 'veh-2', nome: 'Uno', placa: 'DEF5678', ativo: true, status: 'ativo', quilometragem_atual: 0, tecnico_responsavel_id: null }
    ],
    inventory_products: [],
    inventory_movements: [],
    veiculo_documentos: [
      { id: 'doc-1', veiculo_id: 'veh-1', tipo_documento: 'ipva', data_vencimento: '2020-01-01', status: 'em_dia' }
    ],
    veiculo_manutencoes: [
      { id: 'man-1', veiculo_id: 'veh-1', tipo_manutencao: 'troca_oleo', proxima_quilometragem: 9800, status: 'programada' }
    ],
    veiculo_historico: [],
    veiculo_alerta_envios: []
  };
}

function makeBuilder(state, table) {
  const builder = {
    _op: 'select',
    _payload: null,
    _filters: [],
    _limit: null,
    select() { return builder; },
    order() { return builder; },
    limit(n) { builder._limit = n; return builder; },
    eq(key, value) { builder._filters.push({ key, value }); return builder; },
    insert(payload) {
      builder._op = 'insert';
      const rows = Array.isArray(payload) ? payload : [payload];
      builder._inserted = rows.map((row, index) => ({ id: row.id || `${table}-${state[table].length + index + 1}`, ...row }));
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
      if (builder._limit != null) rows = rows.slice(0, builder._limit);
      return { data: rows, error: null };
    },
    _rows() {
      let rows = [...state[table]];
      for (const filter of builder._filters) rows = rows.filter(row => String(row[filter.key]) === String(filter.value));
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

test('POST /api/veiculos cria veiculo com placa normalizada e historico', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/veiculos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: 'Saveiro', placa: 'abc-9d87', quilometragem_atual: 1200 })
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.placa, 'ABC9D87');
    assert.equal(payload.status, 'ativo');
    assert.equal(state.veiculo_historico.length, 1);
  });
});

test('POST /api/veiculos rejeita quilometragem negativa', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/veiculos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: 'Erro KM', placa: 'XYZ1234', quilometragem_atual: -1 })
    });
    assert.equal(response.status, 400);
  });
});

test('GET /api/veiculos/alertas retorna documento vencido, manutencao por km e veiculo sem tecnico', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/veiculos/alertas`);
    assert.equal(response.status, 200);
    const alerts = await response.json();
    assert.ok(alerts.some(item => item.tipo_alerta === 'ipva_vencido' && item.prioridade === 'critica'));
    assert.ok(alerts.some(item => item.tipo_alerta === 'troca_oleo_km_proxima' && item.prioridade === 'alta'));
    assert.ok(alerts.some(item => item.tipo_alerta === 'veiculo_sem_tecnico'));
  });
});

test('rotas de estoque criam produto e movimentacao pelo backend', async () => {
  await withServer(async (baseUrl, state) => {
    const productResponse = await fetch(`${baseUrl}/api/inventory/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: 'Produto A', unidade: 'un', estoque_inicial: 2 })
    });
    assert.equal(productResponse.status, 201);
    const product = await productResponse.json();

    const movementResponse = await fetch(`${baseUrl}/api/inventory/movements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: '2026-05-14', tipo: 'saida', product_id: product.id, produto_nome: product.nome, quantidade: 1, veiculo_nome: 'Palio' })
    });
    assert.equal(movementResponse.status, 201);
    assert.equal(state.inventory_products.length, 1);
    assert.equal(state.inventory_movements.length, 1);
  });
});

test('rotas de tecnicos criam e atualizam pelo backend', async () => {
  await withServer(async (baseUrl, state) => {
    const createdResponse = await fetch(`${baseUrl}/api/technicians`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: 'Maria Tecnica', telefone: '(11) 99999-9999', whatsapp: '11999999999' })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.telefone, '11999999999');

    const updatedResponse = await fetch(`${baseUrl}/api/technicians/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: false })
    });
    assert.equal(updatedResponse.status, 200);
    const updated = await updatedResponse.json();
    assert.equal(updated.ativo, false);
    assert.equal(state.technicians.some(item => item.nome === 'Maria Tecnica' && item.ativo === false), true);
  });
});
