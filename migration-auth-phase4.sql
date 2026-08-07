-- Fase 4 - identidade administrativa pelo Supabase Auth.
-- Migration aditiva: nao vincula, desativa ou remove usuarios automaticamente.

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS auth_linked_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS invite_sent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS invited_by TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'app_users_auth_user_id_fkey'
       AND conrelid = 'public.app_users'::regclass
  ) THEN
    ALTER TABLE public.app_users
      ADD CONSTRAINT app_users_auth_user_id_fkey
      FOREIGN KEY (auth_user_id)
      REFERENCES auth.users(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

-- O NOT NULL e a validacao definitiva da FK ficam para a etapa de corte,
-- depois que todos os usuarios administrativos ativos forem reconciliados.
