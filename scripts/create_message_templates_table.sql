-- Create message_templates table
CREATE TABLE IF NOT EXISTS public.message_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('whatsapp', 'instagram', 'email', 'other')),
  variables TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

-- Users can only view their own templates
CREATE POLICY "Users can view own message templates" 
  ON public.message_templates 
  FOR SELECT 
  USING (auth.uid() = user_id);

-- Users can only insert their own templates
CREATE POLICY "Users can insert own message templates" 
  ON public.message_templates 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own templates
CREATE POLICY "Users can update own message templates" 
  ON public.message_templates 
  FOR UPDATE 
  USING (auth.uid() = user_id);

-- Users can only delete their own templates
CREATE POLICY "Users can delete own message templates" 
  ON public.message_templates 
  FOR DELETE 
  USING (auth.uid() = user_id);

-- Create index for faster queries
CREATE INDEX idx_message_templates_user_id ON public.message_templates(user_id);
