-- Bootstrap de acesso interno LetecLog.
-- Rode depois de migration-add-app-user-auth.sql.
--
-- Login temporario:
-- Email: letechigienizacaoosp@gmail.com
-- Senha: Letec@835778
--
-- Troque a senha depois criando um novo hash pelo backend/script, ou me peça para rotacionar.

INSERT INTO app_users (
  email,
  name,
  role,
  active,
  password_hash,
  password_updated_at,
  session_revoked_at
) VALUES (
  'letechigienizacaoosp@gmail.com',
  'Admin Letec',
  'admin',
  true,
  'pbkdf2_sha256$120000$ce6d832082cda166f9e2d506975c7cb9$ca17747e71a1a7059cb39a581b3a30072b3c3e29455a09453058c2ff7ab01764',
  now(),
  now()
)
ON CONFLICT (email) DO UPDATE
SET
  name = EXCLUDED.name,
  role = 'admin',
  active = true,
  password_hash = EXCLUDED.password_hash,
  password_updated_at = now(),
  session_revoked_at = now();
