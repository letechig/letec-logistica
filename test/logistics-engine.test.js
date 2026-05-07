const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolverDuracao,
  validateService,
  buildDayRoutes,
  buildRouteForGroup,
  groupServicesByTechnician,
  isSameOperationalAddress,
} = require('../src/logistics/engine');

const technicians = [
  { id: 't1', nome: 'Ana' },
  { id: 't2', nome: 'Bruno' },
];

const serviceTypes = [
  { sigla: 'DS', nome: 'Desinsetização', duracao_minutos: 60 },
  { sigla: 'DR', nome: 'Desratização', duracao_minutos: 60 },
  { sigla: 'LCA', nome: 'Limpeza Caixa Água', duracao_minutos: 180 },
  { sigla: 'VIS', nome: 'Vistoria', duracao_minutos: 30 },
];

const fixedDistance = {
  async getDistance(origem, destino) {
    if (String(origem) === String(destino) || /Mesmo Local/.test(`${origem} ${destino}`)) {
      return { km: 0, minutos: 0, origem: 'mesmo_local' };
    }
    return { km: 12, minutos: 35, origem: 'estimado' };
  },
};

test('resolve duração por prioridade: tempo real, intervalo, catálogo e fallback', () => {
  assert.equal(resolverDuracao({ tempo_execucao: 42 }, serviceTypes).minutos, 42);
  assert.deepEqual(resolverDuracao({
    tempo_execucao: 42,
    inicio_hora: '2026-05-07T08:00:00-03:00',
    fim_hora: '2026-05-07T09:15:00-03:00',
  }, serviceTypes), { minutos: 75, origem: 'inicio_fim', mensagens: [] });
  assert.deepEqual(resolverDuracao({ tipos: ['DS', 'DR'] }, serviceTypes), {
    minutos: 120,
    origem: 'service_types',
    mensagens: [],
  });
  assert.equal(resolverDuracao({ tipoServico: 'Tipo sem mapa' }, []).minutos, 90);
});

test('comparação de endereço é conservadora e não usa prefixo parcial de token', () => {
  assert.equal(
    isSameOperationalAddress('Rua José Maria, 100 - Vila Mariana', 'Rua José Marcelo, 100 - Vila Mariana'),
    false
  );
  assert.equal(
    isSameOperationalAddress('Rua Padre Anchieta, 100 - Pinheiros', 'Rua Anchieta, 100 - Pinheiros'),
    true
  );
});

test('serviço sem técnico vira pré-agendamento com alerta operacional', async () => {
  const result = await validateService({
    id: 1,
    date: '2026-05-07',
    horario: '09:00',
    tipos: ['DS'],
    endereco: 'Rua A, 1',
  }, { services: [], serviceTypes, technicians, distanceClient: fixedDistance });

  assert.equal(result.status, 'pre_agendamento');
  assert.equal(result.podeSalvar, true);
});

test('sobreposição do mesmo técnico vira crítico e exige justificativa', async () => {
  const services = [{
    id: 1,
    date: '2026-05-07',
    horario: '09:00',
    tipos: ['DS'],
    tecnicos_ids: ['t1'],
    endereco: 'Rua A, 1',
  }];

  const result = await validateService({
    id: 2,
    date: '2026-05-07',
    horario: '09:30',
    tipos: ['DR'],
    tecnicos_ids: ['t1'],
    endereco: 'Rua B, 2',
  }, { services, serviceTypes, technicians, distanceClient: fixedDistance });

  assert.equal(result.status, 'critico');
  assert.equal(result.exigeJustificativa, true);
  assert.equal(result.detalhes.regraAplicada, 'sobreposicao');
});

test('deslocamento estimado insuficiente gera alerta, não bloqueio', async () => {
  const services = [{
    id: 1,
    date: '2026-05-07',
    horario: '08:00',
    tipos: ['DS'],
    tecnicos_ids: ['t1'],
    endereco: 'Rua A, 1',
  }];

  const result = await validateService({
    id: 2,
    date: '2026-05-07',
    horario: '09:05',
    tipos: ['VIS'],
    tecnicos_ids: ['t1'],
    endereco: 'Rua B, 2',
  }, { services, serviceTypes, technicians, distanceClient: fixedDistance });

  assert.equal(result.status, 'alerta');
  assert.equal(result.podeSalvar, true);
  assert.match(result.mensagens.join(' '), /estimativa|Deslocamento/i);
});

