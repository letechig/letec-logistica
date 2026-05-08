-- Lembretes manuais para clientes
-- Migracao aditiva: prepara rastreabilidade sem envio automatico.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS customer_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id TEXT NOT NULL,
  customer_id TEXT,
  tipo TEXT NOT NULL,
  canal TEXT NOT NULL DEFAULT 'whatsapp_manual',
  status TEXT NOT NULL DEFAULT 'pendente',
  destino TEXT,
  mensagem TEXT,
  aberto_em TIMESTAMP WITH TIME ZONE,
  enviado_em TIMESTAMP WITH TIME ZONE,
  erro TEXT,
  operador TEXT,
  origem_contato TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_reminders_unique_service_tipo_canal
  ON customer_reminders(service_id, tipo, canal);

CREATE INDEX IF NOT EXISTS idx_customer_reminders_service_id ON customer_reminders(service_id);
CREATE INDEX IF NOT EXISTS idx_customer_reminders_customer_id ON customer_reminders(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_reminders_status ON customer_reminders(status);
CREATE INDEX IF NOT EXISTS idx_customer_reminders_tipo ON customer_reminders(tipo);
CREATE INDEX IF NOT EXISTS idx_customer_reminders_created_at ON customer_reminders(created_at);
