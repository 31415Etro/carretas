-- Add SD sub-status column to leads table
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS sd_sub_status TEXT;

-- Add check constraint for valid sub-status values
ALTER TABLE leads 
ADD CONSTRAINT leads_sd_sub_status_check 
CHECK (sd_sub_status IS NULL OR sd_sub_status IN (
  'analise_dados',
  'elaboracao_layout',
  'preparando_pc_fpv',
  'elaborando_proposta'
));

-- Add comment to explain the column
COMMENT ON COLUMN leads.sd_sub_status IS 'Sub-status for leads in SD stage: analise_dados, elaboracao_layout, preparando_pc_fpv, elaborando_proposta';