test('jornada muito acima do limite vira crítico', async () => {
  const services = Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    date: '2026-05-07',
    horario: `${String(8 + i).padStart(2, '0')}:00`,
    tempo_execucao: 120,
    tecnicos_ids: ['t1'],
    endereco: `Rua ${i}, 1`,
  }));

  const result = await validateService({
    id: 99,
    date: '2026-05-07',
    horario: '16:00',
    tempo_execucao: 120,
    tecnicos_ids: ['t1'],
    endereco: 'Rua Z, 9',
  }, { services, serviceTypes, technicians, distanceClient: fixedDistance });

  assert.equal(result.status, 'critico');
  assert.equal(result.exigeJustificativa, true);
});

test('descanso mínimo entre dias vira crítico', async () => {
  const services = [{
    id: 1,
    date: '2026-05-06',
    horario: '22:00',
    tempo_execucao: 120,
    tecnicos_ids: ['t1'],
    endereco: 'Rua Noite, 1',
  }];

  const result = await validateService({
    id: 2,
    date: '2026-05-07',
    horario: '08:00',
    tipos: ['VIS'],
    tecnicos_ids: ['t1'],
    endereco: 'Rua Manhã, 2',
  }, { services, serviceTypes, technicians, distanceClient: fixedDistance });

  assert.equal(result.status, 'critico');
  assert.match(result.mensagens.join(' '), /Descanso/);
});

test('descanso mínimo usa linha do tempo contínua quando serviço anterior passa de meia-noite', async () => {
  const services = [{
    id: 1,
    date: '2026-05-06',
    horario: '23:30',
    tempo_execucao: 90,
    tecnicos_ids: ['t1'],
    endereco: 'Rua Noite, 1',
  }];

  const result = await validateService({
    id: 2,
    date: '2026-05-07',
    horario: '09:00',
    tipos: ['VIS'],
    tecnicos_ids: ['t1'],
    endereco: 'Rua Manhã, 2',
  }, { services, serviceTypes, technicians, distanceClient: fixedDistance });

  assert.equal(result.status, 'critico');
  assert.match(result.mensagens.join(' '), /Descanso/);
});

test('agrupa técnico individual e equipe compartilhada', () => {
  const groups = groupServicesByTechnician([
    { id: 1, tecnicos_ids: ['t1'] },
    { id: 2, tecnicos_ids: ['t1', 't2'] },
  ], technicians);

  assert.equal(groups.length, 2);
  assert.ok(groups.some(g => g.id === 't1'));
  assert.ok(groups.some(g => g.id === 'shared:t1|t2'));
});

test('roteiro do dia retorna totais e alerta quando Maps não é real', async () => {
  const result = await buildDayRoutes([
    { id: 1, date: '2026-05-07', horario: '08:00', tipos: ['DS'], tecnicos_ids: ['t1'], endereco: 'Rua A, 1' },
    { id: 2, date: '2026-05-07', horario: '10:00', tipos: ['DR'], tecnicos_ids: ['t1'], endereco: 'Rua B, 2' },
  ], { date: '2026-05-07', serviceTypes, technicians, distanceClient: fixedDistance });

  assert.equal(result.totalServices, 2);
  assert.equal(result.routes.length, 1);
  assert.equal(result.routes[0].status, 'alerta');
  assert.equal(result.totals.warningRoutes, 1);
});

test('buildRouteForGroup cacheia distâncias repetidas e inclui retorno à base por padrão', async () => {
  let calls = 0;
  const countingDistance = {
    async getDistance(origem, destino) {
      calls += 1;
      if (/Rua A/.test(String(origem)) && /88VH/.test(String(destino))) {
        return { km: 8, minutos: 20, origem: 'google' };
      }
      return { km: 4, minutos: 10, origem: 'google' };
    },
  };

  const route = await buildRouteForGroup({
    id: 't1',
    equipe: 'Ana',
    tecnicos_ids: ['t1'],
    svcs: [{ id: 1, date: '2026-05-07', horario: '08:00', tipos: ['DS'], endereco: 'Rua A, 1' }],
  }, { serviceTypes, distanceClient: countingDistance });

  assert.equal(calls, 2);
  assert.equal(route.retornoBaseMin, 20);
  assert.equal(route.retornoBaseKm, 8);
  assert.equal(route.tempoTotalMin, 90);
  assert.equal(route.confiabilidadeGeral, 'alta');
  assert.equal(route.esperaTotalMin, 0);
  assert.equal(route.atrasoTotalMin, 10);
  assert.equal(route.scoreOperacional >= 80, true);
});

