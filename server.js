const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const readXlsxFile = require('read-excel-file/node');
const { createClient } = require('@supabase/supabase-js');
const { DistanceClient } = require('./src/logistics/distance');
const { validateService, buildDayRoutes } = require('./src/logistics/engine');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12000);
const EVOLUTION_SEND_DELAY_MS = Number(process.env.EVOLUTION_SEND_DELAY_MS || 1200);
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

// Rate limiting middleware
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                   // limit each IP to 100 requests per windowMs
  message: 'Muitas requisições deste endereço IP, tente novamente mais tarde',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health'  // Allow health checks
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 30,                    // limit each IP to 30 requests for write operations
  message: 'Muitas requisições de escrita, tente novamente em alguns minutos',
  standardHeaders: true,
  legacyHeaders: false
});

function parseMatrixLocations(value) {
  return String(value || '')
    .split('|')
    .map(item => item.trim())
    .filter(Boolean);
}

function buildMatrixUrl(origins, destinations) {
  const search = new URLSearchParams({
    origins: origins.join('|'),
    destinations: destinations.join('|'),
    mode: 'driving',
    language: 'pt-BR',
    region: 'br',
    key: process.env.GOOGLE_MAPS_API_KEY || ''
  });

  return `https://maps.googleapis.com/maps/api/distancematrix/json?${search.toString()}`;
}

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

function normalizeAddress(value) {
  return normalizeLooseText(value)
    .replace(/\bAVENIDA\b/g, 'AV')
    .replace(/\bRUA\b/g, 'R')
    .replace(/\bESTRADA\b/g, 'EST')
    .replace(/\bRODOVIA\b/g, 'ROD')
    .replace(/\bDOUTOR\b/g, 'DR')
    .replace(/\bPROFESSOR\b/g, 'PROF')
    .replace(/\bCONDOMINIO\b/g, 'COND')
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

function hasRelatedCustomerNames(leftName, rightName) {
  const left = normalizeCustomerName(leftName);
  const right = normalizeCustomerName(rightName);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 3 && right.includes(left)) return true;
  if (right.length >= 3 && left.includes(right)) return true;
  return false;
}

function areDuplicateCustomers(left, right) {
  const leftPhone = normalizePhone(left.telefone);
  const rightPhone = normalizePhone(right.telefone);
  if (leftPhone && rightPhone && leftPhone === rightPhone) return true;

  const leftWhatsapp = normalizePhone(left.whatsapp);
  const rightWhatsapp = normalizePhone(right.whatsapp);
  if (leftWhatsapp && rightWhatsapp && leftWhatsapp === rightWhatsapp) return true;

  const leftDocument = normalizeDocument(left.cpf_cnpj);
  const rightDocument = normalizeDocument(right.cpf_cnpj);
  if (leftDocument && rightDocument && leftDocument === rightDocument) return true;

  const leftName = left.nome_normalizado || normalizeCustomerName(left.nome);
  const rightName = right.nome_normalizado || normalizeCustomerName(right.nome);
  if (leftName && rightName && leftName === rightName) return true;
  const relatedNames = hasRelatedCustomerNames(left.nome, right.nome);

  const leftAddress = buildCustomerAddressFingerprint(left);
  const rightAddress = buildCustomerAddressFingerprint(right);
  if (leftAddress && rightAddress && leftAddress === rightAddress && relatedNames) return true;

  const leftCep = String(left.cep || '').replace(/\D/g, '');
  const rightCep = String(right.cep || '').replace(/\D/g, '');
  if (leftCep && rightCep && leftCep === rightCep && relatedNames) return true;

  const leftStreet = normalizeAddress(left.rua || left.endereco_completo || left.endereco);
  const rightStreet = normalizeAddress(right.rua || right.endereco_completo || right.endereco);
  if (leftStreet && rightStreet && (leftStreet === rightStreet || leftStreet.includes(rightStreet) || rightStreet.includes(leftStreet))) {
    return relatedNames;
  }

  return false;
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
  'origem'
]);

function getMissingSchemaColumn(error) {
  if (!error || !['PGRST204', '42703'].includes(error.code)) return null;
  const message = String(error.message || '');
  const match = message.match(/'([^']+)' column/) || message.match(/column\s+\w+\.([a-zA-Z0-9_]+)\s+does not exist/);
  return match ? match[1] : null;
}

