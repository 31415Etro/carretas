-- Adiciona coluna created_by na tabela leads para rastrear quem criou o lead
ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES profiles(id);

-- Preenche leads existentes: se sdr_id estiver preenchido, usa como created_by
UPDATE leads SET created_by = sdr_id WHERE created_by IS NULL AND sdr_id IS NOT NULL;

-- Cria índice para performance
CREATE INDEX IF NOT EXISTS leads_created_by_idx ON leads(created_by);
