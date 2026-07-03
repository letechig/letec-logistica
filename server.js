const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const readXlsxFile = require('read-excel-file/node');
const { createClient } = require('@supabase/supabase-js');
const { DistanceClient, parseMatrixLocations } = require('./src/logistics/distance');
const { validateService, buildDayRoutes } = require('./src/logistics/engine');
const { createClientService } = require('./src/services/clientService');
const { createAppointmentService } = require('./src/services/appointmentService');
require('dotenv').config();

const app = express();
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
const PORT = process.env.PORT || 8000;
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12000);
const EVOLUTION_SEND_DELAY_MS = Number(process.env.EVOLUTION_SEND_DELAY_MS || 1200);
const CEP_CACHE_TTL_MS = Number(process.env.CEP_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const CLIENT_IMPORT_WORKBOOK = process.env.CLIENT_IMPORT_WORKBOOK ||
  path.resolve(__dirname, '..', 'BASE_CLIENTES_TRATADA_LETEC (1).xlsx');
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (!allowedOrigins.length) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  credentials: true,
  optionsSuccessStatus: 200
};

const cepLookupCache = new Map();

function rateLimitJsonHandler(message, code) {
  return (req, res, next, options = {}) => {
    res.status(options.statusCode || 429).json({
      error: message,
      code
    });
  };
}

// Rate limiting middleware
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: Number(process.env.GLOBAL_RATE_LIMIT_MAX || 600),
  message: 'Muitas requisições deste endereço IP, tente novamente mais tarde',
  handler: rateLimitJsonHandler('Muitas requisições deste endereço IP, tente novamente mais tarde', 'rate_limited'),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health'  // Allow health checks
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: Number(process.env.STRICT_RATE_LIMIT_MAX || 60),
  message: 'Muitas requisições de escrita, tente novamente em alguns minutos',
  handler: rateLimitJsonHandler('Muitas requisições de escrita, tente novamente em alguns minutos', 'write_rate_limited'),
  standardHeaders: true,
  legacyHeaders: false
});

const technicianLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.TECHNICIAN_LOGIN_RATE_LIMIT_MAX || 8),
  message: 'Muitas tentativas de login. Tente novamente em alguns minutos',
  handler: rateLimitJsonHandler('Muitas tentativas de login. Tente novamente em alguns minutos', 'technician_login_rate_limited'),
  standardHeaders: true,
  legacyHeaders: false
});

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeBrazilWhatsAppNumber(value) {
  const digits = normalizePhone(value);
  if (!digits) return '';
  if (digits.startsWith('55')) {
    const local = digits.slice(2);
    return local.length === 10 || local.length === 11 ? digits : '';
  }
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return '';
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

function normalizeUf(value) {
  const uf = String(value || '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  return uf || null;
}

function normalizeDocument(value) {
  return String(value || '').replace(/\D/g, '');
}

function cleanCell(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function rowToObject(headers, row) {
  return headers.reduce((acc, header, index) => {
    if (header) acc[header] = row[index] === undefined ? null : row[index];
    return acc;
  }, {});
}

async function readImportSheet(sheetName) {
  const sheetResults = await readXlsxFile(CLIENT_IMPORT_WORKBOOK, { sheets: [sheetName] });
  const rows = sheetResults[0]?.data || [];
  const headers = (rows.shift() || []).map(header => cleanCell(header));
  return rows
    .map(row => rowToObject(headers, row))
    .filter(row => Object.values(row).some(value => value !== null && value !== ''));
}

function buildReviewPreviewItem(row, index) {
  const problem = row.contrato_match_nome ? 'nome_parecido' : 'possivel_duplicidade';
  return {
    id: `preview-${index + 1}`,
    customer_id: null,
    tipo_problema: row.observacao_revisao
      ? problem
      : (!row.endereco ? 'endereco_ausente' : (!row.telefone ? 'telefone_ausente' : problem)),
    descricao: cleanCell(row.observacao_revisao) || `Registro de "${cleanCell(row.cliente_oficial) || 'cliente'}" precisa de revisao.`,
    sugestao: 'Previa da planilha: aplique a migracao e rode a importacao para habilitar resolucao.',
    status_revisao: 'pendente',
    origem: [cleanCell(row.origem_cadastro), cleanCell(row.origem_agenda)].filter(Boolean).join(', ') || 'Planilha tratada',
    payload: {
      cliente: cleanCell(row.cliente_oficial),
      endereco: cleanCell(row.endereco),
      telefone: cleanCell(row.telefone),
      cnpjcpf: cleanCell(row.cnpjcpf),
      proposta: cleanCell(row.proposta),
      status_operacional: cleanCell(row.status_operacional),
      tipo_cliente: cleanCell(row.tipo_cliente_final)
    },
    customers: null,
    preview: true
  };
}

function normalizeCustomerName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\b(LTDA|EIRELI|MEI|ME|EPP|S\/?A|SA)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLooseText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCustomerPriority(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const key = normalizeLooseText(raw);
  if (key === 'ALTA') return 'Alta';
  if (key === 'MEDIA') return 'Média';
  if (key === 'BAIXA') return 'Baixa';
  return raw;
}

function customerPriorityAliases(value) {
  const normalized = normalizeCustomerPriority(value);
  if (normalized === 'Média') return ['Média', 'Media', 'média', 'media', 'MÉDIA', 'MEDIA'];
  return normalized ? [normalized] : [];
}

function normalizeCustomerOperationalStatus(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const key = normalizeLooseText(raw);
  if (key === 'ATIVO') return 'Ativo';
  if (key === 'A RENOVAR') return 'A renovar';
  if (key === 'VENCIDO') return 'Vencido';
  if (key === 'EVENTUAL' || key === 'EVENTUAL RECENTE' || key === 'EVENTUAL ANTIGO') return 'Eventual';
  if (key === 'INATIVO' || key === 'HISTORICO INATIVO' || key === 'CANCELADO') return 'Inativo';
  return raw;
}

function customerStatusAliases(value) {
  const normalized = normalizeCustomerOperationalStatus(value);
  if (normalized === 'Eventual') return ['Eventual', 'Eventual recente', 'Eventual antigo'];
  if (normalized === 'Inativo') return ['Inativo', 'Historico/Inativo', 'Histórico/Inativo', 'Cancelado'];
  return normalized ? [normalized] : [];
}

function isInactiveCustomerRecord(customer = {}) {
  return customer?.ativo === false || normalizeCustomerOperationalStatus(customer?.status_operacional) === 'Inativo';
}

function normalizeAddress(value) {
  return normalizeLooseText(value)
    .replace(/\bAVENIDA\b/g, 'AV')
    .replace(/\bRUA\b/g, 'R')
    .replace(/\bESTRADA\b/g, 'EST')
    .replace(/\bRODOVIA\b/g, 'ROD')
    .replace(/\bDOUTOR\b/g, 'DR')
    .replace(/\bPROFESSOR\b/g, 'PROF')
    .replace(/\bCONDOMINIO\b/g, 'COND')
    .replace(/\b(DO|DA|DE|DOS|DAS)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCustomerAddressFingerprint(customer = {}) {
  const cep = String(customer.cep || '').replace(/\D/g, '');
  const structured = [customer.rua, customer.numero, customer.bairro, customer.cidade, customer.uf]
    .filter(Boolean)
    .map(part => String(part).trim())
    .join(' ');
  const fallback = customer.endereco_completo || customer.endereco || '';
  const normalized = normalizeAddress(structured || fallback);
  if (cep && normalized) return `${cep}|${normalized}`;
  return normalized || cep;
}

function addressNumberTokens(address = {}) {
  const text = [address.numero, address.endereco_completo, address.endereco]
    .filter(Boolean)
    .join(' ');
  return [...new Set(String(text).match(/\b\d{1,6}[A-Z]?\b/gi) || [])]
    .map(item => item.toUpperCase());
}

function addressCoreTokens(fingerprint = '') {
  return String(fingerprint || '')
    .split('|')
    .pop()
    .replace(/\b\d{1,6}[A-Z]?\b/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3 && !['VILA', 'JARDIM', 'JD', 'PARQUE'].includes(token));
}

function areEquivalentCustomerAddresses(left = {}, right = {}) {
  const leftFp = buildCustomerAddressFingerprint(left);
  const rightFp = buildCustomerAddressFingerprint(right);
  if (!leftFp || !rightFp) return false;
  if (leftFp === rightFp) return true;

  const leftNumbers = addressNumberTokens(left);
  const rightNumbers = addressNumberTokens(right);
  const sharedNumber = leftNumbers.some(number => rightNumbers.includes(number));
  const leftCore = addressCoreTokens(leftFp);
  const rightCore = addressCoreTokens(rightFp);
  const sharedCore = leftCore.filter(token => rightCore.includes(token));
  if (sharedNumber) return sharedCore.length >= 2;
  return sharedCore.length >= 2 && (!leftNumbers.length || !rightNumbers.length);
}

function hasRelatedCustomerNames(leftName, rightName) {
  const left = normalizeCustomerName(leftName);
  const right = normalizeCustomerName(rightName);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 3 && right.includes(left)) return true;
  if (right.length >= 3 && left.includes(right)) return true;
  return false;
}

class CustomerLinkError extends Error {
  constructor(message, statusCode = 409) {
    super(message);
    this.name = 'CustomerLinkError';
    this.statusCode = statusCode;
  }
}

function buildCustomerAddress({ rua, numero, bairro, cidade, uf, complemento, referencia }) {
  const parts = [];
  if (rua) parts.push(String(rua).trim());
  if (numero) parts.push(String(numero).trim());
  const main = parts.filter(Boolean).join(', ');
  const secondary = [];
  if (bairro) secondary.push(String(bairro).trim());
  if (cidade || uf) secondary.push([cidade, uf].filter(Boolean).map(part => String(part).trim()).join(' / '));
  let address = main;
  if (secondary.length) {
    address += (address ? ' - ' : '') + secondary.join(' - ');
  }
  if (complemento) address += ` / ${String(complemento).trim()}`;
  if (referencia) address += ` / ${String(referencia).trim()}`;
  return address.trim() || null;
}

const CUSTOMER_OPTIONAL_WRITE_COLUMNS = new Set([
  'whatsapp',
  'email',
  'cep',
  'endereco_completo',
  'rua',
  'numero',
  'bairro',
  'cidade',
  'uf',
  'complemento',
  'referencia',
  'latitude',
  'longitude',
  'tipo_local',
  'restricoes_operacionais',
  'nivel_urgencia_padrao',
  'observacoes_operacionais',
  'nome_fantasia',
  'tags',
  'categoria_principal',
  'vendedor_responsavel',
  'observacao_comercial',
  'cadastro_quality_score',
  'cadastro_quality_flags',
  'possui_animais',
  'animais_quais',
  'restricao_horario',
  'acesso_local',
  'precisa_agendar_portaria',
  'precisa_autorizacao_previa',
  'tem_chave_portaria',
  'risco_especial',
  'epis_obrigatorios',
  'melhor_periodo_atendimento',
  'tempo_medio_local',
  'cliente_recorrente',
  'periodicidade',
  'data_ultimo_servico',
  'categoria',
  'tipo',
  'cpf_cnpj',
  'contato',
  'zona',
  'tipo_cliente',
  'status_operacional',
  'prioridade',
  'origem',
  'observacoes',
  'ativo',
  'is_incomplete',
  'updated_at'
]);

function getMissingSchemaColumn(error) {
  if (!error || !['PGRST204', '42703'].includes(error.code)) return null;
  const message = String(error.message || '');
  const match = message.match(/'([^']+)' column/) || message.match(/column\s+\w+\.([a-zA-Z0-9_]+)\s+does not exist/);
  return match ? match[1] : null;
}

function publicDbErrorDetails(error) {
  if (!error) return null;
  const missingColumn = getMissingSchemaColumn(error);
  if (missingColumn) return `Coluna ausente no schema: ${missingColumn}`;
  if (isMissingRelationError(error)) return 'Tabela ou relacao opcional ausente no schema';
  if (error.code === '23505') return 'Registro duplicado por restricao unica';
  return error.code ? `Erro do banco: ${error.code}` : null;
}

async function runCustomerWriteWithSchemaFallback(buildQuery, payload, context) {
  const workingPayload = { ...payload };
  const removedColumns = [];

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const result = await buildQuery(workingPayload);
    if (!result.error) {
      if (removedColumns.length) {
        console.warn(`[${context}] Ignored customer column(s) missing from PostgREST schema cache: ${removedColumns.join(', ')}`);
      }
      return result;
    }

    const missingColumn = getMissingSchemaColumn(result.error);
    if (!missingColumn || !CUSTOMER_OPTIONAL_WRITE_COLUMNS.has(missingColumn) || !(missingColumn in workingPayload)) {
      return result;
    }

    removedColumns.push(missingColumn);
    delete workingPayload[missingColumn];
  }

  return buildQuery(workingPayload);
}

const SERVICE_OPTIONAL_WRITE_COLUMNS = new Set([
  'date',
  'data',
  'cliente_id',
  'customer_address_id',
  'horario',
  'tiposervico',
  'tipos',
  'equipe',
  'veiculo',
  'os',
  'observacoes',
  'status',
  'tecnicos_ids',
  'exec_status',
  'chegada_hora',
  'chegada_lat',
  'chegada_lng',
  'inicio_hora',
  'fim_hora',
  'tempo_espera',
  'tempo_execucao',
  'checklist_servico',
  'problema_descricao',
  'confirmado_cliente',
  'confirmado_cliente_em',
  'agenda_confirmada_tecnico',
  'agenda_confirmada_tecnico_em',
  'client_name_snapshot',
  'address_snapshot',
  'phone_snapshot'
]);

async function runServiceWriteWithSchemaFallback(buildQuery, payload, context) {
  const workingPayload = { ...payload };
  const removedColumns = [];

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const result = await buildQuery(workingPayload);
    if (!result.error) {
      if (removedColumns.length) {
        console.warn(`[${context}] Ignored service column(s) missing from PostgREST schema cache: ${removedColumns.join(', ')}`);
      }
      return result;
    }

    const missingColumn = getMissingSchemaColumn(result.error);
    if (!missingColumn || !SERVICE_OPTIONAL_WRITE_COLUMNS.has(missingColumn) || !(missingColumn in workingPayload)) {
      return result;
    }

    removedColumns.push(missingColumn);
    delete workingPayload[missingColumn];
  }

  return buildQuery(workingPayload);
}

const CUSTOMER_ADDRESS_OPTIONAL_WRITE_COLUMNS = new Set([
  'label',
  'endereco',
  'endereco_completo',
  'cep',
  'rua',
  'numero',
  'bairro',
  'cidade',
  'uf',
  'complemento',
  'referencia',
  'latitude',
  'longitude',
  'zona_regiao',
  'tipo_imovel',
  'bloco_torre_andar',
  'google_maps_url',
  'is_primary',
  'ativo',
  'origem',
  'created_at',
  'updated_at'
]);

async function runCustomerAddressWriteWithSchemaFallback(buildQuery, payload, context) {
  const workingPayload = { ...payload };
  const removedColumns = [];

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const result = await buildQuery(workingPayload);
    if (!result.error) {
      if (removedColumns.length) {
        console.warn(`[${context}] Ignored customer address column(s) missing from PostgREST schema cache: ${removedColumns.join(', ')}`);
      }
      return result;
    }

    const missingColumn = getMissingSchemaColumn(result.error);
    if (!missingColumn || !CUSTOMER_ADDRESS_OPTIONAL_WRITE_COLUMNS.has(missingColumn) || !(missingColumn in workingPayload)) {
      return result;
    }

    removedColumns.push(missingColumn);
    delete workingPayload[missingColumn];
  }

  return buildQuery(workingPayload);
}

const CUSTOMER_CONTACT_OPTIONAL_WRITE_COLUMNS = new Set([
  'customer_id',
  'nome',
  'funcao',
  'telefone',
  'whatsapp',
  'email',
  'recebe_lembrete',
  'recebe_cobranca',
  'recebe_relatorio',
  'is_primary',
  'ativo',
  'created_at',
  'updated_at'
]);

async function runCustomerContactWriteWithSchemaFallback(buildQuery, payload, context) {
  const workingPayload = { ...payload };
  const removedColumns = [];

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const result = await buildQuery(workingPayload);
    if (!result.error) {
      if (removedColumns.length) {
        console.warn(`[${context}] Ignored customer contact column(s) missing from PostgREST schema cache: ${removedColumns.join(', ')}`);
      }
      return result;
    }

    const missingColumn = getMissingSchemaColumn(result.error);
    if (!missingColumn || !CUSTOMER_CONTACT_OPTIONAL_WRITE_COLUMNS.has(missingColumn) || !(missingColumn in workingPayload)) {
      return result;
    }

    removedColumns.push(missingColumn);
    delete workingPayload[missingColumn];
  }

  return buildQuery(workingPayload);
}

const CONTRACT_OPTIONAL_WRITE_COLUMNS = new Set([
  'customer_id',
  'numero_contrato',
  'numero_proposta',
  'data_inicio',
  'data_vencimento',
  'vigencia_inicial',
  'vigencia_final',
  'periodicidade',
  'tipo_servico',
  'local_atendido',
  'customer_address_id',
  'valor',
  'status_contrato',
  'data_ultimo_atendimento',
  'data_proximo_atendimento',
  'proxima_execucao_sugerida',
  'tecnico_preferencial',
  'tempo_estimado',
  'observacao_servico',
  'observacoes',
  'origem',
  'created_at',
  'updated_at'
]);

async function runContractWriteWithSchemaFallback(buildQuery, payload, context) {
  const workingPayload = { ...payload };
  const removedColumns = [];

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const result = await buildQuery(workingPayload);
    if (!result.error) {
      if (removedColumns.length) {
        console.warn(`[${context}] Ignored contract column(s) missing from PostgREST schema cache: ${removedColumns.join(', ')}`);
      }
      return result;
    }

    const missingColumn = getMissingSchemaColumn(result.error);
    if (!missingColumn || !CONTRACT_OPTIONAL_WRITE_COLUMNS.has(missingColumn) || !(missingColumn in workingPayload)) {
      return result;
    }

    removedColumns.push(missingColumn);
    delete workingPayload[missingColumn];
  }

  return buildQuery(workingPayload);
}

function isMissingRelationError(error) {
  if (!error) return false;
  const text = `${error.code || ''} ${error.message || ''} ${error.details || ''}`.toLowerCase();
  return text.includes('42p01')
    || text.includes('pgrst205')
    || text.includes('does not exist')
    || text.includes('could not find the table')
    || text.includes('schema cache');
}

function hasOwnValue(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined;
}

function firstDefined(source, keys) {
  for (const key of keys) {
    if (hasOwnValue(source, key)) return source[key];
  }
  return undefined;
}

function cleanText(value, maxLength = 500) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : '';
}

function cleanNullableText(value, maxLength = 500) {
  const text = cleanText(value, maxLength);
  return text === '' ? null : text;
}

function cleanDateText(value) {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text || '') ? text : null;
}

