-- Hardening da Data API do LetecLog.
-- Arquitetura: navegador -> API Node autenticada -> Supabase com service_role.
-- Nao existem policies para anon/authenticated de proposito: o acesso direto
-- deve ser negado por padrao, inclusive para usuarios do Supabase Auth.

BEGIN;

-- Remove a primeira versao deste gatilho antes de qualquer DDL em tabela.
-- Isso tambem permite recuperar um projeto onde ela tenha sido instalada
-- parcialmente e esteja impedindo novas migrations.
DROP EVENT TRIGGER IF EXISTS ensure_public_tables_rls;
DROP EVENT TRIGGER IF EXISTS leteclog_ensure_public_tables_rls;

DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      -- Tabela de referencia mantida pela extensao PostGIS, quando instalada.
      AND tablename <> 'spatial_ref_sys'
    ORDER BY tablename
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      target.schemaname,
      target.tablename
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM anon, authenticated',
      target.schemaname,
      target.tablename
    );
    EXECUTE format(
      'GRANT ALL PRIVILEGES ON TABLE %I.%I TO service_role',
      target.schemaname,
      target.tablename
    );
  END LOOP;
END $$;

-- Impede que uma permissao residual de sequence viabilize inserts diretos.
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Defesa para objetos futuros. RLS ainda deve ser habilitado na mesma migration
-- que criar cada tabela, mas uma omissao nao deve conceder DML automaticamente.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- Evita regressao: tabelas futuras criadas por SQL no schema public recebem
-- RLS e revogacao de acesso direto automaticamente.
CREATE OR REPLACE FUNCTION public.leteclog_rls_auto_enable()
RETURNS EVENT_TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  command RECORD;
BEGIN
  FOR command IN
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name
    FROM pg_event_trigger_ddl_commands() AS ddl
    JOIN pg_class AS relation
      ON relation.oid = ddl.objid
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE ddl.command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND ddl.object_type IN ('table', 'partitioned table')
      AND namespace.nspname = 'public'
      AND relation.relname <> 'spatial_ref_sys'
      AND NOT ddl.in_extension
  LOOP
    EXECUTE format(
      'ALTER TABLE IF EXISTS %I.%I ENABLE ROW LEVEL SECURITY',
      command.schema_name,
      command.table_name
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM anon, authenticated',
      command.schema_name,
      command.table_name
    );
    EXECUTE format(
      'GRANT ALL PRIVILEGES ON TABLE %I.%I TO service_role',
      command.schema_name,
      command.table_name
    );
  END LOOP;
END;
$$;

CREATE EVENT TRIGGER leteclog_ensure_public_tables_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.leteclog_rls_auto_enable();

REVOKE ALL ON FUNCTION public.leteclog_rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- RPC operacional sensivel: somente o backend pode reagendar uma OS.
DO $$
BEGIN
  IF to_regprocedure(
    'public.transition_service_reschedule(bigint,bigint,date,text,text,text,text,jsonb)'
  ) IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.transition_service_reschedule(
      BIGINT, BIGINT, DATE, TEXT, TEXT, TEXT, TEXT, JSONB
    ) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.transition_service_reschedule(
      BIGINT, BIGINT, DATE, TEXT, TEXT, TEXT, TEXT, JSONB
    ) TO service_role;
  END IF;
END $$;

COMMIT;

-- Resultado esperado: todas as tabelas de aplicacao retornam rls_enabled=true
-- e anon/authenticated nao possuem privilegios diretos.
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_has_dml,
  has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS authenticated_has_dml
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relname <> 'spatial_ref_sys'
ORDER BY c.relname;
