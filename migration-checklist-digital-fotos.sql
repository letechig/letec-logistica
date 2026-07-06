-- Checklist digital do portal tecnico: fotos do veiculo na saida e ocorrencias do dia.
-- As imagens ficam no Supabase Storage; o banco guarda apenas paths e metadados.

ALTER TABLE checklists ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'diario';
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS equipe TEXT;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS service_id BIGINT;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS fotos_saida JSONB DEFAULT '[]'::jsonb;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS ocorrencias JSONB DEFAULT '[]'::jsonb;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS itens JSONB DEFAULT '{}'::jsonb;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pendente';

CREATE INDEX IF NOT EXISTS idx_checklists_tipo ON checklists(tipo);
CREATE INDEX IF NOT EXISTS idx_checklists_equipe ON checklists(equipe);
CREATE INDEX IF NOT EXISTS idx_checklists_service_id ON checklists(service_id);
CREATE INDEX IF NOT EXISTS idx_checklists_status ON checklists(status);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'checklist-photos',
  'checklist-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
