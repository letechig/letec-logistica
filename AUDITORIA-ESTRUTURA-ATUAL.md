# Auditoria e Operacao Segura - Letec

Documento de referencia para manutencao segura antes de novas funcionalidades. Esta rodada nao muda a arquitetura principal; ela reduz risco de exposicao, organiza legado e registra a ordem operacional recomendada.

## Arquivos ativos

- `server.js`: backend Node.js/Express, rotas internas, Supabase, Evolution API e proxy do Google Maps.
- `frontend/index.html`: aplicacao principal do sistema Letec.
- `frontend/portal-tecnico.html`: portal tecnico.
- `src/logistics/`: motor logistico e calculos auxiliares.
- `scripts/`: scripts de apoio e auditoria.
- `test/`: testes automatizados.
- `supabase-setup.sql` e `migration-*.sql`: scripts de banco.
- `render.yaml`: configuracao de deploy Render.
- `evolution-api/`: configuracao Docker do servico Evolution API.

## Arquivos legados

Arquivos de teste/HTML soltos que estavam na raiz foram movidos para:

- `archive/legacy-audit/`

Eles ficam preservados para consulta, mas nao devem ser usados como entrada de producao. O backend atual serve `frontend/index.html` em `/` e `frontend/portal-tecnico.html` em `/portal-tecnico.html`.

## Variaveis obrigatorias

Backend:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_ANON_KEY`
- `GOOGLE_MAPS_API_KEY`
- `ALLOWED_ORIGINS`
- `PORT`
- `EVOLUTION_API_URL` ou `EVOLUTION_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_INSTANCE_NAME` ou `EVOLUTION_INSTANCE`

Evolution API:

- `SERVER_URL`
- `AUTHENTICATION_API_KEY`
- `DATABASE_ENABLED`
- `DATABASE_PROVIDER`
- `DATABASE_CONNECTION_URI`
- `CACHE_REDIS_ENABLED`
- `CACHE_REDIS_URI`

Arquivos `.env` e `evolution-api/.env` devem permanecer fora do Git. O `.gitignore` ja cobre `.env`, `**/.env`, `.env.local` e `.env.production`.

## Nota sobre Supabase no front

O front ativo ainda usa publishable/anon key do Supabase em algumas rotinas. Isso e aceitavel temporariamente somente se as tabelas estiverem protegidas por RLS. A proxima fase de hardening deve mover escritas sensiveis para o backend, principalmente:

- `services`
- `checklists`
- `technician_events`
- `technician_messages`
- `inventory_*`

## Ordem recomendada de banco

Para banco novo, use `supabase-setup.sql` como base. Para bancos existentes, aplique migrations de forma controlada e idempotente nesta ordem sugerida:

1. `migration-add-vehicles.sql`
2. `migration-customer-fields.sql`
3. `migration-add-cep.sql`
4. `migration-add-customer-contact-fields.sql`
5. `migration-import-client-base.sql`
6. `migration-add-inventory.sql`
7. `migration-add-technician-portal.sql`
8. `migration-field-ops-status.sql`
9. `migration-field-ops-whatsapp-escalation.sql`
10. `migration-customer-reminders.sql`
11. `migration-logistica-whatsapp-fase1.sql`
12. `migration-clientes-agenda-ux.sql`
13. `migration-clientes-unidades.sql`

`supabase-setup.sql` foi alinhado para manter `services.cliente_id` com FK para `customers(id)` usando `ON DELETE SET NULL`.

## Como rodar localmente

1. Instalar dependencias:

```bash
npm install
```

2. Configurar `.env` local.

3. Rodar backend:

```bash
npm start
```

ou com reload:

```bash
npm run dev
```

4. Acessar:

- Sistema: `http://localhost:8000/`
- Portal tecnico: `http://localhost:8000/portal-tecnico.html`
- Health check: `http://localhost:8000/api/health`

## Como testar Evolution API

1. Confirmar variaveis `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` e `EVOLUTION_INSTANCE_NAME`.
2. Abrir:

```text
GET /api/evolution/status
```

3. Confirmar resposta conectada para a instancia ativa.
4. Enviar uma mensagem controlada por rota interna do backend, nunca direto do front para a Evolution.

## Checklist antes de deploy

- `npm test`
- `npm run audit:frontend`
- `GET /api/health` responde OK.
- `/` carrega `frontend/index.html`.
- `/portal-tecnico.html` carrega o portal.
- `/api/evolution/status` responde pelo backend.
- `.env` nao aparece no Git.
- Nenhuma chave real foi commitada em docs ou arquivos legados.
- RLS revisado nas tabelas acessadas pelo front.

## Rotacao de chaves

Como havia valores antigos em arquivos versionados/legados, rotacione no provedor qualquer chave que ainda esteja ativa:

- Supabase publishable/anon keys expostas anteriormente.
- Google Maps key exposta anteriormente.
- Qualquer token operacional que tenha sido compartilhado fora do `.env`.

## Proxima fase recomendada

Fazer hardening gradual das escritas do front para backend, com prioridade nas tabelas operacionais (`services`, `checklists`, eventos tecnicos e estoque). Depois disso, modularizar `server.js` por dominio: clientes, agenda, Evolution/WhatsApp, tecnicos, estoque e mapas.
