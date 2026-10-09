-- Create tasks table for lead task management
-- Run this script to enable the tasks functionality

-- Drop existing table if needed (uncomment if you want to recreate)
-- DROP TABLE IF EXISTS tasks CASCADE;

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  due_date TIMESTAMP WITH TIME ZONE NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_tasks_lead_id ON tasks(lead_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);

-- Enable RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid errors on re-run)
DROP POLICY IF EXISTS "tasks_select_all" ON tasks;
DROP POLICY IF EXISTS "tasks_insert_all" ON tasks;
DROP POLICY IF EXISTS "tasks_update_all" ON tasks;
DROP POLICY IF EXISTS "tasks_delete_all" ON tasks;

-- RLS Policies for tasks table - allowing all authenticated users
CREATE POLICY "tasks_select_all"
ON tasks FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "tasks_insert_all"
ON tasks FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "tasks_update_all"
ON tasks FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "tasks_delete_all"
ON tasks FOR DELETE
TO authenticated
USING (true);

-- Create updated_at trigger function (if not exists)
CREATE OR REPLACE FUNCTION update_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;

-- Create trigger
CREATE TRIGGER tasks_updated_at
BEFORE UPDATE ON tasks
FOR EACH ROW
EXECUTE FUNCTION update_tasks_updated_at();

-- Grant permissions
GRANT ALL ON tasks TO authenticated;
GRANT ALL ON tasks TO service_role;
