-- Migration: compact Letec client-base import support
-- Adds operational client fields and auxiliary tables for contracts, history, and manual review.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS contato TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS zona TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tipo_cliente TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS status_operacional TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS prioridade TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS origem TEXT;
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_telefone_key;

CREATE INDEX IF NOT EXISTS idx_customers_tipo_cliente ON customers(tipo_cliente);
CREATE INDEX IF NOT EXISTS idx_customers_status_operacional ON customers(status_operacional);
CREATE INDEX IF NOT EXISTS idx_customers_prioridade ON customers(prioridade);
CREATE INDEX IF NOT EXISTS idx_customers_cpf_cnpj ON customers(cpf_cnpj);

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