function cleanNumber(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCep(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatCep(value) {
  const cep = normalizeCep(value);
  return cep.length === 8 ? cep.replace(/(\d{5})(\d{3})/, '$1-$2') : cep;
}

function extractBrasilApiCoordinates(payload = {}) {
  const coordinates = payload.location?.coordinates || payload.coordinates || {};
  const latitude = cleanNumber(coordinates.latitude ?? coordinates.lat ?? payload.latitude);
  const longitude = cleanNumber(coordinates.longitude ?? coordinates.lng ?? coordinates.lon ?? payload.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : { latitude: null, longitude: null };
}

function normalizeCepPayload(provider, payload = {}, cep) {
  const isBrasilApi = provider === 'brasilapi';
  const coords = isBrasilApi ? extractBrasilApiCoordinates(payload) : { latitude: null, longitude: null };
  const rua = isBrasilApi ? (payload.street || '') : (payload.logradouro || '');
  const bairro = isBrasilApi ? (payload.neighborhood || '') : (payload.bairro || '');
  const cidade = isBrasilApi ? (payload.city || '') : (payload.localidade || '');
  const uf = normalizeUf(isBrasilApi ? payload.state : payload.uf);
  const complemento = isBrasilApi ? (payload.complement || '') : (payload.complemento || '');
  const enderecoCompleto = buildCustomerAddress({
    rua,
    numero: '',
    bairro,
    cidade,
    uf,
    complemento,
    referencia: ''
  });
  return {
    cep: formatCep(payload.cep || cep),
    cep_digits: normalizeCep(payload.cep || cep),
    rua: rua || '',
    logradouro: rua || '',
    bairro: bairro || '',
    cidade: cidade || '',
    localidade: cidade || '',
    uf: uf || '',
    complemento: complemento || '',
    endereco_completo: enderecoCompleto || '',
    latitude: coords.latitude,
    longitude: coords.longitude,
    provider,
    valid: true
  };
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupCep(cep) {
  const normalizedCep = normalizeCep(cep);
  if (normalizedCep.length !== 8) {
    const error = new Error('CEP deve ter 8 digitos');
    error.statusCode = 400;
    error.code = 'cep_invalid';
    throw error;
  }

  const cached = cepLookupCache.get(normalizedCep);
  if (cached && Date.now() - cached.cachedAt < CEP_CACHE_TTL_MS) return cached.payload;

  const attempts = [
    {
      provider: 'brasilapi',
      url: `https://brasilapi.com.br/api/cep/v2/${normalizedCep}`,
      notFound(payload, response) {
        return response.status === 404 || payload?.name === 'CepPromiseError';
      }
    },
    {
      provider: 'viacep',
      url: `https://viacep.com.br/ws/${normalizedCep}/json/`,
      notFound(payload, response) {
        return response.status === 404 || payload?.erro === true;
      }
    }
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const { response, payload } = await fetchJsonWithTimeout(attempt.url);
      if (attempt.notFound(payload, response)) {
        lastError = new Error('CEP nao encontrado');
        lastError.statusCode = 404;
        lastError.code = 'cep_not_found';
        continue;
      }
      if (!response.ok) {
        lastError = new Error(payload?.message || payload?.error || `Falha ao consultar CEP em ${attempt.provider}`);
        lastError.statusCode = response.status;
        continue;
      }
      const normalized = normalizeCepPayload(attempt.provider, payload, normalizedCep);
      cepLookupCache.set(normalizedCep, { cachedAt: Date.now(), payload: normalized });
      return normalized;
    } catch (error) {
      lastError = error;
      if (error.name === 'AbortError') lastError.statusCode = 504;
    }
  }

  if (!lastError) {
    lastError = new Error('Falha ao consultar CEP');
    lastError.statusCode = 502;
  }
  throw lastError;
}

function cleanArray(value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean);
  }
  if (value === null || value === '') return [];
  return String(value)
    .split(/[,+/|]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeServicePayload(input = {}, options = {}) {
  const partial = !!options.partial;
  const includeId = !!options.includeId;
  const payload = {};

  const set = (target, keys, normalizer, defaultValue) => {
    const value = firstDefined(input, Array.isArray(keys) ? keys : [keys]);
    if (value === undefined) {
      if (!partial && defaultValue !== undefined) payload[target] = defaultValue;
      return;
    }
    payload[target] = normalizer ? normalizer(value) : value;
  };

  if (includeId && hasOwnValue(input, 'id')) {
    payload.id = input.id;
  }

  const dateValue = firstDefined(input, ['date', 'data', 'dt']);
  if (dateValue !== undefined || !partial) {
    const normalizedDate = cleanDateText(dateValue);
    payload.date = normalizedDate;
    payload.data = normalizedDate;
  }

  set('cliente_id', ['cliente_id', 'clienteId', 'customer_id', 'client_id'], cleanNumber, null);
  set('customer_address_id', ['customer_address_id', 'customerAddressId', 'endereco_id', 'address_id'], value => cleanNullableText(value, 80), null);
  set('cliente', ['cliente', 'cl'], value => cleanText(value, 300), '');
  set('endereco', 'endereco', value => cleanText(value, 500), '');
  set('horario', ['horario', 'hr'], value => cleanText(value, 20), '');
  set('tiposervico', ['tiposervico', 'tipoServico', 'sc'], value => cleanText(value, 200), '');
  set('tipos', 'tipos', cleanArray, []);
  set('equipe', ['equipe', 'eq'], value => cleanText(value, 300), '');
  set('veiculo', 'veiculo', value => cleanText(value, 120), '');
  set('os', ['os', 'OS'], value => cleanText(value, 120), '');
  set('observacoes', ['observacoes', 'obs'], value => cleanText(value, 2000), '');
  set('status', ['status', 'st'], value => cleanText(value, 80) || 'agendado', 'agendado');
  set('exec_status', 'exec_status', value => cleanText(value, 80) || 'agendado', 'agendado');
  set('tecnicos_ids', 'tecnicos_ids', cleanArray, []);
  set('chegada_hora', 'chegada_hora', value => cleanNullableText(value, 80));
  set('chegada_lat', 'chegada_lat', cleanNumber);
  set('chegada_lng', 'chegada_lng', cleanNumber);
  set('inicio_hora', 'inicio_hora', value => cleanNullableText(value, 80));
  set('fim_hora', 'fim_hora', value => cleanNullableText(value, 80));
  set('tempo_espera', 'tempo_espera', cleanNumber);
  set('tempo_execucao', 'tempo_execucao', cleanNumber);
  set('checklist_servico', 'checklist_servico', value => value || null);
  set('problema_descricao', 'problema_descricao', value => cleanText(value, 1000), '');
  set('confirmado_cliente', 'confirmado_cliente', value => value === true || String(value) === 'true');
  set('confirmado_cliente_em', 'confirmado_cliente_em', value => cleanNullableText(value, 80));
  set('agenda_confirmada_tecnico', 'agenda_confirmada_tecnico', value => value === true || String(value) === 'true');
  set('agenda_confirmada_tecnico_em', 'agenda_confirmada_tecnico_em', value => cleanNullableText(value, 80));

  return payload;
}

function normalizeChecklistPayload(input = {}) {
  const kms = cleanNumber(input.kms);
  const kmc = cleanNumber(input.kmc);
  const kmd = input.kmd !== undefined ? cleanNumber(input.kmd) : (kms !== null && kmc !== null ? kmc - kms : null);
  return {
    id: input.id !== undefined ? input.id : Date.now(),
    date: cleanDateText(input.date),
    motorista: cleanText(input.motorista, 200),
    assistente: cleanText(input.assistente, 200),
    cartao: cleanText(input.cartao, 120),
    vei: cleanText(input.vei, 120),
    kms,
    kmc,
    kmd,
    hrs: cleanText(input.hrs, 20),
    hrc: cleanText(input.hrc, 20),
    fuel: cleanText(input.fuel, 40),
    hasav: input.hasav === true || String(input.hasav) === 'true',
    avtxt: cleanText(input.avtxt, 1000),
    obs: cleanText(input.obs, 2000),
    equip: input.equip && typeof input.equip === 'object' ? input.equip : {},
    importado: input.importado === true || String(input.importado) === 'true',
    origem: cleanText(input.origem, 80) || 'admin',
    saida_lat: cleanNumber(input.saida_lat),
    saida_lng: cleanNumber(input.saida_lng),
    retorno_lat: cleanNumber(input.retorno_lat),
    retorno_lng: cleanNumber(input.retorno_lng)
  };
}

function normalizeTechnicianEventPayload(input = {}, options = {}) {
  const partial = !!options.partial;
  const payload = {};
  const set = (target, normalizer, defaultValue) => {
    if (!hasOwnValue(input, target)) {
      if (!partial && defaultValue !== undefined) payload[target] = defaultValue;
      return;
    }
    payload[target] = normalizer ? normalizer(input[target]) : input[target];
  };

  if (!partial || hasOwnValue(input, 'id')) payload.id = input.id !== undefined ? input.id : Date.now();
  set('date', cleanDateText);
  set('tecnico', value => cleanText(value, 200));
  set('equipe', value => cleanText(value, 200));
  set('service_id', cleanNumber);
  set('tipo', value => cleanText(value, 80));
  set('titulo', value => cleanText(value, 200));
  set('detalhes', value => cleanText(value, 4000));
  set('lat', cleanNumber);
  set('lng', cleanNumber);
  set('prioridade', value => cleanText(value, 80) || 'normal', 'normal');
  set('status', value => cleanText(value, 80) || 'pendente', 'pendente');
  set('visto', value => value === true || String(value) === 'true', false);
  set('visto_em', value => cleanNullableText(value, 80));
  set('resolvido_em', value => cleanNullableText(value, 80));
  set('operador_responsavel', value => cleanText(value, 200));
  set('observacao_resolucao', value => cleanText(value, 2000));
  set('whatsapp_escalado_em', value => cleanNullableText(value, 80));
  set('whatsapp_escalado_para', value => cleanText(value, 80));
  set('whatsapp_escalado_status', value => cleanText(value, 80) || 'nao_enviado', 'nao_enviado');
  set('whatsapp_escalado_erro', value => cleanText(value, 2000));
  return payload;
}

const IDEMPOTENT_TECHNICIAN_EVENT_TYPES = new Set([
  'deslocamento',
  'chegada',
  'inicio',
  'finalizacao',
  'problema'
]);

async function findDuplicateTechnicianEvent(db, payload = {}) {
  if (!IDEMPOTENT_TECHNICIAN_EVENT_TYPES.has(String(payload.tipo || ''))) return null;
  if (!payload.date || !payload.service_id || !payload.tecnico) return null;

  const { data, error } = await db
    .from('technician_events')
    .select('*')
    .eq('date', payload.date)
    .eq('service_id', payload.service_id)
    .eq('tecnico', payload.tecnico)
    .eq('tipo', payload.tipo)
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

function normalizeTechnicianMessagePayload(input = {}) {
  return {
    id: input.id !== undefined ? input.id : Date.now(),
    date: cleanDateText(input.date),
    tecnico: cleanText(input.tecnico, 200),
    equipe: cleanText(input.equipe, 200),
    mensagem: cleanText(input.mensagem, 4000),
    prioridade: cleanText(input.prioridade, 80) || 'normal',
    lido: input.lido === true || String(input.lido) === 'true',
    lido_em: cleanNullableText(input.lido_em, 80)
  };
}

function cleanBoolean(value, defaultValue = true) {
  if (value === undefined) return defaultValue;
  if (typeof value === 'boolean') return value;
  return !['false', '0', 'nao', 'não', 'inativo'].includes(String(value || '').trim().toLowerCase());
}

function normalizePlate(value) {
  const text = cleanNullableText(value, 20);
  return text ? text.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
}

function normalizeVehicleName(value) {
  return normalizeLooseText(value);
}

function addVehicleComputedFields(item) {
  return { ...item, rodizio: rodizioInfo(item.placa) };
}

function findDuplicateVehicle(vehicles = [], payload = {}, ignoreId = null) {
  const plate = normalizePlate(payload.placa);
  const name = normalizeVehicleName(payload.nome);
  const sameId = item => ignoreId !== null && ignoreId !== undefined && String(item.id) === String(ignoreId);

  if (plate) {
    const byPlate = vehicles.find(item => !sameId(item) && normalizePlate(item.placa) === plate);
    if (byPlate) return { vehicle: byPlate, reason: 'placa' };
  }

  if (name) {
    const byName = vehicles.find(item => !sameId(item) && normalizeVehicleName(item.nome) === name);
    if (byName) return { vehicle: byName, reason: 'nome' };
  }

  return null;
}

function vehicleDuplicatePayload(duplicate) {
  const reason = duplicate?.reason || 'cadastro';
  const label = reason === 'placa' ? 'placa' : 'nome';
  return {
    error: `Ja existe um veiculo com este ${label}. Edite o cadastro existente em vez de criar outro.`,
    duplicate: true,
    duplicate_reason: reason,
    existing_vehicle: duplicate?.vehicle || null,
    existing: duplicate?.vehicle || null
  };
}

function buildVehicleDuplicateGroups(vehicles = []) {
  const groups = [];
  const collect = (key, type, label, vehicle) => {
    if (!key) return;
    let group = groups.find(item => item.type === type && item.key === key);
    if (!group) {
      group = { type, key, label, vehicles: [] };
      groups.push(group);
    }
    group.vehicles.push(vehicle);
  };

  vehicles.forEach(vehicle => {
    collect(normalizeVehicleName(vehicle.nome), 'nome', vehicle.nome || 'Sem nome', vehicle);
    collect(normalizePlate(vehicle.placa), 'placa', vehicle.placa || 'Sem placa', vehicle);
  });

  return groups
    .filter(group => group.vehicles.length > 1)
    .map(group => ({
      ...group,
      count: group.vehicles.length,
      vehicles: group.vehicles.map(addVehicleComputedFields)
    }));
}

function normalizeVehiclePayload(input = {}, options = {}) {
  const partial = !!options.partial;
  const payload = {};
  const set = (target, keys, normalizer, defaultValue) => {
    const value = firstDefined(input, Array.isArray(keys) ? keys : [keys]);
    if (value === undefined) {
      if (!partial && defaultValue !== undefined) payload[target] = defaultValue;
      return;
    }
    payload[target] = normalizer ? normalizer(value) : value;
  };

  set('nome', 'nome', value => cleanText(value, 160), '');
  set('placa', 'placa', normalizePlate, null);
  set('marca', 'marca', value => cleanNullableText(value, 120));
  set('modelo', 'modelo', value => cleanNullableText(value, 120));
  set('ano', 'ano', value => {
    const year = Number.parseInt(value, 10);
    return Number.isFinite(year) && year > 1900 ? year : null;
  });
  set('cor', 'cor', value => cleanNullableText(value, 80));
  set('renavam', 'renavam', value => cleanNullableText(value, 80));
  set('chassi', 'chassi', value => cleanNullableText(value, 80));
  set('combustivel', 'combustivel', value => cleanNullableText(value, 80));
  set('quilometragem_atual', ['quilometragem_atual', 'km_atual'], value => {
    const number = cleanNumber(value);
    if (number === null || number === undefined) return null;
    if (number < 0) {
      const error = new Error('Quilometragem nao pode ser negativa');
      error.status = 400;
      throw error;
    }
    return number;
  }, 0);
  set('tecnico_responsavel_id', ['tecnico_responsavel_id', 'tecnico_id'], value => cleanNullableText(value, 80));
  set('status', 'status', value => {
    const status = String(value || 'ativo').trim().toLowerCase();
    if (!['ativo', 'manutencao', 'inativo'].includes(status)) {
      const error = new Error('Status de veiculo invalido');
      error.status = 400;
      throw error;
    }
    return status;
  }, 'ativo');
  set('observacoes', 'observacoes', value => cleanText(value, 2000), '');
  set('ativo', 'ativo', value => cleanBoolean(value, true), true);

  if (!payload.nome && !partial) {
    payload.nome = [payload.marca, payload.modelo, payload.placa].filter(Boolean).join(' ').trim();
  }
  if (payload.status) payload.ativo = payload.status !== 'inativo';
  payload.updated_at = new Date().toISOString();
  return payload;
}

function normalizeTechnicianPayload(input = {}, options = {}) {
  const partial = !!options.partial;
  const payload = {};
  const set = (target, keys, normalizer, defaultValue) => {
    const value = firstDefined(input, Array.isArray(keys) ? keys : [keys]);
    if (value === undefined) {
      if (!partial && defaultValue !== undefined) payload[target] = defaultValue;
      return;
    }
    payload[target] = normalizer ? normalizer(value) : value;
  };
  set('nome', 'nome', value => cleanText(value, 160), '');
  set('telefone', 'telefone', value => cleanNullableText(normalizePhone(value), 20));
  set('whatsapp', 'whatsapp', value => cleanNullableText(normalizePhone(value), 20));
  set('ativo', 'ativo', value => cleanBoolean(value, true), true);
  return payload;
}

function normalizeInventoryProductPayload(input = {}, options = {}) {
  const partial = !!options.partial;
  const payload = {};
  const set = (target, keys, normalizer, defaultValue) => {
    const value = firstDefined(input, Array.isArray(keys) ? keys : [keys]);
    if (value === undefined) {
      if (!partial && defaultValue !== undefined) payload[target] = defaultValue;
      return;
    }
    payload[target] = normalizer ? normalizer(value) : value;
  };
  set('nome', 'nome', value => cleanText(value, 180), '');
  set('unidade', 'unidade', value => cleanText(value, 20) || 'un', 'un');
  set('categoria', 'categoria', value => cleanText(value, 80) || 'outros', 'outros');
  set('estoque_inicial', 'estoque_inicial', cleanNumber, 0);
  set('estoque_minimo', 'estoque_minimo', cleanNumber, 0);
  set('ativo', 'ativo', value => cleanBoolean(value, true), true);
  set('observacoes', 'observacoes', value => cleanText(value, 2000), '');
  payload.updated_at = new Date().toISOString();
  return payload;
}

function normalizeInventoryMovementPayload(input = {}) {
  const tipo = String(input.tipo || '').trim().toLowerCase();
  if (!['entrada', 'saida', 'ajuste'].includes(tipo)) {
    const error = new Error('Tipo de movimentacao invalido');
    error.status = 400;
    throw error;
  }
  const quantidade = cleanNumber(input.quantidade);
  if (quantidade === null || quantidade === undefined || (tipo !== 'ajuste' && quantidade <= 0)) {
    const error = new Error('Quantidade invalida');
    error.status = 400;
    throw error;
  }
  return {
    data: cleanDateText(input.data) || new Date().toISOString().slice(0, 10),
    tipo,
    product_id: cleanNumber(input.product_id),
    produto_nome: cleanText(input.produto_nome, 180),
    quantidade,
    vehicle_id: cleanNullableText(input.vehicle_id, 80),
    veiculo_nome: cleanText(input.veiculo_nome, 160),
    motivo_os: cleanText(input.motivo_os, 160),
    observacoes: cleanText(input.observacoes, 2000),
    operador: cleanText(input.operador, 160)
  };
}

function normalizeVehicleDocumentPayload(input = {}, options = {}) {
  const partial = !!options.partial;
  const payload = {};
  const set = (target, normalizer, defaultValue) => {
    if (!hasOwnValue(input, target)) {
      if (!partial && defaultValue !== undefined) payload[target] = defaultValue;
      return;
    }
    payload[target] = normalizer ? normalizer(input[target]) : input[target];
  };
  set('tipo_documento', value => cleanText(value, 80));
  set('descricao', value => cleanText(value, 300), '');
  set('data_vencimento', cleanDateText);
  set('data_pagamento', cleanDateText);
  set('valor', cleanNumber);
  set('status', value => cleanText(value, 80) || 'em_dia', 'em_dia');
  set('observacoes', value => cleanText(value, 2000), '');
  set('arquivo_url', value => cleanNullableText(value, 1000));
  payload.updated_at = new Date().toISOString();
  return payload;
}

function normalizeVehicleMaintenancePayload(input = {}, options = {}) {
  const partial = !!options.partial;
  const payload = {};
  const set = (target, normalizer, defaultValue) => {
    if (!hasOwnValue(input, target)) {
      if (!partial && defaultValue !== undefined) payload[target] = defaultValue;
      return;
    }
    payload[target] = normalizer ? normalizer(input[target]) : input[target];
  };
  set('tipo_manutencao', value => cleanText(value, 100));
  set('descricao', value => cleanText(value, 400), '');
  set('data_realizada', cleanDateText);
  set('quilometragem_realizada', cleanNumber);
  set('proxima_data', cleanDateText);
  set('proxima_quilometragem', cleanNumber);
  set('valor', cleanNumber);
  set('oficina_fornecedor', value => cleanText(value, 200), '');
  set('status', value => cleanText(value, 80) || 'programada', 'programada');
  set('observacoes', value => cleanText(value, 2000), '');
  set('comprovante_url', value => cleanNullableText(value, 1000));
  if (payload.proxima_quilometragem !== undefined && payload.quilometragem_realizada !== undefined
    && payload.proxima_quilometragem !== null && payload.quilometragem_realizada !== null
    && payload.proxima_quilometragem < payload.quilometragem_realizada) {
    const error = new Error('Proxima quilometragem nao pode ser menor que a realizada');
    error.status = 400;
    throw error;
  }
  payload.updated_at = new Date().toISOString();
  return payload;
}

function vehicleDisplayName(vehicle = {}) {
  return vehicle.nome || [vehicle.marca, vehicle.modelo].filter(Boolean).join(' ') || vehicle.placa || 'Veiculo';
}

function plateLastDigit(plate) {
  const digits = String(plate || '').replace(/\D/g, '');
  return digits ? digits[digits.length - 1] : '';
}

function rodizioInfo(plate, date = new Date()) {
  const final = plateLastDigit(plate);
  const map = { '1': 1, '2': 1, '3': 2, '4': 2, '5': 3, '6': 3, '7': 4, '8': 4, '9': 5, '0': 5 };
  const labels = { 1: 'segunda-feira', 2: 'terca-feira', 3: 'quarta-feira', 4: 'quinta-feira', 5: 'sexta-feira' };
  const day = map[final] || null;
  return {
    final_placa: final || null,
    dia_rodizio: day ? labels[day] : null,
    horario_restricao: day ? '07:00-10:00 e 17:00-20:00' : null,
    status_rodizio_hoje: !!day && date.getDay() === day
  };
}

function daysUntil(dateText, today = new Date()) {
  const date = cleanDateText(dateText);
  if (!date) return null;
  const base = new Date(`${today.toISOString().slice(0, 10)}T12:00:00Z`);
  const target = new Date(`${date}T12:00:00Z`);
  return Math.round((target - base) / 86400000);
}

function buildVehicleAlerts({ vehicles = [], documents = [], maintenances = [] } = {}) {
  const alerts = [];
  const docsByVehicle = new Map();
  const maintByVehicle = new Map();
  documents.forEach(item => {
    const key = String(item.veiculo_id || item.vehicle_id || '');
    if (!docsByVehicle.has(key)) docsByVehicle.set(key, []);
    docsByVehicle.get(key).push(item);
  });
  maintenances.forEach(item => {
    const key = String(item.veiculo_id || item.vehicle_id || '');
    if (!maintByVehicle.has(key)) maintByVehicle.set(key, []);
    maintByVehicle.get(key).push(item);
  });

  const addAlert = (vehicle, type, message, priority, extra = {}) => {
    const alertaChave = [
      type,
      vehicle.id,
      extra.item_id || '',
      extra.data_limite || '',
      extra.proxima_quilometragem || ''
    ].join(':');
    alerts.push({
      alerta_chave: alertaChave,
      veiculo_id: vehicle.id,
      veiculo: vehicleDisplayName(vehicle),
      placa: vehicle.placa || '',
      tipo_alerta: type,
      mensagem: message,
      prioridade: priority,
      status: 'aberto',
      ...extra
    });
  };

  vehicles.forEach(vehicle => {
    const active = vehicle.ativo !== false && String(vehicle.status || 'ativo') !== 'inativo';
    if (active && !vehicle.tecnico_responsavel_id) addAlert(vehicle, 'veiculo_sem_tecnico', 'Veiculo ativo sem tecnico responsavel', 'media');
    if (active && (vehicle.quilometragem_atual === null || vehicle.quilometragem_atual === undefined || vehicle.quilometragem_atual === '')) {
      addAlert(vehicle, 'quilometragem_nao_atualizada', 'Veiculo sem quilometragem atualizada', 'media');
    }
    const rodizio = rodizioInfo(vehicle.placa);
    if (rodizio.status_rodizio_hoje) addAlert(vehicle, 'rodizio_hoje', 'Hoje e dia de rodizio deste veiculo', 'alta', rodizio);

    (docsByVehicle.get(String(vehicle.id)) || []).forEach(doc => {
      const paid = ['pago', 'cancelado'].includes(String(doc.status || '').toLowerCase()) || doc.data_pagamento;
      if (paid) return;
      const diff = daysUntil(doc.data_vencimento);
      if (diff === null) return;
      const label = cleanText(doc.tipo_documento, 80) || 'documento';
      if (diff < 0) addAlert(vehicle, `${label}_vencido`, `${label} vencido`, 'critica', { item_id: doc.id, data_limite: doc.data_vencimento });
      else if (diff <= 7) addAlert(vehicle, `${label}_vence_7_dias`, `${label} vence em ate 7 dias`, 'alta', { item_id: doc.id, data_limite: doc.data_vencimento });
      else if (diff <= 15) addAlert(vehicle, `${label}_vence_15_dias`, `${label} vence em ate 15 dias`, 'media', { item_id: doc.id, data_limite: doc.data_vencimento });
      else if (diff <= 30) addAlert(vehicle, `${label}_vence_30_dias`, `${label} vence em ate 30 dias`, 'baixa', { item_id: doc.id, data_limite: doc.data_vencimento });
    });

    (maintByVehicle.get(String(vehicle.id)) || []).forEach(maintenance => {
      if (['realizada', 'cancelada'].includes(String(maintenance.status || '').toLowerCase())) return;
      const label = cleanText(maintenance.tipo_manutencao, 100) || 'manutencao';
      const diff = daysUntil(maintenance.proxima_data);
      if (diff !== null) {
        if (diff < 0) addAlert(vehicle, `${label}_data_vencida`, `${label} vencida por data`, 'critica', { item_id: maintenance.id, data_limite: maintenance.proxima_data });
        else if (diff <= 7) addAlert(vehicle, `${label}_data_proxima`, `${label} proxima por data`, 'alta', { item_id: maintenance.id, data_limite: maintenance.proxima_data });
        else if (diff <= 30) addAlert(vehicle, `${label}_data_30_dias`, `${label} programada em ate 30 dias`, 'media', { item_id: maintenance.id, data_limite: maintenance.proxima_data });
      }
      const currentKm = Number(vehicle.quilometragem_atual);
      const nextKm = Number(maintenance.proxima_quilometragem);
      if (Number.isFinite(currentKm) && Number.isFinite(nextKm) && nextKm > 0) {
        const remaining = nextKm - currentKm;
        if (remaining < 0) addAlert(vehicle, `${label}_km_vencida`, `${label} vencida por quilometragem`, 'critica', { item_id: maintenance.id, proxima_quilometragem: nextKm });
        else if (remaining <= 500) addAlert(vehicle, `${label}_km_proxima`, `${label} proxima por quilometragem`, 'alta', { item_id: maintenance.id, proxima_quilometragem: nextKm, km_restante: remaining });
      }
    });
  });

  const priorityOrder = { critica: 0, alta: 1, media: 2, baixa: 3 };
  return alerts.sort((a, b) => (priorityOrder[a.prioridade] ?? 9) - (priorityOrder[b.prioridade] ?? 9));
}

async function insertVehicleHistory(db, payload) {
  const { error } = await db.from('veiculo_historico').insert([{
    veiculo_id: payload.veiculo_id || null,
    tipo_evento: payload.tipo_evento,
    descricao: payload.descricao || '',
    dados_anteriores: payload.dados_anteriores || null,
    dados_novos: payload.dados_novos || null,
    usuario_id: payload.usuario_id || null
  }]);
  if (error) console.warn('[veiculo_historico] Falha ao registrar historico:', error.message);
}

function isMissingSupabaseRelation(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return text.includes('pgrst205')
    || text.includes('42p01')
    || text.includes('could not find')
    || text.includes('does not exist')
    || text.includes('schema cache');
}

async function safeFleetRows(builder, label) {
  const { data, error } = await builder;
  if (error) {
    if (isMissingSupabaseRelation(error)) {
      console.warn(`[${label}] Tabela opcional ainda nao existe. Execute migration-frota-v1.sql.`);
      return [];
    }
    throw error;
  }
  return data || [];
}

async function fetchVehicleAlerts(db) {
  const [vehiclesRes, documents, maintenances] = await Promise.all([
    db.from('vehicles').select('*').order('nome', { ascending: true }),
    safeFleetRows(db.from('veiculo_documentos').select('*'), 'veiculo_documentos'),
    safeFleetRows(db.from('veiculo_manutencoes').select('*'), 'veiculo_manutencoes')
  ]);
  if (vehiclesRes.error) throw vehiclesRes.error;
  return buildVehicleAlerts({
    vehicles: vehiclesRes.data || [],
    documents,
    maintenances
  });
}

const FLEET_MIGRATION_NAME = 'migration-frota-v1.sql';
const FLEET_OPTIONAL_TABLES = [
  'veiculo_documentos',
  'veiculo_manutencoes',
  'veiculo_historico',
  'veiculo_alerta_envios'
];

function fleetMigrationPayload(resource = 'Recurso de frota') {
  return {
    error: `${resource} indisponivel. Execute ${FLEET_MIGRATION_NAME} no Supabase para liberar esta funcao.`,
    setup_required: true,
    migration: FLEET_MIGRATION_NAME
  };
}

function sendFleetSetupError(res, error, resource) {
  if (!isMissingSupabaseRelation(error)) return false;
  res.status(503).json(fleetMigrationPayload(resource));
  return true;
}

async function checkFleetTable(db, table) {
  const { error } = await db.from(table).select('id').limit(1);
  if (!error) return { table, available: true };
  if (isMissingSupabaseRelation(error)) return { table, available: false, error: error.message };
  throw error;
}

async function checkFleetVehicleColumns(db) {
  const requiredColumns = [
    'id',
    'marca',
    'modelo',
    'ano',
    'cor',
    'renavam',
    'chassi',
    'combustivel',
    'quilometragem_atual',
    'tecnico_responsavel_id',
    'status',
    'observacoes'
  ];
  const { error } = await db.from('vehicles').select(requiredColumns.join(',')).limit(1);
  if (!error) return { available: true, missing: [] };
  if (!isMissingSupabaseRelation(error)) throw error;
  return { available: false, missing: requiredColumns.slice(1), error: error.message };
}

async function getFleetSetupStatus(db) {
  const [columnsStatus, ...tableStatuses] = await Promise.all([
    checkFleetVehicleColumns(db),
    ...FLEET_OPTIONAL_TABLES.map(table => checkFleetTable(db, table))
  ]);

  const tableMap = Object.fromEntries(tableStatuses.map(item => [item.table, item.available]));
  const missingTables = tableStatuses.filter(item => !item.available).map(item => item.table);
  const vehiclesRes = await db.from('vehicles').select('id,nome,placa').order('nome', { ascending: true });
  if (vehiclesRes.error) throw vehiclesRes.error;

  const plates = new Map();
  (vehiclesRes.data || []).forEach(vehicle => {
    const normalized = normalizePlate(vehicle.placa);
    if (!normalized) return;
    if (!plates.has(normalized)) plates.set(normalized, []);
    plates.get(normalized).push({ id: vehicle.id, nome: vehicle.nome, placa: vehicle.placa });
  });
  const duplicatePlates = [...plates.values()].filter(items => items.length > 1);

  return {
    migration: FLEET_MIGRATION_NAME,
    complete: columnsStatus.available && missingTables.length === 0,
    vehicles_available: true,
    vehicle_extended_fields: columnsStatus.available,
    missing_tables: missingTables,
    missing_columns: columnsStatus.missing || [],
    duplicate_plates: duplicatePlates,
    features: {
      documentos: !!tableMap.veiculo_documentos,
      manutencoes: !!tableMap.veiculo_manutencoes,
      historico: !!tableMap.veiculo_historico,
      alerta_envios: !!tableMap.veiculo_alerta_envios,
      alertas: !!tableMap.veiculo_documentos && !!tableMap.veiculo_manutencoes
    }
  };
}

async function findDuplicateCustomer({ id, nome, telefone, whatsapp, cpf_cnpj, cep, endereco, endereco_completo, rua, numero, bairro, cidade, uf, db }) {
  const nomeNormalizado = normalizeCustomerName(nome);
  const telefoneNormalizado = normalizePhone(telefone);
  const whatsappNormalizado = normalizePhone(whatsapp);
  const documentoNormalizado = normalizeDocument(cpf_cnpj);
  const enderecoNormalizado = normalizeAddress(
    endereco_completo ||
    endereco ||
    buildCustomerAddress({ rua, numero, bairro, cidade, uf })
  );

  const client = db || getSupabaseClient();
  const aliasMatch = await findCustomerByAlias(client, nome, id);
  if (aliasMatch) return aliasMatch;

  const { data, error } = await client
    .from('customers')
    .select('*')
    .eq('ativo', true);

  if (error) throw error;

  return (data || []).find(item => {
    const sameRecord = id && Number(item.id) === Number(id);
    if (sameRecord) return false;

    const itemNomeNorm = item.nome_normalizado || normalizeCustomerName(item.nome);
    const itemTelNorm = normalizePhone(item.telefone);
    const itemWhatsappNorm = normalizePhone(item.whatsapp);
    const itemDocumentoNorm = normalizeDocument(item.cpf_cnpj);
    const itemEnderecoNorm = buildCustomerAddressFingerprint(item);

    if (telefoneNormalizado && itemTelNorm && itemTelNorm === telefoneNormalizado) return true;
    if (whatsappNormalizado && itemWhatsappNorm && itemWhatsappNorm === whatsappNormalizado) return true;
    if (documentoNormalizado && itemDocumentoNorm === documentoNormalizado) return true;
    if (nomeNormalizado && itemNomeNorm === nomeNormalizado) return true;
    if (nomeNormalizado && itemNomeNorm === nomeNormalizado && enderecoNormalizado && itemEnderecoNorm === enderecoNormalizado) return true;
    return false;
  });
}

// Middleware - ORDER IS CRITICAL FOR SECURITY
// 1. Security headers first
const supabaseConnectSrc = process.env.SUPABASE_URL || "https://*.supabase.co";

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "cdn.jsdelivr.net", "'unsafe-inline'"],
      scriptSrcElem: ["'self'", "cdn.jsdelivr.net", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'", "'unsafe-hashes'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      styleSrcElem: ["'self'", "'unsafe-inline'", "https:", "fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:", "https://tile.openstreetmap.org"],
      fontSrc: ["'self'", "https:", "data:", "fonts.gstatic.com"],
      connectSrc: ["'self'", "https://tile.openstreetmap.org", supabaseConnectSrc, "https://cdn.jsdelivr.net"],
      frameSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  strictTransportSecurity: {
    maxAge: 31536000,  // 1 year
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'no-referrer' }
}));

// 2. CORS policies
app.use(cors(corsOptions));

// 3. Body parsing
app.use(express.json({ limit: '1mb' }));

// 4. Global rate limiting (applies to all routes except /api/health)
app.use(globalLimiter);

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);
app.locals.supabase = supabase;

function getSupabaseClient() {
  return app.locals.supabase || supabase;
}

function firstHeader(req, name) {
  const value = req.get(name);
  return Array.isArray(value) ? value[0] : value;
}

