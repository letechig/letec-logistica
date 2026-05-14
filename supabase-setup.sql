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
  telefone   TEXT,
  whatsapp   TEXT,
  ativo      BOOLEAN DEFAULT true,
  UNIQUE(nome)
);

ALTER TABLE technicians ADD COLUMN IF NOT EXISTS telefone TEXT;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS whatsapp TEXT;

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
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS marca TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS modelo TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ano INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS cor TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS renavam TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS chassi TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS combustivel TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS quilometragem_atual NUMERIC(12,2) DEFAULT 0;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tecnico_responsavel_id UUID REFERENCES technicians(id) ON DELETE SET NULL;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ativo';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS observacoes TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT UPPER(REGEXP_REPLACE(COALESCE(placa, ''), '[^A-Za-z0-9]', '', 'g')) AS placa_norm, COUNT(*) AS total
      FROM vehicles
      WHERE placa IS NOT NULL AND TRIM(placa) <> ''
      GROUP BY 1
      HAVING COUNT(*) > 1
    ) dup
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_placa_normalizada_unique
    ON vehicles (UPPER(REGEXP_REPLACE(COALESCE(placa, ''), '[^A-Za-z0-9]', '', 'g')))
    WHERE placa IS NOT NULL AND TRIM(placa) <> '';
  ELSE
    RAISE NOTICE 'Indice unico de placa nao criado: existem placas duplicadas para revisar.';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_tecnico_responsavel ON vehicles(tecnico_responsavel_id);

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
  categoria TEXT DEFAULT 'outros',
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
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE inventory_products ALTER COLUMN categoria SET DEFAULT 'outros';
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
CREATE INDEX IF NOT EXISTS idx_inventory_products_categoria ON inventory_products(categoria);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_data ON inventory_movements(data);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_tipo ON inventory_movements(tipo);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_vehicle ON inventory_movements(vehicle_id);

UPDATE inventory_products
SET categoria = CASE
  WHEN LOWER(nome) LIKE '%raticida%' OR LOWER(nome) LIKE '%isca%' OR LOWER(nome) LIKE '%porta isca%' OR LOWER(nome) LIKE '%armadilha%' OR LOWER(nome) LIKE '%cola%' OR LOWER(nome) LIKE '%rato%' OR LOWER(nome) LIKE '%roedor%' THEN 'desratizacao'
  WHEN LOWER(nome) LIKE '%inseticida%' OR LOWER(nome) LIKE '%gel%' OR LOWER(nome) LIKE '%pulverizador%' OR LOWER(nome) LIKE '%cipermetrina%' OR LOWER(nome) LIKE '%blatum%' OR LOWER(nome) LIKE '%baraticida%' OR LOWER(nome) LIKE '%formicida%' THEN 'desinsetizacao'
  WHEN LOWER(nome) LIKE '%cloro%' OR LOWER(nome) LIKE '%hipoclorito%' OR LOWER(nome) LIKE '%escova%' OR LOWER(nome) LIKE '%bomba%' OR LOWER(nome) LIKE '%mangueira%' OR LOWER(nome) LIKE '%caixa d%agua%' OR LOWER(nome) LIKE '%caixa d%gua%' OR LOWER(nome) LIKE '%caixa dagua%' THEN 'caixa_agua'
  WHEN LOWER(nome) LIKE '%desentupidor%' OR LOWER(nome) LIKE '%cabo%' OR LOWER(nome) LIKE '%mola%' OR LOWER(nome) LIKE '%produto desentupimento%' THEN 'desentupimento'
  ELSE 'outros'
END
WHERE categoria IS NULL OR TRIM(categoria) = '';

INSERT INTO inventory_products (nome, unidade, categoria, estoque_inicial, estoque_minimo, ativo) VALUES
  ('Set', 'un', 'outros', 0, 0, true),
  ('MAXFORCE', 'un', 'outros', 0, 0, true),
  ('Fipronil', 'un', 'outros', 0, 0, true),
  ('Blatum', 'un', 'desinsetizacao', 0, 0, true),
  ('Formifim', 'un', 'outros', 0, 0, true),
  ('Tenopa', 'un', 'outros', 0, 0, true),
  ('Cymperator', 'un', 'outros', 0, 0, true),
  ('Cyperex', 'un', 'outros', 0, 0, true),
  ('Ceretrex', 'un', 'outros', 0, 0, true),
  ('Devetion', 'un', 'outros', 0, 0, true),
  ('Termidor', 'un', 'outros', 0, 0, true),
  ('Demand', 'un', 'outros', 0, 0, true),
  ('F4', 'un', 'outros', 0, 0, true),
  ('F3', 'un', 'outros', 0, 0, true),
  ('Fulmiprag', 'un', 'outros', 0, 0, true),
  ('Placa Cola', 'un', 'desratizacao', 0, 0, true)
