-- Create sd_activities table for tracking SD work
CREATE TABLE IF NOT EXISTS sd_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Date of the activity
  activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Project/Lead reference (can select from projects or leads)
  project_code VARCHAR(50),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  
  -- Revision count
  revision_count INTEGER DEFAULT 0,
  
  -- Client name (from project/lead or manual input)
  client_name VARCHAR(255),
  
  -- Seller (Closer user)
  seller_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  
  -- Resource (who did the work)
  resource_name VARCHAR(255),
  
  -- Activity type
  activity_type VARCHAR(100) CHECK (activity_type IN (
    'interna', 'reuniao', 'analise_dados', 'layout', 
    'precificacao', 'layout_3d', 'proposta', 'visita'
  )),
  
  -- Hours spent
  hours_spent DECIMAL(10, 2) DEFAULT 0,
  
  -- Priority flag
  is_priority BOOLEAN DEFAULT FALSE,
  
  -- Delay description/notes
  delay_notes TEXT,
  
  -- Reallocated flag
  is_reallocated BOOLEAN DEFAULT FALSE,
  
  -- Costs and values
  sd_cost DECIMAL(15, 2) DEFAULT 0,
  travel_cost DECIMAL(15, 2) DEFAULT 0,
  sale_value DECIMAL(15, 2) DEFAULT 0,
  
  -- Notes
  notes TEXT,
  
  -- Audit fields
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_sd_activities_date ON sd_activities(activity_date);
CREATE INDEX IF NOT EXISTS idx_sd_activities_seller ON sd_activities(seller_id);
CREATE INDEX IF NOT EXISTS idx_sd_activities_project_code ON sd_activities(project_code);
CREATE INDEX IF NOT EXISTS idx_sd_activities_activity_type ON sd_activities(activity_type);

-- Enable RLS
ALTER TABLE sd_activities ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Enable read access for authenticated users" ON sd_activities
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert for authenticated users" ON sd_activities
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON sd_activities
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users" ON sd_activities
  FOR DELETE USING (auth.role() = 'authenticated');