test('buildRouteForGroup mantém compatibilidade quando retorno à base é desativado', async () => {
  const route = await buildRouteForGroup({
    id: 't1',
    equipe: 'Ana',
    tecnicos_ids: ['t1'],
    svcs: [{ id: 1, date: '2026-05-07', horario: '08:00', tipos: ['DS'], endereco: 'Rua A, 1' }],
  }, {
    serviceTypes,
    config: { incluirRetornoBase: false },
    distanceClient: { async getDistance() { return { km: 4, minutos: 10, origem: 'google' }; } },
  });

  assert.equal(route.retornoBaseMin, 0);
  assert.equal(route.retornoBaseKm, 0);
  assert.equal(route.tempoTotalMin, 70);
});

test('buildRouteForGroup expõe espera, atraso, confiabilidade e score operacional', async () => {
  const route = await buildRouteForGroup({
    id: 't1',
    equipe: 'Ana',
    tecnicos_ids: ['t1'],
    svcs: [
      { id: 1, date: '2026-05-07', horario: '08:30', tipos: ['VIS'], endereco: 'Rua A, 1' },
      { id: 2, date: '2026-05-07', horario: '08:35', tipos: ['VIS'], endereco: 'Rua B, 2' },
    ],
  }, {
    serviceTypes,
    config: { incluirRetornoBase: false },
    distanceClient: {
      async getDistance(origem, destino) {
        if (/Rua A/.test(String(destino))) return { km: 5, minutos: 10, origem: 'estimado' };
        return { km: 5, minutos: 20, origem: 'estimado' };
      },
    },
  });

  assert.equal(route.confiabilidadeGeral, 'baixa');
  assert.equal(route.sequencia[0].confiabilidadeDistancia, 'baixa');
  assert.equal(route.sequencia[0].esperaMin, 20);
  assert.equal(route.sequencia[1].atrasoMin, 45);
  assert.equal(route.esperaTotalMin, 20);
  assert.equal(route.atrasoTotalMin, 45);
  assert.equal(route.classificacaoOperacional, 'atencao');
  assert.ok(route.motivosScore.some(m => /Distância estimada/.test(m)));
});

test('validateService usa jornada com serviços, deslocamentos e retorno à base', async () => {
  const services = [{
    id: 1,
    date: '2026-05-07',
    horario: '08:00',
    tempo_execucao: 50,
    tecnicos_ids: ['t1'],
    endereco: 'Rua A, 1',
  }];
  const routeDistance = {
    async getDistance(origem, destino) {
      if (/Rua A/.test(String(origem)) && /Rua B/.test(String(destino))) {
        return { km: 8, minutos: 20, origem: 'google' };
      }
      return { km: 6, minutos: 15, origem: 'google' };
    },
  };

  const result = await validateService({
    id: 2,
    date: '2026-05-07',
    horario: '09:30',
    tempo_execucao: 50,
    tecnicos_ids: ['t1'],
    endereco: 'Rua B, 2',
  }, {
    services,
    serviceTypes,
    technicians,
    distanceClient: routeDistance,
    config: { jornadaMin: 130, incluirRetornoBase: true },
  });

  assert.equal(result.status, 'alerta');
  assert.equal(result.detalhes.regraAplicada, 'jornada_estourada');
  assert.equal(result.confiabilidadeGeral, 'alta');
  assert.equal(Number.isFinite(result.scoreOperacional), true);
  assert.match(result.mensagens.join(' '), /incluindo deslocamentos/);
});

test('validateService respeita modo de validação rígido sem mudar o padrão flexível', async () => {
  const services = [{
    id: 1,
    date: '2026-05-07',
    horario: '09:00',
    tipos: ['DS'],
    tecnicos_ids: ['t1'],
    endereco: 'Rua A, 1',
  }];
  const candidate = {
    id: 2,
    date: '2026-05-07',
    horario: '09:30',
    tipos: ['DR'],
    tecnicos_ids: ['t1'],
    endereco: 'Rua B, 2',
  };

  const flex = await validateService(candidate, { services, serviceTypes, technicians, distanceClient: fixedDistance });
  const rigido = await validateService(candidate, {
    services,
    serviceTypes,
    technicians,
    distanceClient: fixedDistance,
    config: { modoValidacao: 'rigido' },
  });

  assert.equal(flex.status, 'critico');
  assert.equal(flex.podeSalvar, true);
  assert.equal(flex.exigeJustificativa, true);
  assert.equal(rigido.status, 'critico');
  assert.equal(rigido.podeSalvar, false);
  assert.equal(rigido.exigeJustificativa, false);
});
