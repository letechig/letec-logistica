# Deploy Production Runbook (D1/D2)

Este documento define a implantacao de producao em duas fases, com validacao e rollback.

## Arquitetura alvo

- Frontend: Vercel (pasta `refactored/`)
- Backend API: Render (arquivo `render.yaml`) ou plataforma equivalente
- Banco: Supabase
- Roteirizacao: Google Distance Matrix via proxy backend (`/api/maps/distance-matrix`)

## D1 - Preparacao e Staging

1. Backend (Render)
- Criar servico web apontando para este repositorio
- Usar `render.yaml` para bootstrap
- Configurar variaveis:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_ANON_KEY` (se necessario)
  - `GOOGLE_MAPS_API_KEY`
  - `ALLOWED_ORIGINS` com dominio do frontend de staging

2. Frontend (Vercel)
- Criar projeto com Root Directory: `refactored`
- Deploy da branch de staging
- Obter URL do preview/staging

3. Conectar frontend ao backend
- No console do navegador do frontend, executar:

```javascript
window.setLeteApiBaseUrl('https://SEU_BACKEND_STAGING.onrender.com');
```

- Isso grava `letec_api_base_url` no navegador e recarrega a pagina.

4. Validacoes obrigatorias em staging
- Auth: login/logout/persistencia
- Servicos: carregar, criar, editar, excluir
- Roteiro:
  - 1 servico: Ida + Volta da base
  - 2+ servicos: sequencia otimizada
  - sem duplicidade de compartilhados
  - sem erro CORS

## D2 - Go-live

1. Publicar backend de producao
- Confirmar health check: `/api/health`
- Confirmar mapsProxy true no payload

2. Publicar frontend de producao
- Promover deploy aprovado no Vercel

3. Apontar frontend para backend prod
- No frontend prod, executar uma vez:

```javascript
window.setLeteApiBaseUrl('https://SEU_BACKEND_PROD.onrender.com');
```

4. Smoke test (20-30 min)
- Login com perfis
- Agenda e checklist
- Roteiro com 1 e 2+ servicos
- Confirmar sem erro CORS no console

## Rollback

1. Frontend
- Vercel: promover deploy anterior

2. Backend
- Render: rollback para release anterior

3. Contencao rapida
- Desativar uso de mapas apontando para backend antigo ou removendo `letec_api_base_url` local:

```javascript
window.clearLeteApiBaseUrl();
```

## Observacoes

- Nao expor `GOOGLE_MAPS_API_KEY` no frontend em producao.
- Manter `ALLOWED_ORIGINS` restrito aos dominos reais.
- Atualizar periodicamente chaves e segredos.