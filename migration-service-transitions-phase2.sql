-- Fluxo oficial dos servicos - Fase 2
-- Migration aditiva: preserva todos os registros existentes e nao executa backfill.

ALTER TABLE services ADD COLUMN IF NOT EXISTS completion_source TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS rescheduled_from_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_services_rescheduled_from_id
  ON services(rescheduled_from_id);

-- Reagendamento atomico: bloqueia o original, encerra-o e cria a nova visita
-- na mesma transacao. A funcao e idempotente por servico original.
CREATE OR REPLACE FUNCTION transition_service_reschedule(
  p_service_id BIGINT,
  p_new_id BIGINT,
  p_new_date DATE,
  p_new_time TEXT,
  p_reason TEXT,
  p_equipe TEXT DEFAULT NULL,
  p_veiculo TEXT DEFAULT NULL,
  p_tecnicos_ids JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  original services%ROWTYPE;
  existing_child services%ROWTYPE;
  new_service services%ROWTYPE;
  new_payload JSONB;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Motivo do reagendamento obrigatorio';
  END IF;
  IF p_new_date IS NULL OR p_new_time IS NULL OR trim(p_new_time) = '' THEN
    RAISE EXCEPTION 'Nova data e horario sao obrigatorios';
  END IF;

  SELECT * INTO original FROM services WHERE id = p_service_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Servico nao encontrado'; END IF;

  SELECT * INTO existing_child
    FROM services
   WHERE rescheduled_from_id = p_service_id
   ORDER BY created_at DESC NULLS LAST
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('service', to_jsonb(original), 'new_service', to_jsonb(existing_child), 'idempotent', true);
  END IF;

  IF lower(coalesce(original.status, 'agendado')) IN ('executado', 'cancelado', 'reagendado') THEN
    RAISE EXCEPTION 'Servico em estado terminal nao pode ser reagendado';
  END IF;

  UPDATE services
     SET status = 'reagendado', exec_status = 'reagendado',
         status_reason = trim(p_reason), status_changed_at = now(), updated_at = now()
   WHERE id = p_service_id
   RETURNING * INTO original;

  new_payload := to_jsonb(original) || jsonb_build_object(
    'id', p_new_id,
    'date', p_new_date,
    'data', p_new_date,
    'horario', trim(p_new_time),
    'status', 'agendado',
    'exec_status', 'agendado',
    'equipe', coalesce(p_equipe, original.equipe),
    'veiculo', coalesce(p_veiculo, original.veiculo),
    'tecnicos_ids', coalesce(p_tecnicos_ids, original.tecnicos_ids, '[]'::jsonb),
    'chegada_hora', NULL,
    'chegada_lat', NULL,
    'chegada_lng', NULL,
    'inicio_hora', NULL,
    'fim_hora', NULL,
    'tempo_espera', NULL,
    'tempo_execucao', NULL,
    'checklist_servico', NULL,
    'problema_descricao', '',
    'completion_source', NULL,
    'status_reason', NULL,
    'status_changed_at', now(),
    'rescheduled_from_id', original.id,
    'confirmado_cliente', false,
    'confirmado_cliente_em', NULL,
    'agenda_confirmada_tecnico', false,
    'agenda_confirmada_tecnico_em', NULL,
    'created_at', now(),
    'updated_at', now()
  );

  INSERT INTO services
  SELECT * FROM jsonb_populate_record(NULL::services, new_payload)
  RETURNING * INTO new_service;

  RETURN jsonb_build_object('service', to_jsonb(original), 'new_service', to_jsonb(new_service), 'idempotent', false);
END;
$$;

REVOKE ALL ON FUNCTION transition_service_reschedule(BIGINT, BIGINT, DATE, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION transition_service_reschedule(BIGINT, BIGINT, DATE, TEXT, TEXT, TEXT, TEXT, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION transition_service_reschedule(BIGINT, BIGINT, DATE, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
