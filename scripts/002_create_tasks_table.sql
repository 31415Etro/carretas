-- Create tasks table for lead task management
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

-- RLS Policies for tasks table
-- Users can view tasks for leads they have access to
CREATE POLICY "tasks_select_own"
ON tasks FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM leads
    WHERE leads.id = tasks.lead_id
  )
);

-- Users can insert tasks for leads they have access to
CREATE POLICY "tasks_insert_own"
ON tasks FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM leads
    WHERE leads.id = tasks.lead_id
  )
);

-- Users can update tasks for leads they have access to
CREATE POLICY "tasks_update_own"
ON tasks FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM leads
    WHERE leads.id = tasks.lead_id
  )
);

-- Users can delete tasks for leads they have access to
CREATE POLICY "tasks_delete_own"
ON tasks FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM leads
    WHERE leads.id = tasks.lead_id
  )
);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_updated_at
BEFORE UPDATE ON tasks
FOR EACH ROW
EXECUTE FUNCTION update_tasks_updated_at();
