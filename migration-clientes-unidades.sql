-- Clientes V2: cliente principal + unidades/enderecos + aliases
-- Rodar manualmente no Supabase SQL Editor.
-- Nao apaga clientes nem historico existente.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS customer_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT,
  endereco TEXT,
  endereco_completo TEXT,
  cep TEXT,
  rua TEXT,
  numero TEXT,
  bairro TEXT,
  cidade TEXT,
  uf TEXT,
  complemento TEXT,
  referencia TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location_source TEXT,
  location_precision TEXT,
  location_verified_at TIMESTAMPTZ,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  origem TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_normalizado TEXT NOT NULL,
  origem TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS customer_address_id UUID NULL REFERENCES customer_addresses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer_id
  ON customer_addresses(customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_active
  ON customer_addresses(customer_id, ativo);

CREATE INDEX IF NOT EXISTS idx_customer_aliases_customer_id
  ON customer_aliases(customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_aliases_norm
  ON customer_aliases(alias_normalizado)
  WHERE ativo = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_aliases_norm_active
  ON customer_aliases(alias_normalizado)
  WHERE ativo = TRUE;

CREATE INDEX IF NOT EXISTS idx_services_customer_address_id
  ON services(customer_address_id);

-- Cria uma primeira unidade para clientes que ja tem endereco no cadastro.
-- O bloco abaixo e defensivo: bancos antigos podem ainda nao ter colunas como cep/rua/bairro.
DO $$
DECLARE
  has_ativo BOOLEAN;
  has_endereco BOOLEAN;
  has_endereco_completo BOOLEAN;
  has_cep BOOLEAN;
  has_rua BOOLEAN;
  has_numero BOOLEAN;
  has_bairro BOOLEAN;
  has_cidade BOOLEAN;
  has_uf BOOLEAN;
  has_complemento BOOLEAN;
  has_referencia BOOLEAN;
  has_latitude BOOLEAN;
  has_longitude BOOLEAN;
  endereco_expr TEXT;
  structured_expr TEXT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'ativo') INTO has_ativo;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'endereco') INTO has_endereco;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'endereco_completo') INTO has_endereco_completo;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'cep') INTO has_cep;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'rua') INTO has_rua;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'numero') INTO has_numero;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'bairro') INTO has_bairro;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'cidade') INTO has_cidade;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'uf') INTO has_uf;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'complemento') INTO has_complemento;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'referencia') INTO has_referencia;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'latitude') INTO has_latitude;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'longitude') INTO has_longitude;

  structured_expr := 'NULLIF(concat_ws('', '', '
    || CASE WHEN has_rua THEN 'NULLIF(c.rua, '''')' ELSE 'NULL::text' END || ', '
    || CASE WHEN has_numero THEN 'NULLIF(c.numero, '''')' ELSE 'NULL::text' END || ', '
    || CASE WHEN has_bairro THEN 'NULLIF(c.bairro, '''')' ELSE 'NULL::text' END || ', '
    || CASE WHEN has_cidade THEN 'NULLIF(c.cidade, '''')' ELSE 'NULL::text' END || ', '
    || CASE WHEN has_uf THEN 'NULLIF(c.uf, '''')' ELSE 'NULL::text' END || ', '
    || CASE WHEN has_complemento THEN 'NULLIF(c.complemento, '''')' ELSE 'NULL::text' END || ', '
    || CASE WHEN has_referencia THEN 'NULLIF(c.referencia, '''')' ELSE 'NULL::text' END
    || '), '''')';

  endereco_expr := 'COALESCE('
    || CASE WHEN has_endereco THEN 'NULLIF(c.endereco, ''''), ' ELSE '' END
    || CASE WHEN has_endereco_completo THEN 'NULLIF(c.endereco_completo, ''''), ' ELSE '' END
    || structured_expr
    || ')';

  EXECUTE '
    INSERT INTO customer_addresses (
      customer_id,
      label,
      endereco,
      endereco_completo,
      cep,
      rua,
      numero,
      bairro,
      cidade,
      uf,
      complemento,
      referencia,
      latitude,
      longitude,
      is_primary,
      ativo,
      origem
    )
    SELECT
      c.id,
      ''Principal'',
      ' || endereco_expr || ',
      ' || endereco_expr || ',
      ' || CASE WHEN has_cep THEN 'c.cep' ELSE 'NULL::text' END || ',
      ' || CASE WHEN has_rua THEN 'c.rua' ELSE 'NULL::text' END || ',
      ' || CASE WHEN has_numero THEN 'c.numero' ELSE 'NULL::text' END || ',
      ' || CASE WHEN has_bairro THEN 'c.bairro' ELSE 'NULL::text' END || ',
      ' || CASE WHEN has_cidade THEN 'c.cidade' ELSE 'NULL::text' END || ',
      ' || CASE WHEN has_uf THEN 'c.uf' ELSE 'NULL::text' END || ',
      ' || CASE WHEN has_complemento THEN 'c.complemento' ELSE 'NULL::text' END || ',
      ' || CASE WHEN has_referencia THEN 'c.referencia' ELSE 'NULL::text' END || ',
      ' || CASE WHEN has_latitude THEN 'c.latitude' ELSE 'NULL::double precision' END || ',
      ' || CASE WHEN has_longitude THEN 'c.longitude' ELSE 'NULL::double precision' END || ',
      TRUE,
      TRUE,
      ''migration-clientes-unidades''
    FROM customers c
    WHERE ' || CASE WHEN has_ativo THEN 'c.ativo IS DISTINCT FROM FALSE' ELSE 'TRUE' END || '
      AND ' || endereco_expr || ' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM customer_addresses ca
        WHERE ca.customer_id = c.id
          AND ca.ativo = TRUE
      )';
END $$;
