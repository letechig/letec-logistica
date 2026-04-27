-- Adiciona cadastro de veículos para a aba Configurações.
-- Seguro para reexecutar em bases existentes.

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
