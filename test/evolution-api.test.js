const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon';
process.env.EVOLUTION_API_URL = 'https://evolution.example.test';
process.env.EVOLUTION_API_KEY = 'secret';
process.env.EVOLUTION_INSTANCE_NAME = 'letec';

const app = require('../server');

function makeReminder(overrides = {}) {
  return {
    id: 'rem-1',
    service_id: 'svc-1',
    customer_id: 'cust-1',
    tipo: 'dia_do_atendimento',
    canal: 'evolution_api',
    status: 'pendente',
    destino: '5511999999999',
    mensagem: 'Mensagem de teste',
    tentativas: 0,
    ...overrides
  };
}

function makeMockSupabase(reminder) {
  const state = { reminder: { ...reminder }, updates: [] };
  return {
    state,
    from(table) {
      assert.equal(table, 'customer_reminders');
      const builder = {
        _op: 'select',
        _payload: null,
        select() { return builder; },
        eq() { return builder; },
        update(payload) {
          builder._op = 'update';
          builder._payload = payload;
          state.updates.push(payload);
          state.reminder = { ...state.reminder, ...payload };
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: state.reminder || null, error: null });
        },
        then(resolve) {
          if (builder._op === 'update') {
            return resolve({ data: [state.reminder], error: null });
          }
          return resolve({ data: state.reminder ? [state.reminder] : [], error: null });
        },
      };
      return builder;
    },
  };
}

async function withServer({ reminder = makeReminder(), evolutionFetch, env = {} }, fn) {
  const previousEnv = {
    EVOLUTION_API_URL: process.env.EVOLUTION_API_URL,
    EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY,
    EVOLUTION_INSTANCE_NAME: process.env.EVOLUTION_INSTANCE_NAME
  };
  Object.entries(env).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  const mockSupabase = makeMockSupabase(reminder);
  app.locals.supabase = mockSupabase;
  app.locals.evolutionFetch = evolutionFetch;
  const server = app.listen(0);
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`, mockSupabase.state);
  } finally {
    await new Promise(resolve => server.close(resolve));
    delete app.locals.evolutionFetch;
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

test('POST /api/customer-reminders/:id/send envia lembrete via Evolution', async () => {
  let called = false;
  await withServer({
    evolutionFetch: async (url, options) => {
      called = true;
      assert.equal(url, 'https://evolution.example.test/message/sendText/letec');
      assert.equal(options.headers.apikey, 'secret');
      const body = JSON.parse(options.body);
      assert.equal(body.number, '5511999999999');
      assert.equal(body.text, 'Mensagem de teste');
      return new Response(JSON.stringify({ key: { id: 'wamid-1' }, status: 'sent' }), { status: 200 });
    }
  }, async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/customer-reminders/rem-1/send`, { method: 'POST' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(called, true);
    assert.equal(payload.status, 'enviado');
    assert.equal(payload.provider_message_id, 'wamid-1');
    assert.equal(state.updates.some(update => update.status === 'enviando'), true);
  });
});

test('POST /api/customer-reminders/:id/send rejeita numero invalido sem chamar Evolution', async () => {
  let called = false;
  await withServer({
    reminder: makeReminder({ destino: '123' }),
    evolutionFetch: async () => { called = true; return new Response('{}'); }
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/customer-reminders/rem-1/send`, { method: 'POST' });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });
});

test('POST /api/customer-reminders/:id/send registra erro quando Evolution falha', async () => {
  await withServer({
    evolutionFetch: async () => new Response(JSON.stringify({ message: 'instance disconnected' }), { status: 503 })
  }, async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/customer-reminders/rem-1/send`, { method: 'POST' });
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.status, 'erro');
    assert.equal(payload.erro, 'instance disconnected');
    assert.equal(state.reminder.status, 'erro');
  });
});

test('GET /api/evolution/status retorna 503 sem env vars', async () => {
  await withServer({
    evolutionFetch: async () => new Response('{}'),
    env: { EVOLUTION_API_URL: undefined, EVOLUTION_API_KEY: undefined }
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/evolution/status`);
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.configured, false);
  });
});
