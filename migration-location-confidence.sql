-- Localizacao confiavel de clientes e unidades.
-- Rodar manualmente no Supabase SQL Editor.
-- Compatibilidade: somente adiciona metadados; latitude/longitude existentes sao preservadas.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS location_source TEXT,
  ADD COLUMN IF NOT EXISTS location_precision TEXT,
  ADD COLUMN IF NOT EXISTS location_verified_at TIMESTAMPTZ;

ALTER TABLE customer_addresses
  ADD COLUMN IF NOT EXISTS location_source TEXT,
  ADD COLUMN IF NOT EXISTS location_precision TEXT,
  ADD COLUMN IF NOT EXISTS location_verified_at TIMESTAMPTZ;

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_location_source_check;
ALTER TABLE customers ADD CONSTRAINT customers_location_source_check
  CHECK (location_source IS NULL OR location_source IN ('address', 'cep', 'manual_map', 'technician_arrival'));

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_location_precision_check;
ALTER TABLE customers ADD CONSTRAINT customers_location_precision_check
  CHECK (location_precision IS NULL OR location_precision IN ('exact', 'approximate', 'verified'));

ALTER TABLE customer_addresses DROP CONSTRAINT IF EXISTS customer_addresses_location_source_check;
ALTER TABLE customer_addresses ADD CONSTRAINT customer_addresses_location_source_check
  CHECK (location_source IS NULL OR location_source IN ('address', 'cep', 'manual_map', 'technician_arrival'));

ALTER TABLE customer_addresses DROP CONSTRAINT IF EXISTS customer_addresses_location_precision_check;
ALTER TABLE customer_addresses ADD CONSTRAINT customer_addresses_location_precision_check
  CHECK (location_precision IS NULL OR location_precision IN ('exact', 'approximate', 'verified'));

CREATE INDEX IF NOT EXISTS idx_customers_location_review
  ON customers(location_precision) WHERE ativo IS DISTINCT FROM FALSE;

CREATE INDEX IF NOT EXISTS idx_customer_addresses_location_review
  ON customer_addresses(location_precision) WHERE ativo IS DISTINCT FROM FALSE;