function extractBearerToken(req) {
  const auth = firstHeader(req, 'authorization') || '';
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function extractTechnicianToken(req) {
  const headerToken = firstHeader(req, 'x-technician-session') || '';
  const bearer = extractBearerToken(req);
  if (String(bearer).startsWith('tech_')) return bearer;
  return String(headerToken || '').trim();
}

function extractAppToken(req) {
  const headerToken = firstHeader(req, 'x-app-session') || '';
  const bearer = extractBearerToken(req);
  if (String(bearer).startsWith('app_')) return bearer;
  return String(headerToken || '').trim();
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function generateTechnicianSessionToken() {
  return `tech_${crypto.randomBytes(32).toString('base64url')}`;
}

function generateAppSessionToken() {
  return `app_${crypto.randomBytes(32).toString('base64url')}`;
}

function hashPassword(password) {
  const clean = String(password || '');
  if (clean.length < 6) {
    const error = new Error('Senha deve ter pelo menos 6 caracteres');
    error.status = 400;
    throw error;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 120000;
  const digest = crypto.pbkdf2Sync(clean, salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$${iterations}$${salt}$${digest}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const [, iterationsText, salt, expected] = parts;
  const iterations = Number(iterationsText);
  if (!Number.isFinite(iterations) || !salt || !expected) return false;
  const digest = crypto.pbkdf2Sync(String(password || ''), salt, iterations, 32, 'sha256').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(expected, 'hex'));
  } catch(e) {
    return false;
  }
}

const EMERGENCY_APP_ADMIN_EMAIL = normalizeEmail(process.env.INTERNAL_ADMIN_EMAIL || 'letechigienizacaoosp@gmail.com');
const EMERGENCY_APP_ADMIN_PASSWORD_HASH = process.env.INTERNAL_ADMIN_PASSWORD_HASH || 'pbkdf2_sha256$120000$ce6d832082cda166f9e2d506975c7cb9$ca17747e71a1a7059cb39a581b3a30072b3c3e29455a09453058c2ff7ab01764';

function getInternalAuthSecret() {
  return process.env.INTERNAL_AUTH_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || 'leteclog-internal-auth-fallback-v1';
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signInternalPayload(payloadPart) {
  return crypto.createHmac('sha256', getInternalAuthSecret()).update(payloadPart).digest('base64url');
}

function createEmergencyAppSession(email = EMERGENCY_APP_ADMIN_EMAIL) {
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000;
  const payload = {
    typ: 'app_emergency',
    sub: 'emergency-admin',
    email,
    name: 'Admin Letec',
    role: 'admin',
    iat: now,
    exp: expiresAt
  };
  const payloadPart = base64UrlJson(payload);
  const signature = signInternalPayload(payloadPart);
  return {
    token: `app_emg_${payloadPart}.${signature}`,
    expires_at: new Date(expiresAt).toISOString(),
    user: {
      id: 'emergency-admin',
      email,
      name: 'Admin Letec',
      role: 'admin',
      active: true,
      emergency: true
    },
    session_id: null
  };
}

function verifyEmergencyAppSessionToken(token) {
  const raw = String(token || '');
  if (!raw.startsWith('app_emg_')) return null;
  const body = raw.slice('app_emg_'.length);
  const [payloadPart, signature] = body.split('.');
  if (!payloadPart || !signature) return null;
  const expected = signInternalPayload(payloadPart);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  } catch(e) {
    return null;
  }
  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch(e) {
    return null;
  }
  if (payload?.typ !== 'app_emergency' || !payload.exp || Number(payload.exp) <= Date.now()) return null;
  return {
    session: { id: null, expires_at: new Date(Number(payload.exp)).toISOString(), emergency: true },
    appUser: {
      id: payload.sub || 'emergency-admin',
      email: payload.email || EMERGENCY_APP_ADMIN_EMAIL,
      name: payload.name || 'Admin Letec',
      role: payload.role || 'admin',
      active: true,
      emergency: true
    },
    role: payload.role || 'admin'
  };
}

function generateTechnicianPin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashTechnicianPin(pin) {
  const clean = String(pin || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(clean)) {
    const error = new Error('PIN deve ter 6 digitos');
    error.status = 400;
    throw error;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 120000;
  const digest = crypto.pbkdf2Sync(clean, salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$${iterations}$${salt}$${digest}`;
}

function verifyTechnicianPin(pin, storedHash) {
  const clean = String(pin || '').replace(/\D/g, '');
  const parts = String(storedHash || '').split('$');
  if (!/^\d{6}$/.test(clean) || parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const [, iterationsText, salt, expected] = parts;
  const iterations = Number(iterationsText);
  if (!Number.isFinite(iterations) || !salt || !expected) return false;
  const digest = crypto.pbkdf2Sync(clean, salt, iterations, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(expected, 'hex'));
}

function publicTechnician(technician = {}) {
  if (!technician) return null;
  const { portal_pin_hash, ...rest } = technician;
  return {
    ...rest,
    portal_login_enabled: technician.portal_login_enabled !== false,
    has_portal_pin: !!portal_pin_hash
  };
}

function technicianHasService(technicianId, service = {}) {
  if (!technicianId || !service) return false;
  return serviceTechnicianIds(service).some(id => String(id) === String(technicianId));
}

function textMatchesTechnician(technician = {}, value = '') {
  const hay = normalizeLooseForMatch(value);
  if (!hay) return true;
  const names = [
    technician.id,
    technician.nome,
    ...(String(technician.nome || '').split(/\s*(?:\/|,|\+|\be\b)\s*/i))
  ].filter(Boolean).map(normalizeLooseForMatch).filter(Boolean);
  return names.some(name => hay.includes(name) || name.includes(hay));
}

function eventMatchesTechnician(technician = {}, item = {}) {
  return textMatchesTechnician(technician, `${item.tecnico || ''} ${item.equipe || ''}`);
}

async function findTechnicianForLogin(db, input = {}) {
  const id = cleanNullableText(input.technician_id || input.tecnico_id || input.id, 120);
  const phone = normalizePhone(input.telefone || input.whatsapp || input.phone || '');
  const name = cleanNullableText(input.nome || input.name || input.tecnico, 160);

  if (id) {
    const technician = await fetchTechnicianById(db, id);
    return technician ? [technician] : [];
  }

  if (phone) {
    const { data, error } = await db
      .from('technicians')
      .select('*')
      .or(`telefone.eq.${phone},whatsapp.eq.${phone}`)
      .limit(5);
    if (error) throw error;
    return data || [];
  }

  if (name) {
    const { data, error } = await db
      .from('technicians')
      .select('*')
      .ilike('nome', `%${name}%`)
      .limit(5);
    if (error) throw error;
    return data || [];
  }

  return [];
}

async function authenticateTechnicianSession(req) {
  if (req.technicianAuth !== undefined) return req.technicianAuth;
  const token = extractTechnicianToken(req);
  if (!token) {
    req.technicianAuth = null;
    return null;
  }

  const db = getSupabaseClient();
  const sessionHash = hashToken(token);
  const session = await maybeSingle(
    db.from('technician_sessions')
      .select('*')
      .eq('session_token_hash', sessionHash)
      .limit(1)
  );
  if (!session || session.revoked_at) {
    req.technicianAuth = null;
    return null;
  }
  if (session.expires_at && new Date(session.expires_at).getTime() <= Date.now()) {
    req.technicianAuth = null;
    return null;
  }

  const technician = await fetchTechnicianById(db, session.technician_id);
  const revokedAt = technician?.portal_session_revoked_at ? new Date(technician.portal_session_revoked_at).getTime() : 0;
  const createdAt = session.created_at ? new Date(session.created_at).getTime() : 0;
  if (!technician || technician.ativo === false || technician.portal_login_enabled === false || (revokedAt && createdAt && createdAt <= revokedAt)) {
    req.technicianAuth = null;
    return null;
  }

  Promise.resolve(
    db.from('technician_sessions')
      .update({ last_seen_at: new Date().toISOString(), ip: req.ip || null, user_agent: truncateText(firstHeader(req, 'user-agent') || '', 500) || null })
      .eq('id', session.id)
      .select()
  ).catch(() => {});

  req.technicianAuth = { session, technician };
  return req.technicianAuth;
}

async function resolveSupabaseActor(req) {
  const token = extractBearerToken(req);
  if (!token || token.startsWith('tech_') || token.startsWith('app_')) return null;
  try {
    const { data, error } = await getSupabaseClient().auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch (error) {
    return null;
  }
}

function publicAppUser(appUser = {}) {
  if (!appUser) return null;
  const { password_hash, ...rest } = appUser;
  return rest;
}

async function authenticateAppSession(req) {
  if (req.appSessionAuth !== undefined) return req.appSessionAuth;
  const token = extractAppToken(req);
  if (!token) {
    req.appSessionAuth = null;
    return null;
  }
  const emergencyAuth = verifyEmergencyAppSessionToken(token);
  if (emergencyAuth) {
    req.appSessionAuth = emergencyAuth;
    return req.appSessionAuth;
  }
  const db = getSupabaseClient();
  const sessionHash = hashToken(token);
  const session = await maybeSingle(
    db.from('app_user_sessions')
      .select('*')
      .eq('session_token_hash', sessionHash)
      .limit(1)
  ).catch(error => {
    if (isMissingRelationError(error)) return null;
    throw error;
  });
  if (!session || session.revoked_at) {
    req.appSessionAuth = null;
    return null;
  }
  if (session.expires_at && new Date(session.expires_at).getTime() <= Date.now()) {
    req.appSessionAuth = null;
    return null;
  }
  const appUser = await maybeSingle(
    db.from('app_users')
      .select('*')
      .eq('id', session.app_user_id)
      .eq('active', true)
      .limit(1)
  ).catch(error => {
    if (isMissingRelationError(error)) return null;
    throw error;
  });
  const revokedAt = appUser?.session_revoked_at ? new Date(appUser.session_revoked_at).getTime() : 0;
  const createdAt = session.created_at ? new Date(session.created_at).getTime() : 0;
  if (!appUser || (revokedAt && createdAt && createdAt <= revokedAt)) {
    req.appSessionAuth = null;
    return null;
  }
  Promise.resolve(
    db.from('app_user_sessions')
      .update({ last_seen_at: new Date().toISOString(), ip: req.ip || null, user_agent: truncateText(firstHeader(req, 'user-agent') || '', 500) || null })
      .eq('id', session.id)
      .select()
  ).catch(() => {});
  req.appSessionAuth = { session, appUser, role: appUser.role };
  return req.appSessionAuth;
}

async function resolveAppUserRole(req) {
  if (req.appUserRole !== undefined) return req.appUserRole;
  const appSession = await authenticateAppSession(req);
  if (appSession) {
    req.appUserRole = {
      user: { id: appSession.appUser.auth_user_id || `app:${appSession.appUser.id}`, email: appSession.appUser.email },
      appUser: appSession.appUser,
      role: appSession.appUser.role
    };
    return req.appUserRole;
  }
  const user = await resolveSupabaseActor(req);
  if (!user) {
    req.appUserRole = null;
    return null;
  }
  const db = getSupabaseClient();
  const appUser = await maybeSingle(
    db.from('app_users')
      .select('*')
      .eq('auth_user_id', user.id)
      .eq('active', true)
      .limit(1)
  ).catch(async error => {
    if (!isMissingRelationError(error)) throw error;
    return null;
  });
  if (!appUser && user.email) {
    const byEmail = await maybeSingle(
      db.from('app_users')
        .select('*')
        .eq('email', user.email)
        .eq('active', true)
        .limit(1)
    ).catch(error => {
      if (!isMissingRelationError(error)) throw error;
      return null;
    });
    if (byEmail) {
      req.appUserRole = { user, appUser: byEmail, role: byEmail.role };
      return req.appUserRole;
    }
    const bootstrapped = await maybeBootstrapFirstAppUser(db, user);
    req.appUserRole = bootstrapped ? { user, appUser: bootstrapped, role: bootstrapped.role } : null;
    return req.appUserRole;
  }
  req.appUserRole = appUser ? { user, appUser, role: appUser.role } : null;
  return req.appUserRole;
}

async function maybeBootstrapFirstAppUser(db, user) {
  if (!user?.email) return null;
  try {
    const { count, error: countError } = await db
      .from('app_users')
      .select('id', { count: 'exact', head: true })
      .eq('active', true);
    if (countError) throw countError;
    if (Number(count || 0) > 0) return null;

    const { data, error } = await db
      .from('app_users')
      .upsert({
        auth_user_id: user.id,
        email: user.email,
        role: 'admin',
        active: true
      }, { onConflict: 'email' })
      .select()
      .limit(1);
    if (error) throw error;
    return data?.[0] || null;
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

async function requireAdminOrOperator(req, res) {
  const actor = await resolveAppUserRole(req);
  if (actor && ['admin', 'operador'].includes(String(actor.role || '').toLowerCase())) return actor;
  res.status(403).json({ error: 'Acesso restrito a admin/operador', code: 'admin_role_required' });
  return null;
}

async function requireAdmin(req, res) {
  const actor = await resolveAppUserRole(req);
  if (actor && String(actor.role || '').toLowerCase() === 'admin') return actor;
  res.status(403).json({ error: 'Acesso restrito a admin', code: 'admin_required' });
  return null;
}

function isTechnicianPortalRequest(req) {
  return firstHeader(req, 'x-portal-client') === 'technician-portal' || !!extractTechnicianToken(req);
}

async function requireTechnicianForPortal(req, res) {
  const auth = await authenticateTechnicianSession(req);
  if (auth) return auth;
  if (isTechnicianPortalRequest(req)) {
    res.status(401).json({ error: 'Login do tecnico obrigatorio', code: 'technician_session_required' });
    return false;
  }
  return null;
}

function truncateText(value, maxLength = 500) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...[truncated]` : text;
}

function redactAuditValue(key, value) {
  const lowered = String(key || '').toLowerCase();
  if (/(password|senha|token|secret|authorization|api[_-]?key|assinatura|foto|image|base64)/.test(lowered)) {
    return '[redacted]';
  }
  if (typeof value === 'string') {
    if (value.startsWith('data:image/') || value.length > 1200) return truncateText(value, 180);
    return value;
  }
  return value;
}

function buildAuditPayload(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[max-depth]';
  if (Array.isArray(value)) return value.slice(0, 30).map(item => buildAuditPayload(item, depth + 1));
  if (typeof value === 'object') {
    return Object.entries(value).slice(0, 80).reduce((acc, [key, item]) => {
      acc[key] = buildAuditPayload(redactAuditValue(key, item), depth + 1);
      return acc;
    }, {});
  }
  return redactAuditValue('', value);
}

function inferAuditEntity(req) {
  const parts = String(req.path || '').split('/').filter(Boolean);
  if (parts[0] !== 'api') return { entity: parts[0] || null, entityId: null };
  const entity = parts.slice(1, 3).join('/') || null;
  const entityId = req.params?.id || req.params?.documento_id || req.params?.manutencao_id || req.body?.id || null;
  return { entity, entityId: entityId === null || entityId === undefined ? null : String(entityId) };
}

function inferAuditAction(method) {
  const map = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };
  return map[String(method || '').toUpperCase()] || 'write';
}

async function resolveAuditActor(req) {
  const technicianAuth = await authenticateTechnicianSession(req).catch(() => null);
  if (technicianAuth?.technician) {
    return {
      actor_id: technicianAuth.technician.id || null,
      actor_email: null,
      actor_name: technicianAuth.technician.nome || null,
      actor_source: 'technician_session'
    };
  }

  const appSession = await authenticateAppSession(req).catch(() => null);
  if (appSession?.appUser) {
    return {
      actor_id: appSession.appUser.id || null,
      actor_email: appSession.appUser.email || null,
      actor_name: appSession.appUser.name || appSession.appUser.email || null,
      actor_source: appSession.appUser.emergency ? 'app_emergency_session' : 'app_user_session'
    };
  }

  const token = extractBearerToken(req);
  if (token && !token.startsWith('tech_') && !token.startsWith('app_')) {
    try {
      const { data, error } = await getSupabaseClient().auth.getUser(token);
      if (!error && data?.user) {
        const user = data.user;
        return {
          actor_id: user.id || null,
          actor_email: user.email || null,
          actor_name: user.user_metadata?.name || user.user_metadata?.full_name || user.email || null,
          actor_source: 'supabase_auth'
        };
      }
    } catch (error) {
      console.warn('[audit] Falha ao validar token:', error.message);
    }
  }

  const portalTecnico = truncateText(firstHeader(req, 'x-portal-tecnico') || req.body?.tecnico || '', 200);
  const portalEquipe = truncateText(firstHeader(req, 'x-portal-equipe') || req.body?.equipe || '', 200);
  const portalTecnicoId = truncateText(firstHeader(req, 'x-portal-tecnico-id') || '', 200);
  const actorName = truncateText(firstHeader(req, 'x-actor-name') || portalTecnico || portalEquipe || '', 200);
  return {
    actor_id: truncateText(firstHeader(req, 'x-actor-id') || portalTecnicoId || '', 200) || null,
    actor_email: truncateText(firstHeader(req, 'x-actor-email') || '', 200) || null,
    actor_name: actorName || null,
    actor_source: actorName ? 'request_context' : 'anonymous'
  };
}

function auditActivityMiddleware(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || req.path === '/api/activity-logs') {
    return next();
  }

  res.on('finish', () => {
    const db = getSupabaseClient();
    const { entity, entityId } = inferAuditEntity(req);
    const payload = buildAuditPayload(req.body || {});
    resolveAuditActor(req)
      .then(actor => db.from('activity_logs').insert([{
        ...actor,
        portal_tecnico_id: truncateText(firstHeader(req, 'x-portal-tecnico-id') || '', 200) || null,
        portal_tecnico: truncateText(firstHeader(req, 'x-portal-tecnico') || req.body?.tecnico || '', 200) || null,
        portal_equipe: truncateText(firstHeader(req, 'x-portal-equipe') || req.body?.equipe || '', 200) || null,
        method,
        path: req.originalUrl || req.path,
        route: req.route?.path ? String(req.route.path) : null,
        status_code: res.statusCode,
        entity,
        entity_id: entityId,
        action: inferAuditAction(method),
        request_id: firstHeader(req, 'x-request-id') || null,
        ip: req.ip || req.socket?.remoteAddress || null,
        user_agent: truncateText(firstHeader(req, 'user-agent') || '', 500) || null,
        origin: truncateText(firstHeader(req, 'origin') || '', 300) || null,
        referer: truncateText(firstHeader(req, 'referer') || '', 500) || null,
        payload,
        response_summary: { ok: res.statusCode < 400 }
      }]))
      .then(({ error }) => {
        if (error) console.warn('[audit] Falha ao gravar activity_logs:', error.message);
      })
      .catch(error => console.warn('[audit] Falha inesperada:', error.message));
  });

  next();
}

app.use(auditActivityMiddleware);

function getEvolutionConfig() {
  const apiUrl = String(process.env.EVOLUTION_API_URL || process.env.EVOLUTION_URL || '').replace(/\/$/, '');
  const apiKey = String(process.env.EVOLUTION_API_KEY || '');
  const instance = String(process.env.EVOLUTION_INSTANCE_NAME || process.env.EVOLUTION_INSTANCE || 'Letec').trim();
  return {
    apiUrl,
    apiKey,
    instance,
    configured: !!(apiUrl && apiKey && instance)
  };
}

async function evolutionFetch(pathname, options = {}) {
  const fetchImpl = app.locals.evolutionFetch || fetch;
  const config = getEvolutionConfig();
  if (!config.configured) {
    const error = new Error('Evolution API nao configurada');
    error.status = 503;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${config.apiUrl}${pathname}`, {
      ...options,
      signal: options.signal || controller.signal,
      headers: {
        Accept: 'application/json',
        apikey: config.apiKey,
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let payload = {};
    if (text) {
      try { payload = JSON.parse(text); }
      catch(e) { payload = { raw: text }; }
    }
    if (!response.ok) {
      const error = new Error(payload.error || payload.message || `Evolution API HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function extractEvolutionState(payload = {}) {
  const state = payload.instance?.state
    || payload.instance?.connectionStatus
    || payload.instance?.status
    || payload.connectionStatus
    || payload.state
    || payload.status
    || payload.qrcode?.status
    || '';
  return String(state || '');
}

function isEvolutionConnectedState(state) {
  return ['open', 'connected', 'online', 'connection_open'].includes(String(state || '').toLowerCase());
}

function normalizeEvolutionInstanceName(value) {
  return String(value || '').trim().toLowerCase();
}

function flattenEvolutionInstances(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.instances)) return payload.instances;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.instance)) return payload.instance;
  return [];
}

function evolutionInstanceName(item = {}) {
  return item.name
    || item.instanceName
    || item.instance_name
    || item.instance?.instanceName
    || item.instance?.name
    || '';
}

async function fetchEvolutionInstanceListSafe() {
  try {
    const payload = await evolutionFetch('/instance/fetchInstances');
    return { payload, instances: flattenEvolutionInstances(payload) };
  } catch (error) {
    return { error };
  }
}

function extractEvolutionMessageId(payload = {}) {
  return payload.key?.id
    || payload.message?.key?.id
    || payload.instance?.messageId
    || null;
}

async function sendEvolutionText({ number, text }) {
  const config = getEvolutionConfig();
  const rawDestination = String(number || '').trim();
  const normalized = rawDestination.endsWith('@g.us') ? rawDestination : normalizeBrazilWhatsAppNumber(rawDestination);
  if (!normalized) {
    const error = new Error('Numero de WhatsApp invalido. Use DDD + numero ou 55 + DDD + numero.');
    error.status = 400;
    throw error;
  }
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    const error = new Error('Mensagem obrigatoria');
    error.status = 400;
    throw error;
  }

  const payload = await evolutionFetch(`/message/sendText/${encodeURIComponent(config.instance)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      number: normalized,
      text: cleanText,
      delay: EVOLUTION_SEND_DELAY_MS,
      linkPreview: false
    })
  });

  return {
    number: normalized,
    provider: 'evolution_api',
    providerMessageId: extractEvolutionMessageId(payload),
    providerStatus: payload.status || payload.instance?.state || 'sent',
    providerResponse: payload
  };
}

async function markCustomerReminderSendAttempt(db, id, payload) {
  const builder = db
    .from('customer_reminders')
    .update(payload)
    .eq('id', id)
    .select();
  const { data, error } = typeof builder.maybeSingle === 'function'
    ? await builder.maybeSingle()
    : await builder;
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

function ymdToBr(date) {
  const value = String(date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || 'data prevista';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function serviceTechnicianIds(service = {}) {
  const raw = service.tecnicos_ids || service.tecnicosIds || service.technicians_ids || [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch(e) {}
  }
  return [];
}

function isServiceCancelledOrDone(service = {}) {
  const status = String(service.status || service.st || '').toLowerCase();
  const execStatus = String(service.exec_status || '').toLowerCase();
  return ['cancelado', 'executado', 'concluido', 'concluído'].includes(status)
    || ['finalizado', 'concluido', 'concluído'].includes(execStatus);
}

function normalizeLooseForMatch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function maybeSingle(builder) {
  const { data, error } = typeof builder.maybeSingle === 'function'
    ? await builder.maybeSingle()
    : await builder;
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

async function fetchServiceById(db, id) {
  return maybeSingle(db.from('services').select('*').eq('id', id));
}

function validCoordinatePair(lat, lng) {
  const latitude = cleanNumber(lat);
  const longitude = cleanNumber(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (Math.abs(latitude) < 0.000001 && Math.abs(longitude) < 0.000001) return null;
  return { latitude, longitude };
}

async function safeSelectByIds(db, table, column, ids = []) {
  const wanted = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!wanted.length) return [];
  try {
    const { data, error } = await db
      .from(table)
      .select('*')
      .in(column, wanted)
      .limit(Math.max(wanted.length, 1000));
    if (error) {
      if (isMissingRelationError(error) || getMissingSchemaColumn(error)) return [];
      throw error;
    }
    return data || [];
  } catch (error) {
    if (isMissingRelationError(error) || getMissingSchemaColumn(error)) return [];
    throw error;
  }
}

function choosePrimaryAddress(addresses = []) {
  return [...addresses]
    .filter(item => item && item.ativo !== false)
    .sort((a, b) => {
      if (a.is_primary === true && b.is_primary !== true) return -1;
      if (b.is_primary === true && a.is_primary !== true) return 1;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    })[0] || null;
}

async function enrichServicesWithCustomerLocations(db, rows = []) {
  const services = Array.isArray(rows) ? rows : [];
  if (!services.length) return services;

  const customerIds = services.map(service => serviceCustomerId(service)).filter(Boolean);
  const addressIds = services.map(service => service.customer_address_id).filter(Boolean);

  const [customers, addressesByExplicitId, addressesByCustomer] = await Promise.all([
    safeSelectByIds(db, 'customers', 'id', customerIds),
    safeSelectByIds(db, 'customer_addresses', 'id', addressIds),
    safeSelectByIds(db, 'customer_addresses', 'customer_id', customerIds)
  ]);

  const customerById = new Map(customers.map(customer => [String(customer.id), customer]));
  const addressById = new Map(addressesByExplicitId.map(address => [String(address.id), address]));
  const addressesByCustomerId = new Map();
  addressesByCustomer.forEach(address => {
    const key = String(address.customer_id || '');
    if (!key) return;
    if (!addressesByCustomerId.has(key)) addressesByCustomerId.set(key, []);
    addressesByCustomerId.get(key).push(address);
  });

  return services.map(service => {
    const customerId = serviceCustomerId(service);
    const customer = customerById.get(String(customerId || '')) || null;
    const explicitAddress = service.customer_address_id ? addressById.get(String(service.customer_address_id)) : null;
    const primaryAddress = customerId ? choosePrimaryAddress(addressesByCustomerId.get(String(customerId)) || []) : null;
    const address = explicitAddress || primaryAddress || null;
    const addressCoords = validCoordinatePair(address?.latitude, address?.longitude);
    const customerCoords = validCoordinatePair(customer?.latitude, customer?.longitude);
    const serviceCoords = validCoordinatePair(service.latitude, service.longitude);
    const arrivalCoords = validCoordinatePair(service.chegada_lat, service.chegada_lng);
    const selected = addressCoords || customerCoords || serviceCoords || arrivalCoords;
    return {
      ...service,
      cliente_id: service.cliente_id || customer?.id || null,
      customer_id: service.customer_id || service.cliente_id || customer?.id || null,
      customer_address_id: service.customer_address_id || address?.id || null,
      latitude: selected?.latitude ?? null,
      longitude: selected?.longitude ?? null,
      customer_latitude: customerCoords?.latitude ?? addressCoords?.latitude ?? null,
      customer_longitude: customerCoords?.longitude ?? addressCoords?.longitude ?? null,
      address_latitude: addressCoords?.latitude ?? null,
      address_longitude: addressCoords?.longitude ?? null,
      location_source: addressCoords ? 'customer_address'
        : customerCoords ? 'customer'
          : serviceCoords ? 'service'
            : arrivalCoords ? 'technician_arrival'
              : null,
      customer_cep: customer?.cep || address?.cep || null,
      address_cep: address?.cep || null,
      address_numero: address?.numero || customer?.numero || null
    };
  });
}

function normalizeCustomerAlias(value) {
  return normalizeCustomerName(value);
}

function compactCustomerAddress(address = {}) {
  return {
    id: address.id || null,
    customer_id: address.customer_id || null,
    label: address.label || address.nome_unidade || null,
    endereco: address.endereco || address.endereco_completo || null,
    endereco_completo: address.endereco_completo || address.endereco || null,
    cep: address.cep || null,
    rua: address.rua || null,
    numero: address.numero || null,
    bairro: address.bairro || null,
    cidade: address.cidade || null,
    uf: address.uf || null,
    complemento: address.complemento || null,
    referencia: address.referencia || null,
    zona_regiao: address.zona_regiao || null,
    tipo_imovel: address.tipo_imovel || null,
    bloco_torre_andar: address.bloco_torre_andar || null,
    google_maps_url: address.google_maps_url || null,
    latitude: address.latitude || null,
    longitude: address.longitude || null,
    is_primary: address.is_primary === true,
    ativo: address.ativo !== false,
    origem: address.origem || null
  };
}

function customerAddressPayload(customerId, input = {}, options = {}) {
  const ufNormalizada = normalizeUf(input.uf);
  const enderecoEstruturado = buildCustomerAddress({
    rua: input.rua,
    numero: input.numero,
    bairro: input.bairro,
    cidade: input.cidade,
    uf: ufNormalizada,
    complemento: input.complemento,
    referencia: input.referencia
  });
  const endereco = cleanNullableText(input.endereco || input.endereco_completo || enderecoEstruturado, 500);
  const enderecoCompleto = cleanNullableText(input.endereco_completo || input.endereco || enderecoEstruturado, 500);
  return {
    id: cleanNullableText(input.id, 80) || undefined,
    customer_id: Number(customerId),
    label: cleanNullableText(input.label || input.nome_unidade || options.label, 160) || null,
    endereco,
    endereco_completo: enderecoCompleto,
    cep: String(input.cep || '').replace(/\D/g, '') || null,
    rua: cleanNullableText(input.rua, 200),
    numero: cleanNullableText(input.numero, 60),
    bairro: cleanNullableText(input.bairro, 160),
    cidade: cleanNullableText(input.cidade, 160),
    uf: ufNormalizada,
    complemento: cleanNullableText(input.complemento, 200),
    referencia: cleanNullableText(input.referencia, 300),
    zona_regiao: cleanNullableText(input.zona_regiao || input.zona, 120),
    tipo_imovel: cleanNullableText(input.tipo_imovel, 120),
    bloco_torre_andar: cleanNullableText(input.bloco_torre_andar, 160),
    google_maps_url: cleanNullableText(input.google_maps_url, 500),
    latitude: cleanNumber(input.latitude),
    longitude: cleanNumber(input.longitude),
    is_primary: input.is_primary === true || String(input.is_primary) === 'true' || options.is_primary === true,
    ativo: input.ativo === false || String(input.ativo) === 'false' ? false : true,
    origem: cleanNullableText(input.origem || options.origem, 80) || 'sistema'
  };
}

function hasUsableAddress(address = {}) {
  return !!buildCustomerAddressFingerprint(address);
}

async function listCustomerAddresses(db, customerId, options = {}) {
  if (!customerId) return [];
  try {
    let query = db
      .from('customer_addresses')
      .select('*')
      .eq('customer_id', Number(customerId))
      .order('is_primary', { ascending: false });
    if (!options.includeInactive) query = query.eq('ativo', true);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(compactCustomerAddress);
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
    const customer = await maybeSingle(db.from('customers').select('*').eq('id', Number(customerId))).catch(() => null);
    return customer && hasUsableAddress(customer)
      ? [compactCustomerAddress({ ...customer, customer_id: Number(customerId), is_primary: true, origem: 'customers_fallback' })]
      : [];
  }
}

async function findCustomerByAlias(db, alias, ignoreId = null) {
  const aliasNormalizado = normalizeCustomerAlias(alias);
  if (!aliasNormalizado) return null;
  try {
    const { data, error } = await db
      .from('customer_aliases')
      .select('*')
      .eq('alias_normalizado', aliasNormalizado)
      .eq('ativo', true)
      .limit(10);
    if (error) throw error;
    const ids = [...new Set((data || [])
      .map(item => Number(item.customer_id))
      .filter(id => id && String(id) !== String(ignoreId || '')))];
    if (!ids.length) return null;
    const { data: customers, error: customersError } = await db
      .from('customers')
      .select('*')
      .in('id', ids)
      .eq('ativo', true);
    if (customersError) throw customersError;
    return (customers || [])[0] || null;
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

async function ensureCustomerAlias(db, customerId, alias, origem = 'sistema') {
  const aliasNormalizado = normalizeCustomerAlias(alias);
  if (!customerId || !aliasNormalizado) return null;
  try {
    const existing = await findCustomerByAlias(db, alias, null);
    if (existing && String(existing.id) === String(customerId)) return existing;
    const payload = {
      customer_id: Number(customerId),
      alias: String(alias || '').trim(),
      alias_normalizado: aliasNormalizado,
      origem,
      ativo: true
    };
    const { data, error } = await db.from('customer_aliases').insert([payload]).select();
    if (error) {
      if (error.code === '23505') return existing || null;
      throw error;
    }
    return data?.[0] || null;
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

async function ensureCustomerAddress(db, customerId, input = {}, options = {}) {
  if (!customerId) return null;
  const payload = customerAddressPayload(customerId, input, options);
  if (!hasUsableAddress(payload)) return null;
  try {
    const existing = await listCustomerAddresses(db, customerId, { includeInactive: false });
    const fingerprint = buildCustomerAddressFingerprint(payload);
    const match = existing.find(item => buildCustomerAddressFingerprint(item) === fingerprint || areEquivalentCustomerAddresses(item, payload));
    if (match) return match;
    const insertPayload = {
      ...payload,
      is_primary: payload.is_primary || existing.length === 0
    };
    delete insertPayload.id;
    const { data, error } = await runCustomerAddressWriteWithSchemaFallback(
      workingPayload => db.from('customer_addresses').insert([workingPayload]).select(),
      insertPayload,
      'ensureCustomerAddress'
    );
    if (error) throw error;
    return compactCustomerAddress(data?.[0] || insertPayload);
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

function normalizeServiceAddressInput(servicePayload = {}, rawInput = {}) {
  const ufNormalizada = normalizeUf(rawInput.uf || servicePayload.uf);
  const structured = {
    cep: normalizeCep(rawInput.cep || servicePayload.cep),
    rua: cleanNullableText(rawInput.rua || servicePayload.rua, 200),
    numero: cleanNullableText(rawInput.numero || servicePayload.numero, 60),
    bairro: cleanNullableText(rawInput.bairro || servicePayload.bairro, 160),
    cidade: cleanNullableText(rawInput.cidade || servicePayload.cidade, 160),
    uf: ufNormalizada,
    complemento: cleanNullableText(rawInput.complemento || servicePayload.complemento, 200),
    referencia: cleanNullableText(rawInput.referencia || servicePayload.referencia, 300),
    latitude: cleanNumber(rawInput.latitude ?? servicePayload.latitude),
    longitude: cleanNumber(rawInput.longitude ?? servicePayload.longitude)
  };
  const enderecoEstruturado = buildCustomerAddress(structured);
  return {
    ...structured,
    endereco: cleanNullableText(rawInput.endereco || servicePayload.endereco || enderecoEstruturado, 500),
    endereco_completo: cleanNullableText(rawInput.endereco_completo || rawInput.endereco || servicePayload.endereco || enderecoEstruturado, 500)
  };
}

function validateRequiredServiceAddress(input = {}) {
  if (!input.cep || normalizeCep(input.cep).length !== 8) {
    return { ok: false, status: 400, code: 'service_address_cep_required', error: 'CEP e obrigatorio para salvar endereco novo na agenda' };
  }
  if (!input.numero) {
    return { ok: false, status: 400, code: 'service_address_number_required', error: 'Numero e obrigatorio para salvar endereco novo na agenda' };
  }
  if (!input.rua || !input.bairro || !input.cidade || !input.uf) {
    return { ok: false, status: 400, code: 'service_address_structured_required', error: 'Rua, bairro, cidade e UF sao obrigatorios para endereco novo na agenda' };
  }
  return { ok: true };
}

async function ensureServiceCustomerAddress(db, servicePayload = {}, customer = null, origem = 'agenda', rawInput = {}) {
  const customerId = servicePayload.cliente_id || customer?.id;
  if (!customerId || servicePayload.customer_address_id) return null;
  const addressInput = normalizeServiceAddressInput(servicePayload, rawInput);
  const validation = validateRequiredServiceAddress(addressInput);
  if (!validation.ok) {
    const error = new Error(validation.error);
    error.statusCode = validation.status;
    error.code = validation.code;
    throw error;
  }
  const address = await ensureCustomerAddress(db, customerId, {
    ...addressInput,
    origem
  }, { origem, label: servicePayload.cliente || customer?.nome || null });
  if (address?.id) servicePayload.customer_address_id = address.id;
  return address;
}

async function fetchServicesByDate(db, date) {
  const { data, error } = await db
    .from('services')
    .select('*')
    .or(`date.eq.${date},data.eq.${date}`)
    .order('horario', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

async function fetchTechniciansByIds(db, ids = []) {
  const wanted = [...new Set(ids.map(String).filter(Boolean))];
  if (!wanted.length) return [];
  const { data, error } = await db
    .from('technicians')
    .select('*')
    .in('id', wanted);
  if (error) throw error;
  return data || [];
}

async function fetchTechnicianById(db, id) {
  return maybeSingle(db.from('technicians').select('*').eq('id', id));
}

async function fetchCustomerForService(db, service = {}) {
  const explicitId = service.customer_id || service.cliente_id || service.clienteId || service.client_id;
  if (explicitId) {
    const byId = await maybeSingle(db.from('customers').select('*').eq('id', explicitId));
    if (byId) return byId;
  }

  const serviceName = normalizeLooseForMatch(service.cliente || service.cl || '');
  if (!serviceName) return null;
  const { data, error } = await db
    .from('customers')
    .select('*')
    .eq('ativo', true)
    .limit(500);
  if (error) throw error;
  const matches = (data || []).filter(customer => normalizeLooseForMatch(customer.nome_normalizado || customer.nome) === serviceName);
  return matches.length === 1 ? matches[0] : null;
}

async function ensureCustomerForServicePayload(db, servicePayload = {}, options = {}) {
  const shouldSaveAddress = options.saveAddress !== false;
  const rawInput = options.input || {};
  if (servicePayload.cliente_id) {
    const customer = await maybeSingle(db.from('customers').select('*').eq('id', servicePayload.cliente_id)).catch(() => null);
    let address = null;
    if (shouldSaveAddress) {
      try {
        address = await ensureServiceCustomerAddress(db, servicePayload, customer, 'agenda', rawInput);
      } catch (addressError) {
        if (addressError.statusCode) throw addressError;
        console.warn('[POST /api/services ensure customer] Complemento de endereco ignorado:', addressError.message);
      }
    }
    return { payload: servicePayload, customer, address, created: false };
  }

  if (!String(servicePayload.cliente || '').trim()) {
    return { payload: servicePayload, customer: null, address: null, created: false };
  }

  const name = String(servicePayload.cliente || '').trim();
  const address = String(servicePayload.endereco || '').trim();
  const serviceName = normalizeLooseForMatch(name);

  const { data: activeCustomers, error: activeCustomersError } = await db
    .from('customers')
    .select('*')
    .eq('ativo', true)
    .limit(1000);
  if (activeCustomersError) throw activeCustomersError;

  const exactMatches = (activeCustomers || [])
    .filter(customer => normalizeLooseForMatch(customer.nome_normalizado || customer.nome) === serviceName);

  if (exactMatches.length === 1) {
    servicePayload.cliente_id = Number(exactMatches[0].id);
    let addressRecord = null;
    if (shouldSaveAddress) {
      try {
        addressRecord = await ensureServiceCustomerAddress(db, servicePayload, exactMatches[0], 'agenda', rawInput);
      } catch (addressError) {
        if (addressError.statusCode) throw addressError;
        console.warn('[POST /api/services ensure customer] Complemento de endereco ignorado:', addressError.message);
      }
    }
    return { payload: servicePayload, customer: exactMatches[0], address: addressRecord, created: false };
  }

  if (exactMatches.length > 1) {
    const serviceAddressFingerprint = buildCustomerAddressFingerprint({ endereco: address });
    const addressMatches = serviceAddressFingerprint
      ? exactMatches.filter(customer => buildCustomerAddressFingerprint(customer) === serviceAddressFingerprint)
      : [];

  if (addressMatches.length === 1) {
    servicePayload.cliente_id = Number(addressMatches[0].id);
    let addressRecord = null;
    if (shouldSaveAddress) {
      try {
        addressRecord = await ensureServiceCustomerAddress(db, servicePayload, addressMatches[0], 'agenda', rawInput);
      } catch (addressError) {
        if (addressError.statusCode) throw addressError;
        console.warn('[POST /api/services ensure customer] Complemento de endereco ignorado:', addressError.message);
      }
    }
    return { payload: servicePayload, customer: addressMatches[0], address: addressRecord, created: false };
  }

    throw new CustomerLinkError(
      `Mais de um cliente ativo encontrado para "${name}". Selecione o cliente correto no autocomplete antes de salvar.`
    );
  }

  const duplicate = await findDuplicateCustomer({
    nome: name,
    endereco: address,
    endereco_completo: address,
    db
  });
  if (duplicate?.id) {
    servicePayload.cliente_id = Number(duplicate.id);
    let addressRecord = null;
    if (shouldSaveAddress) {
      try {
        addressRecord = await ensureServiceCustomerAddress(db, servicePayload, duplicate, 'agenda', rawInput);
      } catch (addressError) {
        if (addressError.statusCode) throw addressError;
        console.warn('[POST /api/services ensure customer] Complemento de endereco ignorado:', addressError.message);
      }
    }
    return { payload: servicePayload, customer: duplicate, address: addressRecord, created: false };
  }

  const insertPayload = {
    nome: name,
    nome_normalizado: normalizeCustomerName(name),
    ...normalizeServiceAddressInput(servicePayload, rawInput),
    endereco: normalizeServiceAddressInput(servicePayload, rawInput).endereco || address || null,
    endereco_completo: normalizeServiceAddressInput(servicePayload, rawInput).endereco_completo || address || null,
    tipo: 'PF',
    tipo_cliente: 'Eventual',
    origem: 'agenda',
    is_incomplete: false,
    ativo: true
  };
  const insertValidation = validateRequiredServiceAddress(insertPayload);
  if (!insertValidation.ok) {
    const error = new Error(insertValidation.error);
    error.statusCode = insertValidation.status;
    error.code = insertValidation.code;
    throw error;
  }

  const { data, error } = await runCustomerWriteWithSchemaFallback(
    payload => db.from('customers').insert([payload]).select(),
    insertPayload,
    'POST /api/services ensure customer'
  );
  if (error) throw error;

  const created = data?.[0] || null;
  if (created?.id) servicePayload.cliente_id = Number(created.id);
  if (created?.id) {
    try {
      await ensureCustomerAlias(db, created.id, name, 'agenda');
    } catch (aliasError) {
      console.warn('[POST /api/services ensure customer] Complemento de alias ignorado:', aliasError.message);
    }
  }
  let addressRecord = null;
  if (created?.id && shouldSaveAddress) {
    try {
      addressRecord = await ensureServiceCustomerAddress(db, servicePayload, created, 'agenda', rawInput);
    } catch (addressError) {
      if (addressError.statusCode) throw addressError;
      console.warn('[POST /api/services ensure customer] Complemento de endereco ignorado:', addressError.message);
    }
  }
  return { payload: servicePayload, customer: created, address: addressRecord, created: true };
}

let clientServiceInstance = null;
function getClientDomainService() {
  if (!clientServiceInstance) {
    clientServiceInstance = createClientService({
      maybeSingle,
      normalizePhone,
      normalizeEmail,
      normalizeUf,
      normalizeCustomerName,
      normalizeCustomerOperationalStatus,
      normalizeCustomerPriority,
      buildCustomerAddress,
      findDuplicateCustomer,
      runCustomerWriteWithSchemaFallback,
      ensureCustomerAlias,
      ensureCustomerAddress,
      listCustomerAddresses,
      runCustomerAddressWriteWithSchemaFallback,
      isMissingRelationError,
      publicDbErrorDetails
    });
  }
  return clientServiceInstance;
}

let appointmentServiceInstance = null;
function getAppointmentDomainService() {
  if (!appointmentServiceInstance) {
    appointmentServiceInstance = createAppointmentService({
      normalizeServicePayload,
      runServiceWriteWithSchemaFallback,
      ensureCustomerForServicePayload
    });
  }
  return appointmentServiceInstance;
}

function serviceCustomerId(service = {}) {
  return service.cliente_id || service.customer_id || service.clienteId || service.client_id || null;
}

function serviceCustomerName(service = {}) {
  return String(service.cliente || service.cl || '').trim();
}

function compactServiceCustomerLink(service = {}) {
  return {
    id: service.id,
    date: serviceDateValue(service) || null,
    cliente: serviceCustomerName(service),
    cliente_id: serviceCustomerId(service),
    endereco: service.endereco || null,
    status: service.status || service.st || null
  };
}

function compactCustomerCandidate(customer = {}, score = 0, reason = '') {
  return {
    id: customer.id,
    nome: customer.nome,
    telefone: customer.telefone || customer.whatsapp || null,
    endereco: customer.endereco || customer.endereco_completo || null,
    ativo: customer.ativo !== false,
    score,
    reason
  };
}

function customerLinkNameScore(left, right) {
  const leftName = normalizeCustomerName(left);
  const rightName = normalizeCustomerName(right);
  if (!leftName || !rightName) return 0;
  if (leftName === rightName) return 100;
  if ((leftName.length >= 3 && rightName.includes(leftName)) || (rightName.length >= 3 && leftName.includes(rightName))) {
    return 88;
  }

  const leftTokens = leftName.split(' ').filter(token => token.length >= 3);
  const rightTokens = rightName.split(' ').filter(token => token.length >= 3);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const rightSet = new Set(rightTokens);
  const common = leftTokens.filter(token => rightSet.has(token)).length;
  return Math.round((common / Math.max(leftTokens.length, rightTokens.length)) * 80);
}

function buildCustomerLinkCandidateList(service, customers = []) {
  const serviceName = serviceCustomerName(service);
  const serviceFingerprint = buildCustomerAddressFingerprint({ endereco: service.endereco || '' });
  return customers
    .map(customer => {
      const score = customerLinkNameScore(serviceName, customer.nome_normalizado || customer.nome);
      const addressMatch = serviceFingerprint && buildCustomerAddressFingerprint(customer) === serviceFingerprint;
      const finalScore = addressMatch ? Math.max(score, 72) : score;
      return compactCustomerCandidate(customer, finalScore, addressMatch ? 'endereco_compativel' : 'nome_parecido');
    })
    .filter(candidate => candidate.score >= 50)
    .sort((a, b) => b.score - a.score || String(a.nome || '').localeCompare(String(b.nome || '')))
    .slice(0, 5);
}

function classifyServiceCustomerLink(service, customers = []) {
  const serviceName = serviceCustomerName(service);
  if (!serviceName) {
    return {
      type: 'revisao_manual',
      confidence: 0,
      reason: 'servico_sem_nome_cliente',
      service: compactServiceCustomerLink(service),
      candidates: []
    };
  }

  const normalizedServiceName = normalizeCustomerName(serviceName);
  const activeCustomers = customers.filter(customer => customer.ativo !== false);
  const exactActive = activeCustomers.filter(customer => normalizeCustomerName(customer.nome_normalizado || customer.nome) === normalizedServiceName);

  if (exactActive.length === 1) {
    return {
      type: 'link_auto_seguro',
      confidence: 100,
      reason: 'nome_exato_unico',
      service: compactServiceCustomerLink(service),
      suggested_customer: compactCustomerCandidate(exactActive[0], 100, 'nome_exato_unico')
    };
  }

  const serviceFingerprint = buildCustomerAddressFingerprint({ endereco: service.endereco || '' });
  if (exactActive.length > 1) {
    const byAddress = serviceFingerprint
      ? exactActive.filter(customer => buildCustomerAddressFingerprint(customer) === serviceFingerprint)
      : [];
    if (byAddress.length === 1) {
      return {
        type: 'link_auto_seguro',
        confidence: 96,
        reason: 'nome_exato_e_endereco_unicos',
        service: compactServiceCustomerLink(service),
        suggested_customer: compactCustomerCandidate(byAddress[0], 96, 'nome_exato_e_endereco_unicos')
      };
    }
    return {
      type: 'revisao_manual',
      confidence: 0,
      reason: 'nome_exato_multiplo',
      service: compactServiceCustomerLink(service),
      candidates: buildCustomerLinkCandidateList(service, exactActive)
    };
  }

  const addressMatches = serviceFingerprint
    ? activeCustomers.filter(customer => buildCustomerAddressFingerprint(customer) === serviceFingerprint)
    : [];
  const compatibleAddressMatches = addressMatches
    .map(customer => ({ customer, score: customerLinkNameScore(serviceName, customer.nome_normalizado || customer.nome) }))
    .filter(item => item.score >= 45);

  if (compatibleAddressMatches.length === 1) {
    return {
      type: 'link_auto_seguro',
      confidence: 92,
      reason: 'endereco_unico_nome_compativel',
      service: compactServiceCustomerLink(service),
      suggested_customer: compactCustomerCandidate(compatibleAddressMatches[0].customer, 92, 'endereco_unico_nome_compativel')
    };
  }

  const candidates = buildCustomerLinkCandidateList(service, customers);
  if (compatibleAddressMatches.length > 1 || candidates.length) {
    return {
      type: 'revisao_manual',
      confidence: 0,
      reason: compatibleAddressMatches.length > 1 ? 'endereco_multiplo' : 'nome_parecido',
      service: compactServiceCustomerLink(service),
      candidates
    };
  }

  return {
    type: 'criar_cliente',
    confidence: 90,
    reason: 'sem_candidato_seguro',
    service: compactServiceCustomerLink(service),
    new_customer: {
      nome: serviceName,
      endereco: service.endereco || null,
      tipo_cliente: 'Eventual',
      origem: 'agenda_repair'
    }
  };
}

function summarizeCustomerLinkAudit(items = {}) {
  return {
    link_auto_seguro: items.link_auto_seguro?.length || 0,
    criar_cliente: items.criar_cliente?.length || 0,
    revisao_manual: items.revisao_manual?.length || 0,
    ignorados: items.ignorados?.length || 0,
    total_pendentes: (items.link_auto_seguro?.length || 0) + (items.criar_cliente?.length || 0) + (items.revisao_manual?.length || 0)
  };
}

async function buildCustomerLinkAudit(db, options = {}) {
  const serviceLimit = Math.min(Math.max(parseInt(options.serviceLimit, 10) || 5000, 1), 10000);
  const customerLimit = Math.min(Math.max(parseInt(options.customerLimit, 10) || 5000, 1), 10000);
  const includeCancelled = options.includeCancelled === true || String(options.includeCancelled) === 'true';

  const [servicesRes, customersRes] = await Promise.all([
    db.from('services').select('*').order('date', { ascending: false, nullsFirst: false }).limit(serviceLimit),
    db.from('customers').select('*').limit(customerLimit)
  ]);
  if (servicesRes.error) throw servicesRes.error;
  if (customersRes.error) throw customersRes.error;

  const items = {
    link_auto_seguro: [],
    criar_cliente: [],
    revisao_manual: [],
    ignorados: []
  };

  for (const service of servicesRes.data || []) {
    if (serviceCustomerId(service)) {
      items.ignorados.push({ reason: 'ja_vinculado', service: compactServiceCustomerLink(service) });
      continue;
    }
    if (!includeCancelled && String(service.status || service.st || '').toLowerCase() === 'cancelado') {
      items.ignorados.push({ reason: 'cancelado', service: compactServiceCustomerLink(service) });
      continue;
    }

    const classified = classifyServiceCustomerLink(service, customersRes.data || []);
    items[classified.type].push(classified);
  }

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    limits: { services: serviceLimit, customers: customerLimit },
    totals: {
      services_loaded: (servicesRes.data || []).length,
      customers_loaded: (customersRes.data || []).length
    },
    counts: summarizeCustomerLinkAudit(items),
    items
  };
}

async function createCustomerFromServiceForRepair(db, service = {}) {
  const name = serviceCustomerName(service);
  const address = String(service.endereco || '').trim();
  const payload = {
    nome: name,
    nome_normalizado: normalizeCustomerName(name),
    endereco: address || null,
    endereco_completo: address || null,
    categoria: 'eventual',
    tipo: 'PF',
    tipo_cliente: 'Eventual',
    status_operacional: 'Eventual',
    prioridade: 'Média',
    origem: 'agenda_repair',
    observacoes: `Criado automaticamente pela correção de vínculo da Agenda a partir do serviço #${service.id || '-'}.`,
    ativo: true
  };
  const { data, error } = await runCustomerWriteWithSchemaFallback(
    workingPayload => db.from('customers').insert([workingPayload]).select(),
    payload,
    'POST /api/services/customer-link-repair create customer'
  );
  if (error) throw error;
  return data?.[0] || null;
}

