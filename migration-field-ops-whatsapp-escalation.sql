-- Central de Campo - preparacao para escalonamento WhatsApp
-- Migracao aditiva: nao envia mensagens e nao altera o fluxo atual.

ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS whatsapp_escalado_em TIMESTAMP WITH TIME ZONE;
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS whatsapp_escalado_para TEXT;
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS whatsapp_escalado_status TEXT DEFAULT 'nao_enviado';
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS whatsapp_escalado_erro TEXT;

UPDATE technician_events
SET whatsapp_escalado_status = COALESCE(NULLIF(whatsapp_escalado_status, ''), 'nao_enviado')
WHERE whatsapp_escalado_status IS NULL
   OR whatsapp_escalado_status = '';

CREATE INDEX IF NOT EXISTS idx_technician_events_escalation_ready
  ON technician_events(status, prioridade, created_at);

CREATE INDEX IF NOT EXISTS idx_technician_events_whatsapp_escalado_status
  ON technician_events(whatsapp_escalado_status);
