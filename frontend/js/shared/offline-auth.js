(function () {
  const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const ALLOWED_ROLES = new Set(['admin', 'operador']);

  function timeMs(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 100000000000 ? value * 1000 : value;
    }
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  function userIdentity(user = {}) {
    return String(user.id || user.auth_user_id || user.email || '').trim().toLowerCase();
  }

  function safeUser(user = {}) {
    return {
      id: user.id ?? null,
      auth_user_id: user.auth_user_id ?? null,
      email: String(user.email || '').trim().toLowerCase(),
      name: String(user.name || user.nome || user.user_metadata?.name || user.user_metadata?.nome || '').trim(),
      role: String(user.role || '').trim().toLowerCase()
    };
  }

  function isAllowedUser(user) {
    const normalized = safeUser(user);
    return !!userIdentity(normalized) && ALLOWED_ROLES.has(normalized.role);
  }

  function sessionExpiryMs(session = {}) {
    return timeMs(session.expires_at ?? session.session_expires_at);
  }

  function sessionReference(session = {}, authType = 'legacy_session') {
    const user = session.user || {};
    const identity = userIdentity(user);
    const expiry = sessionExpiryMs(session) || '';
    if (session.session_id !== undefined && session.session_id !== null && session.session_id !== '') {
      return `${authType}:sid:${session.session_id}:${identity}`;
    }
    return `${authType}:session:${expiry}:${identity}`;
  }

  function buildProof({ user, session, authType = 'legacy_session', now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
    const normalizedUser = safeUser(user || session?.user || {});
    if (!isAllowedUser(normalizedUser)) return null;
    const verifiedAtMs = timeMs(now);
    const expiresAtMs = sessionExpiryMs(session || {});
    if (!verifiedAtMs || !expiresAtMs || expiresAtMs <= verifiedAtMs) return null;
    const allowedAge = Math.max(1, Math.min(Number(maxAgeMs) || DEFAULT_MAX_AGE_MS, DEFAULT_MAX_AGE_MS));
    const offlineUntilMs = Math.min(expiresAtMs, verifiedAtMs + allowedAge);
    return {
      version: 1,
      auth_type: authType,
      session_ref: sessionReference({ ...(session || {}), user: normalizedUser }, authType),
      user: normalizedUser,
      verified_at: new Date(verifiedAtMs).toISOString(),
      offline_until: new Date(offlineUntilMs).toISOString(),
      session_expires_at: new Date(expiresAtMs).toISOString()
    };
  }

  function evaluateProof({ proof, session, authType = 'legacy_session', now = Date.now() } = {}) {
    const nowMs = timeMs(now);
    if (!proof || proof.version !== 1 || !nowMs) return { allowed: false, reason: 'missing_proof' };
    if (proof.auth_type !== authType) return { allowed: false, reason: 'auth_type_mismatch' };
    if (!isAllowedUser(proof.user)) return { allowed: false, reason: 'invalid_user' };

    const sessionUser = session?.user || proof.user;
    if (!isAllowedUser(sessionUser) || userIdentity(sessionUser) !== userIdentity(proof.user)) {
      return { allowed: false, reason: 'user_mismatch' };
    }

    const expectedRef = sessionReference({ ...(session || {}), user: sessionUser }, authType);
    if (!expectedRef || proof.session_ref !== expectedRef) return { allowed: false, reason: 'session_mismatch' };

    const verifiedAtMs = timeMs(proof.verified_at);
    const offlineUntilMs = timeMs(proof.offline_until);
    const proofExpiryMs = timeMs(proof.session_expires_at);
    const sessionExpiresAtMs = sessionExpiryMs(session || {});
    if (!verifiedAtMs || !offlineUntilMs || !proofExpiryMs || !sessionExpiresAtMs) {
      return { allowed: false, reason: 'invalid_dates' };
    }
    if (verifiedAtMs > nowMs + 5 * 60 * 1000) return { allowed: false, reason: 'future_proof' };
    if (offlineUntilMs - verifiedAtMs > DEFAULT_MAX_AGE_MS) return { allowed: false, reason: 'excessive_window' };
    if (nowMs >= offlineUntilMs) return { allowed: false, reason: 'offline_window_expired' };
    if (nowMs >= proofExpiryMs || nowMs >= sessionExpiresAtMs) return { allowed: false, reason: 'session_expired' };

    return {
      allowed: true,
      reason: 'verified_session',
      user: safeUser(proof.user),
      verifiedAt: new Date(verifiedAtMs).toISOString(),
      offlineUntil: new Date(offlineUntilMs).toISOString()
    };
  }

  function isRetryableAuthFailure(status, error) {
    const numericStatus = Number(status || error?.status || 0);
    if ([408, 425, 429].includes(numericStatus) || numericStatus >= 500) return true;
    if (numericStatus >= 400) return false;
    const message = String(error?.message || error || '').toLowerCase();
    return !numericStatus && (
      error instanceof TypeError ||
      message.includes('fetch') ||
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('connection')
    );
  }

  function isReadOnlyRequestMethod(method) {
    return ['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase());
  }

  window.LetecOfflineAuth = Object.freeze({
    DEFAULT_MAX_AGE_MS,
    buildProof,
    evaluateProof,
    isAllowedUser,
    isReadOnlyRequestMethod,
    isRetryableAuthFailure,
    safeUser,
    sessionReference
  });
})();