function customerPhone(customer = {}) {
  return normalizeBrazilWhatsAppNumber(customer.whatsapp || customer.telefone || '');
}

function technicianPhone(technician = {}) {
  return normalizeBrazilWhatsAppNumber(technician.whatsapp || technician.telefone || '');
}

function buildServiceLine(service = {}, index = 1) {
  return `${index}) ${serviceTimeValue(service)} - ${service.cliente || service.cl || 'Cliente'}\nServiço: ${serviceTypeValue(service)}\nEndereço: ${service.endereco || 'Endereco nao informado'}\nContato: ${service.contato_cliente || service.telefone || '-'}\nObservações: ${service.observacoes || service.obs || '-'}`;
}

function buildTechnicianAgendaMessage(technician, date, services = []) {
  const lines = services.map(buildServiceLine).join('\n\n');
  return `Bom dia, ${technician.nome || 'tecnico'}!\n\nSegue sua agenda de hoje, ${ymdToBr(date)}:\n\n${lines || 'Nenhum atendimento encontrado.'}\n\nPor favor, confirme o recebimento respondendo: OK`;
}

function buildCustomerConfirmationMessage(service, customer) {
  return `Olá, ${customer?.nome || service.cliente || service.cl || 'cliente'}! Tudo bem?\n\nSeu atendimento com a Letec foi agendado:\n\nData: ${ymdToBr(serviceDateValue(service))}\nHorário/Período: ${serviceTimeValue(service)}\nServiço: ${serviceTypeValue(service)}\nEndereço: ${service.endereco || 'Endereco cadastrado'}\n\nPor favor, responda:\n1 - Confirmar\n2 - Reagendar\n3 - Falar com a equipe`;
}

function buildCustomerReminder24hMessage(service, customer) {
  return `Olá, ${customer?.nome || service.cliente || service.cl || 'cliente'}!\n\nPassando para lembrar do atendimento da Letec agendado para amanhã:\n\nData: ${ymdToBr(serviceDateValue(service))}\nHorário/Período: ${serviceTimeValue(service)}\nServiço: ${serviceTypeValue(service)}\nEndereço: ${service.endereco || 'Endereco cadastrado'}\n\nPodemos manter confirmado?\n\nResponda:\n1 - Confirmar\n2 - Reagendar\n3 - Falar com a equipe`;
}

async function existingLogisticsWhatsappMessage(db, { agendamentoId, tipo, destinatarioTipo, dateKey }) {
  let query = db
    .from('logistica_whatsapp_mensagens')
    .select('*')
    .eq('agendamento_id', String(agendamentoId || ''))
    .eq('tipo', tipo)
    .eq('destinatario_tipo', destinatarioTipo)
    .gte('created_at', `${dateKey}T00:00:00.000Z`)
    .lt('created_at', `${dateKey}T23:59:59.999Z`)
    .limit(1);
  const { data, error } = await query;
  if (error) throw error;
  return (data || [])[0] || null;
}

async function insertLogisticsWhatsappMessage(db, payload) {
  const { data, error } = await db
    .from('logistica_whatsapp_mensagens')
    .insert([payload])
    .select();
  if (error) throw error;
  return data?.[0] || payload;
}

async function updateLogisticsWhatsappMessage(db, id, payload) {
  const { data, error } = await db
    .from('logistica_whatsapp_mensagens')
    .update(payload)
    .eq('id', id)
    .select();
  if (error) throw error;
  return data?.[0] || { id, ...payload };
}

async function sendAndRecordLogisticsMessage(db, payload, { force = false } = {}) {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  if (!force && payload.agendamento_id) {
    const existing = await existingLogisticsWhatsappMessage(db, {
      agendamentoId: payload.agendamento_id,
      tipo: payload.tipo,
      destinatarioTipo: payload.destinatario_tipo,
      dateKey
    });
    if (existing && existing.status === 'enviado') return { skipped: true, message: existing };
  }

  const phone = payload.telefone ? normalizeBrazilWhatsAppNumber(payload.telefone) : '';
  if (!phone && !payload.grupo_jid) {
    const errorRecord = await insertLogisticsWhatsappMessage(db, {
      ...payload,
      telefone: payload.telefone || null,
      direcao: 'enviada',
      status: 'erro',
      erro: 'Destinatario sem telefone valido ou grupo_jid',
      created_at: now.toISOString()
    });
    return { error: 'Destinatario sem telefone valido ou grupo_jid', message: errorRecord };
  }

  const pending = await insertLogisticsWhatsappMessage(db, {
    ...payload,
    telefone: phone || payload.telefone || null,
    direcao: 'enviada',
    status: 'pendente',
    created_at: now.toISOString()
  });

  try {
    const result = await sendEvolutionText({ number: phone || payload.grupo_jid, text: payload.mensagem });
    const sent = await updateLogisticsWhatsappMessage(db, pending.id, {
      status: 'enviado',
      resposta_api: result.providerResponse,
      enviado_em: new Date().toISOString(),
      erro: null
    });
    return { message: sent, evolution: result };
  } catch (error) {
    const failed = await updateLogisticsWhatsappMessage(db, pending.id, {
      status: 'erro',
      resposta_api: error.payload || { message: error.message },
      erro: error.message
    });
    return { error: error.message, message: failed };
  }
}

function getMapProviderConfig() {
  return {
    provider: 'local_estimate',
    routingConfigured: false,
    geocodingConfigured: false,
    cepLookupConfigured: true
  };
}

function createDistanceClient() {
  return new DistanceClient();
}

async function fetchLogisticsCatalogs() {
  const db = getSupabaseClient();
  const [serviceTypesResult, techniciansResult] = await Promise.all([
    db.from('service_types').select('*'),
    db.from('technicians').select('*')
  ]);

  if (serviceTypesResult.error) throw serviceTypesResult.error;
  if (techniciansResult.error) throw techniciansResult.error;

  return {
    serviceTypes: serviceTypesResult.data || [],
    technicians: techniciansResult.data || []
  };
}

async function fetchServicesForDate(date) {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from('services')
    .select('*')
    .or(`date.eq.${date},data.eq.${date}`)
    .order('horario', { ascending: true, nullsFirst: false });

  if (error) throw error;
  return data || [];
}

function operationalMapBounds(date, range) {
  const base = cleanDateText(date) || new Date().toISOString().slice(0, 10);
  const period = ['day', 'week', 'month'].includes(String(range || '').toLowerCase())
    ? String(range).toLowerCase()
    : 'day';
  if (period === 'week') {
    const end = new Date(`${base}T12:00:00`);
    end.setDate(end.getDate() + 6);
    return { start: base, end: end.toISOString().slice(0, 10), range: period };
  }
  if (period === 'month') {
    const start = `${base.slice(0, 7)}-01`;
    const endDate = new Date(Number(base.slice(0, 4)), Number(base.slice(5, 7)), 0);
    return { start, end: endDate.toISOString().slice(0, 10), range: period };
  }
  return { start: base, end: base, range: period };
}

function serviceDateValue(service = {}) {
  return service.date || service.data || service.dt || '';
}

function serviceTimeValue(service = {}) {
  return service.horario || service.hr || '';
}

function serviceAddressValue(service = {}) {
  return service.address_snapshot || service.endereco || service.endereco_completo || service.address || '';
}

function serviceTypeValue(service = {}) {
  return service.tiposervico || service.tipoServico || service.sc || service.tipo || '';
}

function serviceLocationValue(service = {}) {
  const candidates = [
    { lat: service.address_latitude, lng: service.address_longitude, source: 'customer_address' },
    { lat: service.customer_latitude, lng: service.customer_longitude, source: 'customer' },
    { lat: service.latitude ?? service.lat, lng: service.longitude ?? service.lng, source: service.location_source || 'service' },
    { lat: service.chegada_lat, lng: service.chegada_lng, source: 'technician_arrival' }
  ];
  for (const candidate of candidates) {
    const coords = validCoordinatePair(candidate.lat, candidate.lng);
    if (coords) return { ...coords, source: candidate.source };
  }
  return null;
}

function serviceStatusForOperationalMap(service = {}) {
  const status = String(service.status || service.st || 'agendado').toLowerCase();
  const date = serviceDateValue(service);
  const today = new Date().toISOString().slice(0, 10);
  if (status === 'executado') return 'executado';
  if (status === 'reagendado' || status === 'cancelado') return 'critico';
  if (status === 'agendado' && date && date < today) return 'atrasado';
  return 'pendente';
}

function normalizeOperationalService(service = {}, catalogs = {}) {
  const techIds = serviceTechnicianIds(service);
  const techById = new Map((catalogs.technicians || []).map(t => [String(t.id), t]));
  const technicians = techIds.map(id => techById.get(String(id))?.nome || String(id)).filter(Boolean);
  return {
    id: service.id,
    date: serviceDateValue(service),
    horario: serviceTimeValue(service),
    cliente: service.cliente || service.client_name_snapshot || service.cl || '',
    endereco: serviceAddressValue(service),
    equipe: technicians.join(' / ') || service.equipe || '',
    technicians_ids: techIds,
    veiculo: service.veiculo || '',
    tipo: serviceTypeValue(service),
    status: service.status || service.st || 'agendado',
    operational_status: serviceStatusForOperationalMap(service),
    os: service.os || service.OS || '',
    location: serviceLocationValue(service)
  };
}

// Routes
app.get('/api/health', (req, res) => {
  const maps = getMapProviderConfig();
  res.json({
    status: 'OK',
    message: 'Letec Logistics Backend is running',
    mapsProvider: maps.provider,
    routingConfigured: maps.routingConfigured,
    geocodingConfigured: maps.geocodingConfigured,
    cepLookupConfigured: maps.cepLookupConfigured,
    mapsProxy: maps.routingConfigured
  });
});

async function checkSupabaseTable(tableName) {
  const db = getSupabaseClient();
  const startedAt = Date.now();
  try {
    const { error } = await db
      .from(tableName)
      .select('id')
      .limit(1);

    if (error) {
      return {
        ok: false,
        status: 'error',
        table: tableName,
        ms: Date.now() - startedAt,
        message: error.message || 'Falha ao consultar tabela'
      };
    }

    return {
      ok: true,
      status: 'ok',
      table: tableName,
      ms: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      table: tableName,
      ms: Date.now() - startedAt,
      message: error.message || 'Falha ao consultar tabela'
    };
  }
}

app.get('/api/diagnostics/operational', async (req, res) => {
  const tables = [
    'services',
    'customers',
    'technicians',
    'vehicles',
    'checklists',
    'technician_events',
    'technician_messages'
  ];

  const checksList = await Promise.all(tables.map(checkSupabaseTable));
  const checks = checksList.reduce((acc, item) => {
    acc[item.table] = item;
    return acc;
  }, {});
  const failed = checksList.filter(item => !item.ok);
  const evolution = getEvolutionConfig();
  const warnings = [];

  if (!process.env.SUPABASE_URL) warnings.push('SUPABASE_URL nao configurada no backend.');
  if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)) {
    warnings.push('Chave Supabase do backend nao configurada.');
  }
  if (failed.length) {
    warnings.push(`${failed.length} tabela(s) principal(is) com falha de consulta.`);
  }
  if (!evolution.configured) warnings.push('Evolution API nao configurada completamente.');

  res.json({
    ok: failed.length === 0,
    serverTime: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    checks,
    features: {
      supabaseConfigured: !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)),
      mapsProvider: getMapProviderConfig().provider,
      routingConfigured: getMapProviderConfig().routingConfigured,
      geocodingConfigured: getMapProviderConfig().geocodingConfigured,
      cepLookupConfigured: getMapProviderConfig().cepLookupConfigured,
      mapsConfigured: getMapProviderConfig().routingConfigured,
      evolutionConfigured: evolution.configured,
      evolutionInstanceConfigured: !!evolution.instance
    },
    warnings
  });
});

app.post('/api/logistics/validate-service', async (req, res) => {
  try {
    const service = req.body.service || req.body.servico || req.body;
    if (!service || typeof service !== 'object') {
      return res.status(400).json({ error: 'service is required' });
    }

    const catalogs = req.body.serviceTypes && req.body.technicians
      ? { serviceTypes: req.body.serviceTypes, technicians: req.body.technicians }
      : await fetchLogisticsCatalogs();

    const services = Array.isArray(req.body.services)
      ? req.body.services
      : Array.isArray(req.body.servicos)
        ? req.body.servicos
        : await fetchServicesForDate(service.dt || service.date || service.data);

    const result = await validateService(service, {
      services,
      serviceTypes: catalogs.serviceTypes,
      technicians: catalogs.technicians,
      ignoreId: req.body.ignoreId ?? req.body.ignore_id ?? null,
      distanceClient: createDistanceClient()
    });

    res.json(result);
  } catch (error) {
    console.error('[POST /api/logistics/validate-service] Error:', error.message);
    res.status(500).json({ error: 'Falha ao validar logística do serviço', details: error.message });
  }
});

app.get('/api/logistics/day-route', async (req, res) => {
  try {
    const date = String(req.query.date || req.query.data || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const [catalogs, services] = await Promise.all([
      fetchLogisticsCatalogs(),
      fetchServicesForDate(date)
    ]);

    const result = await buildDayRoutes(services, {
      date,
      serviceTypes: catalogs.serviceTypes,
      technicians: catalogs.technicians,
      distanceClient: createDistanceClient()
    });

    res.json(result);
  } catch (error) {
    console.error('[GET /api/logistics/day-route] Error:', error.message);
    res.status(500).json({ error: 'Falha ao calcular roteiro do dia', details: error.message });
  }
});

app.get('/api/operational-map', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const technicianAuth = await requireTechnicianForPortal(req, res);
    if (technicianAuth === false) return;

    const bounds = operationalMapBounds(req.query.date || req.query.data, req.query.range || req.query.periodo);
    const team = cleanText(req.query.team || req.query.equipe || '', 160).toLowerCase();
    const vehicle = cleanText(req.query.vehicle || req.query.veiculo || '', 120).toLowerCase();
    const status = cleanText(req.query.status || '', 80).toLowerCase();
    const tipo = cleanText(req.query.tipo || req.query.type || '', 120).toLowerCase();

    const [catalogs, servicesResult] = await Promise.all([
      fetchLogisticsCatalogs(),
      db.from('services').select('*').limit(5000)
    ]);

    if (servicesResult.error) throw servicesResult.error;

    let rows = (servicesResult.data || []).filter(service => {
      const date = serviceDateValue(service);
      return date && date >= bounds.start && date <= bounds.end;
    });

    if (technicianAuth) {
      rows = rows.filter(service => technicianHasService(technicianAuth.technician.id, service));
    }

    rows = await enrichServicesWithCustomerLocations(db, rows);

    let services = rows.map(service => normalizeOperationalService(service, catalogs));

    if (team) services = services.filter(service => String(service.equipe || '').toLowerCase().includes(team));
    if (vehicle) services = services.filter(service => String(service.veiculo || '').toLowerCase() === vehicle);
    if (status) services = services.filter(service => String(service.operational_status || '').toLowerCase() === status || String(service.status || '').toLowerCase() === status);
    if (tipo) services = services.filter(service => String(service.tipo || '').toLowerCase().includes(tipo));

    let routes = [];
    if (bounds.range === 'day' && rows.length) {
      try {
        const routeResult = await buildDayRoutes(rows, {
          date: bounds.start,
          serviceTypes: catalogs.serviceTypes,
          technicians: catalogs.technicians,
          distanceClient: createDistanceClient()
        });
        routes = routeResult.routes || [];
      } catch (routeError) {
        routes = [];
      }
    }

    res.json({
      range: bounds,
      base: {
        label: 'Base Letec',
        query: 'R. Maria José Rangel, 135 - Vila Sao Paulo, São Paulo - SP',
        latitude: -23.655753,
        longitude: -46.6704132
      },
      services,
      routes,
      summary: {
        total: services.length,
        atrasados: services.filter(service => service.operational_status === 'atrasado').length,
        criticos: services.filter(service => service.operational_status === 'critico').length,
        pendentes: services.filter(service => service.operational_status === 'pendente').length,
        executados: services.filter(service => service.operational_status === 'executado').length
      }
    });
  } catch (error) {
    console.error('[GET /api/operational-map] Error:', error.message);
    res.status(500).json({ error: 'Falha ao montar mapa operacional', details: error.message });
  }
});

app.post('/api/logistics/simulate-route', async (req, res) => {
  try {
    const services = req.body.services || req.body.servicos || [];
    if (!Array.isArray(services)) {
      return res.status(400).json({ error: 'services must be an array' });
    }

    const catalogs = req.body.serviceTypes && req.body.technicians
      ? { serviceTypes: req.body.serviceTypes, technicians: req.body.technicians }
      : await fetchLogisticsCatalogs();

    const result = await buildDayRoutes(services, {
      date: req.body.date || req.body.data || '',
      serviceTypes: catalogs.serviceTypes,
      technicians: catalogs.technicians,
      distanceClient: createDistanceClient()
    });

    res.json(result);
  } catch (error) {
    console.error('[POST /api/logistics/simulate-route] Error:', error.message);
    res.status(500).json({ error: 'Falha ao simular roteiro', details: error.message });
  }
});

// Static frontend assets
app.use('/js', express.static(path.join(__dirname, 'frontend', 'js')));
app.use('/assets', express.static(path.join(__dirname, 'frontend', 'assets')));

app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(__dirname, 'frontend', 'manifest.webmanifest'));
});

app.get('/portal-tecnico-sw.js', (req, res) => {
  res.type('application/javascript');
  res.set('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'frontend', 'portal-tecnico-sw.js'));
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.get('/portal-tecnico.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'portal-tecnico.html'));
});

app.get('/portal-tecnico', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'portal-tecnico.html'));
});

