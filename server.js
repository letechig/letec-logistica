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
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
const supabaseConnectSrc = process.env.SUPABASE_URL || "https://*.supabase.co";

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
      connectSrc: ["'self'", "maps.googleapis.com", "maps.gstatic.com", supabaseConnectSrc, "https://cdn.jsdelivr.net"],
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
  const instance = String(process.env.EVOLUTION_INSTANCE_NAME || process.env.EVOLUTION_INSTANCE || 'letec-higienizacao').trim();
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

async function ensureCustomerForServicePayload(db, servicePayload = {}) {
  if (servicePayload.cliente_id || !String(servicePayload.cliente || '').trim()) {
    return { payload: servicePayload, customer: null, created: false };
  }

  const existing = await fetchCustomerForService(db, servicePayload);
  if (existing?.id) {
    servicePayload.cliente_id = Number(existing.id);
    return { payload: servicePayload, customer: existing, created: false };
  }

  const name = String(servicePayload.cliente || '').trim();
  const address = String(servicePayload.endereco || '').trim();
  const insertPayload = {
    nome: name,
    nome_normalizado: normalizeCustomerName(name),
    endereco: address || null,
    endereco_completo: address || null,
    tipo: 'PF',
    tipo_cliente: 'Eventual',
    origem: 'agenda',
    ativo: true
  };

  const { data, error } = await runCustomerWriteWithSchemaFallback(
    payload => db.from('customers').insert([payload]).select(),
    insertPayload,
    'POST /api/services ensure customer'
  );
  if (error) throw error;

  const created = data?.[0] || null;
  if (created?.id) servicePayload.cliente_id = Number(created.id);
  return { payload: servicePayload, customer: created, created: true };
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
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/services', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const payload = normalizeServicePayload(req.body, { includeId: true });
    let customerLink = null;
    try {
      customerLink = await ensureCustomerForServicePayload(db, payload);
    } catch (customerError) {
      console.warn('[POST /api/services] Falha ao criar/vincular cliente automaticamente:', customerError.message);
    }
    const { data, error } = await db
      .from('services')
      .insert([payload])
      .select();

    if (error) throw error;
    const saved = data?.[0] || null;
    res.status(201).json(saved ? {
      ...saved,
      customer_auto_link: customerLink ? {
        created: !!customerLink.created,
        customer_id: payload.cliente_id || null
      } : null
    } : null);
  } catch (error) {
    console.error('[POST /api/services] Error:', error.message);
    res.status(500).json({ error: 'Falha ao criar serviço' });
  }
});

app.put('/api/services/:id', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const id = req.params.id;
    const payload = normalizeServicePayload(req.body, { partial: true });
    delete payload.id;

    if (!Object.keys(payload).length) {
      return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
    }

    const { data, error } = await db
      .from('services')
      .update(payload)
      .eq('id', id)
      .select();

    if (error) throw error;
    const updated = data?.[0] || null;
    if (!updated) return res.status(404).json({ error: 'Serviço não encontrado' });
    res.json(updated);
  } catch (error) {
    console.error('[PUT /api/services/:id] Error:', error.message);
    res.status(500).json({ error: 'Falha ao atualizar serviço' });
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

app.get('/api/checklists', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const date = cleanDateText(req.query.date);
    let query = db
      .from('checklists')
      .select('*')
      .order('created_at', { ascending: false });

    if (date) query = query.eq('date', date);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('[GET /api/checklists] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar checklists' });
  }
});

app.post('/api/checklists', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const payload = normalizeChecklistPayload(req.body);
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
    const date = cleanDateText(req.query.date);
    let query = db
      .from('technician_events')
      .select('*')
      .order('created_at', { ascending: false });

    if (date) query = query.eq('date', date);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('[GET /api/technician-events] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar eventos técnicos' });
  }
});

app.post('/api/technician-events', async (req, res) => {
  try {
    const db = getSupabaseClient();
    const payload = normalizeTechnicianEventPayload(req.body);
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
    const date = cleanDateText(req.query.date);
    const unread = String(req.query.unread) === 'true';
    let query = db
      .from('technician_messages')
      .select('*')
      .order('created_at', { ascending: false });

    if (date && unread) query = query.or(`date.eq.${date},lido.eq.false`);
    else if (date) query = query.eq('date', date);
    else if (unread) query = query.eq('lido', false);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
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
