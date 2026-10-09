-- Add address fields to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS cep TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS street TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS number TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS complement TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS neighborhood TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS state TEXT;

-- Create index for city searches
CREATE INDEX IF NOT EXISTS idx_leads_city ON leads(city);
CREATE INDEX IF NOT EXISTS idx_leads_state ON leads(state);
