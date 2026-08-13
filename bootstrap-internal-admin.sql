-- DESATIVADO POR SEGURANCA.
--
-- Este arquivo ja conteve uma credencial estatica e nao deve mais criar usuarios.
-- Crie ou convide o primeiro administrador pelo Supabase Auth e vincule-o em
-- app_users por um procedimento controlado, sem colocar senhas ou hashes no Git.
-- Se o bootstrap antigo foi executado, troque imediatamente a senha daquela conta
-- e revogue suas sessoes em Configuracoes > Usuarios.

DO $$
BEGIN
  RAISE NOTICE 'Bootstrap estatico desativado. Use Supabase Auth e o fluxo de convite do LetecLog.';
END $$;
