-- Complete schema fix for the CRM system
-- This migration aligns the database schema with the application code

-- =============================================================================
-- FIX LEADS TABLE - Add missing columns and rename existing ones
-- =============================================================================

-- Add missing columns to leads table
ALTER TABLE public.leads 
  ADD COLUMN IF NOT EXISTS sdr_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS deal_value NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS closed_date TIMESTAMPTZ;

-- Copy data from old columns to new columns (if they exist)
DO $$
BEGIN
  -- Copy assigned_sdr to sdr_id if the column exists
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'leads' AND column_name = 'assigned_sdr') THEN
    UPDATE public.leads SET sdr_id = assigned_sdr WHERE assigned_sdr IS NOT NULL;
    ALTER TABLE public.leads DROP COLUMN IF EXISTS assigned_sdr;
  END IF;
  
  -- Copy assigned_closer to closer_id if the column exists
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'leads' AND column_name = 'assigned_closer') THEN
    UPDATE public.leads SET closer_id = assigned_closer WHERE assigned_closer IS NOT NULL;
    ALTER TABLE public.leads DROP COLUMN IF EXISTS assigned_closer;
  END IF;
  
  -- Copy linkedin to linkedin_url if the column exists
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'leads' AND column_name = 'linkedin') THEN
    UPDATE public.leads SET linkedin_url = linkedin WHERE linkedin IS NOT NULL;
    ALTER TABLE public.leads DROP COLUMN IF EXISTS linkedin;
  END IF;
  
  -- Copy instagram to instagram_url if the column exists  
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'leads' AND column_name = 'instagram') THEN
    UPDATE public.leads SET instagram_url = instagram WHERE instagram IS NOT NULL;
    ALTER TABLE public.leads DROP COLUMN IF EXISTS instagram;
  END IF;
  
  -- Copy value to deal_value if the column exists
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'leads' AND column_name = 'value') THEN
    UPDATE public.leads SET deal_value = value WHERE value IS NOT NULL;
    ALTER TABLE public.leads DROP COLUMN IF EXISTS value;
  END IF;
  
  -- Copy sale_date to closed_date if the column exists
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'leads' AND column_name = 'sale_date') THEN
    UPDATE public.leads SET closed_date = sale_date WHERE sale_date IS NOT NULL;
    ALTER TABLE public.leads DROP COLUMN IF EXISTS sale_date;
  END IF;
  
  -- Rename next_follow_up to follow_up_date if needed
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'leads' AND column_name = 'next_follow_up') THEN
    ALTER TABLE public.leads RENAME COLUMN next_follow_up TO follow_up_date;
  END IF;
END $$;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_leads_sdr_id ON public.leads(sdr_id);
CREATE INDEX IF NOT EXISTS idx_leads_closer_id ON public.leads(closer_id);
CREATE INDEX IF NOT EXISTS idx_leads_closed_date ON public.leads(closed_date);

-- Drop old indexes if they exist
DROP INDEX IF EXISTS idx_leads_assigned_sdr;
DROP INDEX IF EXISTS idx_leads_assigned_closer;

-- =============================================================================
-- CREATE PROJECTS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  value_goal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  minimum_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  lead_goal INTEGER NOT NULL DEFAULT 0,
  closing_goal INTEGER NOT NULL DEFAULT 0,
  responsible_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for projects
CREATE INDEX IF NOT EXISTS idx_projects_name ON public.projects(name);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON public.projects(created_at);
CREATE INDEX IF NOT EXISTS idx_projects_responsible_id ON public.projects(responsible_id);

-- Enable RLS for projects
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Projects RLS Policies
DROP POLICY IF EXISTS "projects_select_authenticated" ON public.projects;
DROP POLICY IF EXISTS "projects_insert_authenticated" ON public.projects;
DROP POLICY IF EXISTS "projects_update_authenticated" ON public.projects;
DROP POLICY IF EXISTS "projects_delete_authenticated" ON public.projects;

CREATE POLICY "projects_select_authenticated"
  ON public.projects FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "projects_insert_authenticated"
  ON public.projects FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "projects_update_authenticated"
  ON public.projects FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "projects_delete_authenticated"
  ON public.projects FOR DELETE
  TO authenticated
  USING (true);

-- Create updated_at trigger for projects
CREATE OR REPLACE FUNCTION update_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projects_updated_at ON public.projects;
CREATE TRIGGER projects_updated_at
BEFORE UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION update_projects_updated_at();

-- =============================================================================
-- CREATE FRANCHISES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.franchises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for franchises
CREATE INDEX IF NOT EXISTS idx_franchises_name ON public.franchises(name);
CREATE INDEX IF NOT EXISTS idx_franchises_created_at ON public.franchises(created_at);

-- Enable RLS for franchises
ALTER TABLE public.franchises ENABLE ROW LEVEL SECURITY;

-- Franchises RLS Policies
DROP POLICY IF EXISTS "franchises_select_all" ON public.franchises;
DROP POLICY IF EXISTS "franchises_insert_admin" ON public.franchises;
DROP POLICY IF EXISTS "franchises_update_admin" ON public.franchises;
DROP POLICY IF EXISTS "franchises_delete_admin" ON public.franchises;

CREATE POLICY "franchises_select_all"
  ON public.franchises FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "franchises_insert_admin"
  ON public.franchises FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "franchises_update_admin"
  ON public.franchises FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "franchises_delete_admin"
  ON public.franchises FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- =============================================================================
-- CREATE INTERACTIONS TABLE (for activity tracking)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('call', 'email', 'meeting', 'note', 'whatsapp', 'other')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for interactions
CREATE INDEX IF NOT EXISTS idx_interactions_lead_id ON public.interactions(lead_id);
CREATE INDEX IF NOT EXISTS idx_interactions_user_id ON public.interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_interactions_created_at ON public.interactions(created_at);

-- Enable RLS for interactions
ALTER TABLE public.interactions ENABLE ROW LEVEL SECURITY;

-- Interactions RLS Policies
DROP POLICY IF EXISTS "interactions_select_all" ON public.interactions;
DROP POLICY IF EXISTS "interactions_insert_all" ON public.interactions;
DROP POLICY IF EXISTS "interactions_update_own" ON public.interactions;
DROP POLICY IF EXISTS "interactions_delete_own" ON public.interactions;

CREATE POLICY "interactions_select_all"
  ON public.interactions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "interactions_insert_all"
  ON public.interactions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "interactions_update_own"
  ON public.interactions FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "interactions_delete_own"
  ON public.interactions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- =============================================================================
-- UPDATE PROFILES POLICIES TO ALLOW ADMIN ACCESS
-- =============================================================================

-- Add policy for admins to update any profile
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
CREATE POLICY "profiles_update_admin"
  ON public.profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Add policy for admins to insert profiles
DROP POLICY IF EXISTS "profiles_insert_admin" ON public.profiles;
CREATE POLICY "profiles_insert_admin"
  ON public.profiles FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Add policy for admins to delete profiles
DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
CREATE POLICY "profiles_delete_admin"
  ON public.profiles FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
