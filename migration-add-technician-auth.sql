-- Login individual do Portal do Tecnico e papeis administrativos.

ALTER TABLE technicians ADD COLUMN IF NOT EXISTS portal_pin_hash TEXT;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS portal_pin_updated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS portal_login_enabled BOOLEAN DEFAULT false;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS portal_session_revoked_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS technician_sessions (
  id BIGSERIAL PRIMARY KEY,
  technician_id UUID REFERENCES technicians(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_seen_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_technician_sessions_technician_id ON technician_sessions(technician_id);
CREATE INDEX IF NOT EXISTS idx_technician_sessions_token_hash ON technician_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_technician_sessions_expires_at ON technician_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_technician_sessions_revoked_at ON technician_sessions(revoked_at);

CREATE TABLE IF NOT EXISTS app_users (
  id BIGSERIAL PRIMARY KEY,
  auth_user_id UUID,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operador')),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(auth_user_id),
  UNIQUE(email)
);

CREATE INDEX IF NOT EXISTS idx_app_users_auth_user_id ON app_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_app_users_role_active ON app_users(role, active);
