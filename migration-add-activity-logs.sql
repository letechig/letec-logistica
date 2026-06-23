-- Auditoria de atividades do backend.
-- Registra autoria conhecida, contexto tecnico, IP, navegador, rota e payload resumido.

CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  actor_id TEXT,
  actor_email TEXT,
  actor_name TEXT,
  actor_source TEXT,
  portal_tecnico_id TEXT,
  portal_tecnico TEXT,
  portal_equipe TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  route TEXT,
  status_code INTEGER,
  entity TEXT,
  entity_id TEXT,
  action TEXT,
  request_id TEXT,
  ip TEXT,
  user_agent TEXT,
  origin TEXT,
  referer TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  response_summary JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor_email ON activity_logs(LOWER(actor_email));
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor_source ON activity_logs(actor_source);
CREATE INDEX IF NOT EXISTS idx_activity_logs_path ON activity_logs(path);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON activity_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_portal_tecnico ON activity_logs(LOWER(portal_tecnico));
