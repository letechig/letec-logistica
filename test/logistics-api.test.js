const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon';

const app = require('../server');

const technicians = [{ id: 't1', nome: 'Ana' }];
const serviceTypes = [{ sigla: 'DS', nome: 'Desinsetizacao', duracao_minutos: 60 }];
const services = [
  { id: 1, date: '2026-05-07', horario: '08:00', tipos: ['DS'], tecnicos_ids: ['t1'], endereco: 'Rua A, 1', cliente_id: 10, customer_address_id: 'a10' },
  { id: 2, date: '2026-05-07', horario: '10:00', tipos: ['DS'], tecnicos_ids: ['t1'], endereco: 'Rua B, 2' },
  { id: 3, date: '2026-05-08', horario: '12:00', tipos: ['DS'], tecnicos_ids: ['t1'], endereco: 'Rua C, 3', latitude: 0, longitude: 0 },
];

function makeMockSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'admin@letec.test' } }, error: null }) },
    from(table) {
      const dataByTable = {
        service_types: serviceTypes,
        technicians,
        services,
        customers: [{ id: 10, nome: 'Cliente Mapa', endereco: 'Rua Cadastro, 10', cidade: 'Sao Paulo' }],
        customer_addresses: [{ id: 'a10', customer_id: 10, endereco: 'Rua A, 1', is_primary: true }],
        app_users: [{ id: 1, auth_user_id: 'user-1', email: 'admin@letec.test', role: 'admin', active: true }]
      };
      const builder = {
        _in: null,
        _filters: [],
        _or: null,
        _limit: null,
        select() { return builder; },
        order() { return builder; },
        or(expr) { builder._or = String(expr || ''); return builder; },
        limit(n) { builder._limit = n; return builder; },
        ilike() { return builder; },
        eq(key, value) { builder._filters.push({ key, value }); return builder; },
        in(key, values) { builder._in = { key, values: (values || []).map(String) }; return builder; },
        insert() { return builder; },
        upsert() { return builder; },
        update() { return builder; },
        delete() { return builder; },
        then(resolve) { return resolve({ data: builder._rows(), error: null }); },
        _rows() {
          let rows = dataByTable[table] || [];
          for (const filter of builder._filters) rows = rows.filter(row => String(row[filter.key]) === String(filter.value));
          if (builder._in) rows = rows.filter(row => builder._in.values.includes(String(row[builder._in.key])));
          if (builder._or) {
            const terms = builder._or.split(',').map(part => part.match(/^([^.]+)\.eq\.(.+)$/)).filter(Boolean);
            rows = rows.filter(row => terms.some(([, key, value]) => String(row[key]) === String(value)));
          }
          if (builder._limit != null) rows = rows.slice(0, builder._limit);
          return rows;
        }
      };
      return builder;
    },
  };
}

async function withServer(fn) {
  app.locals.supabase = makeMockSupabase();
  const server = app.listen(0);
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('POST /api/logistics/validate-service valida com payload local sem Supabase', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/logistics/validate-service`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: {
          id: 3,
          date: '2026-05-07',
          horario: '08:30',
          tipos: ['DS'],
          tecnicos_ids: ['t1'],
          endereco: 'Rua C, 3',
        },
        services,
        serviceTypes,
        technicians,
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, 'critico');
    assert.equal(payload.exigeJustificativa, true);
    assert.equal(typeof payload.scoreOperacional, 'number');
    assert.ok(['alta', 'baixa'].includes(payload.confiabilidadeGeral));
  });
});

test('GET /api/logistics/day-route calcula roteiro usando mock Supabase', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/logistics/day-route?date=2026-05-07`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.totalServices, 2);
    assert.equal(payload.routes.length, 1);
    assert.equal(payload.routes[0].warnings.length > 0, true);
    assert.equal(typeof payload.routes[0].scoreOperacional, 'number');
    assert.ok(['alta', 'baixa'].includes(payload.routes[0].confiabilidadeGeral));
  });
});

test('GET /api/health anuncia geocodificacao OpenStreetMap', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.mapsProvider, 'local_estimate');
    assert.equal(payload.routingConfigured, false);
    assert.equal(payload.geocodingConfigured, true);
    assert.equal(payload.cepLookupConfigured, true);
    assert.equal(payload.mapsProxy, false);
  });
});

test('GET /api/services ignora coordenada zero-zero invalida', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/services`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    const service = payload.find(item => item.id === 3);
    assert.ok(service);
    assert.equal(service.latitude, null);
    assert.equal(service.longitude, null);
  });
});

test('GET /api/maps/distance-matrix responde compativel sem Google configurado', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/maps/distance-matrix?origins=Rua A, 1&destinations=Rua B, 2`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, 'OK');
    assert.equal(payload.provider, 'estimated');
    assert.equal(payload.rows[0].elements[0].status, 'OK');
    assert.equal(payload.rows[0].elements[0].origin, 'estimado');
  });
});

test('GET /api/geocode rejeita endereco arbitrario', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/geocode?address=${encodeURIComponent('Rua Maria Jose Rangel, 135')}`);
    assert.equal(response.status, 405);
    const payload = await response.json();
    assert.equal(payload.code, 'service_geocode_required');
  });
});

test('GET /api/services resolve endereco do servico antes do cadastro', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/services`);
    const payload = await response.json();
    const service = payload.find(item => item.id === 1);
    assert.equal(service.resolved_address, 'Rua A, 1');
    assert.equal(service.resolved_address_source, 'service');
  });
});

test('POST /api/services/:id/geocode localiza endereco vinculado e nao aceita payload arbitrario', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://nominatim.openstreetmap.org/search')) {
      return new Response(JSON.stringify([{
        lat: '-23.55052', lon: '-46.63331', display_name: 'Rua A, 1, Sao Paulo, Brasil',
        address: { house_number: '1', city: 'Sao Paulo' }
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(url, options);
  };
  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/services/1/geocode`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: 'Endereco malicioso, 999' })
      });
      const payload = await response.json();
      assert.equal(response.status, 200, JSON.stringify(payload));
      assert.equal(payload.address, 'Rua A, 1');
      assert.equal(payload.location.latitude, -23.55052);
      assert.equal(payload.target, 'customer_address');
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('GET /api/cep normaliza BrasilAPI v2 com coordenadas', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://brasilapi.com.br/api/cep/v2/')) {
      return new Response(JSON.stringify({
        cep: '01001000',
        state: 'SP',
        city: 'Sao Paulo',
        neighborhood: 'Se',
        street: 'Praca da Se',
        location: { coordinates: { latitude: '-23.55052', longitude: '-46.63331' } }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(url, options);
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/cep/01001000`);
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.provider, 'brasilapi');
      assert.equal(payload.cep, '01001-000');
      assert.equal(payload.rua, 'Praca da Se');
      assert.equal(payload.cidade, 'Sao Paulo');
      assert.equal(payload.latitude, -23.55052);
      assert.equal(payload.longitude, -46.63331);
    });
  } finally {
    global.fetch = originalFetch;
  }
});
