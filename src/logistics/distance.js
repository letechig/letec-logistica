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

function parseCoordinate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function haversineKm(a, b) {
  if (!a || !b) return null;
  const toRad = value => (Number(value) * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function estimateCoordinateDistance(origem, destino) {
  const origemCoord = parseCoordinate(origem);
  const destinoCoord = parseCoordinate(destino);
  const straightKm = haversineKm(origemCoord, destinoCoord);
  if (!Number.isFinite(straightKm)) return null;
  return Number((straightKm * 1.35).toFixed(1));
}

function matrixElementOk(km, minutos, origin = 'estimado') {
  return {
    status: 'OK',
    distance: {
      text: `${Number(km || 0).toLocaleString('pt-BR')} km`,
      value: Math.round(Number(km || 0) * 1000),
    },
    duration: {
      text: `${Math.round(Number(minutos || 0))} min`,
      value: Math.round(Number(minutos || 0) * 60),
    },
    origin,
  };
}

function matrixElementUnknown(origin = 'desconhecido') {
  return {
    status: 'ZERO_RESULTS',
    distance: { text: '', value: 0 },
    duration: { text: '', value: 0 },
    origin,
  };
}

class DistanceClient {
  constructor(options = {}) {
    this.cache = options.cache || new Map();
  }

  isRoutingConfigured() {
    return false;
  }

  isGeocodingConfigured() {
    return false;
  }

  normalizeAddress(address) {
    return String(address || '').trim();
  }

  fallback(origem, destino, origemStatus = 'estimado') {
    if (!origem || !destino) return { km: null, minutos: null, origem: 'desconhecido' };
    if (isSameOperationalAddress(origem, destino)) return { km: 0, minutos: 0, origem: 'mesmo_local' };

    const coordKm = estimateCoordinateDistance(origem, destino);
    if (Number.isFinite(coordKm)) {
      const minutos = coordKm <= 0
        ? 0
        : Math.max(8, Math.round((coordKm / 28) * 60));
      return { km: coordKm, minutos, origem: origemStatus };
    }

    return {
      km: Number(estimateDistance(origem, destino).toFixed(1)),
      minutos: estimateTravelMinutes(origem, destino),
      origem: origemStatus,
    };
  }

  async getDistance(origem, destino) {
    const origemFmt = this.normalizeAddress(origem);
    const destinoFmt = this.normalizeAddress(destino);
    const cacheKey = `estimated|${origemFmt}|${destinoFmt}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
    const result = this.fallback(origemFmt, destinoFmt, origemFmt && destinoFmt ? 'estimado' : 'desconhecido');
    this.cache.set(cacheKey, result);
    return result;
  }

  async buildDistanceMatrix(origins, destinations) {
    const originList = (origins || []).map(item => this.normalizeAddress(item));
    const destinationList = (destinations || []).map(item => this.normalizeAddress(item));
    return this.buildEstimatedMatrix(originList, destinationList);
  }

  buildEstimatedMatrix(origins, destinations) {
    return {
      destination_addresses: destinations,
      origin_addresses: origins,
      rows: origins.map(origem => ({
        elements: destinations.map(destino => {
          const dist = this.fallback(origem, destino, origem && destino ? 'estimado' : 'desconhecido');
          if (!Number.isFinite(Number(dist.km)) || !Number.isFinite(Number(dist.minutos))) {
            return matrixElementUnknown(dist.origem);
          }
          return matrixElementOk(Number(dist.km), Number(dist.minutos), dist.origem);
        }),
      })),
      status: 'OK',
      provider: 'estimated',
    };
  }
}

module.exports = {
  DistanceClient,
  parseCoordinate,
  parseMatrixLocations,
  matrixElementOk,
};