app.get('/radar-gestor.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'radar-gestor.html'));
});

app.get('/radar-gestor', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'radar-gestor.html'));
});

app.get('/api/maps/distance-matrix', async (req, res) => {
  try {
    const origins = parseMatrixLocations(req.query.origins);
    const destinations = parseMatrixLocations(req.query.destinations);

    if (!origins.length || !destinations.length) {
      return res.status(400).json({ error: 'origins and destinations are required' });
    }

    if (origins.length > 5 || destinations.length > 25) {
      return res.status(400).json({ error: 'Too many origins or destinations for a single request' });
    }

    const payload = await createDistanceClient().buildDistanceMatrix(origins, destinations);
    return res.json(payload);
  } catch (error) {
    const isAbort = error.name === 'AbortError';
    return res.status(isAbort ? 504 : 500).json({
      error: isAbort ? 'Routing provider request timed out' : error.message
    });
  }
});

// Example routes for logistics operations
app.get('/api/services/customer-link-audit', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const audit = await buildCustomerLinkAudit(db, {
      serviceLimit: req.query.service_limit || req.query.limit,
      customerLimit: req.query.customer_limit,
      includeCancelled: req.query.include_cancelled
    });
    res.json(audit);
  } catch (error) {
    console.error('[GET /api/services/customer-link-audit] Error:', error.message);
    res.status(500).json({ error: 'Falha ao auditar vínculos da agenda' });
  }
});

app.post('/api/services/customer-link-repair', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const apply = req.body?.apply === true || String(req.query.apply || '').toLowerCase() === 'true';
    const audit = await buildCustomerLinkAudit(db, {
      serviceLimit: req.body?.service_limit || req.query.service_limit || req.query.limit,
      customerLimit: req.body?.customer_limit || req.query.customer_limit,
      includeCancelled: req.body?.include_cancelled || req.query.include_cancelled
    });
    const summary = {
      dry_run: !apply,
      linked: 0,
      created: 0,
      ignored: audit.counts.revisao_manual,
      ambiguous: audit.counts.revisao_manual,
      errors: []
    };

    if (!apply) {
      return res.json({
        ok: true,
        ...summary,
        counts: audit.counts,
        preview: audit.items
      });
    }

    for (const item of audit.items.link_auto_seguro) {
      try {
        const serviceId = item.service?.id;
        const customerId = item.suggested_customer?.id;
        if (!serviceId || !customerId) throw new Error('Serviço ou cliente ausente na sugestão');
        const { data, error } = await db
          .from('services')
          .update({ cliente_id: Number(customerId) })
          .eq('id', serviceId)
          .select();
        if (error) throw error;
        if (!data?.length) throw new Error('Serviço não encontrado para vínculo');
        summary.linked += 1;
      } catch (error) {
        summary.errors.push({ service_id: item.service?.id || null, action: 'link', error: error.message });
      }
    }

    const createdCustomerByRepairKey = new Map();
    for (const item of audit.items.criar_cliente) {
      try {
        const serviceId = item.service?.id;
        if (!serviceId) throw new Error('Serviço ausente para criação');
        const service = (audit.items.criar_cliente || []).find(candidate => candidate.service?.id === serviceId)?.service || item.service;
        const repairKey = `${normalizeCustomerName(service.cliente)}|${buildCustomerAddressFingerprint({ endereco: service.endereco || '' })}`;
        let customerId = createdCustomerByRepairKey.get(repairKey);
        if (!customerId) {
          const created = await createCustomerFromServiceForRepair(db, service);
          if (!created?.id) throw new Error('Cliente criado sem ID retornado');
          customerId = created.id;
          createdCustomerByRepairKey.set(repairKey, customerId);
          summary.created += 1;
        }
        const { data, error } = await db
          .from('services')
          .update({ cliente_id: Number(customerId) })
          .eq('id', serviceId)
          .select();
        if (error) throw error;
        if (!data?.length) throw new Error('Serviço não encontrado para vínculo do cliente criado');
        summary.linked += 1;
      } catch (error) {
        summary.errors.push({ service_id: item.service?.id || null, action: 'create', error: error.message });
      }
    }

    res.json({
      ok: summary.errors.length === 0,
      ...summary,
      counts: audit.counts
    });
  } catch (error) {
    console.error('[POST /api/services/customer-link-repair] Error:', error.message);
    res.status(500).json({ error: 'Falha ao corrigir vínculos da agenda' });
  }
});

app.post('/api/technician-auth/login', technicianLoginLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const pin = String(req.body?.pin || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(pin)) return res.status(400).json({ error: 'PIN deve ter 6 digitos', code: 'invalid_pin' });

    const matches = await findTechnicianForLogin(db, req.body || {});
    if (!matches.length) return res.status(401).json({ error: 'Tecnico ou PIN invalido', code: 'invalid_credentials' });
    if (matches.length > 1) return res.status(409).json({ error: 'Identifique o tecnico pelo ID ou telefone completo', code: 'ambiguous_technician' });

    const technician = matches[0];
    if (technician.ativo === false || technician.portal_login_enabled === false || !technician.portal_pin_hash) {
      return res.status(403).json({ error: 'Acesso do portal nao habilitado para este tecnico', code: 'portal_login_disabled' });
    }
    if (!verifyTechnicianPin(pin, technician.portal_pin_hash)) {
      return res.status(401).json({ error: 'Tecnico ou PIN invalido', code: 'invalid_credentials' });
    }

    const token = generateTechnicianSessionToken();
    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const sessionPayload = {
      technician_id: technician.id,
      session_token_hash: hashToken(token),
      expires_at: expires.toISOString(),
      last_seen_at: now.toISOString(),
      ip: req.ip || null,
      user_agent: truncateText(firstHeader(req, 'user-agent') || '', 500) || null
    };
    const { data, error } = await db.from('technician_sessions').insert([sessionPayload]).select();
    if (error) throw error;
    res.status(201).json({
      token,
      expires_at: expires.toISOString(),
      technician: publicTechnician(technician),
      session_id: data?.[0]?.id || null
    });
  } catch (error) {
    console.error('[POST /api/technician-auth/login] Error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao autenticar tecnico' });
  }
});

app.post('/api/app-auth/login', technicianLoginLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const email = normalizeEmail(req.body?.email || '');
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha sao obrigatorios', code: 'missing_credentials' });
    }
    if (email === EMERGENCY_APP_ADMIN_EMAIL && verifyPassword(password, EMERGENCY_APP_ADMIN_PASSWORD_HASH)) {
      return res.status(201).json(createEmergencyAppSession(email));
    }
    const appUser = await maybeSingle(
      db.from('app_users')
        .select('*')
        .eq('email', email)
        .eq('active', true)
        .limit(1)
    ).catch(error => {
      if (isMissingRelationError(error)) return null;
      throw error;
    });
    if (!appUser) {
      const { count, error: countError } = await db
        .from('app_users')
        .select('id', { count: 'exact', head: true })
        .eq('active', true);
      if (countError && !isMissingRelationError(countError)) throw countError;
      if (!countError && Number(count || 0) === 0) {
        const now = new Date().toISOString();
        const { data: created, error: createError } = await db
          .from('app_users')
          .upsert({
            email,
            name: 'Admin Letec',
            role: 'admin',
            active: true,
            password_hash: hashPassword(password),
            password_updated_at: now,
            session_revoked_at: now
          }, { onConflict: 'email' })
          .select()
          .limit(1);
        if (createError) throw createError;
        req.body.__bootstrapped_app_admin = true;
        return res.status(201).json(await createAppLoginSession(db, created?.[0], req));
      }
    }
    if (!appUser || !appUser.password_hash || !verifyPassword(password, appUser.password_hash)) {
      return res.status(401).json({ error: 'Email ou senha invalido', code: 'invalid_credentials' });
    }
    if (!['admin', 'operador'].includes(String(appUser.role || '').toLowerCase())) {
      return res.status(403).json({ error: 'Perfil sem permissao de acesso interno', code: 'invalid_role' });
    }

    res.status(201).json(await createAppLoginSession(db, appUser, req));
  } catch (error) {
    console.error('[POST /api/app-auth/login] Error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao autenticar usuario interno' });
  }
});

async function createAppLoginSession(db, appUser, req) {
  if (!appUser?.id) {
    const error = new Error('Usuario interno nao encontrado apos criacao');
    error.status = 500;
    throw error;
  }
  const token = generateAppSessionToken();
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sessionPayload = {
    app_user_id: appUser.id,
    session_token_hash: hashToken(token),
    expires_at: expires.toISOString(),
    last_seen_at: now.toISOString(),
    ip: req.ip || null,
    user_agent: truncateText(firstHeader(req, 'user-agent') || '', 500) || null
  };
  const { data, error } = await db.from('app_user_sessions').insert([sessionPayload]).select();
  if (error) throw error;
  return {
    token,
    expires_at: expires.toISOString(),
    user: publicAppUser(appUser),
    session_id: data?.[0]?.id || null
  };
}

app.post('/api/app-auth/logout', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const token = extractAppToken(req);
    if (token) {
      await db.from('app_user_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('session_token_hash', hashToken(token))
        .select();
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('[POST /api/app-auth/logout] Error:', error.message);
    res.status(500).json({ error: 'Falha ao encerrar sessao interna' });
  }
});

app.get('/api/app-auth/me', async (req, res) => {
  try {
    const auth = await authenticateAppSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessao interna invalida', code: 'app_session_required' });
    res.json({ user: publicAppUser(auth.appUser), session_expires_at: auth.session.expires_at });
  } catch (error) {
    console.error('[GET /api/app-auth/me] Error:', error.message);
    res.status(500).json({ error: 'Falha ao validar sessao interna' });
  }
});

function normalizeAppUserPayload(input = {}, options = {}) {
  const payload = {};
  if (!options.partial || input.email !== undefined) {
    const email = normalizeEmail(input.email || '');
    if (email) payload.email = email;
  }
  if (!options.partial || input.name !== undefined || input.nome !== undefined) {
    const name = cleanNullableText(input.name || input.nome || '', 160);
    if (name !== undefined) payload.name = name;
  }
  if (!options.partial || input.role !== undefined) {
    const role = String(input.role || '').trim().toLowerCase();
    if (['admin', 'operador'].includes(role)) payload.role = role;
  }
  if (!options.partial || input.active !== undefined) {
    payload.active = input.active !== false;
  }
  if (input.password !== undefined || input.senha !== undefined) {
    payload.password_hash = hashPassword(input.password || input.senha || '');
    payload.password_updated_at = new Date().toISOString();
    payload.session_revoked_at = new Date().toISOString();
  }
  return payload;
}

app.get('/api/app-users', async (req, res) => {
  try {
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    const db = getSupabaseClient();
    const { data, error } = await db
      .from('app_users')
      .select('id,auth_user_id,email,name,role,active,created_at,updated_at,password_updated_at,session_revoked_at')
      .order('email', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('[GET /api/app-users] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar usuarios internos' });
  }
});

app.post('/api/app-users', strictLimiter, async (req, res) => {
  try {
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    const db = getSupabaseClient();
    const payload = normalizeAppUserPayload(req.body || {});
    if (!payload.email) return res.status(400).json({ error: 'Email e obrigatorio' });
    if (!payload.role) payload.role = 'operador';
    if (!payload.password_hash) return res.status(400).json({ error: 'Senha e obrigatoria para novo usuario' });

    const { data, error } = await db
      .from('app_users')
      .insert([payload])
      .select('id,auth_user_id,email,name,role,active,created_at,updated_at,password_updated_at,session_revoked_at');
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ja existe usuario interno com este email' });
      throw error;
    }
    res.status(201).json(data?.[0] || null);
  } catch (error) {
    console.error('[POST /api/app-users] Error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao criar usuario interno' });
  }
});

app.put('/api/app-users/:id', strictLimiter, async (req, res) => {
  try {
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    const db = getSupabaseClient();
    const payload = normalizeAppUserPayload(req.body || {}, { partial: true });
    if (!Object.keys(payload).length) return res.status(400).json({ error: 'Nenhum campo valido para atualizar' });
    payload.updated_at = new Date().toISOString();

    const { data, error } = await db
      .from('app_users')
      .update(payload)
      .eq('id', req.params.id)
      .select('id,auth_user_id,email,name,role,active,created_at,updated_at,password_updated_at,session_revoked_at');
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ja existe usuario interno com este email' });
      throw error;
    }
    const updated = data?.[0] || null;
    if (!updated) return res.status(404).json({ error: 'Usuario interno nao encontrado' });
    res.json(updated);
  } catch (error) {
    console.error('[PUT /api/app-users/:id] Error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao atualizar usuario interno' });
  }
});

app.post('/api/app-users/:id/revoke', strictLimiter, async (req, res) => {
  try {
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    const db = getSupabaseClient();
    const now = new Date().toISOString();
    const { data, error } = await db
      .from('app_users')
      .update({ session_revoked_at: now, updated_at: now })
      .eq('id', req.params.id)
      .select('id,auth_user_id,email,name,role,active,created_at,updated_at,password_updated_at,session_revoked_at');
    if (error) throw error;
    const updated = data?.[0] || null;
    if (!updated) return res.status(404).json({ error: 'Usuario interno nao encontrado' });
    try {
      await db.from('app_user_sessions')
        .update({ revoked_at: now })
        .eq('app_user_id', req.params.id)
        .select();
    } catch(e) {}
    res.json(updated);
  } catch (error) {
    console.error('[POST /api/app-users/:id/revoke] Error:', error.message);
    res.status(500).json({ error: 'Falha ao revogar sessoes do usuario interno' });
  }
});

app.post('/api/technician-auth/logout', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const token = extractTechnicianToken(req);
    if (token) {
      await db
        .from('technician_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('session_token_hash', hashToken(token))
        .select();
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('[POST /api/technician-auth/logout] Error:', error.message);
    res.status(500).json({ error: 'Falha ao sair do portal' });
  }
});

app.get('/api/technician-auth/me', async (req, res) => {
  try {
    const auth = await authenticateTechnicianSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessao do tecnico invalida ou expirada', code: 'technician_session_required' });
    res.json({ technician: publicTechnician(auth.technician), expires_at: auth.session.expires_at });
  } catch (error) {
    console.error('[GET /api/technician-auth/me] Error:', error.message);
    res.status(500).json({ error: 'Falha ao validar sessao do tecnico' });
  }
});

app.post('/api/technician-auth/change-pin', technicianLoginLimiter, async (req, res) => {
  try {
    const auth = await authenticateTechnicianSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessao do tecnico invalida ou expirada', code: 'technician_session_required' });

    const currentPin = String(req.body?.current_pin || req.body?.currentPin || req.body?.pin_atual || '').replace(/\D/g, '');
    const newPin = String(req.body?.new_pin || req.body?.newPin || req.body?.pin_novo || '').replace(/\D/g, '');
    const confirmPin = String(req.body?.confirm_pin || req.body?.confirmPin || req.body?.confirmacao || '').replace(/\D/g, '');

    if (!/^\d{6}$/.test(currentPin)) {
      return res.status(400).json({ error: 'Informe o PIN atual com 6 digitos', code: 'invalid_current_pin' });
    }
    if (!/^\d{6}$/.test(newPin)) {
      return res.status(400).json({ error: 'O novo PIN deve ter 6 digitos', code: 'invalid_new_pin' });
    }
    if (newPin !== confirmPin) {
      return res.status(400).json({ error: 'A confirmacao do PIN nao confere', code: 'pin_confirmation_mismatch' });
    }
    if (newPin === currentPin) {
      return res.status(400).json({ error: 'Escolha um PIN diferente do atual', code: 'same_pin' });
    }

    const db = getSupabaseClient();
    const technician = await fetchTechnicianById(db, auth.technician.id);
    if (!technician || technician.ativo === false || technician.portal_login_enabled === false || !technician.portal_pin_hash) {
      return res.status(403).json({ error: 'Acesso do portal nao habilitado para este tecnico', code: 'portal_login_disabled' });
    }
    if (!verifyTechnicianPin(currentPin, technician.portal_pin_hash)) {
      return res.status(401).json({ error: 'PIN atual invalido', code: 'invalid_current_pin' });
    }

    const revokedAt = new Date().toISOString();
    const { data, error } = await db
      .from('technicians')
      .update({
        portal_pin_hash: hashTechnicianPin(newPin),
        portal_pin_updated_at: revokedAt,
        portal_login_enabled: true,
        portal_session_revoked_at: revokedAt
      })
      .eq('id', technician.id)
      .select();
    if (error) throw error;
    const updated = data?.[0] || null;
    if (!updated) return res.status(404).json({ error: 'Tecnico nao encontrado' });

    try {
      await db.from('technician_sessions')
        .update({ revoked_at: revokedAt })
        .eq('technician_id', technician.id)
        .select();
    } catch(e) {}

    res.json({ ok: true, technician: publicTechnician(updated) });
  } catch (error) {
    console.error('[POST /api/technician-auth/change-pin] Error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao trocar PIN do tecnico' });
  }
});

app.get('/api/services', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const technicianAuth = await requireTechnicianForPortal(req, res);
    if (technicianAuth === false) return;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 1000, 1), 5000);
    const cliente = String(req.query.cliente || '').trim();
    const date = cleanDateText(req.query.date);

    let query = db
      .from('services')
      .select('*')
      .order('date', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (cliente) {
      query = query.ilike('cliente', `%${cliente}%`);
    }
    if (date) {
      query = query.or(`date.eq.${date},data.eq.${date}`);
    }

    const { data, error } = await query;

    if (error) throw error;
    const rows = technicianAuth
      ? (data || []).filter(service => technicianHasService(technicianAuth.technician.id, service))
      : (data || []);
    res.json(await enrichServicesWithCustomerLocations(db, rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/services', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const result = await getAppointmentDomainService().createAppointment(db, req.body || {});
    if (result.error) {
      if (result.customerLinkFailed && result.error instanceof CustomerLinkError) {
        return res.status(result.status || 409).json({
          error: result.error.message,
          code: 'customer_link_ambiguous'
        });
      }
      if (result.error?.code === '23505' && result.payload?.id !== undefined && result.payload?.id !== null) {
        const existing = await maybeSingle(db.from('services').select('*').eq('id', result.payload.id));
        if (existing) return res.status(200).json(existing);
      }
      if (result.customerLinkFailed) {
        return res.status(result.status || 500).json({
          error: result.error?.statusCode ? result.error.message : 'Falha ao criar/vincular cliente do serviço',
          code: result.error?.code || 'customer_link_failed',
          details: publicDbErrorDetails(result.error)
        });
      }
      throw result.error;
    }
    res.status(result.status || 201).json(result.data || null);
  } catch (error) {
    console.error('[POST /api/services] Error:', error.message);
    res.status(500).json({
      code: 'service_create_failed',
      error: 'Falha ao criar serviço',
      details: publicDbErrorDetails(error)
    });
  }
});

app.put('/api/services/:id', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const id = req.params.id;
    const technicianAuth = await requireTechnicianForPortal(req, res);
    if (technicianAuth === false) return;
    if (technicianAuth) {
      const current = await fetchServiceById(db, id);
      if (!current) return res.status(404).json({ code: 'service_not_found', error: 'ServiÃ§o nÃ£o encontrado' });
      if (!technicianHasService(technicianAuth.technician.id, current)) {
        return res.status(403).json({ code: 'technician_service_forbidden', error: 'Este servico nao pertence ao tecnico logado' });
      }
    }
    const result = await getAppointmentDomainService().updateAppointment(db, id, req.body || {});
    if (result.error) {
      return res.status(result.status || 500).json(result.error);
    }
    res.json(result.data);
  } catch (error) {
    console.error('[PUT /api/services/:id] Error:', error.message);
    res.status(500).json({
      code: 'service_update_failed',
      error: 'Falha ao atualizar serviço',
      details: publicDbErrorDetails(error)
    });
  }
});

app.delete('/api/services/:id', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from('services')
      .delete()
      .eq('id', req.params.id)
      .select();

    if (error) throw error;
    const deleted = data?.[0] || null;
    if (!deleted) return res.status(404).json({ error: 'Serviço não encontrado' });
    res.json({ ok: true, service: deleted });
  } catch (error) {
    console.error('[DELETE /api/services/:id] Error:', error.message);
    res.status(500).json({ error: 'Falha ao excluir serviço' });
  }
});

app.post('/api/services/:id/promote-arrival-location', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const service = await fetchServiceById(db, req.params.id);
    if (!service) return res.status(404).json({ error: 'Servico nao encontrado', code: 'service_not_found' });

    const location = parseLocationBody({
      latitude: service.chegada_lat,
      longitude: service.chegada_lng
    });
    if (!location.ok) {
      return res.status(400).json({ error: 'Servico sem GPS de chegada valido', code: 'arrival_location_missing' });
    }

    const customerId = serviceCustomerId(service);
    if (!customerId) {
      return res.status(400).json({ error: 'Servico sem cliente vinculado', code: 'service_customer_missing' });
    }

    if (service.customer_address_id) {
      try {
        const { data, error } = await runCustomerAddressWriteWithSchemaFallback(
          payload => db.from('customer_addresses').update(payload).eq('customer_id', Number(customerId)).eq('id', service.customer_address_id).select(),
          { latitude: location.latitude, longitude: location.longitude, updated_at: new Date().toISOString() },
          'POST /api/services/:id/promote-arrival-location address'
        );
        if (error) throw error;
        if ((data || []).length) {
          return res.json({ ok: true, target: 'customer_address', location: { latitude: location.latitude, longitude: location.longitude }, address: compactCustomerAddress(data[0]) });
        }
      } catch (addressError) {
        if (!isMissingRelationError(addressError) && !getMissingSchemaColumn(addressError)) throw addressError;
      }
    }

    const { data, error } = await runCustomerWriteWithSchemaFallback(
      payload => db.from('customers').update(payload).eq('id', Number(customerId)).select(),
      { latitude: location.latitude, longitude: location.longitude, updated_at: new Date().toISOString() },
      'POST /api/services/:id/promote-arrival-location customer'
    );
    if (error) throw error;
    if (!(data || []).length) return res.status(404).json({ error: 'Cliente nao encontrado', code: 'customer_not_found' });
    res.json({ ok: true, target: 'customer', location: { latitude: location.latitude, longitude: location.longitude }, customer: data[0] });
  } catch (error) {
    console.error('[POST /api/services/:id/promote-arrival-location] Error:', error.message);
    res.status(500).json({ error: 'Falha ao promover GPS da chegada', details: publicDbErrorDetails(error) });
  }
});

app.get('/api/checklists', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const technicianAuth = await requireTechnicianForPortal(req, res);
    if (technicianAuth === false) return;
    const date = cleanDateText(req.query.date);
    let query = db
      .from('checklists')
      .select('*')
      .order('created_at', { ascending: false });

    if (date) query = query.eq('date', date);

    const { data, error } = await query;
    if (error) throw error;
    const rows = technicianAuth
      ? (data || []).filter(item => textMatchesTechnician(technicianAuth.technician, `${item.motorista || ''} ${item.assistente || ''}`))
      : (data || []);
    res.json(rows);
  } catch (error) {
    console.error('[GET /api/checklists] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar checklists' });
  }
});

app.post('/api/checklists', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const technicianAuth = await requireTechnicianForPortal(req, res);
    if (technicianAuth === false) return;
    const payload = normalizeChecklistPayload(req.body);
    if (technicianAuth) {
      payload.motorista = technicianAuth.technician.nome || payload.motorista;
    }
    const { data, error } = await db
      .from('checklists')
      .insert([payload])
      .select();

    if (error) throw error;
    res.status(201).json(data?.[0] || null);
  } catch (error) {
    console.error('[POST /api/checklists] Error:', error.message);
    res.status(500).json({ error: 'Falha ao criar checklist' });
  }
});

app.delete('/api/checklists/:id', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from('checklists')
      .delete()
      .eq('id', req.params.id)
      .select();

    if (error) throw error;
    const deleted = data?.[0] || null;
    if (!deleted) return res.status(404).json({ error: 'Checklist não encontrado' });
    res.json({ ok: true, checklist: deleted });
  } catch (error) {
    console.error('[DELETE /api/checklists/:id] Error:', error.message);
    res.status(500).json({ error: 'Falha ao excluir checklist' });
  }
});

app.get('/api/technician-events', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const technicianAuth = await requireTechnicianForPortal(req, res);
    if (technicianAuth === false) return;
    const date = cleanDateText(req.query.date);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
    let query = db
      .from('technician_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (date) query = query.eq('date', date);

    const { data, error } = await query;
    if (error) throw error;
    const rows = technicianAuth
      ? (data || []).filter(item => eventMatchesTechnician(technicianAuth.technician, item))
      : (data || []);
    res.json(rows);
  } catch (error) {
    console.error('[GET /api/technician-events] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar eventos técnicos' });
  }
});

app.post('/api/technician-events', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const technicianAuth = await requireTechnicianForPortal(req, res);
    if (technicianAuth === false) return;
    const payload = normalizeTechnicianEventPayload(req.body);
    if (technicianAuth) {
      if (payload.service_id) {
        const service = await fetchServiceById(db, payload.service_id);
        if (!service || !technicianHasService(technicianAuth.technician.id, service)) {
          return res.status(403).json({ code: 'technician_service_forbidden', error: 'Este servico nao pertence ao tecnico logado' });
        }
      }
      payload.tecnico = technicianAuth.technician.nome || payload.tecnico;
      payload.equipe = payload.equipe || technicianAuth.technician.nome || payload.tecnico;
    }
    const duplicate = await findDuplicateTechnicianEvent(db, payload);
    if (duplicate) return res.status(200).json({ ...duplicate, deduplicated: true });

    const { data, error } = await db
      .from('technician_events')
      .insert([payload])
      .select();

    if (error) throw error;
    res.status(201).json(data?.[0] || null);
  } catch (error) {
    console.error('[POST /api/technician-events] Error:', error.message);
    res.status(500).json({ error: 'Falha ao criar evento técnico' });
  }
});

app.put('/api/technician-events/:id', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const payload = normalizeTechnicianEventPayload(req.body, { partial: true });
    delete payload.id;
    const { data, error } = await db
      .from('technician_events')
      .update(payload)
      .eq('id', req.params.id)
      .select();

    if (error) throw error;
    const updated = data?.[0] || null;
    if (!updated) return res.status(404).json({ error: 'Evento técnico não encontrado' });
    res.json(updated);
  } catch (error) {
    console.error('[PUT /api/technician-events/:id] Error:', error.message);
    res.status(500).json({ error: 'Falha ao atualizar evento técnico' });
  }
});

app.get('/api/technician-messages', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const technicianAuth = await requireTechnicianForPortal(req, res);
    if (technicianAuth === false) return;
    const date = cleanDateText(req.query.date);
    const unread = String(req.query.unread) === 'true';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
    let query = db
      .from('technician_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (date && unread) query = query.or(`date.eq.${date},lido.eq.false`);
    else if (date) query = query.eq('date', date);
    else if (unread) query = query.eq('lido', false);

    const { data, error } = await query;
    if (error) throw error;
    const rows = technicianAuth
      ? (data || []).filter(item => eventMatchesTechnician(technicianAuth.technician, item))
      : (data || []);
    res.json(rows);
  } catch (error) {
    console.error('[GET /api/technician-messages] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar mensagens técnicas' });
  }
});

app.post('/api/technician-messages', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const payload = normalizeTechnicianMessagePayload(req.body);
    const { data, error } = await db
      .from('technician_messages')
      .insert([payload])
      .select();

    if (error) throw error;
    res.status(201).json(data?.[0] || null);
  } catch (error) {
    console.error('[POST /api/technician-messages] Error:', error.message);
    res.status(500).json({ error: 'Falha ao criar mensagem técnica' });
  }
});

app.put('/api/technician-messages/:id/read', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const technicianAuth = await requireTechnicianForPortal(req, res);
    if (technicianAuth === false) return;
    if (technicianAuth) {
      const current = await maybeSingle(db.from('technician_messages').select('*').eq('id', req.params.id));
      if (!current) return res.status(404).json({ error: 'Mensagem tÃ©cnica nÃ£o encontrada' });
      if (!eventMatchesTechnician(technicianAuth.technician, current)) {
        return res.status(403).json({ code: 'technician_message_forbidden', error: 'Esta mensagem nao pertence ao tecnico logado' });
      }
    }
    const payload = {
      lido: true,
      lido_em: cleanNullableText(req.body?.lido_em, 80) || new Date().toISOString()
    };
    const { data, error } = await db
      .from('technician_messages')
      .update(payload)
      .eq('id', req.params.id)
      .select();

    if (error) throw error;
    const updated = data?.[0] || null;
    if (!updated) return res.status(404).json({ error: 'Mensagem técnica não encontrada' });
    res.json(updated);
  } catch (error) {
    console.error('[PUT /api/technician-messages/:id/read] Error:', error.message);
    res.status(500).json({ error: 'Falha ao marcar mensagem como lida' });
  }
});

app.get('/api/technicians', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const active = req.query.active ?? req.query.ativo;
    let query = db
      .from('technicians')
      .select('*')
      .order('nome', { ascending: true });

    if (active !== undefined) query = query.eq('ativo', cleanBoolean(active, true));

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('[GET /api/technicians] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar tecnicos' });
  }
});

app.post('/api/technicians', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const payload = normalizeTechnicianPayload(req.body);
    if (!payload.nome) return res.status(400).json({ error: 'Nome do tecnico e obrigatorio' });
    const { data, error } = await db.from('technicians').insert([payload]).select();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ja existe um tecnico com este nome' });
      throw error;
    }
    res.status(201).json(data?.[0] || null);
  } catch (error) {
    console.error('[POST /api/technicians] Error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao criar tecnico' });
  }
});

app.put('/api/technicians/:id', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const payload = normalizeTechnicianPayload(req.body, { partial: true });
    if (!Object.keys(payload).length) return res.status(400).json({ error: 'Nenhum campo valido para atualizar' });
    const { data, error } = await db.from('technicians').update(payload).eq('id', req.params.id).select();
    if (error) throw error;
    const updated = data?.[0] || null;
    if (!updated) return res.status(404).json({ error: 'Tecnico nao encontrado' });
    res.json(updated);
  } catch (error) {
    console.error('[PUT /api/technicians/:id] Error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao atualizar tecnico' });
  }
});

app.post('/api/technicians/:id/portal-pin', strictLimiter, async (req, res) => {
  try {
    const actor = await requireAdminOrOperator(req, res);
    if (!actor) return;
    const db = getSupabaseClient();
    const pin = req.body?.pin ? String(req.body.pin).replace(/\D/g, '') : generateTechnicianPin();
    const payload = {
      portal_pin_hash: hashTechnicianPin(pin),
      portal_pin_updated_at: new Date().toISOString(),
      portal_login_enabled: true,
      portal_session_revoked_at: new Date().toISOString()
    };
    const { data, error } = await db.from('technicians').update(payload).eq('id', req.params.id).select();
    if (error) throw error;
    const updated = data?.[0] || null;
    if (!updated) return res.status(404).json({ error: 'Tecnico nao encontrado' });
    try {
      await db.from('technician_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('technician_id', req.params.id)
        .select();
    } catch(e) {}
    res.json({ technician: publicTechnician(updated), pin });
  } catch (error) {
    console.error('[POST /api/technicians/:id/portal-pin] Error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao gerar PIN do tecnico' });
  }
});

