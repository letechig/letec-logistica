-- Portal do Tecnico - execucao de servicos e checklist diario
-- Migração aditiva: nao remove nem altera regras existentes.

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