async function runCustomerWriteWithSchemaFallback(buildQuery, payload, context) {
  const workingPayload = { ...payload };
  const removedColumns = [];

  for (let attempt = 0; attempt < 12; attempt += 1) {
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
    if (nomeNormalizado && itemNomeNorm === nomeNormalizado && enderecoNormalizado && itemEnderecoNorm === enderecoNormalizado) return true;
    return false;
  });
}

// Middleware - ORDER IS CRITICAL FOR SECURITY
// 1. Security headers first
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "maps.googleapis.com", "cdn.jsdelivr.net", "'unsafe-inline'"],
      scriptSrcElem: ["'self'", "maps.googleapis.com", "cdn.jsdelivr.net", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'", "'unsafe-hashes'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      styleSrcElem: ["'self'", "'unsafe-inline'", "https:", "fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https:", "data:", "fonts.gstatic.com"],
      connectSrc: ["'self'", "maps.googleapis.com", "maps.gstatic.com", "https://zqrztixmrpnpehppylyr.supabase.co", "https://cdn.jsdelivr.net"],
      frameSrc: ["maps.google.com"],
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

function extractEvolutionMessageId(payload = {}) {
  return payload.key?.id
    || payload.message?.key?.id
    || payload.instance?.messageId
    || null;
}

async function sendEvolutionText({ number, text }) {
  const config = getEvolutionConfig();
  const normalized = normalizeBrazilWhatsAppNumber(number);
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

function serviceDateValue(service = {}) {
  return String(service.date || service.data || service.dt || '').slice(0, 10);
}

function serviceTimeValue(service = {}) {
  return String(service.horario || service.hr || '').trim() || 'sem horario';
}

function serviceTypeValue(service = {}) {
  if (Array.isArray(service.tipos) && service.tipos.length) return service.tipos.join(' + ');
  if (typeof service.tipos === 'string' && service.tipos.trim()) {
    try {
      const parsed = JSON.parse(service.tipos);
      if (Array.isArray(parsed) && parsed.length) return parsed.join(' + ');
    } catch(e) {}
    return service.tipos;
  }
  return service.tiposervico || service.tipoServico || service.sc || 'Atendimento';
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

function createDistanceClient() {
  return new DistanceClient({
    apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    timeoutMs: REQUEST_TIMEOUT_MS
  });
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

// Routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Letec Logistics Backend is running',
    mapsProxy: !!process.env.GOOGLE_MAPS_API_KEY
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

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.get('/portal-tecnico.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'portal-tecnico.html'));
});

app.get('/api/maps/distance-matrix', async (req, res) => {
  try {
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return res.status(503).json({ error: 'GOOGLE_MAPS_API_KEY is not configured' });
    }

    const origins = parseMatrixLocations(req.query.origins);
    const destinations = parseMatrixLocations(req.query.destinations);

    if (!origins.length || !destinations.length) {
      return res.status(400).json({ error: 'origins and destinations are required' });
    }

    if (origins.length > 5 || destinations.length > 25) {
      return res.status(400).json({ error: 'Too many origins or destinations for a single request' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(buildMatrixUrl(origins, destinations), {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });

      const payload = await response.json();
      if (!response.ok) {
        return res.status(response.status).json({
          error: payload.error_message || payload.status || 'Google Maps request failed',
          details: payload
        });
      }

      return res.json(payload);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const isAbort = error.name === 'AbortError';
    return res.status(isAbort ? 504 : 500).json({
      error: isAbort ? 'Google Maps request timed out' : error.message
    });
  }
});

// Example routes for logistics operations
app.get('/api/services', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const cliente = String(req.query.cliente || '').trim();

    let query = db
      .from('services')
      .select('*')
      .order('date', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (cliente) {
      query = query.ilike('cliente', `%${cliente}%`);
    }

    const { data, error } = await query;

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/services', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from('services')
      .insert(req.body)
      .select();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/technicians', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('technicians')
      .select('*');

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(201).json(data[0]);
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
    return res.status(isAbort ? 504 : 500).json({
      error: isAbort ? 'Consulta de CEP expirou' : error.message
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
    let query = db
      .from('customers')
      .select('*', hasPagination ? { count: 'exact' } : undefined)
      .order('nome', { ascending: true });

    if (String(include_inactive) !== 'true') {
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
    if (status_operacional) query = query.eq('status_operacional', status_operacional);
    if (prioridade) query = query.eq('prioridade', prioridade);
    if (cliente_recorrente !== undefined) {
      query = query.eq('cliente_recorrente', String(cliente_recorrente) === 'true');
    }
    if (hasPagination) query = query.range(offset, offset + limit - 1);
    else if (rawLimit !== undefined) query = query.limit(limit);
    
    const { data, error, count } = await query;
    if (error) throw error;
    if (hasPagination) {
      return res.json({ items: data || [], total: count || 0, page, limit, offset });
    }
    res.json(data || []);
  } catch (error) {
    console.error('[GET /api/customers] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar clientes' });
  }
});

app.post('/api/customers', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const {
      nome,
      telefone,
      whatsapp,
      email,
      cep,
      endereco,
      endereco_completo,
      latitude,
      longitude,
      categoria,
      periodicidade,
      tipo,
      cpf_cnpj,
      observacoes,
      tipo_local,
      restricoes_operacionais,
      nivel_urgencia_padrao,
      observacoes_operacionais,
      rua,
      numero,
      bairro,
      cidade,
      uf,
      complemento,
      referencia,
      cliente_recorrente,
      data_ultimo_servico,
      contato,
      zona,
      tipo_cliente,
      status_operacional,
      prioridade,
      origem
    } = req.body;

    const telefoneNormalizado = normalizePhone(telefone);
    const whatsappNormalizado = normalizePhone(whatsapp);
    const emailNormalizado = normalizeEmail(email);
    const ufNormalizada = normalizeUf(uf);
    const nomeNormalizado = normalizeCustomerName(nome);
    const cepNormalizado = String(cep || '').replace(/\D/g, '') || null;
    const enderecoEstruturado = buildCustomerAddress({ rua, numero, bairro, cidade, uf: ufNormalizada, complemento, referencia });
    const enderecoFinal = endereco ? endereco.trim() : enderecoEstruturado;
    const enderecoCompletoFinal = endereco_completo ? endereco_completo.trim() : enderecoEstruturado;
    const clienteRecorrente = cliente_recorrente === true || String(cliente_recorrente) === 'true';
    const dataUltimoServicoISO = data_ultimo_servico ? new Date(data_ultimo_servico).toISOString() : null;

    if (!nome) {
      return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
    }

    if (categoria === 'contrato' && !periodicidade) {
      return res.status(400).json({ error: 'Periodicidade é obrigatória para clientes de contrato' });
    }

    if (clienteRecorrente && !periodicidade) {
      return res.status(400).json({ error: 'Periodicidade é obrigatória para clientes recorrentes' });
    }

    const duplicate = await findDuplicateCustomer({
      nome,
      telefone: telefoneNormalizado,
      whatsapp: whatsappNormalizado,
      cpf_cnpj,
      endereco: enderecoFinal,
      endereco_completo: enderecoCompletoFinal,
      cep: cepNormalizado,
      rua,
      numero,
      bairro,
      cidade,
      uf: ufNormalizada,
      db
    });
    if (duplicate) {
      return res.status(409).json({
        error: `Cliente potencialmente duplicado: ${duplicate.nome}`,
        duplicateId: duplicate.id
      });
    }

    const insertPayload = {
      nome: nome.trim(),
      nome_normalizado: nomeNormalizado,
      telefone: telefoneNormalizado,
      whatsapp: whatsappNormalizado || null,
      email: emailNormalizado,
      cep: cepNormalizado,
      endereco: enderecoFinal,
      endereco_completo: enderecoCompletoFinal,
      rua: rua ? rua.trim() : null,
      numero: numero ? String(numero).trim() : null,
      bairro: bairro ? bairro.trim() : null,
      cidade: cidade ? cidade.trim() : null,
      uf: ufNormalizada,
      complemento: complemento ? complemento.trim() : null,
      referencia: referencia ? String(referencia).trim() : null,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      tipo_local: tipo_local ? tipo_local.trim() : null,
      restricoes_operacionais: restricoes_operacionais ? restricoes_operacionais.trim() : null,
      nivel_urgencia_padrao: nivel_urgencia_padrao || 'normal',
      observacoes_operacionais: observacoes_operacionais ? observacoes_operacionais.trim() : null,
      cliente_recorrente: clienteRecorrente,
      periodicidade: categoria === 'contrato' || clienteRecorrente ? periodicidade : null,
      data_ultimo_servico: dataUltimoServicoISO,
      tipo: tipo || 'PF',
      cpf_cnpj,
      contato: contato ? String(contato).trim() : null,
      zona: zona ? String(zona).trim() : null,
      tipo_cliente: tipo_cliente ? String(tipo_cliente).trim() : (categoria === 'contrato' ? 'Contrato' : 'Eventual'),
      status_operacional: status_operacional ? String(status_operacional).trim() : null,
      prioridade: prioridade ? String(prioridade).trim() : null,
      origem: origem ? String(origem).trim() : null,
      observacoes,
      ativo: true
    };

    const { data, error } = await runCustomerWriteWithSchemaFallback(
      payload => db.from('customers').insert([payload]).select(),
      insertPayload,
      'POST /api/customers'
    );

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Telefone já cadastrado. Verifique se o cliente já existe.' });
      }
      throw error;
    }
    
    res.status(201).json(data[0]);
  } catch (error) {
    console.error('[POST /api/customers] Error:', error.message);
    res.status(500).json({ error: 'Falha ao criar cliente' });
  }
});

app.put('/api/customers/:id', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { id } = req.params;
    const {
      nome,
      telefone,
      whatsapp,
      email,
      cep,
      endereco,
      endereco_completo,
      latitude,
      longitude,
      categoria,
      periodicidade,
      tipo,
      cpf_cnpj,
      observacoes,
      tipo_local,
      restricoes_operacionais,
      nivel_urgencia_padrao,
      observacoes_operacionais,
      rua,
      numero,
      bairro,
      cidade,
      uf,
      complemento,
      referencia,
      cliente_recorrente,
      data_ultimo_servico,
      contato,
      zona,
      tipo_cliente,
      status_operacional,
      prioridade,
      origem
    } = req.body;

    const telefoneNormalizado = normalizePhone(telefone);
    const whatsappNormalizado = normalizePhone(whatsapp);
    const emailNormalizado = normalizeEmail(email);
    const ufNormalizada = normalizeUf(uf);
    const nomeNormalizado = normalizeCustomerName(nome);
    const cepNormalizado = String(cep || '').replace(/\D/g, '') || null;
    const enderecoEstruturado = buildCustomerAddress({ rua, numero, bairro, cidade, uf: ufNormalizada, complemento, referencia });
    const enderecoFinal = endereco ? endereco.trim() : enderecoEstruturado;
    const enderecoCompletoFinal = endereco_completo ? endereco_completo.trim() : enderecoEstruturado;
    const clienteRecorrente = cliente_recorrente === true || String(cliente_recorrente) === 'true';
    const dataUltimoServicoISO = data_ultimo_servico ? new Date(data_ultimo_servico).toISOString() : null;

    if (!nome) {
      return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
    }

    if (categoria === 'contrato' && !periodicidade) {
      return res.status(400).json({ error: 'Periodicidade é obrigatória para clientes de contrato' });
    }

    if (clienteRecorrente && !periodicidade) {
      return res.status(400).json({ error: 'Periodicidade é obrigatória para clientes recorrentes' });
    }

    const duplicate = await findDuplicateCustomer({
      id,
      nome,
      telefone: telefoneNormalizado,
      whatsapp: whatsappNormalizado,
      cpf_cnpj,
      endereco: enderecoFinal,
      endereco_completo: enderecoCompletoFinal,
      cep: cepNormalizado,
      rua,
      numero,
      bairro,
      cidade,
      uf: ufNormalizada,
      db
    });
    if (duplicate) {
      return res.status(409).json({
        error: `Cliente potencialmente duplicado: ${duplicate.nome}`,
        duplicateId: duplicate.id
      });
    }

    const updatePayload = {
      nome: nome.trim(),
      nome_normalizado: nomeNormalizado,
      telefone: telefoneNormalizado,
      whatsapp: whatsappNormalizado || null,
      email: emailNormalizado,
      cep: cepNormalizado,
      endereco: enderecoFinal,
      endereco_completo: enderecoCompletoFinal,
      rua: rua ? rua.trim() : null,
      numero: numero ? String(numero).trim() : null,
      bairro: bairro ? bairro.trim() : null,
      cidade: cidade ? cidade.trim() : null,
      uf: ufNormalizada,
      complemento: complemento ? complemento.trim() : null,
      referencia: referencia ? String(referencia).trim() : null,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      tipo_local: tipo_local ? tipo_local.trim() : null,
      restricoes_operacionais: restricoes_operacionais ? restricoes_operacionais.trim() : null,
      nivel_urgencia_padrao: nivel_urgencia_padrao || 'normal',
      observacoes_operacionais: observacoes_operacionais ? observacoes_operacionais.trim() : null,
      cliente_recorrente: clienteRecorrente,
      periodicidade: categoria === 'contrato' || clienteRecorrente ? periodicidade : null,
      data_ultimo_servico: dataUltimoServicoISO,
      categoria: categoria || 'eventual',
      tipo,
      cpf_cnpj,
      contato: contato ? String(contato).trim() : null,
      zona: zona ? String(zona).trim() : null,
      tipo_cliente: tipo_cliente ? String(tipo_cliente).trim() : (categoria === 'contrato' ? 'Contrato' : 'Eventual'),
      status_operacional: status_operacional ? String(status_operacional).trim() : null,
      prioridade: prioridade ? String(prioridade).trim() : null,
      origem: origem ? String(origem).trim() : null,
      observacoes,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await runCustomerWriteWithSchemaFallback(
      payload => db.from('customers').update(payload).eq('id', parseInt(id, 10)).select(),
      updatePayload,
      'PUT /api/customers/:id'
    );

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Telefone já cadastrado por outro cliente' });
      }
      throw error;
    }
    if (!data.length) return res.status(404).json({ error: 'Cliente não encontrado' });
    
    res.json(data[0]);
  } catch (error) {
    console.error('[PUT /api/customers/:id] Error:', error.message);
    res.status(500).json({ error: 'Falha ao atualizar cliente' });
  }
});

