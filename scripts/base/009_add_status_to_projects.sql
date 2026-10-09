-- Add status column to projects table
-- Status will track the project lifecycle: active, completed, on_hold, cancelled

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'projects' AND column_name = 'status') THEN
    ALTER TABLE public.projects ADD COLUMN status TEXT DEFAULT 'active';
    
    -- Add comment explaining the column purpose
    COMMENT ON COLUMN public.projects.status IS 'Project status: active (projeto em andamento), completed (projeto concluído), on_hold (em espera), cancelled (cancelado)';
    
    -- Create index for better query performance
    CREATE INDEX idx_projects_status ON public.projects(status);
    
    RAISE NOTICE 'Column "status" added to projects table successfully';
  ELSE
    RAISE NOTICE 'Column "status" already exists in projects table';
  END IF;
END $$;
