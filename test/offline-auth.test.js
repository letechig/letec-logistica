const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadOfflineAuth() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'shared', 'offline-auth.js'), 'utf8');
  const context = vm.createContext({ window: {} });
  vm.runInContext(source, context, { filename: 'offline-auth.js' });
  return context.window.LetecOfflineAuth;
}

const offlineAuth = loadOfflineAuth();
const now = Date.parse('2026-08-20T12:00:00.000Z');
const user = { id: 7, email: 'operacao@letec.test', name: 'Operação', role: 'operador' };
const session = {
  token: 'app_test',
  session_id: 42,
  expires_at: '2026-09-01T12:00:00.000Z',
  user
};

test('permite contingência por até 24 horas para sessão previamente validada', () => {
  const proof = offlineAuth.buildProof({ user, session, authType: 'legacy_session', now });
  const decision = offlineAuth.evaluateProof({
    proof,
    session,
    authType: 'legacy_session',
    now: now + 23 * 60 * 60 * 1000
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.user.role, 'operador');
});

test('nega contingência quando a janela offline expirou', () => {
  const proof = offlineAuth.buildProof({ user, session, authType: 'legacy_session', now });
  const decision = offlineAuth.evaluateProof({
    proof,
    session,
    authType: 'legacy_session',
    now: now + 24 * 60 * 60 * 1000
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'offline_window_expired');
});

test('respeita uma janela de migração menor que o limite padrão', () => {
  const proof = offlineAuth.buildProof({
    user,
    session,
    authType: 'legacy_session',
    now,
    maxAgeMs: 8 * 60 * 60 * 1000
  });
  assert.equal(offlineAuth.evaluateProof({
    proof,
    session,
    authType: 'legacy_session',
    now: now + 7 * 60 * 60 * 1000
  }).allowed, true);
  const expired = offlineAuth.evaluateProof({
    proof,
    session,
    authType: 'legacy_session',
    now: now + 8 * 60 * 60 * 1000
  });
  assert.equal(expired.allowed, false);
  assert.equal(expired.reason, 'offline_window_expired');
});

test('nunca ultrapassa o vencimento real da sessão', () => {
  const shortSession = { ...session, expires_at: new Date(now + 2 * 60 * 60 * 1000).toISOString() };
  const proof = offlineAuth.buildProof({ user, session: shortSession, authType: 'legacy_session', now });
  const decision = offlineAuth.evaluateProof({
    proof,
    session: shortSession,
    authType: 'legacy_session',
    now: now + 2 * 60 * 60 * 1000
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'offline_window_expired');
});

test('nega prova vinculada a outra sessão ou usuário', () => {
  const proof = offlineAuth.buildProof({ user, session, authType: 'legacy_session', now });
  const otherSession = { ...session, session_id: 99 };
  const decision = offlineAuth.evaluateProof({ proof, session: otherSession, authType: 'legacy_session', now });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'session_mismatch');
});

test('não cria acesso offline para perfil sem permissão operacional', () => {
  const proof = offlineAuth.buildProof({
    user: { ...user, role: 'viewer' },
    session: { ...session, user: { ...user, role: 'viewer' } },
    authType: 'legacy_session',
    now
  });
  assert.equal(proof, null);
});

test('só trata falhas transitórias como elegíveis para contingência', () => {
  assert.equal(offlineAuth.isRetryableAuthFailure(503), true);
  assert.equal(offlineAuth.isRetryableAuthFailure(429), true);
  assert.equal(offlineAuth.isRetryableAuthFailure(0, new Error('Failed to fetch')), true);
  assert.equal(offlineAuth.isRetryableAuthFailure(401), false);
  assert.equal(offlineAuth.isRetryableAuthFailure(403), false);
});

test('modo de contingência permite apenas métodos de leitura no backend', () => {
  assert.equal(offlineAuth.isReadOnlyRequestMethod('GET'), true);
  assert.equal(offlineAuth.isReadOnlyRequestMethod('head'), true);
  assert.equal(offlineAuth.isReadOnlyRequestMethod('POST'), false);
  assert.equal(offlineAuth.isReadOnlyRequestMethod('DELETE'), false);
});
