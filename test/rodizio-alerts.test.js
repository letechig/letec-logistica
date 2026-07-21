const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

const rodizioInfo = app.locals.rodizioInfo;

test('rodizio mapeia todos os finais de placa para o dia correto', () => {
  const expected = {
    1: 'segunda-feira', 2: 'segunda-feira',
    3: 'terca-feira', 4: 'terca-feira',
    5: 'quarta-feira', 6: 'quarta-feira',
    7: 'quinta-feira', 8: 'quinta-feira',
    9: 'sexta-feira', 0: 'sexta-feira'
  };
  Object.entries(expected).forEach(([final, day]) => {
    assert.equal(rodizioInfo(`ABC123${final}`, { date: '2026-07-20' }).dia_rodizio, day);
  });
});

test('rodizio retorna faixas estruturadas e margem preventiva', () => {
  const info = rodizioInfo('ABC-1231', { date: '2026-07-20' });
  assert.deepEqual(info.faixas_restricao, [
    { inicio: '07:00', fim: '10:00' },
    { inicio: '17:00', fim: '20:00' }
  ]);
  assert.equal(info.margem_preventiva_minutos, 60);
  assert.equal(info.situacao, 'rodizio_no_dia');
});

test('rodizio contextualiza margem, restricao e horario livre', () => {
  assert.equal(rodizioInfo('ABC1231', { date: '2026-07-20', time: '05:59' }).situacao, 'livre_agora');
  assert.equal(rodizioInfo('ABC1231', { date: '2026-07-20', time: '06:00' }).situacao, 'atencao');
  assert.equal(rodizioInfo('ABC1231', { date: '2026-07-20', time: '07:00' }).situacao, 'restricao_ativa');
  assert.equal(rodizioInfo('ABC1231', { date: '2026-07-20', time: '10:00' }).situacao, 'livre_agora');
  assert.equal(rodizioInfo('ABC1231', { date: '2026-07-20', time: '16:00' }).situacao, 'atencao');
  assert.equal(rodizioInfo('ABC1231', { date: '2026-07-20', time: '20:00' }).situacao, 'livre_agora');
});

test('rodizio ignora outra data, placa invalida e preserva veiculo utilizavel', () => {
  assert.equal(rodizioInfo('ABC1231', { date: '2026-07-21', time: '08:00' }).situacao, 'sem_rodizio');
  assert.equal(rodizioInfo('123', { date: '2026-07-20', time: '08:00' }).final_placa, null);
  assert.equal(rodizioInfo('', { date: '2026-07-20', time: '08:00' }).status_rodizio_hoje, false);
});
