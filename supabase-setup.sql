-- ============================================
-- SUPABASE SETUP FOR LETEC LOGISTICS
-- Schema mapeado diretamente do banco em 10/04/2026
-- Seguro para re-execução (IF NOT EXISTS / ON CONFLICT)
-- ============================================

-- ─── 1. service_types ───────────────────────────────────────────────
-- Schema real: id UUID PK, nome UNIQUE NOT NULL, sigla NOT NULL,
--              duracao_minutos INTEGER NOT NULL, cor TEXT, created_at
-- Colunas que NÃO existem: descricao, ativo

CREATE TABLE IF NOT EXISTS service_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            TEXT NOT NULL,
  sigla           TEXT NOT NULL,
  duracao_minutos INTEGER NOT NULL DEFAULT 60,
  cor             TEXT,
  categoria       TEXT DEFAULT 'geral',
  tipo_atendimento TEXT DEFAULT 'eventual',
  duracao_contrato_meses INTEGER,
  ativo           BOOLEAN DEFAULT true,
  created_at      TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
  UNIQUE(nome)
);

-- Compatibilidade: adiciona categoria em bases já existentes
ALTER TABLE service_types ADD COLUMN IF NOT EXISTS categoria TEXT DEFAULT 'geral';
ALTER TABLE service_types ADD COLUMN IF NOT EXISTS tipo_atendimento TEXT DEFAULT 'eventual';
ALTER TABLE service_types ADD COLUMN IF NOT EXISTS duracao_contrato_meses INTEGER;
ALTER TABLE service_types ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;

-- Garante domínio válido para tipo_atendimento sem falhar se a constraint já existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'service_types_tipo_atendimento_check'
  ) THEN
    ALTER TABLE service_types
      ADD CONSTRAINT service_types_tipo_atendimento_check
      CHECK (tipo_atendimento IN ('eventual','contrato'));
  END IF;
END $$;

-- Backfill duracao_minutos para registros já existentes sem valor
UPDATE service_types
SET duracao_minutos = 60
WHERE duracao_minutos IS NULL;

-- Backfill categoria para registros existentes sem valor
UPDATE service_types
SET categoria = 'geral'
WHERE categoria IS NULL OR TRIM(categoria) = '';

UPDATE service_types
SET tipo_atendimento = 'eventual'
WHERE tipo_atendimento IS NULL OR TRIM(tipo_atendimento) = '';

UPDATE service_types
SET ativo = true
WHERE ativo IS NULL;

INSERT INTO service_types (nome, sigla, duracao_minutos, cor, categoria) VALUES
  ('Desinsetização',         'DS',    90,  '#16a34a', 'geral'),
  ('Desratização',           'DR',    90,  '#2563eb', 'geral'),
  ('Descupinização',         'DSC',   90,  '#7c3aed', 'geral'),
  ('Iscagem',                'ISCA',  60,  '#b45309', 'geral'),
  ('Monitoramento',          'MON',   45,  '#ea580c', 'geral'),
  ('Higienização Cx Água',   'LCA',   90,  '#0891b2', 'condominio'),
  ('Desentupimento',         'DST',   90,  '#dc2626', 'geral'),
  ('Higienização Estofado',  'HIG',   90,  '#0891b2', 'residencial'),
  ('Termo/Laudo',            'TERMO', 30,  '#475569', 'geral'),
  ('Vistoria',               'VIS',   45,  '#0f766e', 'geral'),
  ('Reunião',                'REU',   60,  '#6d28d9', 'geral'),
  ('Visita Técnica',         'VISTEC',60,  '#0369a1', 'geral'),
  ('Manobra',                'MAN',   30,  '#92400e', 'geral')
ON CONFLICT (nome) DO NOTHING;

-- ─── 2. technicians ─────────────────────────────────────────────────
-- Schema real: id UUID PK, nome TEXT UNIQUE, ativo BOOLEAN

CREATE TABLE IF NOT EXISTS technicians (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       TEXT,
  ativo      BOOLEAN DEFAULT true,
  UNIQUE(nome)
);

INSERT INTO technicians (nome) VALUES
  ('João Silva'),
  ('Maria Santos'),
  ('Pedro Oliveira'),
  ('Ana Costa'),
  ('Carlos Ferreira')
ON CONFLICT (nome) DO NOTHING;

