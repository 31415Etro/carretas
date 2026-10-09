-- Add lead source and referral fields to leads table

-- Add lead_source column
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_source TEXT;

-- Add referral_name column (for when source is Indicação)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referral_name TEXT;

-- Add referral_commission column (percentage)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referral_commission NUMERIC(5,2);

-- Add a check constraint for valid lead sources
ALTER TABLE leads ADD CONSTRAINT leads_source_check 
CHECK (lead_source IS NULL OR lead_source IN ('linkedin', 'whatsapp', 'indicacao', 'feira', 'trafego_pago'));

-- Add a check constraint for commission percentage (0-100)
ALTER TABLE leads ADD CONSTRAINT leads_commission_check 
CHECK (referral_commission IS NULL OR (referral_commission >= 0 AND referral_commission <= 100));

-- Add a constraint that referral_name is required when lead_source is 'indicacao'
-- Note: This is a soft constraint that we'll enforce in the application layer

COMMENT ON COLUMN leads.lead_source IS 'Source of the lead: linkedin, whatsapp, indicacao, feira, trafego_pago';
COMMENT ON COLUMN leads.referral_name IS 'Name of the person who referred the lead (when source is indicacao)';
COMMENT ON COLUMN leads.referral_commission IS 'Commission percentage for the referral (0-100)';
