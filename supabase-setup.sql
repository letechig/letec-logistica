-- ============================================
-- SUPABASE TABLES SETUP FOR LETEC LOGISTICS
-- Execute estes comandos no painel SQL do Supabase
-- ============================================

-- 1. Criar tabela de técnicos
CREATE TABLE IF NOT EXISTS technicians (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Criar tabela de tipos de serviço
CREATE TABLE IF NOT EXISTS service_types (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Criar tabela de serviços
CREATE TABLE IF NOT EXISTS services (
  id BIGINT PRIMARY KEY,
  data DATE,
  cliente TEXT,
  endereco TEXT,
  horario TEXT,
  tiposervico TEXT,
  tipos TEXT[],
  equipe TEXT,
  veiculo TEXT,
  os TEXT,
  observacoes TEXT,
  status TEXT DEFAULT 'agendado',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Inserir dados de teste para técnicos
INSERT INTO technicians (nome) VALUES
('João Silva'),
('Maria Santos'),
('Pedro Oliveira'),
('Ana Costa'),
('Carlos Ferreira')
ON CONFLICT DO NOTHING;

-- 5. Inserir dados de teste para tipos de serviço
INSERT INTO service_types (nome) VALUES
('Manutenção'),
('Instalação'),
('Reparo'),
('Inspeção'),
('Limpeza'),
('Manutenção Preventiva')
ON CONFLICT DO NOTHING;

-- 6. Inserir dados de teste para serviços
INSERT INTO services (id, data, cliente, endereco, horario, tiposervico, tipos, equipe, veiculo, status) VALUES
(1640995200001, '2026-04-07', 'Cliente A - Empresa XYZ', 'Rua das Flores, 123 - Centro', '08:00', 'Manutenção', ARRAY['Manutenção'], 'Equipe 1', 'Veículo 1', 'agendado'),
(1640995200002, '2026-04-08', 'Cliente B - Shopping Center', 'Av. Principal, 456 - Bairro Novo', '10:00', 'Instalação', ARRAY['Instalação'], 'Equipe 2', 'Veículo 2', 'executado'),
(1640995200003, '2026-04-06', 'Cliente C - Condomínio ABC', 'Rua dos Pinheiros, 789 - Jardim', '14:00', 'Reparo', ARRAY['Reparo'], 'Equipe 1', 'Veículo 1', 'agendado'),
(1640995200004, '2026-04-09', 'Cliente D - Escritório Central', 'Praça da República, 321 - Centro', '09:30', 'Inspeção', ARRAY['Inspeção'], 'Equipe 3', 'Veículo 3', 'reagendado'),
(1640995200005, '2026-04-10', 'Cliente E - Residencial', 'Rua das Acácias, 654 - Vila Nova', '16:00', 'Manutenção', ARRAY['Manutenção'], 'Equipe 2', 'Veículo 2', 'agendado'),
(1640995200006, '2026-04-06', 'Cliente F - Indústria ABC', 'Rodovia BR-101, Km 45 - Distrito Industrial', '11:00', 'Limpeza', ARRAY['Limpeza'], 'Equipe 1', 'Veículo 1', 'executado')
ON CONFLICT (id) DO NOTHING;

-- 7. Verificar se os dados foram inseridos
SELECT 'technicians' as table_name, COUNT(*) as count FROM technicians
UNION ALL
SELECT 'service_types' as table_name, COUNT(*) as count FROM service_types
UNION ALL
SELECT 'services' as table_name, COUNT(*) as count FROM services;