-- ─── 3. services ─────────────────────────────────────────────────────
-- Schema real: id BIGINT PK, date DATE, data DATE, cliente, endereco,
--              horario, tiposervico, tipos JSONB, equipe, veiculo, os,
--              observacoes, status, created_at, is_repasse BOOL,
--              prioridade TEXT, updated_at

CREATE TABLE IF NOT EXISTS vehicles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       TEXT NOT NULL,
  placa      TEXT,
  ativo      BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(nome)
);

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS placa TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

INSERT INTO vehicles (nome, ativo) VALUES
  ('Palio', true),
  ('Gol', true),
  ('Uno', true),
  ('Saveiro', true),
  ('Fox', true),
  ('Moto', true),
  ('Outro', true)
ON CONFLICT (nome) DO NOTHING;

-- ─── 3A. inventory ──────────────────────────────────────────────────
-- Controle de estoque de produtos, entradas, saídas por veículo e ajustes.

CREATE TABLE IF NOT EXISTS inventory_products (
  id BIGSERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  unidade TEXT DEFAULT 'un',
  estoque_inicial NUMERIC(12,2) DEFAULT 0,
  estoque_minimo NUMERIC(12,2) DEFAULT 0,
  ativo BOOLEAN DEFAULT true,
  observacoes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGSERIAL PRIMARY KEY,
  data DATE NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada','saida','ajuste')),
  product_id BIGINT REFERENCES inventory_products(id) ON DELETE SET NULL,
  produto_nome TEXT,
  quantidade NUMERIC(12,2) NOT NULL DEFAULT 0,
  vehicle_id TEXT,
  veiculo_nome TEXT,
  motivo_os TEXT,
  observacoes TEXT,
  operador TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS unidade TEXT DEFAULT 'un';
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS estoque_inicial NUMERIC(12,2) DEFAULT 0;
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS estoque_minimo NUMERIC(12,2) DEFAULT 0;
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS observacoes TEXT;
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS data DATE;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS tipo TEXT;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS product_id BIGINT REFERENCES inventory_products(id) ON DELETE SET NULL;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS produto_nome TEXT;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS quantidade NUMERIC(12,2) DEFAULT 0;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS vehicle_id TEXT;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS veiculo_nome TEXT;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS motivo_os TEXT;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS observacoes TEXT;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS operador TEXT;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_inventory_products_nome ON inventory_products(LOWER(nome));
CREATE INDEX IF NOT EXISTS idx_inventory_products_ativo ON inventory_products(ativo);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_data ON inventory_movements(data);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_tipo ON inventory_movements(tipo);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_vehicle ON inventory_movements(vehicle_id);

INSERT INTO inventory_products (nome, unidade, estoque_inicial, estoque_minimo, ativo) VALUES
  ('Set', 'un', 0, 0, true),
  ('MAXFORCE', 'un', 0, 0, true),
  ('Fipronil', 'un', 0, 0, true),
  ('Blatum', 'un', 0, 0, true),
  ('Formifim', 'un', 0, 0, true),
  ('Tenopa', 'un', 0, 0, true),
  ('Cymperator', 'un', 0, 0, true),
  ('Cyperex', 'un', 0, 0, true),
  ('Ceretrex', 'un', 0, 0, true),
  ('Devetion', 'un', 0, 0, true),
  ('Termidor', 'un', 0, 0, true),
  ('Demand', 'un', 0, 0, true),
  ('F4', 'un', 0, 0, true),
  ('F3', 'un', 0, 0, true),
  ('Fulmiprag', 'un', 0, 0, true),
  ('Placa Cola', 'un', 0, 0, true)
ON CONFLICT (nome) DO NOTHING;

CREATE TABLE IF NOT EXISTS services (
  id          BIGINT PRIMARY KEY,
  date        DATE,
  data        DATE,
  cliente     TEXT,
  endereco    TEXT,
  horario     TEXT,
  tiposervico TEXT,
  tipos       JSONB,
  equipe      TEXT,
  veiculo     TEXT,
  os          TEXT,
  observacoes TEXT,
  status      TEXT DEFAULT 'agendado',
  is_repasse  BOOLEAN DEFAULT false,
  prioridade  TEXT,
  exec_status TEXT DEFAULT 'agendado',
  chegada_hora TIMESTAMP WITH TIME ZONE,
  chegada_lat DOUBLE PRECISION,
  chegada_lng DOUBLE PRECISION,
  inicio_hora TIMESTAMP WITH TIME ZONE,
  fim_hora TIMESTAMP WITH TIME ZONE,
  tempo_espera INTEGER,
  tempo_execucao INTEGER,
  checklist_servico JSONB,
  problema_descricao TEXT,
  tecnicos_ids JSONB DEFAULT '[]'::jsonb,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at  TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
);

ALTER TABLE services ADD COLUMN IF NOT EXISTS exec_status TEXT DEFAULT 'agendado';
ALTER TABLE services ADD COLUMN IF NOT EXISTS chegada_hora TIMESTAMP WITH TIME ZONE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS chegada_lat DOUBLE PRECISION;
ALTER TABLE services ADD COLUMN IF NOT EXISTS chegada_lng DOUBLE PRECISION;
ALTER TABLE services ADD COLUMN IF NOT EXISTS inicio_hora TIMESTAMP WITH TIME ZONE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS fim_hora TIMESTAMP WITH TIME ZONE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS tempo_espera INTEGER;
ALTER TABLE services ADD COLUMN IF NOT EXISTS tempo_execucao INTEGER;
ALTER TABLE services ADD COLUMN IF NOT EXISTS checklist_servico JSONB;
ALTER TABLE services ADD COLUMN IF NOT EXISTS problema_descricao TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS tecnicos_ids JSONB DEFAULT '[]'::jsonb;

INSERT INTO services (id, date, data, cliente, endereco, horario, tiposervico, tipos, equipe, veiculo, status) VALUES
  (1640995200001, '2026-04-07', '2026-04-07', 'Cliente A - Empresa XYZ',       'Rua das Flores, 123 - Centro',                '08:00', 'Manutenção', '["Manutenção"]'::jsonb, 'Equipe 1', 'Veículo 1', 'agendado'),
  (1640995200002, '2026-04-08', '2026-04-08', 'Cliente B - Shopping Center',   'Av. Principal, 456 - Bairro Novo',            '10:00', 'Instalação', '["Instalação"]'::jsonb, 'Equipe 2', 'Veículo 2', 'executado'),
  (1640995200003, '2026-04-06', '2026-04-06', 'Cliente C - Condomínio ABC',    'Rua dos Pinheiros, 789 - Jardim',             '14:00', 'Reparo',     '["Reparo"]'::jsonb,     'Equipe 1', 'Veículo 1', 'agendado'),
  (1640995200004, '2026-04-09', '2026-04-09', 'Cliente D - Escritório Central','Praça da República, 321 - Centro',            '09:30', 'Inspeção',   '["Inspeção"]'::jsonb,   'Equipe 3', 'Veículo 3', 'reagendado'),
  (1640995200005, '2026-04-10', '2026-04-10', 'Cliente E - Residencial',       'Rua das Acácias, 654 - Vila Nova',            '16:00', 'Manutenção', '["Manutenção"]'::jsonb, 'Equipe 2', 'Veículo 2', 'agendado'),
  (1640995200006, '2026-04-06', '2026-04-06', 'Cliente F - Indústria ABC',     'Rodovia BR-101, Km 45 - Distrito Industrial', '11:00', 'Limpeza',    '["Limpeza"]'::jsonb,    'Equipe 1', 'Veículo 1', 'executado')
ON CONFLICT (id) DO NOTHING;

-- ─── 4. checklists ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklists (
  id BIGINT PRIMARY KEY,
  date DATE,
  motorista TEXT,
  assistente TEXT,
  cartao TEXT,
  vei TEXT,
  kms INTEGER,
  kmc INTEGER,
  kmd INTEGER,
  hrs TEXT,
  hrc TEXT,
  fuel TEXT,
  hasav BOOLEAN DEFAULT false,
  avtxt TEXT,
  obs TEXT,
  equip JSONB DEFAULT '{}'::jsonb,
  importado BOOLEAN DEFAULT false,
  origem TEXT DEFAULT 'admin',
  saida_lat DOUBLE PRECISION,
  saida_lng DOUBLE PRECISION,
  retorno_lat DOUBLE PRECISION,
  retorno_lng DOUBLE PRECISION,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE checklists ADD COLUMN IF NOT EXISTS cartao TEXT;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS equip JSONB DEFAULT '{}'::jsonb;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS importado BOOLEAN DEFAULT false;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT 'admin';
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS saida_lat DOUBLE PRECISION;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS saida_lng DOUBLE PRECISION;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS retorno_lat DOUBLE PRECISION;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS retorno_lng DOUBLE PRECISION;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_services_exec_status ON services(exec_status);
CREATE INDEX IF NOT EXISTS idx_services_tecnicos_ids ON services USING GIN(tecnicos_ids);
CREATE INDEX IF NOT EXISTS idx_checklists_date ON checklists(date);
CREATE INDEX IF NOT EXISTS idx_checklists_motorista ON checklists(LOWER(motorista));
CREATE INDEX IF NOT EXISTS idx_checklists_origem ON checklists(origem);

CREATE TABLE IF NOT EXISTS technician_events (
  id BIGINT PRIMARY KEY,
  date DATE,
  tecnico TEXT,
  equipe TEXT,
  service_id BIGINT,
  tipo TEXT,
  titulo TEXT,
  detalhes TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  visto BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS technician_messages (
  id BIGINT PRIMARY KEY,
  date DATE,
  tecnico TEXT,
  equipe TEXT,
  mensagem TEXT NOT NULL,
  prioridade TEXT DEFAULT 'normal',
  lido BOOLEAN DEFAULT false,
  lido_em TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS visto BOOLEAN DEFAULT false;
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE technician_messages ADD COLUMN IF NOT EXISTS prioridade TEXT DEFAULT 'normal';
ALTER TABLE technician_messages ADD COLUMN IF NOT EXISTS lido BOOLEAN DEFAULT false;
ALTER TABLE technician_messages ADD COLUMN IF NOT EXISTS lido_em TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_technician_events_date ON technician_events(date);
CREATE INDEX IF NOT EXISTS idx_technician_events_tipo ON technician_events(tipo);
CREATE INDEX IF NOT EXISTS idx_technician_events_visto ON technician_events(visto);
CREATE INDEX IF NOT EXISTS idx_technician_messages_date ON technician_messages(date);
CREATE INDEX IF NOT EXISTS idx_technician_messages_lido ON technician_messages(lido);

-- ─── 5. customers (nova tabela) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
  id               SERIAL PRIMARY KEY,
  nome             TEXT NOT NULL,
  nome_normalizado TEXT,
  telefone         TEXT,
  endereco         TEXT,
  endereco_completo TEXT,
  rua              TEXT,
  numero           TEXT,
  bairro           TEXT,
  cidade           TEXT,
  complemento      TEXT,
  referencia       TEXT,
  latitude         DECIMAL(10,8),
  longitude        DECIMAL(11,8),
  tipo_local       TEXT,
  restricoes_operacionais TEXT,
  nivel_urgencia_padrao TEXT DEFAULT 'normal' CHECK (nivel_urgencia_padrao IN ('normal', 'urgente', 'crítico')),
  observacoes_operacionais TEXT,
  cliente_recorrente BOOLEAN DEFAULT false,
  periodicidade    TEXT CHECK (periodicidade IN ('semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral', 'semestral', 'anual')),
  data_ultimo_servico TIMESTAMP WITH TIME ZONE,
  categoria        TEXT DEFAULT 'eventual' CHECK (categoria IN ('contrato', 'eventual')),
  tipo             TEXT DEFAULT 'PF',
  cpf_cnpj         TEXT,
  contato          TEXT,
  zona             TEXT,
  tipo_cliente     TEXT,
  status_operacional TEXT,
  prioridade       TEXT,
  origem           TEXT,
  ativo            BOOLEAN DEFAULT true,
  observacoes      TEXT,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_nome      ON customers(LOWER(nome));
CREATE INDEX IF NOT EXISTS idx_customers_nome_norm ON customers(nome_normalizado);
CREATE INDEX IF NOT EXISTS idx_customers_categoria ON customers(categoria);
CREATE INDEX IF NOT EXISTS idx_customers_tipo_local ON customers(tipo_local);
CREATE INDEX IF NOT EXISTS idx_customers_bairro    ON customers(bairro);
CREATE INDEX IF NOT EXISTS idx_customers_urgencia  ON customers(nivel_urgencia_padrao);
CREATE INDEX IF NOT EXISTS idx_customers_ativo     ON customers(ativo);
CREATE INDEX IF NOT EXISTS idx_customers_tipo_cliente ON customers(tipo_cliente);
CREATE INDEX IF NOT EXISTS idx_customers_status_operacional ON customers(status_operacional);
CREATE INDEX IF NOT EXISTS idx_customers_prioridade ON customers(prioridade);
CREATE INDEX IF NOT EXISTS idx_customers_cpf_cnpj ON customers(cpf_cnpj);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS contato TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS zona TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tipo_cliente TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS status_operacional TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS prioridade TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS origem TEXT;
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_telefone_key;

CREATE TABLE IF NOT EXISTS contracts (
  id BIGSERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  numero_contrato TEXT,
  data_inicio DATE,
  data_vencimento DATE,
  periodicidade TEXT,
  tipo_servico TEXT,
  valor NUMERIC(12,2),
  status_contrato TEXT,
  proxima_execucao_sugerida DATE,
  observacoes TEXT,
  origem TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_customer_id ON contracts(customer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status_contrato);
CREATE INDEX IF NOT EXISTS idx_contracts_vencimento ON contracts(data_vencimento);

CREATE TABLE IF NOT EXISTS customer_service_history (
  id BIGSERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  data_atendimento DATE,
  origem TEXT,
  servico TEXT,
  tecnico TEXT,
  observacoes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_service_history_customer_id ON customer_service_history(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_service_history_data ON customer_service_history(data_atendimento);

CREATE TABLE IF NOT EXISTS data_reviews (
  id BIGSERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  tipo_problema TEXT NOT NULL,
  descricao TEXT,
  sugestao TEXT,
  status_revisao TEXT DEFAULT 'pendente',
  origem TEXT,
  payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_reviews_customer_id ON data_reviews(customer_id);
CREATE INDEX IF NOT EXISTS idx_data_reviews_tipo ON data_reviews(tipo_problema);
CREATE INDEX IF NOT EXISTS idx_data_reviews_status ON data_reviews(status_revisao);

-- Migração: atualizar registros existentes com valores padrão
UPDATE customers SET categoria = 'eventual' WHERE categoria IS NULL;
UPDATE customers SET tipo = 'PF' WHERE tipo IS NULL OR tipo = '';

-- ─── 5. Migração: importar clientes únicos de services ───────────────
INSERT INTO customers (nome, nome_normalizado, endereco, tipo, observacoes)
SELECT DISTINCT ON (LOWER(TRIM(s.cliente)))
  TRIM(s.cliente),
  UPPER(REGEXP_REPLACE(
    TRANSLATE(TRIM(s.cliente),
      'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇáàãâäéèêëíìîïóòõôöúùûüç',
      'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'),
    '[^A-Z0-9 ]', ' ', 'g')),
  NULLIF(TRIM(s.endereco), ''),
  'PF',
  'Importado automaticamente da tabela services'
FROM services s
WHERE COALESCE(TRIM(s.cliente), '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM customers c
    WHERE LOWER(TRIM(c.nome)) = LOWER(TRIM(s.cliente))
  )
ORDER BY LOWER(TRIM(s.cliente)), s.created_at DESC;

-- Backfill nome_normalizado para clientes sem valor
UPDATE customers
SET nome_normalizado = UPPER(REGEXP_REPLACE(
    TRANSLATE(TRIM(nome),
      'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇáàãâäéèêëíìîïóòõôöúùûüç',
      'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'),
    '[^A-Z0-9 ]', ' ', 'g'))
WHERE COALESCE(nome_normalizado, '') = '';

-- ─── 6. Verificação final ─────────────────────────────────────────────
SELECT 'service_types' AS table_name, COUNT(*) AS count FROM service_types
UNION ALL SELECT 'technicians',  COUNT(*) FROM technicians
UNION ALL SELECT 'vehicles',     COUNT(*) FROM vehicles
UNION ALL SELECT 'inventory_products', COUNT(*) FROM inventory_products
UNION ALL SELECT 'inventory_movements', COUNT(*) FROM inventory_movements
UNION ALL SELECT 'services',     COUNT(*) FROM services
UNION ALL SELECT 'checklists',   COUNT(*) FROM checklists
UNION ALL SELECT 'technician_events', COUNT(*) FROM technician_events
UNION ALL SELECT 'technician_messages', COUNT(*) FROM technician_messages
UNION ALL SELECT 'customers',    COUNT(*) FROM customers;
