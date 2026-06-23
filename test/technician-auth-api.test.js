const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon';

const app = require('../server');

function makeState() {
  return {
    technicians: [
      { id: 't1', nome: 'Ana', telefone: '5511999999999', whatsapp: '5511999999999', ativo: true, portal_login_enabled: false },
      { id: 't2', nome: 'Bruno', telefone: '5511888888888', whatsapp: '5511888888888', ativo: true, portal_login_enabled: false }
    ],
    technician_sessions: [],
    app_users: [{ id: 1, auth_user_id: 'admin-1', email: 'admin@letec.test', role: 'admin', active: true }],
    services: [
      { id: 10, date: '2026-06-17', cliente: 'Cliente Ana', tecnicos_ids: ['t1'], exec_status: 'agendado' },
      { id: 11, date: '2026-06-17', cliente: 'Cliente Bruno', tecnicos_ids: ['t2'], exec_status: 'agendado' },
      { id: 12, date: '2026-06-17', cliente: 'Equipe Ana Bruno', tecnicos_ids: ['t1', 't2'], exec_status: 'agendado' }
    ],
    activity_logs: []
  };
}

function parseOrExpression(expr) {
  return String(expr || '').split(',').map(part => {
    const match = part.match(/^([^.]+)\.(eq|ilike)\.(.*)$/);
    return match ? { key: match[1], op: match[2], value: match[3].replace(/^%|%$/g, '') } : null;
  }).filter(Boolean);
}

function makeBuilder(state, table) {
  const builder = {
    _op: 'select',
    _payload: null,
    _filters: [],
    _or: null,
    _limit: null,
    select() { return builder; },
    order() { return builder; },
    limit(n) { builder._limit = n; return builder; },
    eq(key, value) { builder._filters.push({ key, value }); return builder; },
    ilike(key, value) { builder._filters.push({ key, value, ilike: true }); return builder; },
    or(expr) { builder._or = parseOrExpression(expr); return builder; },
    insert(payload) {
      builder._op = 'insert';
      const rows = Array.isArray(payload) ? payload : [payload];
      builder._inserted = rows.map((row, index) => ({ id: row.id || state[table].length + index + 1, created_at: row.created_at || new Date().toISOString(), ...row }));
      state[table].push(...builder._inserted);
      return builder;
    },
    update(payload) { builder._op = 'update'; builder._payload = payload; return builder; },
    delete() { builder._op = 'delete'; return builder; },
    then(resolve, reject) { return builder._execute().then(resolve, reject); },
    async _execute() {
      if (builder._op === 'insert') return { data: builder._inserted, error: null };
      const rows = builder._rows();
      if (builder._op === 'update') {
        rows.forEach(row => Object.assign(row, builder._payload));
        return { data: rows, error: null };
      }
      if (builder._op === 'delete') {
        state[table] = state[table].filter(row => !rows.includes(row));
        return { data: rows, error: null };
      }
      return { data: builder._limit != null ? rows.slice(0, builder._limit) : rows, error: null };
    },
    _rows() {
      let rows = [...(state[table] || [])];
      for (const filter of builder._filters) {
        rows = rows.filter(row => {
          const actual = String(row[filter.key] ?? '');
          if (filter.ilike) return actual.toLowerCase().includes(String(filter.value).replace(/%/g, '').toLowerCase());
          return actual === String(filter.value);
        });
      }
      if (builder._or?.length) {
        rows = rows.filter(row => builder._or.some(term => {
          const actual = String(row[term.key] ?? '');
          if (term.op === 'ilike') return actual.toLowerCase().includes(term.value.toLowerCase());
          return actual === term.value;
        }));
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

async function generatePin(baseUrl, technicianId = 't1') {
  const response = await fetch(`${baseUrl}/api/technicians/${technicianId}/portal-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-token' },
    body: JSON.stringify({})
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function login(baseUrl, technicianId, pin) {
  const response = await fetch(`${baseUrl}/api/technician-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ technician_id: technicianId, pin })
  });
  assert.equal(response.status, 201);
  return response.json();
}

test('login tecnico com PIN gerado cria sessao e nao expoe hash', async () => {
  await withServer(async (baseUrl, state) => {
    const generated = await generatePin(baseUrl);
    assert.match(generated.pin, /^\d{6}$/);
    assert.equal(typeof state.technicians[0].portal_pin_hash, 'string');
    assert.equal(generated.technician.portal_pin_hash, undefined);

    const payload = await login(baseUrl, 't1', generated.pin);
    assert.ok(payload.token.startsWith('tech_'));
    assert.equal(payload.technician.id, 't1');
    assert.equal(payload.technician.portal_pin_hash, undefined);
    assert.equal(state.technician_sessions.length, 1);
  });
});

test('portal tecnico exige sessao e filtra agenda por tecnico logado', async () => {
  await withServer(async (baseUrl) => {
    const noSession = await fetch(`${baseUrl}/api/services?date=2026-06-17`, {
      headers: { 'X-Portal-Client': 'technician-portal' }
    });
    assert.equal(noSession.status, 401);

    const generated = await generatePin(baseUrl, 't1');
    const auth = await login(baseUrl, 't1', generated.pin);
    const response = await fetch(`${baseUrl}/api/services?date=2026-06-17`, {
      headers: {
        'X-Portal-Client': 'technician-portal',
        Authorization: `Bearer ${auth.token}`
      }
    });
    assert.equal(response.status, 200);
    const rows = await response.json();
    assert.deepEqual(rows.map(row => row.id).sort(), [10, 12]);
  });
});

test('tecnico nao altera servico de outro tecnico, mas altera equipe compartilhada', async () => {
  await withServer(async (baseUrl, state) => {
    const generated = await generatePin(baseUrl, 't1');
    const auth = await login(baseUrl, 't1', generated.pin);
    const headers = {
      'Content-Type': 'application/json',
      'X-Portal-Client': 'technician-portal',
      Authorization: `Bearer ${auth.token}`
    };

    const forbidden = await fetch(`${baseUrl}/api/services/11`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ exec_status: 'em_deslocamento' })
    });
    assert.equal(forbidden.status, 403);

    const allowed = await fetch(`${baseUrl}/api/services/12`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ exec_status: 'em_deslocamento' })
    });
    assert.equal(allowed.status, 200);
    assert.equal(state.services.find(service => service.id === 12).exec_status, 'em_deslocamento');
  });
});
