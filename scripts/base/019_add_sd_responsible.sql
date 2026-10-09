-- Add SD responsible field to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sd_id UUID REFERENCES profiles(id);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_leads_sd_id ON leads(sd_id);

-- Add comment
COMMENT ON COLUMN leads.sd_id IS 'ID do usuário SD (Systems Design) responsável pelo lead';
