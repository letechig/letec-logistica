const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon';
process.env.EVOLUTION_API_URL = 'https://evolution.example.test';
process.env.EVOLUTION_API_KEY = 'secret';
process.env.EVOLUTION_INSTANCE_NAME = 'Letec';

const app = require('../server');

function makeState(overrides = {}) {
  return {
    services: [
      { id: 'svc-1', date: '2026-05-14', data: '2026-05-14', cliente: 'Cliente A', endereco: 'Rua A, 10', horario: '08:00', tiposervico: 'Controle de Pragas', tecnicos_ids: ['tec-1'], status: 'agendado', cliente_id: 'cust-1' },
      { id: 'svc-2', date: '2026-05-14', data: '2026-05-14', cliente: 'Cliente B', endereco: 'Rua B, 20', horario: '10:00', tiposervico: 'Higienização', tecnicos_ids: ['tec-2'], status: 'cancelado', cliente_id: 'cust-2' },
      { id: 'svc-3', date: '2026-05-14', data: '2026-05-14', cliente: 'Cliente C', endereco: 'Rua C, 30', horario: '13:00', tiposervico: 'Vistoria', tecnicos_ids: ['tec-1'], status: 'executado', cliente_id: 'cust-3' },
    ],
    technicians: [
      { id: 'tec-1', nome: 'João', whatsapp: '11999999999', ativo: true },
      { id: 'tec-2', nome: 'Maria', ativo: true },
    ],
    customers: [
      { id: 'cust-1', nome: 'Cliente A', telefone: '11988888888', ativo: true },
      { id: 'cust-2', nome: 'Cliente B', telefone: '11977777777', ativo: true },
      { id: 'cust-3', nome: 'Cliente C', telefone: '11966666666', ativo: true },
    ],
    logistica_whatsapp_mensagens: [],
    ...overrides
  };
}

function makeBuilder(state, table) {
  const builder = {
    _op: 'select',
    _payload: null,
    _filters: [],
    _inFilters: [],
    _orDate: null,
    _limit: null,
    select() { return builder; },
    order() { return builder; },
    limit(n) { builder._limit = n; return builder; },
    eq(key, value) { builder._filters.push({ key, value }); return builder; },
    in(key, values) { builder._inFilters.push({ key, values: (values || []).map(String) }); return builder; },
    gte(key, value) { builder._filters.push({ key, value, op: 'gte' }); return builder; },
    lt(key, value) { builder._filters.push({ key, value, op: 'lt' }); return builder; },
    or(expr) {
      const match = String(expr).match(/(?:date|data)\.eq\.([0-9-]+)/);
      builder._orDate = match ? match[1] : null;
      return builder;
    },
    insert(payload) {
      builder._op = 'insert';
      builder._payload = Array.isArray(payload) ? payload : [payload];
      const inserted = builder._payload.map((row, index) => ({ id: row.id || `msg-${state.logistica_whatsapp_mensagens.length + index + 1}`, ...row }));
      state[table].push(...inserted);
      builder._inserted = inserted;
      return builder;
    },
    update(payload) {
      builder._op = 'update';
      builder._payload = payload;
      return builder;
    },
    async maybeSingle() {
      const rows = await builder._resolveRows();
      return { data: rows[0] || null, error: null };
    },
    then(resolve) {
      return builder._execute().then(resolve);
    },
    async _execute() {
      if (builder._op === 'insert') return { data: builder._inserted, error: null };
      if (builder._op === 'update') {
        const rows = await builder._resolveRows();
        rows.forEach(row => Object.assign(row, builder._payload));
        return { data: rows, error: null };
      }
      return { data: await builder._resolveRows(), error: null };
    },
    async _resolveRows() {
      let rows = [...(state[table] || [])];
      if (builder._orDate) rows = rows.filter(row => row.date === builder._orDate || row.data === builder._orDate);
      for (const filter of builder._filters) {
        if (filter.op === 'gte') rows = rows.filter(row => String(row[filter.key] || '') >= String(filter.value));
        else if (filter.op === 'lt') rows = rows.filter(row => String(row[filter.key] || '') < String(filter.value));
        else rows = rows.filter(row => String(row[filter.key]) === String(filter.value));
      }
      for (const filter of builder._inFilters) {
        rows = rows.filter(row => filter.values.includes(String(row[filter.key])));
      }
      if (builder._limit != null) rows = rows.slice(0, builder._limit);
      return rows;
    }
  };
  return builder;
}

function makeMockSupabase(state) {
  return {
    state,
    from(table) {
      assert.ok(state[table], `unexpected table ${table}`);
      return makeBuilder(state, table);
    }
  };
}

