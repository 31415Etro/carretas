-- Create projects table for project management
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  value_goal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  minimum_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  lead_goal INTEGER NOT NULL DEFAULT 0,
  closing_goal INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);

-- Enable RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- RLS Policies for projects table
-- All authenticated users can view projects
CREATE POLICY "projects_select_authenticated"
ON projects FOR SELECT
TO authenticated
USING (true);

-- All authenticated users can insert projects
CREATE POLICY "projects_insert_authenticated"
ON projects FOR INSERT
TO authenticated
WITH CHECK (true);

-- All authenticated users can update projects
CREATE POLICY "projects_update_authenticated"
ON projects FOR UPDATE
TO authenticated
USING (true);

-- All authenticated users can delete projects
CREATE POLICY "projects_delete_authenticated"
ON projects FOR DELETE
TO authenticated
USING (true);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW
EXECUTE FUNCTION update_projects_updated_at();
