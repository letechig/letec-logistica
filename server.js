const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12000);
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

function buildCustomerAddress({ rua, numero, bairro, cidade, complemento, referencia }) {
  const parts = [];
  if (rua) parts.push(String(rua).trim());
  if (numero) parts.push(String(numero).trim());
  const main = parts.filter(Boolean).join(', ');
  const secondary = [];
  if (bairro) secondary.push(String(bairro).trim());
  if (cidade) secondary.push(String(cidade).trim());
  let address = main;
  if (secondary.length) {
    address += (address ? ' - ' : '') + secondary.join(' - ');
  }
  if (complemento) address += ` / ${String(complemento).trim()}`;
  if (referencia) address += ` / ${String(referencia).trim()}`;
  return address.trim() || null;
}

async function findDuplicateCustomer({ id, nome, telefone }) {
  const nomeNormalizado = normalizeCustomerName(nome);
  const telefoneNormalizado = normalizePhone(telefone);

  const { data, error } = await supabase
    .from('customers')
    .select('id,nome,telefone,nome_normalizado')
    .eq('ativo', true);

  if (error) throw error;

  return (data || []).find(item => {
    const sameRecord = id && Number(item.id) === Number(id);
    if (sameRecord) return false;

    const itemNomeNorm = item.nome_normalizado || normalizeCustomerName(item.nome);
    const itemTelNorm = normalizePhone(item.telefone);

    if (nomeNormalizado && itemNomeNorm === nomeNormalizado) return true;
    if (telefoneNormalizado && itemTelNorm && itemTelNorm === telefoneNormalizado) return true;
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

// Routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Letec Logistics Backend is running',
    mapsProxy: !!process.env.GOOGLE_MAPS_API_KEY
  });
});

// Static frontend assets
app.use('/js', express.static(path.join(__dirname, 'frontend', 'js')));

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
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
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/services', async (req, res) => {
  try {
    const { data, error } = await supabase
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

// CUSTOMERS CRUD
app.get('/api/customers', async (req, res) => {
  try {
    const { search, tipo_local, bairro, nivel_urgencia_padrao, cliente_recorrente } = req.query;
    let query = supabase
      .from('customers')
      .select('*')
      .eq('ativo', true)
      .order('nome', { ascending: true });
    
    if (search && typeof search === 'string') {
      const safeSearch = search.trim().substring(0, 100);
      query = query.or(
        `nome.ilike.%${safeSearch}%,telefone.ilike.%${safeSearch}%,endereco.ilike.%${safeSearch}%,bairro.ilike.%${safeSearch}%,tipo_local.ilike.%${safeSearch}%`
      );
    }
    if (tipo_local) query = query.eq('tipo_local', tipo_local);
    if (bairro) query = query.ilike('bairro', `%${String(bairro).trim()}%`);
    if (nivel_urgencia_padrao) query = query.eq('nivel_urgencia_padrao', nivel_urgencia_padrao);
    if (cliente_recorrente !== undefined) {
      query = query.eq('cliente_recorrente', String(cliente_recorrente) === 'true');
    }
    
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('[GET /api/customers] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar clientes' });
  }
});

