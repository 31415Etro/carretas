-- Add referred_by column to leads table for tracking client referrals
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES leads(id) ON DELETE SET NULL;

-- Add comment to explain the column
COMMENT ON COLUMN leads.referred_by IS 'References another lead (client) who referred this lead';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_leads_referred_by ON leads(referred_by);
