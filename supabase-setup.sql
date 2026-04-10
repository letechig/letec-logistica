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
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at  TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
);

INSERT INTO services (id, date, data, cliente, endereco, horario, tiposervico, tipos, equipe, veiculo, status) VALUES
  (1640995200001, '2026-04-07', '2026-04-07', 'Cliente A - Empresa XYZ',       'Rua das Flores, 123 - Centro',                '08:00', 'Manutenção', '["Manutenção"]'::jsonb, 'Equipe 1', 'Veículo 1', 'agendado'),
  (1640995200002, '2026-04-08', '2026-04-08', 'Cliente B - Shopping Center',   'Av. Principal, 456 - Bairro Novo',            '10:00', 'Instalação', '["Instalação"]'::jsonb, 'Equipe 2', 'Veículo 2', 'executado'),
  (1640995200003, '2026-04-06', '2026-04-06', 'Cliente C - Condomínio ABC',    'Rua dos Pinheiros, 789 - Jardim',             '14:00', 'Reparo',     '["Reparo"]'::jsonb,     'Equipe 1', 'Veículo 1', 'agendado'),
  (1640995200004, '2026-04-09', '2026-04-09', 'Cliente D - Escritório Central','Praça da República, 321 - Centro',            '09:30', 'Inspeção',   '["Inspeção"]'::jsonb,   'Equipe 3', 'Veículo 3', 'reagendado'),
  (1640995200005, '2026-04-10', '2026-04-10', 'Cliente E - Residencial',       'Rua das Acácias, 654 - Vila Nova',            '16:00', 'Manutenção', '["Manutenção"]'::jsonb, 'Equipe 2', 'Veículo 2', 'agendado'),
  (1640995200006, '2026-04-06', '2026-04-06', 'Cliente F - Indústria ABC',     'Rodovia BR-101, Km 45 - Distrito Industrial', '11:00', 'Limpeza',    '["Limpeza"]'::jsonb,    'Equipe 1', 'Veículo 1', 'executado')
ON CONFLICT (id) DO NOTHING;

-- ─── 4. customers (nova tabela) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
  id               SERIAL PRIMARY KEY,
  nome             TEXT NOT NULL,
  nome_normalizado TEXT,
  telefone         TEXT,
  endereco         TEXT,
  tipo             TEXT DEFAULT 'PF',
  cpf_cnpj         TEXT,
  ativo            BOOLEAN DEFAULT true,
  observacoes      TEXT,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(telefone)
);

CREATE INDEX IF NOT EXISTS idx_customers_nome      ON customers(LOWER(nome));
CREATE INDEX IF NOT EXISTS idx_customers_nome_norm ON customers(nome_normalizado);

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
UNION ALL SELECT 'services',     COUNT(*) FROM services
UNION ALL SELECT 'customers',    COUNT(*) FROM customers;