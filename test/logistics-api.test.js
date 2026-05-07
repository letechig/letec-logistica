const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon';
delete process.env.GOOGLE_MAPS_API_KEY;

const app = require('../server');
process.env.GOOGLE_MAPS_API_KEY = '';

const technicians = [{ id: 't1', nome: 'Ana' }];
const serviceTypes = [{ sigla: 'DS', nome: 'Desinsetização', duracao_minutos: 60 }];
const services = [
  { id: 1, date: '2026-05-07', horario: '08:00', tipos: ['DS'], tecnicos_ids: ['t1'], endereco: 'Rua A, 1' },
  { id: 2, date: '2026-05-07', horario: '10:00', tipos: ['DS'], tecnicos_ids: ['t1'], endereco: 'Rua B, 2' },
];

function makeMockSupabase() {
  return {
    from(table) {
      const dataByTable = { service_types: serviceTypes, technicians, services };
      const builder = {
        select() { return builder; },
        order() { return Promise.resolve({ data: dataByTable[table] || [], error: null }); },
        or() { return builder; },
        limit() { return Promise.resolve({ data: dataByTable[table] || [], error: null }); },
        ilike() { return builder; },
        eq() { return builder; },
        insert() { return builder; },
        upsert() { return builder; },
        update() { return builder; },
        delete() { return builder; },
        then(resolve) { return resolve({ data: dataByTable[table] || [], error: null }); },
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
