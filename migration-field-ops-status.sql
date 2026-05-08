-- Central de Campo - prioridade e status operacional
-- Migracao aditiva e compativel com eventos antigos do portal tecnico.

ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS prioridade TEXT DEFAULT 'normal';
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pendente';
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS visto_em TIMESTAMP WITH TIME ZONE;
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS resolvido_em TIMESTAMP WITH TIME ZONE;
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS operador_responsavel TEXT;
ALTER TABLE technician_events ADD COLUMN IF NOT EXISTS observacao_resolucao TEXT;

UPDATE technician_events
SET prioridade = CASE
  WHEN LOWER(COALESCE(tipo, '')) = 'ajuda' THEN 'urgente'
  WHEN LOWER(COALESCE(tipo, '')) = 'problema' THEN 'alerta'
  ELSE COALESCE(NULLIF(prioridade, ''), 'normal')
END
WHERE prioridade IS NULL
   OR prioridade = ''
   OR (prioridade = 'normal' AND LOWER(COALESCE(tipo, '')) IN ('ajuda', 'problema'));

UPDATE technician_events
SET status = CASE
  WHEN COALESCE(visto, false) THEN 'visto'
  ELSE COALESCE(NULLIF(status, ''), 'pendente')
END
WHERE status IS NULL
   OR status = ''
   OR (status = 'pendente' AND COALESCE(visto, false));

UPDATE technician_events
SET visto_em = COALESCE(visto_em, created_at, now())
WHERE COALESCE(visto, false)
  AND visto_em IS NULL;

CREATE OR REPLACE FUNCTION normalize_technician_event_operational_fields()
RETURNS trigger AS $$
BEGIN
  IF NEW.prioridade IS NULL OR NEW.prioridade = '' OR NEW.prioridade = 'normal' THEN
    IF LOWER(COALESCE(NEW.tipo, '')) = 'ajuda' THEN
      NEW.prioridade := 'urgente';
    ELSIF LOWER(COALESCE(NEW.tipo, '')) = 'problema' THEN
      NEW.prioridade := 'alerta';
    ELSE
      NEW.prioridade := COALESCE(NULLIF(NEW.prioridade, ''), 'normal');
    END IF;
  END IF;

  IF NEW.status IS NULL OR NEW.status = '' THEN
    NEW.status := CASE WHEN COALESCE(NEW.visto, false) THEN 'visto' ELSE 'pendente' END;
  END IF;

  IF COALESCE(NEW.visto, false) AND NEW.status = 'pendente' THEN
    NEW.status := 'visto';
  END IF;

  IF COALESCE(NEW.visto, false) AND NEW.visto_em IS NULL THEN
    NEW.visto_em := now();
  END IF;

  IF NEW.status = 'resolvido' AND NEW.resolvido_em IS NULL THEN
    NEW.resolvido_em := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalize_technician_event_operational_fields ON technician_events;
CREATE TRIGGER trg_normalize_technician_event_operational_fields
BEFORE INSERT OR UPDATE ON technician_events
FOR EACH ROW
EXECUTE FUNCTION normalize_technician_event_operational_fields();

CREATE INDEX IF NOT EXISTS idx_technician_events_prioridade ON technician_events(prioridade);
CREATE INDEX IF NOT EXISTS idx_technician_events_status ON technician_events(status);
CREATE INDEX IF NOT EXISTS idx_technician_events_status_prioridade ON technician_events(status, prioridade);
