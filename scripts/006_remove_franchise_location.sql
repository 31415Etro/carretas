-- Remove franchise_location column from projects table

-- Drop the column
ALTER TABLE public.projects DROP COLUMN IF EXISTS franchise_location;
