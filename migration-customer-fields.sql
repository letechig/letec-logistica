-- Migração: Adicionar novos campos para cadastro de clientes aprimorado
-- Data: 18/04/2026
-- Descrição: Adiciona campos para categoria (contrato/eventual), periodicidade, geocoding

-- Adicionar novos campos à tabela customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS endereco_completo TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS rua TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS numero TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bairro TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS complemento TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS referencia TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tipo_local TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS restricoes_operacionais TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS nivel_urgencia_padrao TEXT DEFAULT 'normal' CHECK (nivel_urgencia_padrao IN ('normal', 'urgente', 'crítico'));
ALTER TABLE customers ADD COLUMN IF NOT EXISTS observacoes_operacionais TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cliente_recorrente BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS periodicidade TEXT CHECK (periodicidade IN ('semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral', 'semestral', 'anual'));
ALTER TABLE customers ADD COLUMN IF NOT EXISTS data_ultimo_servico TIMESTAMP WITH TIME ZONE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS categoria TEXT DEFAULT 'eventual' CHECK (categoria IN ('contrato', 'eventual'));

-- Atualizar registros existentes com valores padrão
UPDATE customers SET categoria = 'eventual' WHERE categoria IS NULL;
UPDATE customers SET tipo = 'PF' WHERE tipo IS NULL OR tipo = '';

-- Adicionar índices para os novos campos
CREATE INDEX IF NOT EXISTS idx_customers_categoria ON customers(categoria);
CREATE INDEX IF NOT EXISTS idx_customers_tipo_local ON customers(tipo_local);
CREATE INDEX IF NOT EXISTS idx_customers_bairro    ON customers(bairro);
CREATE INDEX IF NOT EXISTS idx_customers_urgencia  ON customers(nivel_urgencia_padrao);
CREATE INDEX IF NOT EXISTS idx_customers_ativo ON customers(ativo);

-- Verificar se a migração foi aplicada
SELECT 'Migração aplicada com sucesso' as status;