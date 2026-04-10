const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
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
  }
};

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

// Middleware
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json());

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

app.post('/api/service-types', async (req, res) => {
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
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/service-types/:id', async (req, res) => {
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
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/service-types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('service_types').delete().eq('id', id);
    if (error) throw error;
    res.json({ message: 'Tipo removido com sucesso' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CUSTOMERS CRUD
app.get('/api/customers', async (req, res) => {
  try {
    const { search } = req.query;
    let query = supabase
      .from('customers')
      .select('*')
      .eq('ativo', true)
      .order('nome', { ascending: true });
    
    if (search) {
      query = query.ilike('nome', `%${search}%`);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/customers', async (req, res) => {
  try {
    const { nome, telefone, endereco, tipo, cpf_cnpj, observacoes } = req.body;
    const telefoneNormalizado = normalizePhone(telefone);
    const nomeNormalizado = normalizeCustomerName(nome);
    
    if (!nome || !telefoneNormalizado) {
      return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
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
        nome,
        nome_normalizado: nomeNormalizado,
        telefone: telefoneNormalizado,
        endereco,
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
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, telefone, endereco, tipo, cpf_cnpj, observacoes } = req.body;
    const telefoneNormalizado = normalizePhone(telefone);
    const nomeNormalizado = normalizeCustomerName(nome);

    if (!nome || !telefoneNormalizado) {
      return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
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
        nome,
        nome_normalizado: nomeNormalizado,
        telefone: telefoneNormalizado,
        endereco,
        tipo,
        cpf_cnpj,
        observacoes,
        updated_at: new Date().toISOString()
      })
      .eq('id', parseInt(id))
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
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('customers')
      .update({ ativo: false, updated_at: new Date().toISOString() })
      .eq('id', parseInt(id))
      .select();

    if (error) throw error;
    if (!data.length) return res.status(404).json({ error: 'Cliente não encontrado' });
    
    res.json({ message: 'Cliente removido com sucesso' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.message && err.message.startsWith('Origin not allowed by CORS:')) {
    return res.status(403).json({ error: err.message });
  }
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});