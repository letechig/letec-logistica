# Letec Logistics Backend

A secure Node.js backend API for the Letec logistics system that proxies Supabase database operations, preventing direct exposure of API keys in the frontend.

## Security Benefits

- **API Keys Protection**: Supabase keys are stored server-side, not exposed in client code
- **Controlled Access**: All database operations go through authenticated backend endpoints
- **RLS Enforcement**: Server can implement additional security layers beyond Supabase RLS
- **Request Validation**: Input validation and sanitization before database operations

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables in `.env`:
   ```
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   API_AUTH_REQUIRED=true
   ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8000,https://your-frontend-domain.vercel.app
   PORT=8000
   REQUEST_TIMEOUT_MS=12000
   ```

3. Start the server:
   ```bash
   npm start
   ```

   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/maps/distance-matrix` - Matriz compativel usando estimativa operacional local
- `GET /api/cep/:cep` - Validacao de CEP via BrasilAPI/ViaCEP com cache
- `PATCH /api/customers/:id/location` - Salva coordenada manual do cliente
- `PATCH /api/customers/:id/addresses/:addressId/location` - Salva coordenada manual da unidade
- `POST /api/services/:id/promote-arrival-location` - Usa GPS de chegada do tecnico como coordenada do cadastro
- `GET /api/services` - Get all services
- `POST /api/services` - Create a new service
- `GET /api/technicians` - Get all technicians
- `GET /api/service-types` - Get all service types

### Modo Economico de Mapas

O sistema nao usa API paga de mapas nem provedor externo de rota/geocoding em producao. O mapa visual continua em Leaflet/OpenStreetMap, enquanto tempo/km de roteiro usam estimativa local. Enderecos novos exigem CEP e numero; coordenadas entram por CEP quando disponivel, ponto manual no mapa ou GPS de chegada do tecnico.

Exemplo:

```javascript
const params = new URLSearchParams({
   origins: '88VH+MR Vila Sao Paulo, São Paulo - SP',
   destinations: 'Avenida Paulista, 1000, São Paulo - SP|Rua Silva Teles, 951, São Paulo - SP'
});

const response = await fetch(`${API_BASE_URL}/api/maps/distance-matrix?${params.toString()}`);
const data = await response.json();
```

## Frontend Integration

Replace direct Supabase calls in your frontend with requests to these backend endpoints:

```javascript
// Instead of:
// const supabase = createClient(url, key);
// const { data } = await supabase.from('services').select('*');

// Use:
const response = await fetch('/api/services');
const data = await response.json();
```

Para ambiente local abrindo HTML por `file://`, defina uma base explícita da API, por exemplo `http://localhost:8000`.

## Deploy recomendado

- Frontend: Vercel (HTTPS)
- Backend API: Render, Railway, Fly.io ou Vercel Functions
- Configure `ALLOWED_ORIGINS` com os domínios reais do frontend

## Security Considerations

- Ensure proper authentication/authorization is implemented
- Configure CORS appropriately for your domain
- Use HTTPS in production
- Regularly rotate API keys
- Monitor API usage and implement rate limiting
