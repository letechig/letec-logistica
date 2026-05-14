-- Frota V1: hardening de veiculos, documentos, manutencoes, historico e controle de envios.
-- Execute no SQL Editor do Supabase. Nao apaga dados existentes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

UPDATE vehicles
SET placa = UPPER(REGEXP_REPLACE(COALESCE(placa, ''), '[^A-Za-z0-9]', '', 'g'))
WHERE placa IS NOT NULL AND placa <> UPPER(REGEXP_REPLACE(COALESCE(placa, ''), '[^A-Za-z0-9]', '', 'g'));

UPDATE vehicles
SET status = CASE WHEN ativo IS FALSE THEN 'inativo' ELSE COALESCE(NULLIF(status, ''), 'ativo') END
WHERE status IS NULL OR status = '';

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_veiculo_alerta_envios_chave_dia
ON veiculo_alerta_envios(alerta_chave, data_envio);

CREATE INDEX IF NOT EXISTS idx_veiculo_documentos_veiculo ON veiculo_documentos(veiculo_id);
CREATE INDEX IF NOT EXISTS idx_veiculo_documentos_vencimento ON veiculo_documentos(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_veiculo_manutencoes_veiculo ON veiculo_manutencoes(veiculo_id);
CREATE INDEX IF NOT EXISTS idx_veiculo_manutencoes_proxima_data ON veiculo_manutencoes(proxima_data);
CREATE INDEX IF NOT EXISTS idx_veiculo_historico_veiculo ON veiculo_historico(veiculo_id);
