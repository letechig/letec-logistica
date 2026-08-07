-- Etapa final: execute somente depois da auditoria retornar zero OS sem cliente.
-- Falha de forma segura enquanto ainda houver pendencias ou vinculos invalidos.

BEGIN;

DO $$
DECLARE
  pending_count BIGINT;
BEGIN
  SELECT count(*) INTO pending_count
  FROM services
  WHERE cliente_id IS NULL;

  IF pending_count > 0 THEN
    RAISE EXCEPTION
      'Finalizacao bloqueada: ainda existem % servicos sem cliente_id', pending_count;
  END IF;
END $$;

ALTER TABLE services
  DROP CONSTRAINT IF EXISTS services_cliente_id_fkey;

ALTER TABLE services
  ADD CONSTRAINT services_cliente_id_fkey
  FOREIGN KEY (cliente_id)
  REFERENCES customers(id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE services
  VALIDATE CONSTRAINT services_cliente_id_fkey;

ALTER TABLE services
  ALTER COLUMN cliente_id SET NOT NULL;

-- customer_address_id permanece anulavel para o historico legado.
-- Novos inserts continuam obrigados pelo trigger da migration anterior.

COMMIT;
