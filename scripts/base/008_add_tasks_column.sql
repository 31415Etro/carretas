-- Add tasks column to leads table to store task management data
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS tasks JSONB DEFAULT '[]'::jsonb;

-- Add index for better query performance on tasks
CREATE INDEX IF NOT EXISTS idx_leads_tasks ON leads USING GIN (tasks);

-- Add comment to document the column
COMMENT ON COLUMN leads.tasks IS 'Array of tasks associated with the lead, stored as JSONB with id, description, dueDate, completed, and createdAt fields';
