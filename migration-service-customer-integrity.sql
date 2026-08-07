-- Integridade de cliente/unidade em novas OS.
-- Ordem de implantacao: publique backend/frontend primeiro e execute esta migration depois.
-- Esta migration preserva updates operacionais em OS legadas ainda sem vinculo.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.services') IS NULL
     OR to_regclass('public.customers') IS NULL
     OR to_regclass('public.customer_addresses') IS NULL THEN
    RAISE EXCEPTION
      'Execute supabase-setup.sql e migration-clientes-unidades.sql antes de migration-service-customer-integrity.sql';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'cliente_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'customer_address_id'
  ) THEN
    RAISE EXCEPTION 'services.cliente_id e services.customer_address_id sao obrigatorios antes desta migration';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION validate_service_scheduling_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  linked_customer customers%ROWTYPE;
  linked_address customer_addresses%ROWTYPE;
  has_valid_contact BOOLEAN := FALSE;
  contact_digits TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cliente_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'service_customer_required';
    END IF;
    IF NEW.customer_address_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'service_customer_address_required';
    END IF;
  ELSE
    IF OLD.cliente_id IS NOT NULL AND NEW.cliente_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'service_customer_required';
    END IF;
    IF OLD.customer_address_id IS NOT NULL AND NEW.customer_address_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'service_customer_address_required';
    END IF;

    -- Updates tecnicos de OS legadas continuam permitidos quando o vinculo nao muda.
    IF NEW.cliente_id IS NOT DISTINCT FROM OLD.cliente_id
       AND NEW.customer_address_id IS NOT DISTINCT FROM OLD.customer_address_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Uma OS legada pode receber primeiro apenas cliente_id durante o saneamento.
  -- A API administrativa ainda exige a unidade antes de editar ou reagendar.
  IF NEW.cliente_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO linked_customer
  FROM customers
  WHERE id = NEW.cliente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'service_customer_required';
  END IF;
  IF linked_customer.ativo IS FALSE THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'service_customer_inactive';
  END IF;

  contact_digits := regexp_replace(
    coalesce(linked_customer.whatsapp, linked_customer.telefone, ''),
    '[^0-9]', '', 'g'
  );
  has_valid_contact := CASE
    WHEN contact_digits LIKE '55%' THEN length(contact_digits) IN (12, 13)
    ELSE length(contact_digits) IN (10, 11)
  END;

  IF NOT has_valid_contact AND to_regclass('public.customer_contacts') IS NOT NULL THEN
    EXECUTE $contact$
      SELECT EXISTS (
        SELECT 1
        FROM customer_contacts
        WHERE customer_id = $1
          AND ativo IS DISTINCT FROM FALSE
          AND CASE
            WHEN regexp_replace(coalesce(whatsapp, telefone, ''), '[^0-9]', '', 'g') LIKE '55%'
              THEN length(regexp_replace(coalesce(whatsapp, telefone, ''), '[^0-9]', '', 'g')) IN (12, 13)
            ELSE length(regexp_replace(coalesce(whatsapp, telefone, ''), '[^0-9]', '', 'g')) IN (10, 11)
          END
      )
    $contact$ INTO has_valid_contact USING NEW.cliente_id;
  END IF;

  IF NOT has_valid_contact THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'service_customer_contact_required';
  END IF;

  IF NEW.customer_address_id IS NOT NULL THEN
    SELECT * INTO linked_address
    FROM customer_addresses
    WHERE id = NEW.customer_address_id;

    IF NOT FOUND
       OR linked_address.customer_id IS DISTINCT FROM NEW.cliente_id
       OR linked_address.ativo IS FALSE THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'service_customer_address_mismatch';
    END IF;

    IF length(regexp_replace(coalesce(linked_address.cep, ''), '[^0-9]', '', 'g')) <> 8
       OR nullif(btrim(linked_address.rua), '') IS NULL
       OR nullif(btrim(linked_address.numero), '') IS NULL
       OR nullif(btrim(linked_address.bairro), '') IS NULL
       OR nullif(btrim(linked_address.cidade), '') IS NULL
       OR length(btrim(coalesce(linked_address.uf, ''))) <> 2 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'service_customer_address_required';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_services_scheduling_customer ON services;
CREATE TRIGGER trg_services_scheduling_customer
BEFORE INSERT OR UPDATE OF cliente_id, customer_address_id ON services
FOR EACH ROW
EXECUTE FUNCTION validate_service_scheduling_customer();

COMMIT;
