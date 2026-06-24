-- Corrige clientes importados com status inativo, mas ainda marcados como ativo=true.
-- Nao apaga historico; apenas garante que a listagem normal de clientes ativos os esconda.

UPDATE customers
SET
  ativo = false,
  status_operacional = 'Inativo',
  updated_at = now()
WHERE COALESCE(ativo, true) = true
  AND (
    lower(trim(COALESCE(status_operacional, ''))) IN (
      'inativo',
      'historico/inativo',
      'histórico/inativo',
      'cancelado'
    )
    OR translate(
      upper(trim(COALESCE(status_operacional, ''))),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'AAAAAEEEEIIIIOOOOOUUUUC'
    ) IN ('INATIVO', 'HISTORICO/INATIVO', 'CANCELADO')
  );

SELECT
  COUNT(*) AS clientes_inativos_restantes_visiveis_como_ativos
FROM customers
WHERE COALESCE(ativo, true) = true
  AND (
    lower(trim(COALESCE(status_operacional, ''))) IN (
      'inativo',
      'historico/inativo',
      'histórico/inativo',
      'cancelado'
    )
    OR translate(
      upper(trim(COALESCE(status_operacional, ''))),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'AAAAAEEEEIIIIOOOOOUUUUC'
    ) IN ('INATIVO', 'HISTORICO/INATIVO', 'CANCELADO')
  );
