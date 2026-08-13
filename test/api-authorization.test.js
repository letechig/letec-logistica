const test = require('node:test');
const assert = require('node:assert/strict');

process.env.API_AUTH_REQUIRED = 'true';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';

const app = require('../server');

function queryResult(rows) {
  const filters = [];
  const inFilters = [];
  let upserted = null;
  const builder = {
    select() { return builder; },
    eq(key, value) { filters.push([key, value]); return builder; },
    in(key, values) { inFilters.push([key, values.map(String)]); return builder; },
    order() { return builder; },
    limit() { return builder; },
    upsert(payload) {
      const incoming = Array.isArray(payload) ? payload : [payload];
      upserted = incoming.map(item => {
        const existing = rows.find(row =>
          String(row.service_id) === String(item.service_id)
          && String(row.tipo) === String(item.tipo)
          && String(row.canal) === String(item.canal)
        );
        if (existing) return Object.assign(existing, item);
        const created = { id: `rem-${rows.length + 1}`, ...item };
        rows.push(created);
        return created;
      });
      return builder;
    },
    then(resolve) {
      const data = upserted || rows.filter(row =>
        filters.every(([key, value]) => String(row[key]) === String(value))
        && inFilters.every(([key, values]) => values.includes(String(row[key])))
      );
      return resolve({ data, error: null });
    }
  };
  return builder;
}

function makeDb() {
  const tables = {
    app_users: [{ id: 1, auth_user_id: 'admin-1', email: 'admin@letec.test', role: 'admin', active: true }],
    services: [{ id: 10, date: '2026-08-12', cliente: 'Cliente protegido' }],
    customer_reminders: [],
    technicians: [{
      id: 'tech-1', nome: 'Tecnico Teste', telefone: '5511999999999',
      portal_pin_hash: 'hash-secreto', portal_login_enabled: true, ativo: true
    }],
    activity_logs: []
  };
  return {
    auth: {
      async getUser(token) {
        if (token === 'valid-admin-token') {
          return { data: { user: { id: 'admin-1', email: 'admin@letec.test' } }, error: null };
        }
        return { data: { user: null }, error: { message: 'invalid token' } };
      }
    },
    from(table) {
      assert.ok(tables[table], `unexpected table ${table}`);
      if (table === 'activity_logs') {
        return { insert() { return Promise.resolve({ data: [], error: null }); } };
      }
      return queryResult(tables[table]);
    }
  };
}

async function withServer(fn) {
  app.locals.supabase = makeDb();
  const server = app.listen(0);
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('API operacional nega leitura anonima e aceita admin ativo', async () => {
  await withServer(async baseUrl => {
    const anonymous = await fetch(`${baseUrl}/api/services`);
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).code, 'authentication_required');

    const authorized = await fetch(`${baseUrl}/api/services`, {
      headers: { Authorization: 'Bearer valid-admin-token' }
    });
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json())[0].cliente, 'Cliente protegido');
  });
});

test('lista publica do login tecnico nao vaza telefone nem hash do PIN', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/technicians?active=true`);
    assert.equal(response.status, 200);
    const [technician] = await response.json();
    assert.deepEqual(technician, {
      id: 'tech-1',
      nome: 'Tecnico Teste',
      portal_login_enabled: true
    });
  });
});

test('lembretes sao lidos e gravados somente pela API autenticada', async () => {
  await withServer(async baseUrl => {
    const denied = await fetch(`${baseUrl}/api/customer-reminders?service_ids=10`);
    assert.equal(denied.status, 401);

    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer valid-admin-token' };
    const saved = await fetch(`${baseUrl}/api/customer-reminders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        service_id: '10', tipo: 'dia_anterior', canal: 'evolution_api',
        status: 'pendente', mensagem: 'Teste seguro'
      })
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).mensagem, 'Teste seguro');

    const listed = await fetch(`${baseUrl}/api/customer-reminders?service_ids=10`, { headers });
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).length, 1);
  });
});