ON CONFLICT (nome) DO NOTHING;

CREATE TABLE IF NOT EXISTS services (
  id          BIGINT PRIMARY KEY,
  date        DATE,
  data        DATE,
  cliente_id  INTEGER,
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
  confirmado_cliente BOOLEAN DEFAULT false,
  confirmado_cliente_em TIMESTAMP WITH TIME ZONE,
  agenda_confirmada_tecnico BOOLEAN DEFAULT false,
  agenda_confirmada_tecnico_em TIMESTAMP WITH TIME ZONE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at  TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
);

ALTER TABLE services ADD COLUMN IF NOT EXISTS exec_status TEXT DEFAULT 'agendado';
ALTER TABLE services ADD COLUMN IF NOT EXISTS cliente_id INTEGER;
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
ALTER TABLE services ADD COLUMN IF NOT EXISTS confirmado_cliente BOOLEAN DEFAULT false;
ALTER TABLE services ADD COLUMN IF NOT EXISTS confirmado_cliente_em TIMESTAMP WITH TIME ZONE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS agenda_confirmada_tecnico BOOLEAN DEFAULT false;
ALTER TABLE services ADD COLUMN IF NOT EXISTS agenda_confirmada_tecnico_em TIMESTAMP WITH TIME ZONE;

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
CREATE INDEX IF NOT EXISTS idx_services_cliente_id ON services(cliente_id);
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
  prioridade TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'pendente',
  visto BOOLEAN DEFAULT false,
  visto_em TIMESTAMP WITH TIME ZONE,
  resolvido_em TIMESTAMP WITH TIME ZONE,
  operador_responsavel TEXT,
  observacao_resolucao TEXT,
  whatsapp_escalado_em TIMESTAMP WITH TIME ZONE,
  whatsapp_escalado_para TEXT,
  whatsapp_escalado_status TEXT DEFAULT 'nao_enviado',
  whatsapp_escalado_erro TEXT,
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
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS prioridade TEXT DEFAULT 'normal';
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pendente';
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS visto_em TIMESTAMP WITH TIME ZONE;
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS resolvido_em TIMESTAMP WITH TIME ZONE;
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS operador_responsavel TEXT;
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS observacao_resolucao TEXT;
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS whatsapp_escalado_em TIMESTAMP WITH TIME ZONE;
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS whatsapp_escalado_para TEXT;
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS whatsapp_escalado_status TEXT DEFAULT 'nao_enviado';
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS whatsapp_escalado_erro TEXT;
ALTER TABLE technician_messages ADD COLUMN IF NOT EXISTS prioridade TEXT DEFAULT 'normal';
ALTER TABLE technician_messages ADD COLUMN IF NOT EXISTS lido BOOLEAN DEFAULT false;
ALTER TABLE technician_messages ADD COLUMN IF NOT EXISTS lido_em TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_technician_events_date ON technician_events(date);
CREATE INDEX IF NOT EXISTS idx_technician_events_tipo ON technician_events(tipo);
CREATE INDEX IF NOT EXISTS idx_technician_events_visto ON technician_events(visto);
CREATE INDEX IF NOT EXISTS idx_technician_events_prioridade ON technician_events(prioridade);
CREATE INDEX IF NOT EXISTS idx_technician_events_status ON technician_events(status);
CREATE INDEX IF NOT EXISTS idx_technician_events_status_prioridade ON technician_events(status, prioridade);
CREATE INDEX IF NOT EXISTS idx_technician_events_escalation_ready ON technician_events(status, prioridade, created_at);
CREATE INDEX IF NOT EXISTS idx_technician_events_whatsapp_escalado_status ON technician_events(whatsapp_escalado_status);
CREATE INDEX IF NOT EXISTS idx_technician_messages_date ON technician_messages(date);
CREATE INDEX IF NOT EXISTS idx_technician_messages_lido ON technician_messages(lido);

