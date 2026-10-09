-- Add meeting_link column to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meeting_link TEXT;

-- Add comment to describe the column
COMMENT ON COLUMN leads.meeting_link IS 'Google Meet or other video conference link for the scheduled meeting';
