-- Add project_code column to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS project_code VARCHAR(50);

-- Create a sequence for project numbers if it doesn't exist
CREATE SEQUENCE IF NOT EXISTS project_number_seq START 10001;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_leads_project_code ON leads(project_code);