app.post('/api/technicians/:id/portal-access/revoke', strictLimiter, async (req, res) => {
  try {
    const actor = await requireAdminOrOperator(req, res);
    if (!actor) return;
    const db = getSupabaseClient();
    const revokedAt = new Date().toISOString();
    const { data, error } = await db
      .from('technicians')
      .update({ portal_session_revoked_at: revokedAt })
      .eq('id', req.params.id)
      .select();
    if (error) throw error;
    const updated = data?.[0] || null;
    if (!updated) return res.status(404).json({ error: 'Tecnico nao encontrado' });
    try {
      await db.from('technician_sessions')
        .update({ revoked_at: revokedAt })
        .eq('technician_id', req.params.id)
        .select();
    } catch(e) {}
    res.json({ ok: true, technician: publicTechnician(updated) });
  } catch (error) {
    console.error('[POST /api/technicians/:id/portal-access/revoke] Error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao revogar acesso do tecnico' });
  }
});

app.get('/api/inventory/products', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { data, error } = await db.from('inventory_products').select('*').order('nome', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('[GET /api/inventory/products] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar produtos do estoque' });
  }
});

app.post('/api/inventory/products', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const payload = normalizeInventoryProductPayload(req.body);
    if (!payload.nome) return res.status(400).json({ error: 'Nome do produto e obrigatorio' });
    const { data, error } = await db.from('inventory_products').insert([payload]).select();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ja existe um produto com este nome' });
      throw error;
    }
    res.status(201).json(data?.[0] || null);
  } catch (error) {
    console.error('[POST /api/inventory/products] Error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao criar produto' });
  }
});

app.put('/api/inventory/products/:id', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const payload = normalizeInventoryProductPayload(req.body, { partial: true });
    if (!Object.keys(payload).length) return res.status(400).json({ error: 'Nenhum campo valido para atualizar' });
    const { data, error } = await db.from('inventory_products').update(payload).eq('id', req.params.id).select();
    if (error) throw error;
    const updated = data?.[0] || null;
    if (!updated) return res.status(404).json({ error: 'Produto nao encontrado' });
    res.json(updated);
  } catch (error) {
    console.error('[PUT /api/inventory/products/:id] Error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao atualizar produto' });
  }
});

app.delete('/api/inventory/products/:id', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { data, error } = await db.from('inventory_products').delete().eq('id', req.params.id).select();
    if (error) throw error;
    const deleted = data?.[0] || null;
    if (!deleted) return res.status(404).json({ error: 'Produto nao encontrado' });
    res.json({ ok: true, product: deleted });
  } catch (error) {
    console.error('[DELETE /api/inventory/products/:id] Error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao excluir produto' });
  }
});

app.get('/api/inventory/movements', async (req, res) => {
  try {
    const db = getSupabaseClient();
    let query = db.from('inventory_movements').select('*').order('data', { ascending: false }).order('created_at', { ascending: false });
    if (req.query.data) query = query.eq('data', cleanDateText(req.query.data));
    if (req.query.tipo) query = query.eq('tipo', String(req.query.tipo));
    if (req.query.product_id) query = query.eq('product_id', req.query.product_id);
    if (req.query.vehicle_id) query = query.eq('vehicle_id', req.query.vehicle_id);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('[GET /api/inventory/movements] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar movimentacoes do estoque' });
  }
});

app.post('/api/inventory/movements', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const payload = normalizeInventoryMovementPayload(req.body);
    const { data, error } = await db.from('inventory_movements').insert([payload]).select();
    if (error) throw error;
    res.status(201).json(data?.[0] || null);
  } catch (error) {
    console.error('[POST /api/inventory/movements] Error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao criar movimentacao' });
  }
});

app.get('/api/veiculos/setup/status', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const status = await getFleetSetupStatus(db);
    res.json(status);
  } catch (error) {
    console.error('[GET /api/veiculos/setup/status] Error:', error.message);
    res.status(500).json({ error: 'Falha ao verificar setup da frota' });
  }
});

app.get('/api/veiculos/alertas', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const alerts = await fetchVehicleAlerts(db);
    res.json(alerts);
  } catch (error) {
    console.error('[GET /api/veiculos/alertas] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar alertas de frota' });
  }
});

app.post('/api/veiculos/alertas/enviar-whatsapp', strictLimiter, async (req, res) => {
  const db = getSupabaseClient();
  try {
    const alerts = await fetchVehicleAlerts(db);
    const alert = alerts.find(item => item.alerta_chave === req.body.alerta_chave) || req.body.alerta;
    if (!alert) return res.status(404).json({ error: 'Alerta nao encontrado' });
    const destination = cleanNullableText(req.body.telefone, 30) || process.env.GESTOR_WHATSAPP_NUMBER;
    if (!destination && !process.env.GRUPO_OPERACIONAL_JID) {
      return res.status(503).json({ error: 'Configure GESTOR_WHATSAPP_NUMBER ou GRUPO_OPERACIONAL_JID para envio de alertas' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const force = req.body.force === true || String(req.body.force) === 'true';
    const duplicate = await maybeSingle(db
      .from('veiculo_alerta_envios')
      .select('*')
      .eq('alerta_chave', alert.alerta_chave)
      .eq('data_envio', today));
    if (duplicate && !force) return res.status(409).json({ error: 'Alerta ja enviado hoje', envio: duplicate });

    const message = `Alerta de veiculo - Letec\n\nVeiculo: ${alert.veiculo}\nPlaca: ${alert.placa || '-'}\nAlerta: ${alert.mensagem || alert.tipo_alerta}\nPrazo: ${alert.data_limite || alert.proxima_quilometragem || '-'}\nPrioridade: ${alert.prioridade}\n\nVerifique no sistema.`;
    const sendResult = await sendEvolutionText({ number: destination || process.env.GRUPO_OPERACIONAL_JID, text: message });
    const { data, error } = await db.from('veiculo_alerta_envios').insert([{
      veiculo_id: alert.veiculo_id || null,
      alerta_chave: alert.alerta_chave,
      tipo_alerta: alert.tipo_alerta,
      destino: destination || process.env.GRUPO_OPERACIONAL_JID,
      data_envio: today,
      resposta_api: sendResult.providerResponse,
      status: 'enviado'
    }]).select();
    if (error) throw error;
    await insertVehicleHistory(db, {
      veiculo_id: alert.veiculo_id,
      tipo_evento: 'whatsapp',
      descricao: `Alerta enviado por WhatsApp: ${alert.tipo_alerta}`,
      dados_novos: { alert, sendResult }
    });
    res.json({ ok: true, envio: data?.[0] || null, provider: sendResult });
  } catch (error) {
    console.error('[POST /api/veiculos/alertas/enviar-whatsapp] Error:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Falha ao enviar alerta por WhatsApp', detail: error.payload || undefined });
  }
});

app.post('/api/veiculos/alertas/enviar-resumo-whatsapp', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const alerts = await fetchVehicleAlerts(db);
    const destination = cleanNullableText(req.body.telefone, 30) || process.env.GESTOR_WHATSAPP_NUMBER || process.env.GRUPO_OPERACIONAL_JID;
    if (!destination) return res.status(503).json({ error: 'Configure GESTOR_WHATSAPP_NUMBER ou GRUPO_OPERACIONAL_JID para envio do resumo' });
    const counts = alerts.reduce((acc, item) => {
      acc[item.prioridade] = (acc[item.prioridade] || 0) + 1;
      return acc;
    }, {});
    const top = alerts.slice(0, 8).map((item, index) => `${index + 1}. ${item.veiculo} - ${item.placa || '-'} - ${item.mensagem || item.tipo_alerta}`).join('\n');
    const message = `Resumo de alertas da frota - Letec\n\nCriticos: ${counts.critica || 0}\nAltos: ${counts.alta || 0}\nMedios: ${counts.media || 0}\nBaixos: ${counts.baixa || 0}\n\nPrincipais pendencias:\n${top || 'Sem pendencias no momento.'}`;
    const sendResult = await sendEvolutionText({ number: destination, text: message });
    await insertVehicleHistory(db, {
      tipo_evento: 'whatsapp',
      descricao: 'Resumo de alertas da frota enviado por WhatsApp',
      dados_novos: { quantidade_alertas: alerts.length, sendResult }
    });
    res.json({ ok: true, total_alertas: alerts.length, provider: sendResult });
  } catch (error) {
    console.error('[POST /api/veiculos/alertas/enviar-resumo-whatsapp] Error:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Falha ao enviar resumo por WhatsApp', detail: error.payload || undefined });
  }
});

app.get('/api/veiculos', async (req, res) => {
  try {
    const db = getSupabaseClient();
    let query = db.from('vehicles').select('*').order('nome', { ascending: true });
    if (req.query.ativo !== undefined) query = query.eq('ativo', cleanBoolean(req.query.ativo, true));
    const { data, error } = await query;
    if (error) throw error;
    res.json((data || []).map(addVehicleComputedFields));
  } catch (error) {
    console.error('[GET /api/veiculos] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar veiculos' });
  }
});

app.get('/api/veiculos/duplicados', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { data, error } = await db.from('vehicles').select('*').order('nome', { ascending: true });
    if (error) throw error;
    res.json(buildVehicleDuplicateGroups(data || []));
  } catch (error) {
    console.error('[GET /api/veiculos/duplicados] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar duplicados de veiculos' });
  }
});

app.get('/api/veiculos/:id', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const vehicle = await maybeSingle(db.from('vehicles').select('*').eq('id', req.params.id));
    if (!vehicle) return res.status(404).json({ error: 'Veiculo nao encontrado' });
    const [documentos, manutencoes, historico] = await Promise.all([
      safeFleetRows(db.from('veiculo_documentos').select('*').eq('veiculo_id', req.params.id).order('data_vencimento', { ascending: true }), 'veiculo_documentos'),
      safeFleetRows(db.from('veiculo_manutencoes').select('*').eq('veiculo_id', req.params.id).order('created_at', { ascending: false }), 'veiculo_manutencoes'),
      safeFleetRows(db.from('veiculo_historico').select('*').eq('veiculo_id', req.params.id).order('created_at', { ascending: false }).limit(80), 'veiculo_historico')
    ]);
    const alerts = buildVehicleAlerts({ vehicles: [vehicle], documents: documentos, maintenances: manutencoes });
    res.json({ ...vehicle, rodizio: rodizioInfo(vehicle.placa), documentos, manutencoes, historico, alertas: alerts });
  } catch (error) {
    console.error('[GET /api/veiculos/:id] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar veiculo' });
  }
});

app.post('/api/veiculos', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const payload = normalizeVehiclePayload(req.body);
    if (!payload.nome) return res.status(400).json({ error: 'Nome do veiculo e obrigatorio' });
    const existingVehiclesRes = await db.from('vehicles').select('*');
    if (existingVehiclesRes.error) throw existingVehiclesRes.error;
    const duplicate = findDuplicateVehicle(existingVehiclesRes.data || [], payload);
    if (duplicate) return res.status(409).json(vehicleDuplicatePayload(duplicate));

    const { data, error } = await db.from('vehicles').insert([payload]).select();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ja existe um veiculo com este nome ou placa' });
      throw error;
    }
    const vehicle = data?.[0] || null;
    if (vehicle) await insertVehicleHistory(db, { veiculo_id: vehicle.id, tipo_evento: 'cadastro', descricao: 'Veiculo cadastrado', dados_novos: vehicle });
    res.status(201).json(vehicle);
  } catch (error) {
    console.error('[POST /api/veiculos] Error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao criar veiculo' });
  }
});

app.put('/api/veiculos/:id', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const before = await maybeSingle(db.from('vehicles').select('*').eq('id', req.params.id));
    if (!before) return res.status(404).json({ error: 'Veiculo nao encontrado' });
    const payload = normalizeVehiclePayload(req.body, { partial: true });
    if (!Object.keys(payload).length) return res.status(400).json({ error: 'Nenhum campo valido para atualizar' });
    const existingVehiclesRes = await db.from('vehicles').select('*');
    if (existingVehiclesRes.error) throw existingVehiclesRes.error;
    const duplicate = findDuplicateVehicle(existingVehiclesRes.data || [], payload, req.params.id);
    if (duplicate) return res.status(409).json(vehicleDuplicatePayload(duplicate));

    const { data, error } = await db.from('vehicles').update(payload).eq('id', req.params.id).select();
    if (error) throw error;
    const updated = data?.[0] || null;
    await insertVehicleHistory(db, { veiculo_id: req.params.id, tipo_evento: 'edicao', descricao: 'Veiculo atualizado', dados_anteriores: before, dados_novos: updated });
    res.json(updated);
  } catch (error) {
    console.error('[PUT /api/veiculos/:id] Error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao atualizar veiculo' });
  }
});

app.post('/api/veiculos/:id/quilometragem', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const km = cleanNumber(req.body.quilometragem_atual ?? req.body.km);
    if (km === null || km === undefined || km < 0) return res.status(400).json({ error: 'Quilometragem invalida' });
    const before = await maybeSingle(db.from('vehicles').select('*').eq('id', req.params.id));
    if (!before) return res.status(404).json({ error: 'Veiculo nao encontrado' });
    const { data, error } = await db.from('vehicles').update({ quilometragem_atual: km, updated_at: new Date().toISOString() }).eq('id', req.params.id).select();
    if (error) throw error;
    const updated = data?.[0] || null;
    await insertVehicleHistory(db, { veiculo_id: req.params.id, tipo_evento: 'status', descricao: 'Quilometragem atualizada', dados_anteriores: { quilometragem_atual: before.quilometragem_atual }, dados_novos: { quilometragem_atual: km } });
    res.json(updated);
  } catch (error) {
    console.error('[POST /api/veiculos/:id/quilometragem] Error:', error.message);
    res.status(500).json({ error: 'Falha ao atualizar quilometragem' });
  }
});

app.get('/api/veiculos/:id/documentos', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { data, error } = await db.from('veiculo_documentos').select('*').eq('veiculo_id', req.params.id).order('data_vencimento', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('[GET /api/veiculos/:id/documentos] Error:', error.message);
    if (sendFleetSetupError(res, error, 'Documentos do veiculo')) return;
    res.status(500).json({ error: 'Falha ao buscar documentos' });
  }
});

app.post('/api/veiculos/:id/documentos', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const payload = { ...normalizeVehicleDocumentPayload(req.body), veiculo_id: req.params.id };
    if (!payload.tipo_documento || !payload.data_vencimento) return res.status(400).json({ error: 'Tipo e vencimento do documento sao obrigatorios' });
    const { data, error } = await db.from('veiculo_documentos').insert([payload]).select();
    if (error) throw error;
    const doc = data?.[0] || null;
    await insertVehicleHistory(db, { veiculo_id: req.params.id, tipo_evento: 'documento', descricao: 'Documento criado', dados_novos: doc });
    res.status(201).json(doc);
  } catch (error) {
    console.error('[POST /api/veiculos/:id/documentos] Error:', error.message);
    if (sendFleetSetupError(res, error, 'Documentos do veiculo')) return;
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao criar documento' });
  }
});

app.put('/api/veiculos/documentos/:documento_id', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const before = await maybeSingle(db.from('veiculo_documentos').select('*').eq('id', req.params.documento_id));
    if (!before) return res.status(404).json({ error: 'Documento nao encontrado' });
    const payload = normalizeVehicleDocumentPayload(req.body, { partial: true });
    const { data, error } = await db.from('veiculo_documentos').update(payload).eq('id', req.params.documento_id).select();
    if (error) throw error;
    const updated = data?.[0] || null;
    await insertVehicleHistory(db, { veiculo_id: updated?.veiculo_id || before.veiculo_id, tipo_evento: 'documento', descricao: 'Documento atualizado', dados_anteriores: before, dados_novos: updated });
    res.json(updated);
  } catch (error) {
    console.error('[PUT /api/veiculos/documentos/:documento_id] Error:', error.message);
    if (sendFleetSetupError(res, error, 'Documentos do veiculo')) return;
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao atualizar documento' });
  }
});

app.delete('/api/veiculos/documentos/:documento_id', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { data, error } = await db.from('veiculo_documentos').delete().eq('id', req.params.documento_id).select();
    if (error) throw error;
    const deleted = data?.[0] || null;
    if (!deleted) return res.status(404).json({ error: 'Documento nao encontrado' });
    await insertVehicleHistory(db, { veiculo_id: deleted.veiculo_id, tipo_evento: 'documento', descricao: 'Documento excluido', dados_anteriores: deleted });
    res.json({ ok: true, documento: deleted });
  } catch (error) {
    console.error('[DELETE /api/veiculos/documentos/:documento_id] Error:', error.message);
    if (sendFleetSetupError(res, error, 'Documentos do veiculo')) return;
    res.status(500).json({ error: 'Falha ao excluir documento' });
  }
});

app.get('/api/veiculos/:id/manutencoes', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { data, error } = await db.from('veiculo_manutencoes').select('*').eq('veiculo_id', req.params.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('[GET /api/veiculos/:id/manutencoes] Error:', error.message);
    if (sendFleetSetupError(res, error, 'Manutencoes do veiculo')) return;
    res.status(500).json({ error: 'Falha ao buscar manutencoes' });
  }
});

app.post('/api/veiculos/:id/manutencoes', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const payload = { ...normalizeVehicleMaintenancePayload(req.body), veiculo_id: req.params.id };
    if (!payload.tipo_manutencao) return res.status(400).json({ error: 'Tipo de manutencao e obrigatorio' });
    const { data, error } = await db.from('veiculo_manutencoes').insert([payload]).select();
    if (error) throw error;
    const maintenance = data?.[0] || null;
    await insertVehicleHistory(db, { veiculo_id: req.params.id, tipo_evento: 'manutencao', descricao: 'Manutencao criada', dados_novos: maintenance });
    res.status(201).json(maintenance);
  } catch (error) {
    console.error('[POST /api/veiculos/:id/manutencoes] Error:', error.message);
    if (sendFleetSetupError(res, error, 'Manutencoes do veiculo')) return;
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao criar manutencao' });
  }
});

app.put('/api/veiculos/manutencoes/:manutencao_id', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const before = await maybeSingle(db.from('veiculo_manutencoes').select('*').eq('id', req.params.manutencao_id));
    if (!before) return res.status(404).json({ error: 'Manutencao nao encontrada' });
    const payload = normalizeVehicleMaintenancePayload(req.body, { partial: true });
    const { data, error } = await db.from('veiculo_manutencoes').update(payload).eq('id', req.params.manutencao_id).select();
    if (error) throw error;
    const updated = data?.[0] || null;
    await insertVehicleHistory(db, { veiculo_id: updated?.veiculo_id || before.veiculo_id, tipo_evento: 'manutencao', descricao: 'Manutencao atualizada', dados_anteriores: before, dados_novos: updated });
    res.json(updated);
  } catch (error) {
    console.error('[PUT /api/veiculos/manutencoes/:manutencao_id] Error:', error.message);
    if (sendFleetSetupError(res, error, 'Manutencoes do veiculo')) return;
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao atualizar manutencao' });
  }
});

app.post('/api/veiculos/manutencoes/:manutencao_id/marcar-realizada', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const before = await maybeSingle(db.from('veiculo_manutencoes').select('*').eq('id', req.params.manutencao_id));
    if (!before) return res.status(404).json({ error: 'Manutencao nao encontrada' });
    const payload = {
      status: 'realizada',
      data_realizada: cleanDateText(req.body.data_realizada) || new Date().toISOString().slice(0, 10),
      quilometragem_realizada: cleanNumber(req.body.quilometragem_realizada),
      updated_at: new Date().toISOString()
    };
    const { data, error } = await db.from('veiculo_manutencoes').update(payload).eq('id', req.params.manutencao_id).select();
    if (error) throw error;
    const updated = data?.[0] || null;
    await insertVehicleHistory(db, { veiculo_id: updated?.veiculo_id || before.veiculo_id, tipo_evento: 'manutencao', descricao: 'Manutencao marcada como realizada', dados_anteriores: before, dados_novos: updated });
    res.json(updated);
  } catch (error) {
    console.error('[POST /api/veiculos/manutencoes/:manutencao_id/marcar-realizada] Error:', error.message);
    if (sendFleetSetupError(res, error, 'Manutencoes do veiculo')) return;
    res.status(500).json({ error: 'Falha ao marcar manutencao como realizada' });
  }
});

app.delete('/api/veiculos/manutencoes/:manutencao_id', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { data, error } = await db.from('veiculo_manutencoes').delete().eq('id', req.params.manutencao_id).select();
    if (error) throw error;
    const deleted = data?.[0] || null;
    if (!deleted) return res.status(404).json({ error: 'Manutencao nao encontrada' });
    await insertVehicleHistory(db, { veiculo_id: deleted.veiculo_id, tipo_evento: 'manutencao', descricao: 'Manutencao excluida', dados_anteriores: deleted });
    res.json({ ok: true, manutencao: deleted });
  } catch (error) {
    console.error('[DELETE /api/veiculos/manutencoes/:manutencao_id] Error:', error.message);
    if (sendFleetSetupError(res, error, 'Manutencoes do veiculo')) return;
    res.status(500).json({ error: 'Falha ao excluir manutencao' });
  }
});

app.get('/api/service-types', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('service_types')
      .select('*')
      .order('nome', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/service-types', strictLimiter, async (req, res) => {
  try {
    const { nome, sigla, duracao_minutos, cor, categoria, tipo_atendimento, duracao_contrato_meses } = req.body;
    if (!nome || !sigla) {
      return res.status(400).json({ error: 'Nome e sigla são obrigatórios' });
    }

    const tipoAtendimento = (tipo_atendimento || 'eventual').toLowerCase();
    if (!['eventual', 'contrato'].includes(tipoAtendimento)) {
      return res.status(400).json({ error: 'tipo_atendimento deve ser eventual ou contrato' });
    }

    const duracaoContratoMeses = tipoAtendimento === 'contrato'
      ? (Number.parseInt(duracao_contrato_meses, 10) || null)
      : null;

    if (tipoAtendimento === 'contrato' && (!duracaoContratoMeses || duracaoContratoMeses < 1)) {
      return res.status(400).json({ error: 'Duração do contrato (meses) é obrigatória para atendimento por contrato' });
    }

    const siglaUp = sigla.toUpperCase().trim();
    const { data, error } = await supabase
      .from('service_types')
      .insert([{
        nome: nome.trim(),
        sigla: siglaUp,
        duracao_minutos: duracao_minutos || 60,
        cor: cor || '#94a3b8',
        categoria: categoria || 'geral',
        tipo_atendimento: tipoAtendimento,
        duracao_contrato_meses: duracaoContratoMeses,
        ativo: true
      }])
      .select();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Já existe um tipo com este nome ou sigla' });
      throw error;
    }
    const created = data?.[0] || null;
    if (created?.id) {
      await ensureCustomerAlias(db, created.id, created.nome || nome, origem || 'cadastro');
      await ensureCustomerAddress(db, created.id, {
        ...insertPayload,
        origem: origem || 'cadastro'
      }, { origem: origem || 'cadastro', is_primary: true, label: 'Principal' });
    }

    res.status(201).json(created);
  } catch (error) {
    console.error('[POST /api/service-types] Error:', error.message);
    res.status(500).json({ error: 'Falha ao criar tipo de serviço' });
  }
});

app.put('/api/service-types/:id', strictLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, sigla, duracao_minutos, cor, categoria, tipo_atendimento, duracao_contrato_meses } = req.body;
    if (!nome || !sigla) {
      return res.status(400).json({ error: 'Nome e sigla são obrigatórios' });
    }

    const tipoAtendimento = (tipo_atendimento || 'eventual').toLowerCase();
    if (!['eventual', 'contrato'].includes(tipoAtendimento)) {
      return res.status(400).json({ error: 'tipo_atendimento deve ser eventual ou contrato' });
    }

    const duracaoContratoMeses = tipoAtendimento === 'contrato'
      ? (Number.parseInt(duracao_contrato_meses, 10) || null)
      : null;

    if (tipoAtendimento === 'contrato' && (!duracaoContratoMeses || duracaoContratoMeses < 1)) {
      return res.status(400).json({ error: 'Duração do contrato (meses) é obrigatória para atendimento por contrato' });
    }

    const { data, error } = await supabase
      .from('service_types')
      .update({
        nome: nome.trim(),
        sigla: sigla.toUpperCase().trim(),
        duracao_minutos: duracao_minutos || 60,
        cor: cor || '#94a3b8',
        categoria: categoria || 'geral',
        tipo_atendimento: tipoAtendimento,
        duracao_contrato_meses: duracaoContratoMeses
      })
      .eq('id', id)
      .select();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Já existe um tipo com este nome ou sigla' });
      throw error;
    }
    if (!data.length) return res.status(404).json({ error: 'Tipo não encontrado' });
    res.json(data[0]);
  } catch (error) {
    console.error('[PUT /api/service-types/:id] Error:', error.message);
    res.status(500).json({ error: 'Falha ao atualizar tipo de serviço' });
  }
});

app.delete('/api/service-types/:id', strictLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('service_types').delete().eq('id', id);
    if (error) throw error;
    res.json({ message: 'Tipo removido com sucesso' });
  } catch (error) {
    console.error('[DELETE /api/service-types/:id] Error:', error.message);
    res.status(500).json({ error: 'Falha ao remover tipo de serviço' });
  }
});

app.get('/api/cep/:cep', async (req, res) => {
  try {
    const payload = await lookupCep(req.params.cep);
    return res.json(payload);

    const cep = String(req.params.cep || '').replace(/\D/g, '');
    if (cep.length !== 8) {
      return res.status(400).json({ error: 'CEP deve ter 8 dígitos' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          error: payload.erro ? 'CEP não encontrado' : 'Falha ao consultar CEP',
          details: payload
        });
      }

      if (payload.erro) {
        return res.status(404).json({ error: 'CEP não encontrado' });
      }

      return res.json(payload);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const isAbort = error.name === 'AbortError';
    return res.status(error.statusCode || (isAbort ? 504 : 502)).json({
      error: isAbort ? 'Consulta de CEP expirou' : error.message,
      code: error.code || (isAbort ? 'cep_timeout' : 'cep_lookup_failed')
    });
  }
});

// CUSTOMERS CRUD
app.get('/api/customers', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const {
      search,
      tipo_local,
      bairro,
      nivel_urgencia_padrao,
      cliente_recorrente,
      tipo_cliente,
      status_operacional,
      prioridade,
      include_inactive,
      limit: rawLimit,
      offset: rawOffset,
      page: rawPage
    } = req.query;
    const hasPagination = rawPage !== undefined || rawOffset !== undefined;
    const limit = Math.min(Math.max(parseInt(rawLimit, 10) || (hasPagination ? 50 : 500), 1), 500);
    const page = Math.max(parseInt(rawPage, 10) || 1, 1);
    const offset = Math.max(parseInt(rawOffset, 10) || ((page - 1) * limit), 0);
    const normalizedStatusFilter = normalizeCustomerOperationalStatus(status_operacional);
    const includeInactiveCustomers = String(include_inactive) === 'true' || normalizedStatusFilter === 'Inativo';
    let query = db
      .from('customers')
      .select('*', hasPagination ? { count: 'exact' } : undefined)
      .order('nome', { ascending: true });

    if (!includeInactiveCustomers) {
      query = query.eq('ativo', true);
    }
    
    if (search && typeof search === 'string') {
      const safeSearch = search.trim().substring(0, 100);
      query = query.or(
        `nome.ilike.%${safeSearch}%,telefone.ilike.%${safeSearch}%,whatsapp.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%,endereco.ilike.%${safeSearch}%,bairro.ilike.%${safeSearch}%,tipo_local.ilike.%${safeSearch}%`
      );
    }
    if (tipo_local) query = query.eq('tipo_local', tipo_local);
    if (bairro) query = query.ilike('bairro', `%${String(bairro).trim()}%`);
    if (nivel_urgencia_padrao) query = query.eq('nivel_urgencia_padrao', nivel_urgencia_padrao);
    if (tipo_cliente) query = query.eq('tipo_cliente', tipo_cliente);
    if (status_operacional) {
      const aliases = customerStatusAliases(normalizedStatusFilter || status_operacional);
      query = aliases.length > 1
        ? query.in('status_operacional', aliases)
        : query.eq('status_operacional', aliases[0] || status_operacional);
    }
    if (prioridade) {
      const aliases = customerPriorityAliases(prioridade);
      query = aliases.length > 1
        ? query.in('prioridade', aliases)
        : query.eq('prioridade', aliases[0] || prioridade);
    }
    if (cliente_recorrente !== undefined) {
      query = query.eq('cliente_recorrente', String(cliente_recorrente) === 'true');
    }
    if (hasPagination) query = query.range(offset, offset + limit - 1);
    else if (rawLimit !== undefined) query = query.limit(limit);
    
    const { data, error, count } = await query;
    if (error) throw error;
    let normalizedData = (data || []).map(row => ({
      ...row,
      status_operacional: normalizeCustomerOperationalStatus(row.status_operacional) || row.status_operacional,
      prioridade: normalizeCustomerPriority(row.prioridade) || row.prioridade
    }));
    if (!includeInactiveCustomers) {
      normalizedData = normalizedData.filter(row => !isInactiveCustomerRecord(row));
    }
    if (hasPagination) {
      return res.json({ items: normalizedData, total: count || 0, page, limit, offset });
    }
    res.json(normalizedData);
  } catch (error) {
    console.error('[GET /api/customers] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar clientes' });
  }
});

app.post('/api/customers', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const result = await getClientDomainService().createClient(db, req.body || {});
    if (result.error) {
      if (result.error.code === 'possible_duplicate') return res.status(result.status || 409).json(result.error);
      if (result.error.code === '23505') return res.status(409).json({ error: 'Telefone ja cadastrado. Verifique se o cliente ja existe.', code: 'customer_unique_violation' });
      return res.status(result.status || 500).json({
        code: result.error.code || 'customer_create_failed',
        error: result.error.error || 'Falha ao criar cliente',
        details: publicDbErrorDetails(result.error)
      });
    }
    return res.status(result.status || 201).json(result.data);
  } catch (error) {
    console.error('[POST /api/customers] Error:', error.message);
    res.status(500).json({
      code: 'customer_create_failed',
      error: 'Falha ao criar cliente',
      details: publicDbErrorDetails(error)
    });
  }
});

app.post('/api/customers/quick', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const result = await getClientDomainService().createQuickClient(db, req.body || {});
    if (result.error) {
      if (result.error.code === 'possible_duplicate') return res.status(result.status || 409).json(result.error);
      return res.status(result.status || 500).json({
        code: result.error.code || 'customer_quick_create_failed',
        error: result.error.error || 'Falha ao criar cliente rapido',
        details: publicDbErrorDetails(result.error)
      });
    }
    return res.status(result.status || 201).json(result.data);
  } catch (error) {
    console.error('[POST /api/customers/quick] Error:', error.message);
    res.status(500).json({
      code: 'customer_quick_create_failed',
      error: 'Falha ao criar cliente rapido',
      details: publicDbErrorDetails(error)
    });
  }
});

