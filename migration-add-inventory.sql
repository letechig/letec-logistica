-- ============================================
-- LETEC LOG - MODULO DE ESTOQUE
-- Execute no SQL Editor do Supabase.
-- Migração aditiva e segura para reexecução.
-- ============================================

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

NOTIFY pgrst, 'reload schema';