CREATE OR REPLACE FUNCTION normalize_technician_event_operational_fields()
RETURNS trigger AS $$
BEGIN
  IF NEW.prioridade IS NULL OR NEW.prioridade = '' OR NEW.prioridade = 'normal' THEN
    IF LOWER(COALESCE(NEW.tipo, '')) = 'ajuda' THEN
      NEW.prioridade := 'urgente';
    ELSIF LOWER(COALESCE(NEW.tipo, '')) = 'problema' THEN
      NEW.prioridade := 'alerta';
    ELSE
      NEW.prioridade := COALESCE(NULLIF(NEW.prioridade, ''), 'normal');
    END IF;
  END IF;

  IF NEW.status IS NULL OR NEW.status = '' THEN
    NEW.status := CASE WHEN COALESCE(NEW.visto, false) THEN 'visto' ELSE 'pendente' END;
  END IF;

  IF COALESCE(NEW.visto, false) AND NEW.status = 'pendente' THEN
    NEW.status := 'visto';
  END IF;

  IF COALESCE(NEW.visto, false) AND NEW.visto_em IS NULL THEN
    NEW.visto_em := now();
  END IF;

  IF NEW.status = 'resolvido' AND NEW.resolvido_em IS NULL THEN
    NEW.resolvido_em := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalize_technician_event_operational_fields ON technician_events;
CREATE TRIGGER trg_normalize_technician_event_operational_fields
BEFORE INSERT OR UPDATE ON technician_events
FOR EACH ROW
EXECUTE FUNCTION normalize_technician_event_operational_fields();

-- ─── 5. customers (nova tabela) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
  id               SERIAL PRIMARY KEY,
  nome             TEXT NOT NULL,
  nome_normalizado TEXT,
  telefone         TEXT,
  whatsapp         TEXT,
  email            TEXT,
  cep              TEXT,
  endereco         TEXT,
  endereco_completo TEXT,
  rua              TEXT,
  numero           TEXT,
  bairro           TEXT,
  cidade           TEXT,
  uf               TEXT,
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
CREATE INDEX IF NOT EXISTS idx_customers_cep       ON customers(cep);
CREATE INDEX IF NOT EXISTS idx_customers_urgencia  ON customers(nivel_urgencia_padrao);
CREATE INDEX IF NOT EXISTS idx_customers_ativo     ON customers(ativo);
CREATE INDEX IF NOT EXISTS idx_customers_tipo_cliente ON customers(tipo_cliente);
CREATE INDEX IF NOT EXISTS idx_customers_status_operacional ON customers(status_operacional);
CREATE INDEX IF NOT EXISTS idx_customers_prioridade ON customers(prioridade);
CREATE INDEX IF NOT EXISTS idx_customers_cpf_cnpj ON customers(cpf_cnpj);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_whatsapp ON customers(whatsapp);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS uf TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cep TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contato TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS zona TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tipo_cliente TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS status_operacional TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS prioridade TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS origem TEXT;
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_telefone_key;

-- Mantem services.cliente_id alinhado com migration-clientes-agenda-ux.sql.
-- NOT VALID evita falha em bases antigas que ainda tenham registros orfaos;
-- novos registros passam a respeitar a FK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'services_cliente_id_fkey'
  ) THEN
    ALTER TABLE services
      ADD CONSTRAINT services_cliente_id_fkey
      FOREIGN KEY (cliente_id) REFERENCES customers(id) ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

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

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS customer_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id TEXT NOT NULL,
  customer_id TEXT,
  tipo TEXT NOT NULL,
  canal TEXT NOT NULL DEFAULT 'whatsapp_manual',
  status TEXT NOT NULL DEFAULT 'pendente',
  destino TEXT,
  mensagem TEXT,
  aberto_em TIMESTAMP WITH TIME ZONE,
  enviado_em TIMESTAMP WITH TIME ZONE,
  erro TEXT,
  operador TEXT,
  origem_contato TEXT,
  provider TEXT,
  provider_message_id TEXT,
  provider_status TEXT,
  provider_response JSONB,
  tentativas INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE customer_reminders ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE customer_reminders ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE customer_reminders ADD COLUMN IF NOT EXISTS provider_status TEXT;
