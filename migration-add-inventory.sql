-- ============================================
-- LETEC LOG - MODULO DE ESTOQUE
-- Execute no SQL Editor do Supabase.
-- Migração aditiva e segura para reexecução.
-- ============================================

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
  WHEN LOWER(nome) LIKE '%cupim%' OR LOWER(nome) LIKE '%cupinicida%' OR LOWER(nome) LIKE '%descupiniz%' OR LOWER(nome) LIKE '%termidor%' OR LOWER(nome) LIKE '%madeira%' OR LOWER(nome) LIKE '%subterr%neo%' THEN 'descupinizacao'
  WHEN LOWER(nome) LIKE '%cloro%' OR LOWER(nome) LIKE '%hipoclorito%' OR LOWER(nome) LIKE '%escova%' OR LOWER(nome) LIKE '%bomba%' OR LOWER(nome) LIKE '%mangueira%' OR LOWER(nome) LIKE '%caixa d%agua%' OR LOWER(nome) LIKE '%caixa d%gua%' OR LOWER(nome) LIKE '%caixa dagua%' THEN 'caixa_agua'
  WHEN LOWER(nome) LIKE '%desentupidor%' OR LOWER(nome) LIKE '%cabo%' OR LOWER(nome) LIKE '%mola%' OR LOWER(nome) LIKE '%produto desentupimento%' THEN 'desentupimento'
  ELSE 'outros'
END
WHERE categoria IS NULL OR TRIM(categoria) = '' OR categoria = 'outros';

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
  ('Termidor', 'un', 'descupinizacao', 0, 0, true),
  ('Demand', 'un', 'outros', 0, 0, true),
  ('F4', 'un', 'outros', 0, 0, true),
  ('F3', 'un', 'outros', 0, 0, true),
  ('Fulmiprag', 'un', 'outros', 0, 0, true),
  ('Placa Cola', 'un', 'desratizacao', 0, 0, true)
ON CONFLICT (nome) DO NOTHING;

NOTIFY pgrst, 'reload schema';
