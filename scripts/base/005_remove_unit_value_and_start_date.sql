-- Remove unit_value and start_date columns from projects table

-- Drop start_date column if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'projects' AND column_name = 'start_date') THEN
    ALTER TABLE public.projects DROP COLUMN start_date;
  END IF;
END $$;

-- Drop unit_value column if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'projects' AND column_name = 'unit_value') THEN
    ALTER TABLE public.projects DROP COLUMN unit_value;
  END IF;
END $$;
