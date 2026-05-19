-- Padronizacao Cliente/Unidade/Agendamento
-- Seguro e opcional: adiciona campos sem apagar ou renomear dados existentes.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_incomplete BOOLEAN DEFAULT false;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS client_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS address_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS phone_snapshot TEXT;

UPDATE services
SET
  client_name_snapshot = COALESCE(client_name_snapshot, cliente),
  address_snapshot = COALESCE(address_snapshot, endereco)
WHERE client_name_snapshot IS NULL
   OR address_snapshot IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_is_incomplete
  ON customers(is_incomplete);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'services'
      AND column_name = 'customer_address_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_services_customer_address_id
      ON services(customer_address_id);
  END IF;
END $$;
