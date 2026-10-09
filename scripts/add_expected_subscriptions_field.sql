-- Add expected_subscriptions column to projects table
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS expected_subscriptions INTEGER DEFAULT 0;

-- Add comment to describe the column
COMMENT ON COLUMN projects.expected_subscriptions IS 'Total de assinaturas previstas para o projeto';