app.put('/api/customers/:id', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { id } = req.params;
    const result = await getClientDomainService().updateClient(db, id, req.body || {});
    if (result.error) {
      if (result.error.code === 'possible_duplicate') return res.status(result.status || 409).json(result.error);
      return res.status(result.status || 500).json({
        code: result.error.code || 'customer_update_failed',
        error: result.error.error || 'Falha ao atualizar cliente',
        details: publicDbErrorDetails(result.error)
      });
    }
    return res.json(result.data);
  } catch (error) {
    console.error('[PUT /api/customers/:id] Error:', error.message);
    res.status(500).json({
      code: 'customer_update_failed',
      error: 'Falha ao atualizar cliente',
      details: publicDbErrorDetails(error)
    });
  }
});

app.delete('/api/customers/:id', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const rawId = String(req.params.id || '').trim();
    const customerId = /^\d+$/.test(rawId) ? parseInt(rawId, 10) : rawId;
    
    const { data, error } = await db
      .from('customers')
      .update({
        ativo: false,
        status_operacional: 'Inativo',
        updated_at: new Date().toISOString()
      })
      .eq('id', customerId)
      .select();

    if (error) throw error;
    if (!data.length) return res.status(404).json({ error: 'Cliente não encontrado' });
    
    res.json({ message: 'Cliente removido com sucesso', customer: data[0] });
  } catch (error) {
    console.error('[DELETE /api/customers/:id] Error:', error.message);
    res.status(500).json({ error: 'Falha ao remover cliente' });
  }
});

const CUSTOMER_HARD_DELETE_BLOCKERS = [
  { table: 'services', column: 'cliente_id', key: 'services_cliente_id', label: 'servicos vinculados por ID' },
  { table: 'services', column: 'customer_id', key: 'services_customer_id', label: 'servicos vinculados por customer_id' },
  { table: 'customer_service_history', column: 'customer_id', key: 'customer_service_history', label: 'historico operacional' }
];

const CUSTOMER_HARD_DELETE_CLEANUP = [
  { table: 'customer_addresses', column: 'customer_id', key: 'customer_addresses', label: 'enderecos do cadastro' },
  { table: 'customer_aliases', column: 'customer_id', key: 'customer_aliases', label: 'apelidos/aliases' },
  { table: 'contracts', column: 'customer_id', key: 'contracts', label: 'contratos cadastrados' },
  { table: 'data_reviews', column: 'customer_id', key: 'data_reviews', label: 'pendencias de revisao' },
  { table: 'customer_reminders', column: 'customer_id', key: 'customer_reminders', label: 'lembretes do cliente' }
];

async function safeCountRelation(db, relation, value) {
  if (value === undefined || value === null || value === '') return { ...relation, count: 0 };
  try {
    const { data, error, count } = await db
      .from(relation.table)
      .select('id', { count: 'exact' })
      .eq(relation.column, value)
      .limit(500);
    if (error) {
      if (isMissingRelationError(error) || getMissingSchemaColumn(error)) return { ...relation, count: 0, skipped: true };
      throw error;
    }
    return { ...relation, count: Number.isFinite(Number(count)) ? Number(count) : (data || []).length };
  } catch (error) {
    if (isMissingRelationError(error) || getMissingSchemaColumn(error)) return { ...relation, count: 0, skipped: true };
    throw error;
  }
}

async function safeDeleteRelation(db, relation, value) {
  if (value === undefined || value === null || value === '') return { ...relation, deleted: 0 };
  try {
    const { data, error } = await db
      .from(relation.table)
      .delete()
      .eq(relation.column, value)
      .select('id');
    if (error) {
      if (isMissingRelationError(error) || getMissingSchemaColumn(error)) return { ...relation, deleted: 0, skipped: true };
      throw error;
    }
    return { ...relation, deleted: (data || []).length };
  } catch (error) {
    if (isMissingRelationError(error) || getMissingSchemaColumn(error)) return { ...relation, deleted: 0, skipped: true };
    throw error;
  }
}

async function buildCustomerHardDeleteImpact(db, customer) {
  const customerId = customer?.id;
  const blockers = await Promise.all(CUSTOMER_HARD_DELETE_BLOCKERS.map(relation => safeCountRelation(db, relation, customerId)));
  if (customer?.nome) {
    blockers.push(await safeCountRelation(db, {
      table: 'services',
      column: 'cliente',
      key: 'services_cliente_name',
      label: 'servicos vinculados pelo nome'
    }, customer.nome));
  }
  const cleanup = await Promise.all(CUSTOMER_HARD_DELETE_CLEANUP.map(relation => safeCountRelation(db, relation, customerId)));
  const blocking = blockers.filter(item => item.count > 0);
  return {
    can_delete: blocking.length === 0,
    blockers,
    blocking,
    cleanup
  };
}

app.get('/api/customers/:id/hard-delete-preview', async (req, res) => {
  try {
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    const db = getSupabaseClient();
    const customerId = /^\d+$/.test(String(req.params.id || '')) ? Number(req.params.id) : req.params.id;
    const customer = await maybeSingle(db.from('customers').select('*').eq('id', customerId));
    if (!customer) return res.status(404).json({ error: 'Cliente nao encontrado', code: 'customer_not_found' });
    const impact = await buildCustomerHardDeleteImpact(db, customer);
    res.json({ customer: { id: customer.id, nome: customer.nome }, ...impact });
  } catch (error) {
    console.error('[GET /api/customers/:id/hard-delete-preview] Error:', error.message);
    res.status(500).json({ error: 'Falha ao validar exclusao definitiva do cliente' });
  }
});

app.post('/api/customers/:id/hard-delete', strictLimiter, async (req, res) => {
  try {
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    const db = getSupabaseClient();
    const customerId = /^\d+$/.test(String(req.params.id || '')) ? Number(req.params.id) : req.params.id;
    const customer = await maybeSingle(db.from('customers').select('*').eq('id', customerId));
    if (!customer) return res.status(404).json({ error: 'Cliente nao encontrado', code: 'customer_not_found' });

    const confirmName = String(req.body?.confirmName || req.body?.nome || '').trim();
    if (normalizeCustomerName(confirmName) !== normalizeCustomerName(customer.nome)) {
      return res.status(400).json({ error: 'Nome de confirmacao nao confere com o cliente', code: 'customer_name_confirmation_required' });
    }

    const impact = await buildCustomerHardDeleteImpact(db, customer);
    if (!impact.can_delete) {
      return res.status(409).json({
        error: 'Cliente possui historico vinculado. Use inativar ou mesclar em vez de apagar.',
        code: 'customer_hard_delete_blocked',
        impact
      });
    }

    const cleaned = [];
    for (const relation of CUSTOMER_HARD_DELETE_CLEANUP) {
      cleaned.push(await safeDeleteRelation(db, relation, customerId));
    }

    const { data, error } = await db
      .from('customers')
      .delete()
      .eq('id', customerId)
      .select();
    if (error) throw error;
    if (!(data || []).length) return res.status(404).json({ error: 'Cliente nao encontrado', code: 'customer_not_found' });

    res.json({
      message: 'Cliente apagado definitivamente',
      customer: data[0],
      cleanup: cleaned
    });
  } catch (error) {
    console.error('[POST /api/customers/:id/hard-delete] Error:', error.message);
    res.status(500).json({ error: 'Falha ao apagar cliente definitivamente' });
  }
});

app.get('/api/geocode', async (req, res) => {
  try {
    return res.status(503).json({
      error: 'Geocodificacao automatica desativada',
      code: 'geocode_disabled',
      details: 'Modo economico ativo: use CEP, ponto manual no mapa ou GPS de chegada do tecnico.'
    });
  } catch (error) {
    console.error('[GET /api/geocode] Error:', error.message);
    return res.status(500).json({
      error: 'Falha ao retornar status da geocodificacao',
      details: error.message
    });
  }
});

async function updateServicesCustomerLink(db, duplicateId, primaryId, addressId = null) {
  const payload = addressId
    ? { cliente_id: Number(primaryId), customer_address_id: addressId }
    : { cliente_id: Number(primaryId) };
  const { error } = await runServiceWriteWithSchemaFallback(
    workingPayload => db.from('services').update(workingPayload).eq('cliente_id', duplicateId),
    payload,
    'merge services customer link'
  );
  if (error) throw error;
}

function chooseCanonicalPrimary(customers = []) {
  return [...customers].sort((a, b) => {
    const score = item => {
      let value = 0;
      if (item.tipo_cliente === 'Contrato' || item.categoria === 'contrato') value += 30;
      if (item.status_operacional === 'Ativo') value += 20;
      if (item.cliente_recorrente) value += 15;
      if (item.telefone || item.whatsapp) value += 8;
      if (buildCustomerAddressFingerprint(item)) value += 5;
      if (item.ativo !== false) value += 3;
      return value;
    };
    return score(b) - score(a) || Number(a.id || 0) - Number(b.id || 0);
  })[0] || null;
}

function customerCompletenessScore(customer = {}) {
  return [
    customer.nome,
    customer.telefone || customer.whatsapp,
    customer.email,
    customer.cpf_cnpj,
    customer.endereco || customer.endereco_completo,
    customer.cep,
    customer.bairro,
    customer.cidade,
    customer.tipo_cliente || customer.categoria,
    customer.status_operacional
  ].filter(Boolean).length;
}

function dedupCustomerLinkTotal(linkCounts = {}) {
  return Object.values(linkCounts || {}).reduce((total, count) => total + (Number(count) || 0), 0);
}

function chooseDeduplicationPrimary(customers = [], impact = {}) {
  const byCustomer = impact?.by_customer || {};
  return [...customers].sort((a, b) => {
    const score = item => {
      let value = 0;
      const status = normalizeCustomerOperationalStatus(item.status_operacional);
      if (item.tipo_cliente === 'Contrato' || item.categoria === 'contrato') value += 60;
      if (status === 'Ativo') value += 35;
      if (item.cliente_recorrente) value += 25;
      value += dedupCustomerLinkTotal(byCustomer[String(item.id)]?.links) * 12;
      value += customerCompletenessScore(item) * 4;
      if (buildCustomerAddressFingerprint(item)) value += 8;
      if (item.ativo !== false) value += 5;
      return value;
    };
    return score(b) - score(a) || Number(a.id || 0) - Number(b.id || 0);
  })[0] || chooseCanonicalPrimary(customers);
}

function canonicalMergePreview(customers = [], primaryId = null, type = 'same_name') {
  const primary = customers.find(item => String(item.id) === String(primaryId)) || chooseCanonicalPrimary(customers);
  const duplicateIds = customers.filter(item => String(item.id) !== String(primary?.id)).map(item => item.id);
  const knownAddresses = primary && buildCustomerAddressFingerprint(primary) ? [primary] : [];
  const addresses = [];
  customers
    .filter(item => String(item.id) !== String(primary?.id))
    .filter(item => {
      if (!buildCustomerAddressFingerprint(item)) return false;
      const exists = knownAddresses.some(address => areEquivalentCustomerAddresses(address, item));
      if (!exists) knownAddresses.push(item);
      return !exists;
    })
    .forEach(item => addresses.push({
      source_customer_id: item.id,
      label: item.nome || 'Unidade',
      endereco: item.endereco_completo || item.endereco || buildCustomerAddress(item)
    }));
  const aliases = customers
    .filter(item => item.nome && normalizeCustomerAlias(item.nome) !== normalizeCustomerAlias(primary?.nome))
    .map(item => item.nome);
  return {
    type,
    requires_manual: type !== 'same_name',
    suggested_primary_id: primary?.id || null,
    duplicate_ids: duplicateIds,
    addresses_to_create: addresses,
    aliases_to_create: [...new Set(aliases)],
    group: customers
  };
}

const CUSTOMER_DEDUP_LINK_RELATIONS = [
  { table: 'services', column: 'cliente_id', key: 'services_cliente_id', label: 'servicos por ID' },
  { table: 'services', column: 'customer_id', key: 'services_customer_id', label: 'servicos por customer_id' },
  { table: 'contracts', column: 'customer_id', key: 'contracts', label: 'contratos' },
  { table: 'customer_service_history', column: 'customer_id', key: 'customer_service_history', label: 'historico operacional' },
  { table: 'data_reviews', column: 'customer_id', key: 'data_reviews', label: 'revisoes de dados' },
  { table: 'customer_reminders', column: 'customer_id', key: 'customer_reminders', label: 'lembretes' }
];

async function fetchCustomersForDeduplication(db, options = {}) {
  const pageSize = Math.min(Math.max(Number(options.pageSize || options.limit || 1000), 100), 2000);
  const maxPages = Math.min(Math.max(Number(options.maxPages || 200), 1), 500);
  const search = String(options.search || '').trim();
  const rows = [];

  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    let query = db
      .from('customers')
      .select('*')
      .eq('ativo', true)
      .order('nome', { ascending: true });

    if (search) {
      const safe = search.replace(/[%_,]/g, '').slice(0, 120);
      query = query.or(`nome.ilike.%${safe}%,endereco.ilike.%${safe}%,endereco_completo.ilike.%${safe}%,telefone.ilike.%${safe}%,whatsapp.ilike.%${safe}%`);
    }

    if (typeof query.range === 'function') query = query.range(from, to);
    else query = query.limit(pageSize);

    const { data, error } = await query;
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize || typeof query.range !== 'function') break;
  }

  return rows;
}

function normalizedCustomerTokens(name) {
  return normalizeCustomerName(name).split(/\s+/).filter(token => token.length >= 3);
}

function haveSimilarCustomerNames(leftName, rightName) {
  if (hasRelatedCustomerNames(leftName, rightName)) return true;
  const left = normalizedCustomerTokens(leftName);
  const right = normalizedCustomerTokens(rightName);
  if (!left.length || !right.length) return false;
  if (left[0] && right[0] && left[0] === right[0]) return true;
  const shared = left.filter(token => right.includes(token));
  const dice = (shared.length * 2) / (left.length + right.length);
  return shared.length >= 2 && dice >= 0.6;
}

function customerBairroKey(customer = {}) {
  return normalizeLooseText(customer.bairro || '');
}

function haveSameCep(left = {}, right = {}) {
  const leftCep = String(left.cep || '').replace(/\D/g, '');
  const rightCep = String(right.cep || '').replace(/\D/g, '');
  return !!(leftCep && rightCep && leftCep === rightCep);
}

function haveSameBairro(left = {}, right = {}) {
  const leftBairro = customerBairroKey(left);
  const rightBairro = customerBairroKey(right);
  return !!(leftBairro && rightBairro && leftBairro === rightBairro);
}

function haveMatchingContactOrDocument(left = {}, right = {}) {
  const leftPhone = normalizePhone(left.telefone);
  const rightPhone = normalizePhone(right.telefone);
  const leftWhatsapp = normalizePhone(left.whatsapp);
  const rightWhatsapp = normalizePhone(right.whatsapp);
  const leftDocument = normalizeDocument(left.cpf_cnpj);
  const rightDocument = normalizeDocument(right.cpf_cnpj);
  return !!(
    (leftPhone && rightPhone && leftPhone === rightPhone) ||
    (leftWhatsapp && rightWhatsapp && leftWhatsapp === rightWhatsapp) ||
    (leftPhone && rightWhatsapp && leftPhone === rightWhatsapp) ||
    (leftWhatsapp && rightPhone && leftWhatsapp === rightPhone) ||
    (leftDocument && rightDocument && leftDocument === rightDocument)
  );
}

function haveConflictingDocument(left = {}, right = {}) {
  const leftDocument = normalizeDocument(left.cpf_cnpj);
  const rightDocument = normalizeDocument(right.cpf_cnpj);
  return !!(leftDocument && rightDocument && leftDocument !== rightDocument);
}

function haveClearlyConflictingAddresses(left = {}, right = {}) {
  const leftFp = buildCustomerAddressFingerprint(left);
  const rightFp = buildCustomerAddressFingerprint(right);
  if (!leftFp || !rightFp) return false;
  if (areEquivalentCustomerAddresses(left, right)) return false;
  if (haveSameCep(left, right) || haveSameBairro(left, right)) return false;
  const sharedCore = addressCoreTokens(leftFp).filter(token => addressCoreTokens(rightFp).includes(token));
  return sharedCore.length === 0;
}

function classifyDeduplicationPair(left = {}, right = {}) {
  if (haveConflictingDocument(left, right)) return null;
  const leftName = left.nome_normalizado || normalizeCustomerName(left.nome);
  const rightName = right.nome_normalizado || normalizeCustomerName(right.nome);
  if (!leftName || !rightName) return null;

  const exactName = leftName === rightName;
  const similarName = !exactName && haveSimilarCustomerNames(left.nome, right.nome);
  if (!exactName && !similarName) return null;

  const contactMatch = haveMatchingContactOrDocument(left, right);
  const addressMatch = areEquivalentCustomerAddresses(left, right);
  const cepMatch = haveSameCep(left, right);
  const bairroMatch = haveSameBairro(left, right);
  const addressConflict = haveClearlyConflictingAddresses(left, right);
  if (addressConflict && !contactMatch) return null;

  const reasons = [];
  if (exactName) reasons.push('nome igual');
  else reasons.push('nome parecido');
  if (contactMatch) reasons.push('contato/documento compativel');
  if (addressMatch) reasons.push('endereco compativel');
  else if (cepMatch) reasons.push('CEP compativel');
  else if (bairroMatch) reasons.push('bairro compativel');

  if (exactName && (contactMatch || addressMatch || cepMatch || bairroMatch)) {
    return { confidence: 'alta', type: 'same_name', reasons };
  }
  if (similarName && (contactMatch || addressMatch || cepMatch)) {
    return { confidence: contactMatch ? 'alta' : 'revisar', type: 'similar_name_address', reasons };
  }
  if (exactName && !addressConflict) {
    return { confidence: 'revisar', type: 'same_name_needs_review', reasons: [...reasons, 'dados insuficientes para alta confianca'] };
  }
  return null;
}

function buildDeduplicationCandidateGroups(customers = []) {
  const parent = customers.map((_, index) => index);
  const metaByRoot = new Map();
  const buckets = new Map();
  const pairKeys = new Set();
  const addBucket = (key, index) => {
    if (!key) return;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(index);
  };
  customers.forEach((customer, index) => {
    const name = customer.nome_normalizado || normalizeCustomerName(customer.nome);
    const firstNameToken = normalizedCustomerTokens(customer.nome)[0] || '';
    const phone = normalizePhone(customer.telefone);
    const whatsapp = normalizePhone(customer.whatsapp);
    const document = normalizeDocument(customer.cpf_cnpj);
    const cep = String(customer.cep || '').replace(/\D/g, '');
    const address = buildCustomerAddressFingerprint(customer);
    const bairro = customerBairroKey(customer);
    addBucket(name ? `name:${name}` : '', index);
    addBucket(phone ? `phone:${phone}` : '', index);
    addBucket(whatsapp ? `phone:${whatsapp}` : '', index);
    addBucket(document ? `doc:${document}` : '', index);
    addBucket(cep ? `cep:${cep}` : '', index);
    addBucket(address ? `addr:${address}` : '', index);
    addBucket(bairro && firstNameToken ? `bairro-name:${bairro}:${firstNameToken}` : '', index);
  });
  for (const indexes of buckets.values()) {
    for (let a = 0; a < indexes.length; a += 1) {
      for (let b = a + 1; b < indexes.length; b += 1) {
        pairKeys.add(`${indexes[a]}:${indexes[b]}`);
      }
    }
  }
  const find = index => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const merge = (leftIndex, rightIndex, match) => {
    const leftRoot = find(leftIndex);
    const rightRoot = find(rightIndex);
    if (leftRoot === rightRoot) {
      const current = metaByRoot.get(leftRoot) || { confidence: 'alta', types: new Set(), reasons: new Set() };
      if (match.confidence !== 'alta') current.confidence = 'revisar';
      match.reasons.forEach(reason => current.reasons.add(reason));
      current.types.add(match.type);
      metaByRoot.set(leftRoot, current);
      return;
    }
    const target = Math.min(leftRoot, rightRoot);
    const source = Math.max(leftRoot, rightRoot);
    parent[source] = target;
    const current = metaByRoot.get(target) || { confidence: 'alta', types: new Set(), reasons: new Set() };
    const sourceMeta = metaByRoot.get(source);
    if (sourceMeta?.confidence === 'revisar' || match.confidence !== 'alta') current.confidence = 'revisar';
    sourceMeta?.types?.forEach(type => current.types.add(type));
    sourceMeta?.reasons?.forEach(reason => current.reasons.add(reason));
    current.types.add(match.type);
    match.reasons.forEach(reason => current.reasons.add(reason));
    metaByRoot.set(target, current);
  };

  for (const pairKey of pairKeys) {
    const [i, j] = pairKey.split(':').map(Number);
    const match = classifyDeduplicationPair(customers[i], customers[j]);
    if (match) merge(i, j, match);
  }

  const grouped = new Map();
  customers.forEach((customer, index) => {
    const root = find(index);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(customer);
  });

  return [...grouped.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([root, group]) => {
      const meta = metaByRoot.get(find(root)) || { confidence: 'revisar', types: new Set(['same_name_needs_review']), reasons: new Set(['grupo suspeito']) };
      return {
        group,
        confidence: meta.confidence,
        type: meta.types.has('similar_name_address') ? 'similar_name_address' : (meta.types.values().next().value || 'same_name'),
        reasons: [...meta.reasons]
      };
    });
}

async function buildDeduplicationImpact(db, customers = []) {
  const byCustomer = {};
  for (const customer of customers) {
    const links = {};
    for (const relation of CUSTOMER_DEDUP_LINK_RELATIONS) {
      const counted = await safeCountRelation(db, relation, customer.id);
      links[relation.key] = counted.count || 0;
    }
    byCustomer[String(customer.id)] = {
      id: customer.id,
      links,
      total: dedupCustomerLinkTotal(links)
    };
  }
  const linksToMove = Object.values(byCustomer).reduce((total, item) => total + (Number(item.total) || 0), 0);
  return {
    customers_affected: customers.length,
    links_to_move: linksToMove,
    by_customer: byCustomer
  };
}

async function buildCustomerDeduplicationAudit(db, options = {}) {
  const customers = await fetchCustomersForDeduplication(db, options);
  const rawGroups = buildDeduplicationCandidateGroups(customers);
  const groups = [];

  for (const raw of rawGroups) {
    const impact = await buildDeduplicationImpact(db, raw.group);
    const primary = chooseDeduplicationPrimary(raw.group, impact);
    const preview = canonicalMergePreview(raw.group, primary?.id || null, raw.type);
    const ids = raw.group.map(customer => customer.id).sort((a, b) => Number(a) - Number(b));
    groups.push({
      id: `dedup-${ids.join('-')}`,
      confidence: raw.confidence,
      match_type: raw.type,
      reasons: raw.reasons,
      requires_manual: raw.confidence !== 'alta',
      impact,
      customer: raw.group[0],
      ...preview,
      suggested_primary_id: primary?.id || preview.suggested_primary_id
    });
  }

  groups.sort((a, b) => {
    const conf = confidence => confidence === 'alta' ? 0 : 1;
    return conf(a.confidence) - conf(b.confidence)
      || (b.impact?.links_to_move || 0) - (a.impact?.links_to_move || 0)
      || String(a.group?.[0]?.nome || '').localeCompare(String(b.group?.[0]?.nome || ''));
  });

  return {
    ok: true,
    total_customers: customers.length,
    total_groups: groups.length,
    high_confidence: groups.filter(group => group.confidence === 'alta').length,
    review: groups.filter(group => group.confidence !== 'alta').length,
    customers_affected: groups.reduce((total, group) => total + (group.group?.length || 0), 0),
    links_to_move: groups.reduce((total, group) => total + (group.impact?.links_to_move || 0), 0),
    groups,
    search: options.search || null
  };
}

async function mergeCustomersCanonical(db, primaryId, duplicateIds = [], options = {}) {
  if (!primaryId || !Array.isArray(duplicateIds) || duplicateIds.length === 0) {
    const error = new Error('IDs primário e duplicatas são obrigatórios');
    error.statusCode = 400;
    throw error;
  }

  const allIds = [primaryId, ...duplicateIds];
  const { data: customers, error: fetchError } = await db
    .from('customers')
    .select('*')
    .in('id', allIds);

  if (fetchError) throw fetchError;
  if ((customers || []).length !== allIds.length) {
    const error = new Error('Um ou mais clientes não encontrados');
    error.statusCode = 404;
    throw error;
  }

  const primary = customers.find(c => String(c.id) === String(primaryId));
  if (!primary) {
    const error = new Error('Cliente primário não encontrado');
    error.statusCode = 404;
    throw error;
  }

  const duplicates = customers.filter(c => String(c.id) !== String(primaryId));
  const merged = { ...primary };
  const createdAddresses = [];
  const createdAliases = [];

  await ensureCustomerAddress(db, primaryId, primary, { origem: 'merge', is_primary: true, label: 'Principal' });
  await ensureCustomerAlias(db, primaryId, primary.nome, 'merge');

  for (const dup of duplicates) {
    if (!merged.endereco && dup.endereco) merged.endereco = dup.endereco;
    if (!merged.endereco_completo && dup.endereco_completo) merged.endereco_completo = dup.endereco_completo;
    if (!merged.latitude && dup.latitude) merged.latitude = dup.latitude;
    if (!merged.longitude && dup.longitude) merged.longitude = dup.longitude;
    if (!merged.cpf_cnpj && dup.cpf_cnpj) merged.cpf_cnpj = dup.cpf_cnpj;
    if (!merged.whatsapp && dup.whatsapp) merged.whatsapp = dup.whatsapp;
    if (!merged.email && dup.email) merged.email = dup.email;
    if (!merged.uf && dup.uf) merged.uf = dup.uf;
    if (!merged.observacoes && dup.observacoes) merged.observacoes = dup.observacoes;

    if (dup.observacoes && dup.observacoes !== merged.observacoes) {
      merged.observacoes = (merged.observacoes || '') + '\n[Merged from duplicate: ' + dup.observacoes + ']';
    }

    const address = await ensureCustomerAddress(db, primaryId, dup, { origem: 'merge', label: dup.nome || 'Unidade' });
    if (address?.id) createdAddresses.push(address);
    const aliasDeactivation = await db
      .from('customer_aliases')
      .update({ ativo: false })
      .eq('customer_id', dup.id);
    if (aliasDeactivation.error && !isMissingRelationError(aliasDeactivation.error)) throw aliasDeactivation.error;
    const alias = await ensureCustomerAlias(db, primaryId, dup.nome, 'merge');
    if (alias) createdAliases.push(alias);

    await updateServicesCustomerLink(db, dup.id, primaryId, address?.id || null);
  }

  const duplicateNote = `\n[Duplicatas mescladas nesta ficha: ${duplicateIds.join(', ')}]`;
  const primaryUpdatePayload = {
    endereco: merged.endereco,
    endereco_completo: merged.endereco_completo,
    latitude: merged.latitude,
    longitude: merged.longitude,
    cpf_cnpj: merged.cpf_cnpj,
    whatsapp: merged.whatsapp,
    email: merged.email,
    uf: merged.uf,
    observacoes: `${merged.observacoes || ''}${duplicateNote}`,
    updated_at: new Date().toISOString()
  };
  const { error: updateError } = await runCustomerWriteWithSchemaFallback(
    workingPayload => db.from('customers').update(workingPayload).eq('id', primaryId),
    primaryUpdatePayload,
    'canonical merge primary customer'
  );

  if (updateError) throw updateError;

  const relatedUpdates = [
    ['contracts', 'customer_id'],
    ['customer_service_history', 'customer_id'],
    ['data_reviews', 'customer_id'],
    ['customer_reminders', 'customer_id']
  ];

  for (const [table, column] of relatedUpdates) {
    const { error: relatedError } = await db
      .from(table)
      .update({ [column]: primaryId })
      .in(column, duplicateIds);
    if (relatedError) {
      const missing = getMissingSchemaColumn(relatedError);
      if (missing || isMissingRelationError(relatedError)) {
        console.warn(`[POST /api/customers/merge] Ignorando tabela/coluna ausente: ${table}.${column}`);
      } else {
        throw relatedError;
      }
    }
  }

  const duplicateUpdatePayload = {
    ativo: false,
    status_operacional: 'Inativo',
    observacoes: (merged.observacoes || '') + '\n[Merged into customer ID: ' + primaryId + ']',
    updated_at: new Date().toISOString()
  };
  const { error: deleteError } = await runCustomerWriteWithSchemaFallback(
    workingPayload => db.from('customers').update(workingPayload).in('id', duplicateIds),
    duplicateUpdatePayload,
    'canonical merge duplicate customers'
  );

  if (deleteError) throw deleteError;

  return {
    message: `Clientes mesclados com sucesso. ${duplicateIds.length} duplicata(s) removida(s).`,
    primaryCustomer: merged,
    addresses_created: createdAddresses.length,
    aliases_created: createdAliases.length
  };
}

// DUPLICATES MANAGEMENT
app.get('/api/customers/duplicates', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const audit = await buildCustomerDeduplicationAudit(db, {
      search: req.query.search,
      pageSize: req.query.page_size || req.query.limit || 1000
    });
    res.json(audit.groups);
  } catch (error) {
    console.error('[GET /api/customers/duplicates] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar duplicatas' });
  }
});

app.get('/api/customers/deduplication-audit', async (req, res) => {
  try {
    const actor = await requireAdminOrOperator(req, res);
    if (!actor) return;
    const db = getSupabaseClient();
    const audit = await buildCustomerDeduplicationAudit(db, {
      search: req.query.search,
      pageSize: req.query.page_size || req.query.limit || 1000
    });
    res.json(audit);
  } catch (error) {
    console.error('[GET /api/customers/deduplication-audit] Error:', error.message);
    res.status(500).json({ error: 'Falha ao auditar duplicidade de clientes' });
  }
});

app.post('/api/customers/deduplication-merge', strictLimiter, async (req, res) => {
  try {
    const actor = await requireAdminOrOperator(req, res);
    if (!actor) return;
    const db = getSupabaseClient();
    const inputGroups = Array.isArray(req.body?.groups)
      ? req.body.groups
      : [{ primaryId: req.body?.primaryId, duplicateIds: req.body?.duplicateIds }];

    const groups = inputGroups
      .map(group => ({
        primaryId: group?.primaryId,
        duplicateIds: Array.isArray(group?.duplicateIds) ? [...new Set(group.duplicateIds.map(id => /^\d+$/.test(String(id)) ? Number(id) : id))] : []
      }))
      .filter(group => group.primaryId && group.duplicateIds.length);

    if (!groups.length) {
      return res.status(400).json({ error: 'Nenhum grupo aprovado para mesclar', code: 'deduplication_groups_required' });
    }

    const seenDuplicateIds = new Set();
    const results = [];
    for (const group of groups) {
      const duplicateIds = group.duplicateIds.filter(id => {
        const key = String(id);
        if (seenDuplicateIds.has(key) || String(id) === String(group.primaryId)) return false;
        seenDuplicateIds.add(key);
        return true;
      });
      if (!duplicateIds.length) continue;
      const result = await mergeCustomersCanonical(db, group.primaryId, duplicateIds, { actor, source: 'deduplication' });
      results.push({ primaryId: group.primaryId, duplicateIds, ...result });
    }

    res.json({
      ok: true,
      message: `${results.length} grupo(s) mesclado(s) com seguranca.`,
      merged_groups: results.length,
      duplicate_customers_merged: results.reduce((total, item) => total + (item.duplicateIds?.length || 0), 0),
      results
    });
  } catch (error) {
    console.error('[POST /api/customers/deduplication-merge] Error:', error.message);
    res.status(error.statusCode || 500).json({
      code: error.code || 'customers_deduplication_merge_failed',
      error: error.statusCode ? error.message : 'Falha ao mesclar duplicatas de clientes',
      details: publicDbErrorDetails(error)
    });
  }
});