async function withServer({ state = makeState(), evolutionFetch } = {}, fn) {
  const mockSupabase = makeMockSupabase(state);
  app.locals.supabase = mockSupabase;
  app.locals.evolutionFetch = evolutionFetch || (async () => new Response(JSON.stringify({ key: { id: 'wamid-ok' }, status: 'sent' }), { status: 200 }));
  const server = app.listen(0);
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`, state);
  } finally {
    await new Promise(resolve => server.close(resolve));
    delete app.locals.evolutionFetch;
  }
}

async function post(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

test('POST /api/logistica/whatsapp/enviar-agenda-tecnico envia agenda para técnico com WhatsApp válido', async () => {
  let called = false;
  await withServer({
    evolutionFetch: async (url, options) => {
      called = true;
      assert.equal(url, 'https://evolution.example.test/message/sendText/Letec');
      const body = JSON.parse(options.body);
      assert.equal(body.number, '5511999999999');
      assert.match(body.text, /Segue sua agenda de hoje/);
      return new Response(JSON.stringify({ key: { id: 'wamid-agenda' } }), { status: 200 });
    }
  }, async (baseUrl, state) => {
    const { response, payload } = await post(baseUrl, '/api/logistica/whatsapp/enviar-agenda-tecnico', { tecnico_id: 'tec-1', data: '2026-05-14' });
    assert.equal(response.status, 200);
    assert.equal(called, true);
    assert.equal(payload.message.status, 'enviado');
    assert.equal(state.logistica_whatsapp_mensagens[0].tipo, 'agenda_tecnico');
  });
});

test('POST /api/logistica/whatsapp/enviar-agenda-tecnico rejeita técnico sem WhatsApp', async () => {
  let called = false;
  await withServer({ evolutionFetch: async () => { called = true; return new Response('{}'); } }, async (baseUrl) => {
    const { response, payload } = await post(baseUrl, '/api/logistica/whatsapp/enviar-agenda-tecnico', { tecnico_id: 'tec-2', data: '2026-05-14' });
    assert.equal(response.status, 400);
    assert.match(payload.error, /WhatsApp/);
    assert.equal(called, false);
  });
});

test('POST /api/logistica/whatsapp/enviar-confirmacao-cliente envia confirmação para cliente com telefone válido', async () => {
  await withServer({}, async (baseUrl, state) => {
    const { response, payload } = await post(baseUrl, '/api/logistica/whatsapp/enviar-confirmacao-cliente', { agendamento_id: 'svc-1' });
    assert.equal(response.status, 200);
    assert.equal(payload.message.status, 'enviado');
    assert.equal(state.logistica_whatsapp_mensagens[0].tipo, 'confirmacao_cliente');
    assert.equal(state.logistica_whatsapp_mensagens[0].telefone, '5511988888888');
  });
});

test('POST /api/logistica/whatsapp/enviar-confirmacao-cliente rejeita cliente sem telefone', async () => {
  const state = makeState({ customers: [{ id: 'cust-1', nome: 'Cliente A', ativo: true }] });
  await withServer({ state }, async (baseUrl) => {
    const { response, payload } = await post(baseUrl, '/api/logistica/whatsapp/enviar-confirmacao-cliente', { agendamento_id: 'svc-1' });
    assert.equal(response.status, 400);
    assert.match(payload.error, /WhatsApp/);
  });
});

test('POST /api/logistica/whatsapp/enviar-lembretes-24h ignora cancelados/concluídos e evita duplicidade', async () => {
  const state = makeState({
    logistica_whatsapp_mensagens: [{
      id: 'old-1',
      agendamento_id: 'svc-1',
      destinatario_tipo: 'cliente',
      tipo: 'lembrete_24h',
      status: 'enviado',
      mensagem: 'old',
      created_at: new Date().toISOString()
    }]
  });
  await withServer({ state }, async (baseUrl) => {
    const { response, payload } = await post(baseUrl, '/api/logistica/whatsapp/enviar-lembretes-24h', { data: '2026-05-13' });
    assert.equal(response.status, 200);
    assert.equal(payload.total_agendamentos, 1);
    assert.equal(payload.results[0].skipped, true);
    assert.equal(state.logistica_whatsapp_mensagens.length, 1);
  });
});

test('POST /api/logistica/whatsapp/enviar-confirmacao-cliente salva erro quando Evolution falha', async () => {
  await withServer({
    evolutionFetch: async () => new Response(JSON.stringify({ message: 'instance disconnected' }), { status: 503 })
  }, async (baseUrl, state) => {
    const { response, payload } = await post(baseUrl, '/api/logistica/whatsapp/enviar-confirmacao-cliente', { agendamento_id: 'svc-1' });
    assert.equal(response.status, 502);
    assert.equal(payload.message.status, 'erro');
    assert.equal(state.logistica_whatsapp_mensagens[0].status, 'erro');
    assert.match(state.logistica_whatsapp_mensagens[0].erro, /instance disconnected/);
  });
});
