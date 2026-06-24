-- Login interno proprio para admin/operador, sem depender da senha do Supabase Auth.

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS session_revoked_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS app_user_sessions (
  id BIGSERIAL PRIMARY KEY,
  app_user_id BIGINT REFERENCES app_users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_seen_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_user_sessions_app_user_id ON app_user_sessions(app_user_id);
CREATE INDEX IF NOT EXISTS idx_app_user_sessions_token_hash ON app_user_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_app_user_sessions_expires_at ON app_user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_app_user_sessions_revoked_at ON app_user_sessions(revoked_at);