app.post('/api/customers/merge', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { primaryId, duplicateIds } = req.body;
    const result = await mergeCustomersCanonical(db, primaryId, duplicateIds);
    return res.json(result);
  } catch (error) {
    console.error('[POST /api/customers/merge] Error:', error.message);
    res.status(error.statusCode || 500).json({
      code: error.code || 'customers_merge_failed',
      error: error.statusCode ? error.message : 'Falha ao mesclar clientes',
      details: publicDbErrorDetails(error)
    });
  }
});

app.get('/api/customers/canonical-audit', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const search = String(req.query.search || '').trim();
    let query = db
      .from('customers')
      .select('*')
      .order('nome', { ascending: true });

    if (search) {
      const safe = search.replace(/[%_,]/g, '');
      query = query.or(`nome.ilike.%${safe}%,endereco.ilike.%${safe}%,endereco_completo.ilike.%${safe}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const active = (data || []).filter(customer => customer.ativo !== false);
    const byName = new Map();
    for (const customer of active) {
      const key = normalizeCustomerName(customer.nome);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(customer);
    }

    const groups = [];
    for (const group of byName.values()) {
      if (group.length > 1) groups.push(canonicalMergePreview(group, null, 'same_name'));
    }

    res.json({ total: groups.length, groups, search: search || null });
  } catch (error) {
    console.error('[GET /api/customers/canonical-audit] Error:', error.message);
    res.status(500).json({ error: 'Falha ao auditar clientes canonicos' });
  }
});

app.post('/api/customers/canonical-merge', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { primaryId, duplicateIds } = req.body;
    const result = await mergeCustomersCanonical(db, primaryId, duplicateIds);
    res.json(result);
  } catch (error) {
    console.error('[POST /api/customers/canonical-merge] Error:', error.message);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Falha ao mesclar clientes canonicos' });
  }
});

app.get('/api/customers/:id/addresses', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const customerId = Number(req.params.id);
    if (!customerId) return res.status(400).json({ error: 'Cliente invalido' });
    const addresses = await getClientDomainService().listClientLocations(db, customerId, { includeInactive: req.query.include_inactive === 'true' });
    res.json(addresses);
  } catch (error) {
    console.error('[GET /api/customers/:id/addresses] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar unidades do cliente' });
  }
});

function compactCustomerContact(row = {}) {
  return {
    id: row.id,
    customer_id: row.customer_id,
    nome: row.nome || '',
    funcao: row.funcao || '',
    telefone: row.telefone || '',
    whatsapp: row.whatsapp || '',
    email: row.email || '',
    recebe_lembrete: row.recebe_lembrete === true,
    recebe_cobranca: row.recebe_cobranca === true,
    recebe_relatorio: row.recebe_relatorio === true,
    is_primary: row.is_primary === true,
    ativo: row.ativo !== false,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function normalizeCustomerContactPayload(customerId, item = {}, forcePrimary = false) {
  return {
    customer_id: customerId,
    nome: String(item.nome || item.name || '').trim(),
    funcao: String(item.funcao || item.role || '').trim() || null,
    telefone: normalizePhone(item.telefone || item.phone || ''),
    whatsapp: normalizePhone(item.whatsapp || ''),
    email: normalizeEmail(item.email || ''),
    recebe_lembrete: item.recebe_lembrete === true || String(item.recebe_lembrete) === 'true',
    recebe_cobranca: item.recebe_cobranca === true || String(item.recebe_cobranca) === 'true',
    recebe_relatorio: item.recebe_relatorio === true || String(item.recebe_relatorio) === 'true',
    is_primary: forcePrimary || item.is_primary === true || String(item.is_primary) === 'true' || item.contato_principal === true,
    ativo: item.ativo !== false,
    updated_at: new Date().toISOString()
  };
}

app.get('/api/customers/:id/contacts', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const customerId = Number(req.params.id);
    if (!customerId) return res.status(400).json({ error: 'Cliente invalido', code: 'customer_invalid' });
    const { data, error } = await db
      .from('customer_contacts')
      .select('*')
      .eq('customer_id', customerId)
      .eq('ativo', true)
      .order('is_primary', { ascending: false });
    if (error) {
      if (isMissingRelationError(error)) return res.json([]);
      throw error;
    }
    res.json((data || []).map(compactCustomerContact));
  } catch (error) {
    console.error('[GET /api/customers/:id/contacts] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar contatos do cliente', details: publicDbErrorDetails(error) });
  }
});

app.put('/api/customers/:id/contacts', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const customerId = Number(req.params.id);
    if (!customerId) return res.status(400).json({ error: 'Cliente invalido', code: 'customer_invalid' });
    const items = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
    const cleaned = items
      .map((item, index) => normalizeCustomerContactPayload(customerId, item, index === 0 && !items.some(candidate => candidate?.is_primary === true || candidate?.contato_principal === true)))
      .filter(item => item.nome || item.telefone || item.whatsapp || item.email);

    const deactivated = await runCustomerContactWriteWithSchemaFallback(
      payload => db.from('customer_contacts').update(payload).eq('customer_id', customerId),
      { ativo: false, updated_at: new Date().toISOString() },
      'PUT /api/customers/:id/contacts deactivate'
    );
    if (deactivated.error) {
      if (isMissingRelationError(deactivated.error)) {
        return res.status(503).json({ error: 'Tabela customer_contacts ainda nao existe. Rode a migration da Central do Cliente.', migration_required: true });
      }
      throw deactivated.error;
    }

    const saved = [];
    for (const item of cleaned) {
      const { data, error } = await runCustomerContactWriteWithSchemaFallback(
        payload => db.from('customer_contacts').insert([{ ...payload, created_at: new Date().toISOString() }]).select(),
        item,
        'PUT /api/customers/:id/contacts insert'
      );
      if (error) throw error;
      saved.push(...(data || []));
    }
    res.json(saved.map(compactCustomerContact));
  } catch (error) {
    console.error('[PUT /api/customers/:id/contacts] Error:', error.message);
    res.status(500).json({ error: 'Falha ao salvar contatos do cliente', details: publicDbErrorDetails(error) });
  }
});

app.put('/api/customers/:id/addresses', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const customerId = Number(req.params.id);
    if (!customerId) return res.status(400).json({ error: 'Cliente invalido' });
    const addresses = Array.isArray(req.body?.addresses) ? req.body.addresses : [];
    const result = await getClientDomainService().updateClientLocation(db, customerId, addresses);
    if (result.error) return res.status(result.status || 500).json(result.error);
    res.json(result.data || []);
  } catch (error) {
    console.error('[PUT /api/customers/:id/addresses] Error:', error.message);
    res.status(500).json({
      code: 'customer_addresses_save_failed',
      error: 'Falha ao salvar unidades do cliente',
      details: publicDbErrorDetails(error)
    });
  }
});

function parseLocationBody(body = {}) {
  const latitude = cleanNumber(body.latitude ?? body.lat);
  const longitude = cleanNumber(body.longitude ?? body.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, error: 'Latitude e longitude validas sao obrigatorias', code: 'location_required' };
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { ok: false, error: 'Coordenada fora do intervalo valido', code: 'location_out_of_range' };
  }
  return { ok: true, latitude, longitude };
}

app.patch('/api/customers/:id/location', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const customerId = Number(req.params.id);
    if (!customerId) return res.status(400).json({ error: 'Cliente invalido', code: 'customer_invalid' });
    const location = parseLocationBody(req.body || {});
    if (!location.ok) return res.status(400).json(location);

    const { data, error } = await runCustomerWriteWithSchemaFallback(
      payload => db.from('customers').update(payload).eq('id', customerId).select(),
      {
        latitude: location.latitude,
        longitude: location.longitude,
        updated_at: new Date().toISOString()
      },
      'PATCH /api/customers/:id/location'
    );
    if (error) throw error;
    if (!(data || []).length) return res.status(404).json({ error: 'Cliente nao encontrado', code: 'customer_not_found' });
    res.json(data[0]);
  } catch (error) {
    console.error('[PATCH /api/customers/:id/location] Error:', error.message);
    res.status(500).json({ error: 'Falha ao salvar coordenada do cliente', details: publicDbErrorDetails(error) });
  }
});

app.patch('/api/customers/:id/addresses/:addressId/location', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const customerId = Number(req.params.id);
    const addressId = String(req.params.addressId || '').trim();
    if (!customerId || !addressId) return res.status(400).json({ error: 'Cliente ou unidade invalida', code: 'customer_address_invalid' });
    const location = parseLocationBody(req.body || {});
    if (!location.ok) return res.status(400).json(location);

    const { data, error } = await runCustomerAddressWriteWithSchemaFallback(
      payload => db.from('customer_addresses').update(payload).eq('customer_id', customerId).eq('id', addressId).select(),
      {
        latitude: location.latitude,
        longitude: location.longitude,
        updated_at: new Date().toISOString()
      },
      'PATCH /api/customers/:id/addresses/:addressId/location'
    );
    if (error) throw error;
    if (!(data || []).length) return res.status(404).json({ error: 'Unidade nao encontrada', code: 'customer_address_not_found' });
    res.json(compactCustomerAddress(data[0]));
  } catch (error) {
    console.error('[PATCH /api/customers/:id/addresses/:addressId/location] Error:', error.message);
    res.status(500).json({ error: 'Falha ao salvar coordenada da unidade', details: publicDbErrorDetails(error) });
  }
});

app.get('/api/contracts', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { customer_id, status_contrato } = req.query;
    let query = db
      .from('contracts')
      .select('*')
      .order('data_vencimento', { ascending: true, nullsFirst: false });

    if (customer_id) query = query.eq('customer_id', Number(customer_id));
    if (status_contrato) query = query.eq('status_contrato', String(status_contrato));

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('[GET /api/contracts] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar contratos' });
  }
});

app.put('/api/customers/:id/contracts', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const customerId = Number(req.params.id);
    const items = Array.isArray(req.body?.contracts) ? req.body.contracts : [];
    if (!customerId) return res.status(400).json({ error: 'Cliente inválido' });

    const cleaned = items
      .map(item => ({
        customer_id: customerId,
        tipo_servico: String(item.tipo_servico || '').trim(),
        local_atendido: String(item.local_atendido || item.local || '').trim() || null,
        customer_address_id: item.customer_address_id || null,
        periodicidade: String(item.periodicidade || '').trim() || null,
        status_contrato: String(item.status_contrato || 'Ativo').trim(),
        data_ultimo_atendimento: item.data_ultimo_atendimento || item.data_ultimo_servico || null,
        data_proximo_atendimento: item.data_proximo_atendimento || item.proxima_execucao_sugerida || null,
        valor: item.valor === '' || item.valor === undefined || item.valor === null ? null : Number(item.valor),
        numero_contrato: String(item.numero_contrato || item.numero_proposta || '').trim() || null,
        numero_proposta: String(item.numero_proposta || '').trim() || null,
        data_inicio: item.data_inicio || item.vigencia_inicial || null,
        data_vencimento: item.data_vencimento || item.vigencia_final || null,
        vigencia_inicial: item.vigencia_inicial || item.data_inicio || null,
        vigencia_final: item.vigencia_final || item.data_vencimento || null,
        tecnico_preferencial: String(item.tecnico_preferencial || '').trim() || null,
        tempo_estimado: String(item.tempo_estimado || '').trim() || null,
        observacao_servico: String(item.observacao_servico || '').trim() || null,
        proxima_execucao_sugerida: item.proxima_execucao_sugerida || item.data_proximo_atendimento || null,
        observacoes: String(item.observacoes || '').trim() || null,
        updated_at: new Date().toISOString()
      }))
      .filter(item => item.tipo_servico);

    const { error: deleteError } = await db.from('contracts').delete().eq('customer_id', customerId);
    if (deleteError) throw deleteError;

    if (!cleaned.length) return res.json([]);

    const saved = [];
    for (const item of cleaned) {
      const { data, error } = await runContractWriteWithSchemaFallback(
        payload => db.from('contracts').insert([{ ...payload, created_at: new Date().toISOString() }]).select(),
        item,
        'PUT /api/customers/:id/contracts insert'
      );
      if (error) throw error;
      saved.push(...(data || []));
    }
    res.json(saved);
  } catch (error) {
    console.error('[PUT /api/customers/:id/contracts] Error:', error.message);
    res.status(500).json({ error: 'Falha ao salvar serviços contratados' });
  }
});

app.get('/api/customer-service-history', async (req, res) => {
  try {
    const { customer_id } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    let query = supabase
      .from('customer_service_history')
      .select('*')
      .order('data_atendimento', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (customer_id) query = query.eq('customer_id', Number(customer_id));

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('[GET /api/customer-service-history] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar historico importado' });
  }
});

app.get('/api/evolution/status', async (req, res) => {
  const config = getEvolutionConfig();
  if (!config.configured) {
    return res.status(503).json({
      configured: false,
      connected: false,
      instance: config.instance || null,
      error: 'Evolution API nao configurada'
    });
  }

  try {
    const payload = await evolutionFetch(`/instance/connectionState/${encodeURIComponent(config.instance)}`);
    let state = extractEvolutionState(payload);
    let connected = isEvolutionConnectedState(state);
    let matchedInstance = null;
    let availableInstances = [];

    if (!connected) {
      const instanceList = await fetchEvolutionInstanceListSafe();
      availableInstances = (instanceList.instances || []).map(item => ({
        name: evolutionInstanceName(item),
        state: extractEvolutionState(item),
        connected: isEvolutionConnectedState(extractEvolutionState(item))
      })).filter(item => item.name || item.state);
      matchedInstance = availableInstances.find(item => normalizeEvolutionInstanceName(item.name) === normalizeEvolutionInstanceName(config.instance)) || null;
      if (matchedInstance) {
        state = matchedInstance.state || state;
        connected = matchedInstance.connected;
      }
    }

    res.json({
      configured: true,
      connected,
      instance: config.instance,
      matched_instance: matchedInstance,
      available_instances: availableInstances,
      state,
      details: payload
    });
  } catch (error) {
    const instanceList = await fetchEvolutionInstanceListSafe();
    const availableInstances = (instanceList.instances || []).map(item => ({
      name: evolutionInstanceName(item),
      state: extractEvolutionState(item),
      connected: isEvolutionConnectedState(extractEvolutionState(item))
    })).filter(item => item.name || item.state);
    const matchedInstance = availableInstances.find(item => normalizeEvolutionInstanceName(item.name) === normalizeEvolutionInstanceName(config.instance)) || null;
    const connected = !!matchedInstance?.connected;
    res.status(connected ? 200 : (error.status === 404 ? 404 : 502)).json({
      configured: true,
      connected,
      instance: config.instance,
      matched_instance: matchedInstance,
      available_instances: availableInstances,
      state: matchedInstance?.state || '',
      error: error.message,
      details: error.payload || null
    });
  }
});

app.post('/api/customer-reminders/:id/send', strictLimiter, async (req, res) => {
  const db = getSupabaseClient();
  const { id } = req.params;
  const now = new Date().toISOString();

  try {
    const reminderQuery = db
      .from('customer_reminders')
      .select('*')
      .eq('id', id);
    const { data: rawData, error } = typeof reminderQuery.maybeSingle === 'function'
      ? await reminderQuery.maybeSingle()
      : await reminderQuery;
    const data = Array.isArray(rawData) ? rawData[0] : rawData;

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Lembrete nao encontrado' });

    const number = normalizeBrazilWhatsAppNumber(req.body?.destino || data.destino);
    if (!number) {
      return res.status(400).json({ error: 'Lembrete sem WhatsApp valido' });
    }

    const text = String(req.body?.mensagem || data.mensagem || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Lembrete sem mensagem' });
    }

    await markCustomerReminderSendAttempt(db, id, {
      canal: 'evolution_api',
      status: 'enviando',
      destino: number,
      mensagem: text,
      provider: 'evolution_api',
      erro: null,
      updated_at: now,
      tentativas: Number(data.tentativas || 0) + 1
    });

    try {
      const result = await sendEvolutionText({ number, text });
      const saved = await markCustomerReminderSendAttempt(db, id, {
        canal: 'evolution_api',
        status: 'enviado',
        destino: result.number,
        mensagem: text,
        provider: result.provider,
        provider_message_id: result.providerMessageId,
        provider_status: result.providerStatus,
        provider_response: result.providerResponse,
        enviado_em: new Date().toISOString(),
        erro: null,
        updated_at: new Date().toISOString()
      });
      return res.json(saved || {
        ...data,
        status: 'enviado',
        canal: 'evolution_api',
        destino: result.number,
        provider: result.provider,
        provider_message_id: result.providerMessageId,
        provider_status: result.providerStatus,
        provider_response: result.providerResponse
      });
    } catch (sendError) {
      const saved = await markCustomerReminderSendAttempt(db, id, {
        canal: 'evolution_api',
        status: 'erro',
        destino: number,
        mensagem: text,
        provider: 'evolution_api',
        provider_status: 'error',
        provider_response: sendError.payload || { message: sendError.message },
        erro: sendError.message,
        updated_at: new Date().toISOString()
      });
      return res.status(sendError.status || 502).json(saved || {
        ...data,
        status: 'erro',
        canal: 'evolution_api',
        destino: number,
        provider: 'evolution_api',
        provider_status: 'error',
        erro: sendError.message
      });
    }
  } catch (error) {
    console.error('[POST /api/customer-reminders/:id/send] Error:', error.message);
    res.status(500).json({ error: 'Falha ao enviar lembrete', detail: error.message });
  }
});

app.post('/api/logistica/whatsapp/enviar-agenda-tecnico', strictLimiter, async (req, res) => {
  const db = getSupabaseClient();
  try {
    const tecnicoId = String(req.body?.tecnico_id || '').trim();
    const date = String(req.body?.data || '').trim();
    if (!tecnicoId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'tecnico_id e data YYYY-MM-DD sao obrigatorios' });
    }

    const technician = await fetchTechnicianById(db, tecnicoId);
    if (!technician) return res.status(404).json({ error: 'Tecnico nao encontrado' });
    const phone = technicianPhone(technician);
    if (!phone) return res.status(400).json({ error: 'Tecnico sem WhatsApp valido' });

    const services = (await fetchServicesByDate(db, date))
      .filter(service => serviceTechnicianIds(service).includes(tecnicoId));
    const message = buildTechnicianAgendaMessage(technician, date, services);
    const result = await sendAndRecordLogisticsMessage(db, {
      agendamento_id: null,
      tecnico_id: tecnicoId,
      cliente_id: null,
      destinatario_tipo: 'tecnico',
      destinatario_nome: technician.nome || '',
      telefone: phone,
      tipo: 'agenda_tecnico',
      mensagem: message
    }, { force: req.body?.force === true });

    res.status(result.error ? 502 : 200).json({ ...result, total_agendamentos: services.length });
  } catch (error) {
    console.error('[POST /api/logistica/whatsapp/enviar-agenda-tecnico] Error:', error.message);
    res.status(500).json({ error: 'Falha ao enviar agenda do tecnico', detail: error.message });
  }
});

app.post('/api/logistica/whatsapp/enviar-agenda-dia-todos', strictLimiter, async (req, res) => {
  const db = getSupabaseClient();
  try {
    const date = String(req.body?.data || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'data YYYY-MM-DD obrigatoria' });
    }

    const services = await fetchServicesByDate(db, date);
    const technicianIds = [...new Set(services.flatMap(serviceTechnicianIds))];
    const technicians = await fetchTechniciansByIds(db, technicianIds);
    const results = [];

    for (const technician of technicians) {
      const tecnicoId = String(technician.id);
      const phone = technicianPhone(technician);
      const techServices = services.filter(service => serviceTechnicianIds(service).includes(tecnicoId));
      if (!phone) {
        results.push({ tecnico_id: tecnicoId, destinatario_nome: technician.nome, error: 'Tecnico sem WhatsApp valido', total_agendamentos: techServices.length });
        continue;
      }
      const result = await sendAndRecordLogisticsMessage(db, {
        agendamento_id: null,
        tecnico_id: tecnicoId,
        cliente_id: null,
        destinatario_tipo: 'tecnico',
        destinatario_nome: technician.nome || '',
        telefone: phone,
        tipo: 'agenda_tecnico',
        mensagem: buildTechnicianAgendaMessage(technician, date, techServices)
      }, { force: req.body?.force === true });
      results.push({ tecnico_id: tecnicoId, destinatario_nome: technician.nome, total_agendamentos: techServices.length, ...result });
    }

    res.json({ data: date, total_tecnicos: technicians.length, results });
  } catch (error) {
    console.error('[POST /api/logistica/whatsapp/enviar-agenda-dia-todos] Error:', error.message);
    res.status(500).json({ error: 'Falha ao enviar agendas do dia', detail: error.message });
  }
});

async function sendCustomerLogisticsMessageByService(db, serviceId, tipo, buildMessage, force = false) {
  const service = await fetchServiceById(db, serviceId);
  if (!service) {
    const error = new Error('Agendamento nao encontrado');
    error.status = 404;
    throw error;
  }
  if (tipo === 'lembrete_24h' && isServiceCancelledOrDone(service)) {
    const error = new Error('Agendamento cancelado ou concluido nao recebe lembrete');
    error.status = 400;
    throw error;
  }
  const customer = await fetchCustomerForService(db, service);
  const phone = customerPhone(customer) || normalizeBrazilWhatsAppNumber(service.whatsapp || service.telefone || '');
  if (!phone) {
    const error = new Error('Cliente sem WhatsApp valido');
    error.status = 400;
    throw error;
  }
  return sendAndRecordLogisticsMessage(db, {
    agendamento_id: String(service.id),
    tecnico_id: null,
    cliente_id: customer?.id ? String(customer.id) : null,
    destinatario_tipo: 'cliente',
    destinatario_nome: customer?.nome || service.cliente || service.cl || '',
    telefone: phone,
    tipo,
    mensagem: buildMessage(service, customer)
  }, { force });
}

app.post('/api/logistica/whatsapp/enviar-confirmacao-cliente', strictLimiter, async (req, res) => {
  const db = getSupabaseClient();
  try {
    const serviceId = req.body?.agendamento_id;
    if (!serviceId) return res.status(400).json({ error: 'agendamento_id obrigatorio' });
    const result = await sendCustomerLogisticsMessageByService(db, serviceId, 'confirmacao_cliente', buildCustomerConfirmationMessage, req.body?.force === true);
    res.status(result.error ? 502 : 200).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Falha ao enviar confirmacao' });
  }
});

app.post('/api/logistica/whatsapp/enviar-lembrete-cliente', strictLimiter, async (req, res) => {
  const db = getSupabaseClient();
  try {
    const serviceId = req.body?.agendamento_id;
    if (!serviceId) return res.status(400).json({ error: 'agendamento_id obrigatorio' });
    const result = await sendCustomerLogisticsMessageByService(db, serviceId, 'lembrete_24h', buildCustomerReminder24hMessage, req.body?.force === true);
    res.status(result.error ? 502 : 200).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Falha ao enviar lembrete' });
  }
});

app.post('/api/logistica/whatsapp/enviar-lembretes-24h', strictLimiter, async (req, res) => {
  const db = getSupabaseClient();
  try {
    const baseDate = String(req.body?.data || new Date().toISOString().slice(0, 10)).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) return res.status(400).json({ error: 'data YYYY-MM-DD invalida' });
    const tomorrow = new Date(`${baseDate}T12:00:00`);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const targetDate = tomorrow.toISOString().slice(0, 10);
    const services = (await fetchServicesByDate(db, targetDate)).filter(service => !isServiceCancelledOrDone(service));
    const results = [];
    for (const service of services) {
      try {
        const result = await sendCustomerLogisticsMessageByService(db, service.id, 'lembrete_24h', buildCustomerReminder24hMessage, req.body?.force === true);
        results.push({ agendamento_id: String(service.id), ...result });
      } catch (error) {
        results.push({ agendamento_id: String(service.id), error: error.message });
      }
    }
    res.json({ data_base: baseDate, data_alvo: targetDate, total_agendamentos: services.length, results });
  } catch (error) {
    console.error('[POST /api/logistica/whatsapp/enviar-lembretes-24h] Error:', error.message);
    res.status(500).json({ error: 'Falha ao enviar lembretes 24h', detail: error.message });
  }
});

app.get('/api/logistica/whatsapp/mensagens', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 80, 1), 300);
    let query = db
      .from('logistica_whatsapp_mensagens')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (req.query.data) {
      const date = String(req.query.data).slice(0, 10);
      query = query.gte('created_at', `${date}T00:00:00.000Z`).lt('created_at', `${date}T23:59:59.999Z`);
    }
    if (req.query.tipo) query = query.eq('tipo', String(req.query.tipo));
    if (req.query.status) query = query.eq('status', String(req.query.status));
    if (req.query.destinatario_tipo) query = query.eq('destinatario_tipo', String(req.query.destinatario_tipo));

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('[GET /api/logistica/whatsapp/mensagens] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar mensagens logisticas', detail: error.message });
  }
});

app.post('/api/logistica/whatsapp/mensagens/:id/reenviar', strictLimiter, async (req, res) => {
  const db = getSupabaseClient();
  try {
    const current = await maybeSingle(db.from('logistica_whatsapp_mensagens').select('*').eq('id', req.params.id));
    if (!current) return res.status(404).json({ error: 'Mensagem nao encontrada' });
    if (!['erro', 'pendente'].includes(String(current.status))) {
      return res.status(400).json({ error: 'Apenas mensagens pendentes ou com erro podem ser reenviadas' });
    }
    const result = await sendAndRecordLogisticsMessage(db, {
      agendamento_id: current.agendamento_id,
      tecnico_id: current.tecnico_id,
      cliente_id: current.cliente_id,
      destinatario_tipo: current.destinatario_tipo,
      destinatario_nome: current.destinatario_nome,
      telefone: current.telefone,
      grupo_jid: current.grupo_jid,
      tipo: current.tipo,
      mensagem: current.mensagem
    }, { force: true });
    res.status(result.error ? 502 : 200).json(result);
  } catch (error) {
    console.error('[POST /api/logistica/whatsapp/mensagens/:id/reenviar] Error:', error.message);
    res.status(500).json({ error: 'Falha ao reenviar mensagem', detail: error.message });
  }
});

app.get('/api/data-reviews', async (req, res) => {
  try {
    const { tipo_problema, status_revisao, search } = req.query;
    let query = supabase
      .from('data_reviews')
      .select('*')
      .order('created_at', { ascending: false });

    if (tipo_problema) query = query.eq('tipo_problema', String(tipo_problema));
    if (status_revisao) query = query.eq('status_revisao', String(status_revisao));
    if (search && typeof search === 'string') {
      const safeSearch = search.trim().substring(0, 100);
      query = query.or(`descricao.ilike.%${safeSearch}%,sugestao.ilike.%${safeSearch}%,origem.ilike.%${safeSearch}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const reviews = data || [];
    const customerIds = [...new Set(reviews.map(item => item.customer_id).filter(Boolean))];
    let customersById = new Map();

    if (customerIds.length) {
      const { data: customers, error: customersError } = await supabase
        .from('customers')
        .select('id,nome,telefone,whatsapp,email,endereco,cidade,bairro,uf,tipo_cliente,status_operacional,prioridade')
        .in('id', customerIds);
      if (customersError) throw customersError;
      customersById = new Map((customers || []).map(customer => [customer.id, customer]));
    }

    res.json(reviews.map(item => ({
      ...item,
      customers: item.customer_id ? customersById.get(item.customer_id) || null : null
    })));
  } catch (error) {
    console.error('[GET /api/data-reviews] Error:', error.message);
    if (error.code === '42P01' || /data_reviews/i.test(error.message || '')) {
      try {
        const previewRows = await readImportSheet('REVISAR');
        const { tipo_problema, search } = req.query;
        const searchTerm = String(search || '').trim().toLowerCase();
        let preview = previewRows.map(buildReviewPreviewItem);
        if (tipo_problema) preview = preview.filter(item => item.tipo_problema === String(tipo_problema));
        if (searchTerm) {
          preview = preview.filter(item => [
            item.descricao,
            item.sugestao,
            item.origem,
            item.payload?.cliente,
            item.payload?.endereco
          ].some(value => String(value || '').toLowerCase().includes(searchTerm)));
        }
        return res.json({
          preview: true,
          warning: 'Tabela data_reviews ainda nao existe. Exibindo previa da aba REVISAR da planilha.',
          items: preview
        });
      } catch (previewError) {
        return res.status(503).json({
          error: 'Tabela data_reviews ainda nao existe. Aplique migration-import-client-base.sql no Supabase antes da importacao.',
          detail: previewError.message
        });
      }
    }
    res.status(500).json({ error: 'Falha ao buscar revisoes de dados', detail: error.message });
  }
});

app.put('/api/data-reviews/:id', strictLimiter, async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    const customerId = /^\d+$/.test(rawId) ? parseInt(rawId, 10) : rawId;
    const { status_revisao } = req.body;
    const allowed = ['pendente', 'resolvido', 'ignorado'];
    if (!allowed.includes(String(status_revisao))) {
      return res.status(400).json({ error: 'status_revisao invalido' });
    }

    const { data, error } = await db
      .from('data_reviews')
      .update({ status_revisao, updated_at: new Date().toISOString() })
      .eq('id', customerId)
      .select();

    if (error) throw error;
    if (!data.length) return res.status(404).json({ error: 'Revisao nao encontrada' });
    res.json(data[0]);
  } catch (error) {
    console.error('[PUT /api/data-reviews/:id] Error:', error.message);
    res.status(500).json({ error: 'Falha ao atualizar revisao' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Error]', err.message || err);
  
  // Rate limit errors
  if (err.status === 429) {
    return res.status(429).json({ error: 'Muitas requisições. Tente novamente mais tarde.' });
  }
  
  // CORS errors
  if (err.message && err.message.startsWith('Origin not allowed by CORS:')) {
    return res.status(403).json({ error: 'Origem não autorizada' });
  }
  
  // Default error - never leak stack traces in production
  res.status(err.status || 500).json({ 
    error: process.env.NODE_ENV === 'production' 
      ? 'Erro interno do servidor' 
      : err.message 
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[Server] Letec Logistics Backend running on port ${PORT}`);
    console.log(`[Security] Helmet.js enabled with CSP and HSTS`);
    console.log(`[Limits] Global: 100 req/15min | Write: 30 req/15min`);
    console.log(`[CORS] Allowed origins: ${allowedOrigins.length ? allowedOrigins.join(', ') : 'All (development mode)'}`);
  });
}

module.exports = app;
