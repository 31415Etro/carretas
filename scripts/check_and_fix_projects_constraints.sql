-- First, let's check what the current constraints are
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'public.projects'::regclass 
  AND contype = 'c';

-- Remove the problematic check constraints
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_category_check;
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_status_check;

-- Add new check constraints with the correct values that match what the app is using
ALTER TABLE public.projects 
ADD CONSTRAINT projects_category_check 
CHECK (category IN ('vendas', 'marketing', 'desenvolvimento', 'outros'));

ALTER TABLE public.projects 
ADD CONSTRAINT projects_status_check 
CHECK (status IN ('active', 'completed', 'on_hold', 'cancelled'));

-- Make category nullable since it's optional in the form
ALTER TABLE public.projects ALTER COLUMN category DROP NOT NULL;