app.delete('/api/customers/:id', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('customers')
      .update({ ativo: false, updated_at: new Date().toISOString() })
      .eq('id', parseInt(id, 10))
      .select();

    if (error) throw error;
    if (!data.length) return res.status(404).json({ error: 'Cliente não encontrado' });
    
    res.json({ message: 'Cliente removido com sucesso' });
  } catch (error) {
    console.error('[DELETE /api/customers/:id] Error:', error.message);
    res.status(500).json({ error: 'Falha ao remover cliente' });
  }
});

// GEOCODING ENDPOINT
app.get('/api/geocode', async (req, res) => {
  try {
    const { address } = req.query;
    
    if (!address || typeof address !== 'string' || address.trim().length < 3) {
      return res.status(400).json({ error: 'Endereço deve ter pelo menos 3 caracteres' });
    }
    
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Google Maps API key não configurada' });
    }
    
    const encodedAddress = encodeURIComponent(address.trim());
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}&region=br&language=pt-BR`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status !== 'OK') {
      return res.status(400).json({ 
        error: 'Endereço não encontrado', 
        details: data.status,
        suggestions: data.results?.slice(0, 3).map(r => r.formatted_address) || []
      });
    }
    
    const result = data.results[0];
    const location = result.geometry.location;
    
    res.json({
      endereco_completo: result.formatted_address,
      latitude: location.lat,
      longitude: location.lng,
      place_id: result.place_id,
      tipos: result.types
    });
    
  } catch (error) {
    console.error('[GET /api/geocode] Error:', error.message);
    res.status(500).json({ error: 'Falha na geocodificação' });
  }
});

// DUPLICATES MANAGEMENT
app.get('/api/customers/duplicates', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from('customers')
      .select('*')
      .eq('ativo', true)
      .order('nome');

    if (error) throw error;

    const customers = data || [];
    const visited = new Set();
    const actualDuplicates = [];

    for (let i = 0; i < customers.length; i += 1) {
      if (visited.has(i)) continue;

      const groupIndexes = [i];
      const queue = [i];
      visited.add(i);

      while (queue.length) {
        const currentIndex = queue.shift();
        const current = customers[currentIndex];

        for (let j = 0; j < customers.length; j += 1) {
          if (visited.has(j)) continue;
          if (!areDuplicateCustomers(current, customers[j])) continue;
          visited.add(j);
          queue.push(j);
          groupIndexes.push(j);
        }
      }

      if (groupIndexes.length > 1) {
        const group = groupIndexes.map(index => customers[index]);
        actualDuplicates.push({ customer: group[0], group });
      }
    }

    res.json(actualDuplicates);
  } catch (error) {
    console.error('[GET /api/customers/duplicates] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar duplicatas' });
  }
});

app.post('/api/customers/merge', strictLimiter, async (req, res) => {
  try {
    const db = getSupabaseClient();
    const { primaryId, duplicateIds, keepFields } = req.body;
    
    if (!primaryId || !Array.isArray(duplicateIds) || duplicateIds.length === 0) {
      return res.status(400).json({ error: 'IDs primário e duplicatas são obrigatórios' });
    }
    
    // Get all customers involved
    const allIds = [primaryId, ...duplicateIds];
    const { data: customers, error: fetchError } = await db
      .from('customers')
      .select('*')
      .in('id', allIds);
    
    if (fetchError) throw fetchError;
    if (customers.length !== allIds.length) {
      return res.status(404).json({ error: 'Um ou mais clientes não encontrados' });
    }
    
    const primary = customers.find(c => c.id === primaryId);
    if (!primary) return res.status(404).json({ error: 'Cliente primário não encontrado' });
    
    // Merge data based on keepFields preference
    const merged = { ...primary };
    const duplicates = customers.filter(c => c.id !== primaryId);
    
    for (const dup of duplicates) {
      // Merge fields if primary is empty and duplicate has data
      if (!merged.endereco && dup.endereco) merged.endereco = dup.endereco;
      if (!merged.endereco_completo && dup.endereco_completo) merged.endereco_completo = dup.endereco_completo;
      if (!merged.latitude && dup.latitude) merged.latitude = dup.latitude;
      if (!merged.longitude && dup.longitude) merged.longitude = dup.longitude;
      if (!merged.cpf_cnpj && dup.cpf_cnpj) merged.cpf_cnpj = dup.cpf_cnpj;
      if (!merged.whatsapp && dup.whatsapp) merged.whatsapp = dup.whatsapp;
      if (!merged.email && dup.email) merged.email = dup.email;
      if (!merged.uf && dup.uf) merged.uf = dup.uf;
      if (!merged.observacoes && dup.observacoes) merged.observacoes = dup.observacoes;
      
      // Append observations
      if (dup.observacoes && dup.observacoes !== merged.observacoes) {
        merged.observacoes = (merged.observacoes || '') + '\n[Merged from duplicate: ' + dup.observacoes + ']';
      }
    }
    
    // Update primary customer
    const duplicateNote = `\n[Duplicatas mescladas nesta ficha: ${duplicateIds.join(', ')}]`;
    const { error: updateError } = await db
      .from('customers')
      .update({
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
      })
      .eq('id', primaryId);
    
    if (updateError) throw updateError;

    const relatedUpdates = [
      ['services', 'cliente_id'],
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
        if (missing || relatedError.code === '42P01' || relatedError.code === 'PGRST205') {
          console.warn(`[POST /api/customers/merge] Ignorando tabela/coluna ausente: ${table}.${column}`);
        } else {
          throw relatedError;
        }
      }
    }
    
    // Soft delete duplicates
    const { error: deleteError } = await db
      .from('customers')
      .update({ 
        ativo: false, 
        observacoes: (merged.observacoes || '') + '\n[Merged into customer ID: ' + primaryId + ']',
        updated_at: new Date().toISOString()
      })
      .in('id', duplicateIds);
    
    if (deleteError) throw deleteError;
    
    res.json({ 
      message: `Clientes mesclados com sucesso. ${duplicateIds.length} duplicata(s) removida(s).`,
      primaryCustomer: merged
    });
    
  } catch (error) {
    console.error('[POST /api/customers/merge] Error:', error.message);
    res.status(500).json({ error: 'Falha ao mesclar clientes' });
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
        periodicidade: String(item.periodicidade || '').trim() || null,
        status_contrato: String(item.status_contrato || 'Ativo').trim(),
        observacoes: String(item.observacoes || '').trim() || null,
        updated_at: new Date().toISOString()
      }))
      .filter(item => item.tipo_servico);

    const { error: deleteError } = await db.from('contracts').delete().eq('customer_id', customerId);
    if (deleteError) throw deleteError;

    if (!cleaned.length) return res.json([]);

    const { data, error } = await db.from('contracts').insert(cleaned).select();
    if (error) throw error;
    res.json(data || []);
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
    const state = payload.instance?.state || payload.state || payload.status || '';
    res.json({
      configured: true,
      connected: String(state).toLowerCase() === 'open',
      instance: config.instance,
      state,
      details: payload
    });
  } catch (error) {
    res.status(error.status === 404 ? 404 : 502).json({
      configured: true,
      connected: false,
      instance: config.instance,
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
    const { id } = req.params;
    const { status_revisao } = req.body;
    const allowed = ['pendente', 'resolvido', 'ignorado'];
    if (!allowed.includes(String(status_revisao))) {
      return res.status(400).json({ error: 'status_revisao invalido' });
    }

    const { data, error } = await supabase
      .from('data_reviews')
      .update({ status_revisao, updated_at: new Date().toISOString() })
      .eq('id', Number(id))
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
