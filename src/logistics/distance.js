const {
  isSameOperationalAddress,
  estimateDistance,
  estimateTravelMinutes,
} = require('./engine');

function parseMatrixLocations(value) {
  return String(value || '')
    .split('|')
    .map(item => item.trim())
    .filter(Boolean);
}

function buildMatrixUrl(origins, destinations, apiKey) {
  const search = new URLSearchParams({
    origins: origins.join('|'),
    destinations: destinations.join('|'),
    mode: 'driving',
    language: 'pt-BR',
    region: 'br',
    key: apiKey || '',
  });
  return `https://maps.googleapis.com/maps/api/distancematrix/json?${search.toString()}`;
}

class DistanceClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || '';
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = Number(options.timeoutMs || 12000);
    this.cache = options.cache || new Map();
  }

  normalizeAddress(address) {
    const base = String(address || '').trim();
    if (!base) return '';
    return /sao paulo|são paulo|\bsp\b/i.test(base) ? base : `${base}, São Paulo, SP`;
  }

  fallback(origem, destino, origemStatus = 'estimado') {
    if (!origem || !destino) return { km: null, minutos: null, origem: 'desconhecido' };
    if (isSameOperationalAddress(origem, destino)) return { km: 0, minutos: 0, origem: 'mesmo_local' };
    return {
      km: Number(estimateDistance(origem, destino).toFixed(1)),
      minutos: estimateTravelMinutes(origem, destino),
      origem: origemStatus,
    };
  }

  async getDistance(origem, destino) {
    const origemFmt = this.normalizeAddress(origem);
    const destinoFmt = this.normalizeAddress(destino);
    if (!origemFmt || !destinoFmt) return this.fallback(origemFmt, destinoFmt, 'desconhecido');
    if (isSameOperationalAddress(origemFmt, destinoFmt)) return { km: 0, minutos: 0, origem: 'mesmo_local' };

    const cacheKey = `${origemFmt}|${destinoFmt}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
    if (!this.apiKey) {
      const fallback = this.fallback(origemFmt, destinoFmt, 'estimado');
      this.cache.set(cacheKey, fallback);
      return fallback;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(buildMatrixUrl([origemFmt], [destinoFmt], this.apiKey), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json();
      const element = payload?.rows?.[0]?.elements?.[0];
      if (response.ok && payload.status === 'OK' && element?.status === 'OK') {
        const result = {
          km: Number(((Number(element.distance?.value) || 0) / 1000).toFixed(1)),
          minutos: Math.max(0, Math.round((Number(element.duration?.value) || 0) / 60)),
          origem: 'google',
        };
        this.cache.set(cacheKey, result);
        return result;
      }
      const fallback = this.fallback(origemFmt, destinoFmt, 'estimado');
      this.cache.set(cacheKey, fallback);
      return fallback;
    } catch (error) {
      const fallback = this.fallback(origemFmt, destinoFmt, 'estimado');
      this.cache.set(cacheKey, fallback);
      return fallback;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = {
  DistanceClient,
  parseMatrixLocations,
  buildMatrixUrl,
};
