-- Comunicacao Logistica WhatsApp - Fase 1
-- Historico unificado de mensagens e campos de contato/status usados pela Evolution API.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE technicians ADD COLUMN IF NOT EXISTS telefone TEXT;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS whatsapp TEXT;

ALTER TABLE services ADD COLUMN IF NOT EXISTS confirmado_cliente BOOLEAN DEFAULT false;
ALTER TABLE services ADD COLUMN IF NOT EXISTS confirmado_cliente_em TIMESTAMP WITH TIME ZONE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS agenda_confirmada_tecnico BOOLEAN DEFAULT false;
ALTER TABLE services ADD COLUMN IF NOT EXISTS agenda_confirmada_tecnico_em TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS logistica_whatsapp_mensagens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id TEXT,
  tecnico_id TEXT,
  cliente_id TEXT,
  destinatario_tipo TEXT NOT NULL,
  destinatario_nome TEXT,
  telefone TEXT,
  grupo_jid TEXT,
  direcao TEXT NOT NULL DEFAULT 'enviada',
  tipo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  resposta_api JSONB,
  erro TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  enviado_em TIMESTAMP WITH TIME ZONE,
  recebido_em TIMESTAMP WITH TIME ZONE
);

-- Central de Recados (envio assistido/manual). Campos aditivos para manter
-- compatibilidade com o historico da integracao automatica existente.
ALTER TABLE logistica_whatsapp_mensagens ADD COLUMN IF NOT EXISTS reference_key TEXT;
ALTER TABLE logistica_whatsapp_mensagens ADD COLUMN IF NOT EXISTS data_referencia DATE;
ALTER TABLE logistica_whatsapp_mensagens ADD COLUMN IF NOT EXISTS canal TEXT DEFAULT 'whatsapp_manual';
ALTER TABLE logistica_whatsapp_mensagens ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE logistica_whatsapp_mensagens ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_agendamento ON logistica_whatsapp_mensagens(agendamento_id);
CREATE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_tecnico ON logistica_whatsapp_mensagens(tecnico_id);
CREATE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_cliente ON logistica_whatsapp_mensagens(cliente_id);
CREATE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_tipo ON logistica_whatsapp_mensagens(tipo);
CREATE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_status ON logistica_whatsapp_mensagens(status);
CREATE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_destinatario ON logistica_whatsapp_mensagens(destinatario_tipo);
CREATE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_created_at ON logistica_whatsapp_mensagens(created_at);
CREATE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_data_referencia ON logistica_whatsapp_mensagens(data_referencia);
CREATE UNIQUE INDEX IF NOT EXISTS idx_logistica_whatsapp_mensagens_reference_key
  ON logistica_whatsapp_mensagens(reference_key)
  WHERE reference_key IS NOT NULL;
