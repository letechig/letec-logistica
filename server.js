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
      .select('*');

    if (error) throw error;
    res.json(data);
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