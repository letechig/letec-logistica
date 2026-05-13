ALTER TABLE services
  ADD COLUMN IF NOT EXISTS cliente_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_services_cliente_id ON services(cliente_id);

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS tipo_servico TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS periodicidade TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS status_contrato TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS observacoes TEXT;

CREATE INDEX IF NOT EXISTS idx_contracts_customer_id ON contracts(customer_id);
