-- Create table to track SD costs and hours per closer
-- This allows manual input of costs and hours by the user

CREATE TABLE IF NOT EXISTS sd_closer_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  month INTEGER NOT NULL, -- 1-12
  year INTEGER NOT NULL,
  hours_cost NUMERIC DEFAULT 0, -- Custo em horas
  travel_cost NUMERIC DEFAULT 0, -- Custo em viagens
  hours_worked NUMERIC DEFAULT 0, -- Horas trabalhadas
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  
  -- Ensure only one entry per closer per month/year
  UNIQUE(closer_id, month, year)
);

-- Enable RLS
ALTER TABLE sd_closer_metrics ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view all metrics
CREATE POLICY "sd_closer_metrics_select_all" ON sd_closer_metrics
  FOR SELECT TO authenticated USING (true);

-- Allow authenticated users to insert metrics
CREATE POLICY "sd_closer_metrics_insert_all" ON sd_closer_metrics
  FOR INSERT TO authenticated WITH CHECK (true);

-- Allow authenticated users to update metrics
CREATE POLICY "sd_closer_metrics_update_all" ON sd_closer_metrics
  FOR UPDATE TO authenticated USING (true);

-- Allow admin to delete metrics
CREATE POLICY "sd_closer_metrics_delete_admin" ON sd_closer_metrics
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  );

-- Create index for faster queries
CREATE INDEX idx_sd_closer_metrics_closer_id ON sd_closer_metrics(closer_id);
CREATE INDEX idx_sd_closer_metrics_year_month ON sd_closer_metrics(year, month);
