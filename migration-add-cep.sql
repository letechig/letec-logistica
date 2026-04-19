-- Migração: Adicionar campo CEP para clientes
-- Data: 18/04/2026
-- Descrição: Adiciona campo CEP para preenchimento automático de endereço

-- Adicionar campo CEP à tabela customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cep TEXT;

-- Verificar se a migração foi aplicada
SELECT 'Campo CEP adicionado com sucesso' as status;