-- Central do Cliente LetecLog
-- Migration aditiva: nao remove nem renomeia dados existentes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS nome_fantasia TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[],
  ADD COLUMN IF NOT EXISTS categoria_principal TEXT,
  ADD COLUMN IF NOT EXISTS vendedor_responsavel TEXT,
  ADD COLUMN IF NOT EXISTS observacao_comercial TEXT,
  ADD COLUMN IF NOT EXISTS cadastro_quality_score INTEGER,
  ADD COLUMN IF NOT EXISTS cadastro_quality_flags TEXT[],
  ADD COLUMN IF NOT EXISTS possui_animais BOOLEAN,
  ADD COLUMN IF NOT EXISTS animais_quais TEXT[],
  ADD COLUMN IF NOT EXISTS restricao_horario TEXT,
  ADD COLUMN IF NOT EXISTS acesso_local TEXT,
  ADD COLUMN IF NOT EXISTS precisa_agendar_portaria BOOLEAN,
  ADD COLUMN IF NOT EXISTS precisa_autorizacao_previa BOOLEAN,
  ADD COLUMN IF NOT EXISTS tem_chave_portaria BOOLEAN,
  ADD COLUMN IF NOT EXISTS risco_especial BOOLEAN,
  ADD COLUMN IF NOT EXISTS epis_obrigatorios TEXT,
  ADD COLUMN IF NOT EXISTS melhor_periodo_atendimento TEXT,
  ADD COLUMN IF NOT EXISTS tempo_medio_local TEXT,
  ADD COLUMN IF NOT EXISTS is_incomplete BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_customers_nome_fantasia ON customers(nome_fantasia);
CREATE INDEX IF NOT EXISTS idx_customers_categoria_principal ON customers(categoria_principal);
CREATE INDEX IF NOT EXISTS idx_customers_vendedor_responsavel ON customers(vendedor_responsavel);
CREATE INDEX IF NOT EXISTS idx_customers_quality_score ON customers(cadastro_quality_score);

ALTER TABLE customer_addresses
  ADD COLUMN IF NOT EXISTS zona_regiao TEXT,
  ADD COLUMN IF NOT EXISTS tipo_imovel TEXT,
  ADD COLUMN IF NOT EXISTS bloco_torre_andar TEXT,
  ADD COLUMN IF NOT EXISTS google_maps_url TEXT;

CREATE INDEX IF NOT EXISTS idx_customer_addresses_zona_regiao ON customer_addresses(zona_regiao);

CREATE TABLE IF NOT EXISTS customer_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  nome TEXT,
  funcao TEXT,
  telefone TEXT,
  whatsapp TEXT,
  email TEXT,
  recebe_lembrete BOOLEAN NOT NULL DEFAULT false,
  recebe_cobranca BOOLEAN NOT NULL DEFAULT false,
  recebe_relatorio BOOLEAN NOT NULL DEFAULT false,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer_id ON customer_contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_contacts_active ON customer_contacts(customer_id, ativo);
CREATE INDEX IF NOT EXISTS idx_customer_contacts_whatsapp ON customer_contacts(whatsapp);
CREATE INDEX IF NOT EXISTS idx_customer_contacts_email ON customer_contacts(email);

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS local_atendido TEXT,
  ADD COLUMN IF NOT EXISTS customer_address_id UUID NULL REFERENCES customer_addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS data_ultimo_atendimento DATE,
  ADD COLUMN IF NOT EXISTS data_proximo_atendimento DATE,
  ADD COLUMN IF NOT EXISTS numero_proposta TEXT,
  ADD COLUMN IF NOT EXISTS vigencia_inicial DATE,
  ADD COLUMN IF NOT EXISTS vigencia_final DATE,
  ADD COLUMN IF NOT EXISTS tecnico_preferencial TEXT,
  ADD COLUMN IF NOT EXISTS tempo_estimado TEXT,
  ADD COLUMN IF NOT EXISTS observacao_servico TEXT;

CREATE INDEX IF NOT EXISTS idx_contracts_customer_address_id ON contracts(customer_address_id);
CREATE INDEX IF NOT EXISTS idx_contracts_proximo_atendimento ON contracts(data_proximo_atendimento);