app.post('/api/customers', strictLimiter, async (req, res) => {
  try {
    const {
      nome,
      telefone,
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
      complemento,
      referencia,
      cliente_recorrente,
      data_ultimo_servico
    } = req.body;

    const telefoneNormalizado = normalizePhone(telefone);
    const nomeNormalizado = normalizeCustomerName(nome);
    const enderecoEstruturado = buildCustomerAddress({ rua, numero, bairro, cidade, complemento, referencia });
    const enderecoFinal = endereco ? endereco.trim() : enderecoEstruturado;
    const enderecoCompletoFinal = endereco_completo ? endereco_completo.trim() : enderecoEstruturado;
    const clienteRecorrente = cliente_recorrente === true || String(cliente_recorrente) === 'true';
    const dataUltimoServicoISO = data_ultimo_servico ? new Date(data_ultimo_servico).toISOString() : null;

    if (!nome || !telefoneNormalizado) {
      return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
    }

    if (categoria === 'contrato' && !periodicidade) {
      return res.status(400).json({ error: 'Periodicidade é obrigatória para clientes de contrato' });
    }

    if (clienteRecorrente && !periodicidade) {
      return res.status(400).json({ error: 'Periodicidade é obrigatória para clientes recorrentes' });
    }

    const duplicate = await findDuplicateCustomer({ nome, telefone: telefoneNormalizado });
    if (duplicate) {
      return res.status(409).json({
        error: `Cliente potencialmente duplicado: ${duplicate.nome}`,
        duplicateId: duplicate.id
      });
    }

    const { data, error } = await supabase
      .from('customers')
      .insert([{
        nome: nome.trim(),
        nome_normalizado: nomeNormalizado,
        telefone: telefoneNormalizado,
        endereco: enderecoFinal,
        endereco_completo: enderecoCompletoFinal,
        rua: rua ? rua.trim() : null,
        numero: numero ? String(numero).trim() : null,
        bairro: bairro ? bairro.trim() : null,
        cidade: cidade ? cidade.trim() : null,
        complemento: complemento ? complemento.trim() : null,
        referencia: referencia ? referencia.trim() : null,
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
        observacoes,
        ativo: true
      }])
      .select();

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
    const { id } = req.params;
    const {
      nome,
      telefone,
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
      complemento,
      referencia,
      cliente_recorrente,
      data_ultimo_servico
    } = req.body;

    const telefoneNormalizado = normalizePhone(telefone);
    const nomeNormalizado = normalizeCustomerName(nome);
    const enderecoEstruturado = buildCustomerAddress({ rua, numero, bairro, cidade, complemento, referencia });
    const enderecoFinal = endereco ? endereco.trim() : enderecoEstruturado;
    const enderecoCompletoFinal = endereco_completo ? endereco_completo.trim() : enderecoEstruturado;
    const clienteRecorrente = cliente_recorrente === true || String(cliente_recorrente) === 'true';
    const dataUltimoServicoISO = data_ultimo_servico ? new Date(data_ultimo_servico).toISOString() : null;

    if (!nome || !telefoneNormalizado) {
      return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
    }

    if (categoria === 'contrato' && !periodicidade) {
      return res.status(400).json({ error: 'Periodicidade é obrigatória para clientes de contrato' });
    }

    if (clienteRecorrente && !periodicidade) {
      return res.status(400).json({ error: 'Periodicidade é obrigatória para clientes recorrentes' });
    }

    const duplicate = await findDuplicateCustomer({ id, nome, telefone: telefoneNormalizado });
    if (duplicate) {
      return res.status(409).json({
        error: `Cliente potencialmente duplicado: ${duplicate.nome}`,
        duplicateId: duplicate.id
      });
    }

    const { data, error } = await supabase
      .from('customers')
      .update({
        nome: nome.trim(),
        nome_normalizado: nomeNormalizado,
        telefone: telefoneNormalizado,
        endereco: enderecoFinal,
        endereco_completo: enderecoCompletoFinal,
        rua: rua ? rua.trim() : null,
        numero: numero ? String(numero).trim() : null,
        bairro: bairro ? bairro.trim() : null,
        cidade: cidade ? cidade.trim() : null,
        complemento: complemento ? complemento.trim() : null,
        referencia: referencia ? referencia.trim() : null,
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
        observacoes,
        updated_at: new Date().toISOString()
      })
      .eq('id', parseInt(id, 10))
      .select();

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
    const { data, error } = await supabase
      .from('customers')
      .select('id,nome,telefone,nome_normalizado')
      .eq('ativo', true)
      .order('nome');

    if (error) throw error;

    const duplicates = [];
    const seen = new Map();

    for (const customer of data) {
      const key = customer.nome_normalizado || normalizeCustomerName(customer.nome);
      const telKey = normalizePhone(customer.telefone);

      if (seen.has(key)) {
        const existing = seen.get(key);
        if (!existing.group) {
          existing.group = [existing.customer];
          duplicates.push(existing);
        }
        existing.group.push(customer);
      } else if (seen.has(telKey)) {
        const existing = seen.get(telKey);
        if (!existing.group) {
          existing.group = [existing.customer];
          duplicates.push(existing);
        }
        existing.group.push(customer);
      } else {
        seen.set(key, { customer, group: null });
        if (telKey) seen.set(telKey, { customer, group: null });
      }
    }

    // Filter only groups with actual duplicates
    const actualDuplicates = duplicates.filter(d => d.group && d.group.length > 1);

    res.json(actualDuplicates);
  } catch (error) {
    console.error('[GET /api/customers/duplicates] Error:', error.message);
    res.status(500).json({ error: 'Falha ao buscar duplicatas' });
  }
});

app.post('/api/customers/merge', strictLimiter, async (req, res) => {
  try {
    const { primaryId, duplicateIds, keepFields } = req.body;
    
    if (!primaryId || !Array.isArray(duplicateIds) || duplicateIds.length === 0) {
      return res.status(400).json({ error: 'IDs primário e duplicatas são obrigatórios' });
    }
    
    // Get all customers involved
    const allIds = [primaryId, ...duplicateIds];
    const { data: customers, error: fetchError } = await supabase
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
      if (!merged.observacoes && dup.observacoes) merged.observacoes = dup.observacoes;
      
      // Append observations
      if (dup.observacoes && dup.observacoes !== merged.observacoes) {
        merged.observacoes = (merged.observacoes || '') + '\n[Merged from duplicate: ' + dup.observacoes + ']';
      }
    }
    
    // Update primary customer
    const { error: updateError } = await supabase
      .from('customers')
      .update({
        endereco: merged.endereco,
        endereco_completo: merged.endereco_completo,
        latitude: merged.latitude,
        longitude: merged.longitude,
        cpf_cnpj: merged.cpf_cnpj,
        observacoes: merged.observacoes,
        updated_at: new Date().toISOString()
      })
      .eq('id', primaryId);
    
    if (updateError) throw updateError;
    
    // Soft delete duplicates
    const { error: deleteError } = await supabase
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

app.listen(PORT, () => {
  console.log(`[Server] Letec Logistics Backend running on port ${PORT}`);
  console.log(`[Security] Helmet.js enabled with CSP and HSTS`);
  console.log(`[Limits] Global: 100 req/15min | Write: 30 req/15min`);
  console.log(`[CORS] Allowed origins: ${allowedOrigins.length ? allowedOrigins.join(', ') : 'All (development mode)'}`);
});
