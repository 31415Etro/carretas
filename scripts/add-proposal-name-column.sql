-- Add proposal_name column to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS proposal_name TEXT;

-- Add comment to describe the column
COMMENT ON COLUMN leads.proposal_name IS 'Nome da proposta comercial associada ao lead';
