-- Create companies table
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  cnpj VARCHAR(18) UNIQUE,
  email VARCHAR(255),
  phone VARCHAR(20),
  website VARCHAR(255),
  
  -- Address fields
  cep VARCHAR(10),
  street VARCHAR(255),
  number VARCHAR(20),
  complement VARCHAR(100),
  neighborhood VARCHAR(100),
  city VARCHAR(100),
  state VARCHAR(2),
  
  -- Additional info
  industry VARCHAR(100),
  size VARCHAR(50), -- pequena, media, grande
  notes TEXT,
  
  -- Metadata
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add company_id to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_leads_company_id ON leads(company_id);
CREATE INDEX IF NOT EXISTS idx_companies_cnpj ON companies(cnpj);

-- Enable RLS
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view all companies" ON companies
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert companies" ON companies
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update companies" ON companies
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete companies" ON companies
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  );
