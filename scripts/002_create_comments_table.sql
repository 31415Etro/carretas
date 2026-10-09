-- Create comments table for lead comments
CREATE TABLE IF NOT EXISTS public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_comments_lead_id ON public.comments(lead_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON public.comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON public.comments(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before creating new ones to make script idempotent
DROP POLICY IF EXISTS comments_select_policy ON public.comments;
DROP POLICY IF EXISTS comments_insert_policy ON public.comments;
DROP POLICY IF EXISTS comments_update_policy ON public.comments;
DROP POLICY IF EXISTS comments_delete_policy ON public.comments;

-- RLS Policies for comments table
-- Users can view all comments on leads they have access to
CREATE POLICY comments_select_policy
ON public.comments FOR SELECT
USING (true); -- Allow all authenticated users to read comments

-- Users can insert their own comments
CREATE POLICY comments_insert_policy
ON public.comments FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own comments
CREATE POLICY comments_update_policy
ON public.comments FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Users can delete their own comments
CREATE POLICY comments_delete_policy
ON public.comments FOR DELETE
USING (auth.uid() = user_id);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_comments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS comments_updated_at ON public.comments;
CREATE TRIGGER comments_updated_at
BEFORE UPDATE ON public.comments
FOR EACH ROW
EXECUTE FUNCTION update_comments_updated_at();
