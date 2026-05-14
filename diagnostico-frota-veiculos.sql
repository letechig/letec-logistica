-- Diagnostico seguro da Frota: nao altera dados.
-- Use no SQL Editor do Supabase para localizar cadastros a revisar.
-- Este script roda mesmo se a migration-frota-v1.sql ainda nao foi aplicada.

-- 1) Veiculos com nomes duplicados por normalizacao simples.
SELECT
  UPPER(REGEXP_REPLACE(COALESCE(v.nome, ''), '[^A-Za-z0-9]+', ' ', 'g')) AS nome_normalizado,
  COUNT(*) AS total,
  jsonb_agg(jsonb_build_object(
    'id', v.id,
    'nome', v.nome,
    'placa', to_jsonb(v)->>'placa',
    'ativo', COALESCE((to_jsonb(v)->>'ativo')::boolean, true)
  ) ORDER BY v.nome) AS veiculos
FROM vehicles v
GROUP BY 1
HAVING COUNT(*) > 1;

-- 2) Veiculos com placas duplicadas por normalizacao.
SELECT
  UPPER(REGEXP_REPLACE(COALESCE(to_jsonb(v)->>'placa', ''), '[^A-Za-z0-9]', '', 'g')) AS placa_normalizada,
  COUNT(*) AS total,
  jsonb_agg(jsonb_build_object(
    'id', v.id,
    'nome', v.nome,
    'placa', to_jsonb(v)->>'placa',
    'ativo', COALESCE((to_jsonb(v)->>'ativo')::boolean, true)
  ) ORDER BY v.nome) AS veiculos
FROM vehicles v
WHERE to_jsonb(v)->>'placa' IS NOT NULL AND TRIM(to_jsonb(v)->>'placa') <> ''
GROUP BY 1
HAVING COUNT(*) > 1;

-- 3) Veiculos ativos que precisam completar cadastro operacional.
SELECT
  v.id,
  v.nome,
  to_jsonb(v)->>'placa' AS placa,
  NULLIF(to_jsonb(v)->>'quilometragem_atual', '')::numeric AS quilometragem_atual,
  to_jsonb(v)->>'tecnico_responsavel_id' AS tecnico_responsavel_id,
  COALESCE(to_jsonb(v)->>'status', CASE WHEN COALESCE((to_jsonb(v)->>'ativo')::boolean, true) THEN 'ativo' ELSE 'inativo' END) AS status,
  COALESCE((to_jsonb(v)->>'ativo')::boolean, true) AS ativo
FROM vehicles v
WHERE COALESCE((to_jsonb(v)->>'ativo')::boolean, true) = true
  AND (
    to_jsonb(v)->>'placa' IS NULL OR TRIM(to_jsonb(v)->>'placa') = ''
    OR NULLIF(to_jsonb(v)->>'quilometragem_atual', '')::numeric IS NULL
    OR NULLIF(to_jsonb(v)->>'quilometragem_atual', '')::numeric <= 0
    OR to_jsonb(v)->>'tecnico_responsavel_id' IS NULL
  )
ORDER BY v.nome;

-- 4) Colunas esperadas pela Frota V2 e que ainda faltam.
SELECT
  expected.column_name,
  CASE WHEN c.column_name IS NULL THEN 'faltando' ELSE 'ok' END AS status
FROM (
  VALUES
    ('placa'),
    ('ativo'),
    ('marca'),
    ('modelo'),
    ('ano'),
    ('cor'),
    ('renavam'),
    ('chassi'),
    ('combustivel'),
    ('quilometragem_atual'),
    ('tecnico_responsavel_id'),
    ('status'),
    ('observacoes'),
    ('created_at'),
    ('updated_at')
) AS expected(column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = 'vehicles'
 AND c.column_name = expected.column_name
ORDER BY expected.column_name;
