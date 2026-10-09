-- Add meeting_attendees column to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meeting_attendees JSONB DEFAULT '[]'::jsonb;

-- Add comment to describe the column
COMMENT ON COLUMN leads.meeting_attendees IS 'Array of email addresses for meeting attendees';