ALTER TABLE customer_reminders ADD COLUMN IF NOT EXISTS provider_response JSONB;
ALTER TABLE customer_reminders ADD COLUMN IF NOT EXISTS tentativas INTEGER DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_reminders_unique_service_tipo_canal
  ON customer_reminders(service_id, tipo, canal);
CREATE INDEX IF NOT EXISTS idx_customer_reminders_service_id ON customer_reminders(service_id);
CREATE INDEX IF NOT EXISTS idx_customer_reminders_customer_id ON customer_reminders(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_reminders_status ON customer_reminders(status);
CREATE INDEX IF NOT EXISTS idx_customer_reminders_tipo ON customer_reminders(tipo);
CREATE INDEX IF NOT EXISTS idx_customer_reminders_created_at ON customer_reminders(created_at);
CREATE INDEX IF NOT EXISTS idx_customer_reminders_provider_message_id ON customer_reminders(provider_message_id);

CREATE TABLE IF NOT EXISTS logistica_whatsapp_mensagens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id TEXT,
  tecnico_id TEXT,
  cliente_id TEXT,
  destinatario_tipo TEXT NOT NULL,
  destinatario_nome TEXT,
  telefone TEXT,
  grupo_jid TEXT,
  direcao TEXT NOT NULL DEFAULT 'enviada',
  tipo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  resposta_api JSONB,
  erro TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  enviado_em TIMESTAMP WITH TIME ZONE,
  recebido_em TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_agendamento ON logistica_whatsapp_mensagens(agendamento_id);
CREATE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_tecnico ON logistica_whatsapp_mensagens(tecnico_id);
CREATE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_cliente ON logistica_whatsapp_mensagens(cliente_id);
CREATE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_tipo ON logistica_whatsapp_mensagens(tipo);
CREATE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_status ON logistica_whatsapp_mensagens(status);
CREATE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_destinatario ON logistica_whatsapp_mensagens(destinatario_tipo);
CREATE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_created_at ON logistica_whatsapp_mensagens(created_at);

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

-- Frota V1: documentos, manutencoes, historico e controle de envios.
CREATE TABLE IF NOT EXISTS veiculo_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  veiculo_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  tipo_documento TEXT NOT NULL,
  descricao TEXT,
  data_vencimento DATE NOT NULL,
  data_pagamento DATE,
  valor NUMERIC(12,2),
  status TEXT DEFAULT 'em_dia',
  observacoes TEXT,
  arquivo_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS veiculo_manutencoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  veiculo_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  tipo_manutencao TEXT NOT NULL,
  descricao TEXT,
  data_realizada DATE,
  quilometragem_realizada NUMERIC(12,2),
  proxima_data DATE,
  proxima_quilometragem NUMERIC(12,2),
  valor NUMERIC(12,2),
  oficina_fornecedor TEXT,
  status TEXT DEFAULT 'programada',
  observacoes TEXT,
  comprovante_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS veiculo_historico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  veiculo_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  tipo_evento TEXT NOT NULL,
  descricao TEXT,
  dados_anteriores JSONB,
  dados_novos JSONB,
  usuario_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS veiculo_alerta_envios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  veiculo_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  alerta_chave TEXT NOT NULL,
  tipo_alerta TEXT,
  destino TEXT,
  data_envio DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'enviado',
  resposta_api JSONB,
  erro TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_veiculo_alerta_envios_chave_dia ON veiculo_alerta_envios(alerta_chave, data_envio);
CREATE INDEX IF NOT EXISTS idx_veiculo_documentos_veiculo ON veiculo_documentos(veiculo_id);
CREATE INDEX IF NOT EXISTS idx_veiculo_documentos_vencimento ON veiculo_documentos(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_veiculo_manutencoes_veiculo ON veiculo_manutencoes(veiculo_id);
CREATE INDEX IF NOT EXISTS idx_veiculo_manutencoes_proxima_data ON veiculo_manutencoes(proxima_data);
CREATE INDEX IF NOT EXISTS idx_veiculo_historico_veiculo ON veiculo_historico(veiculo_id);
