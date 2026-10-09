-- Initial schema setup for the CRM system
-- This script creates all the base tables needed for the application

-- =============================================================================
-- CREATE PROFILES TABLE (Users)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'sdr', 'closer', 'user')),
  page_permissions TEXT[] DEFAULT '{}',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for profiles
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_active ON public.profiles(active);

-- Enable RLS for profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- CREATE LEADS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,
  cpf_cnpj TEXT,
  location TEXT,
  next_follow_up TIMESTAMPTZ,
  meeting_date TIMESTAMPTZ,
  meeting_link TEXT,
  meeting_attendees TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'em_atendimento' CHECK (
    status IN (
      'em_atendimento', 'follow_up', 'reuniao_agendada', 'reuniao_remarcada',
      'nao_realizada', 'sem_atendimento', 'outbound', 'reuniao_realizada',
      'em_negociacao', 'fechado', 'perdido', 'reuniao_marcada', 'no_show'
    )
  ),
  assigned_sdr UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_closer UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  project_id UUID,
  linkedin TEXT,
  instagram TEXT,
  value NUMERIC(12, 2),
  sale_date TIMESTAMPTZ,
  notes TEXT,
  referred_by UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  tasks JSONB DEFAULT '[]'::jsonb,
  franchise_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for leads
CREATE INDEX IF NOT EXISTS idx_leads_assigned_sdr ON public.leads(assigned_sdr);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_closer ON public.leads(assigned_closer);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_location ON public.leads(location);
CREATE INDEX IF NOT EXISTS idx_leads_referred_by ON public.leads(referred_by);
CREATE INDEX IF NOT EXISTS idx_leads_project_id ON public.leads(project_id);
CREATE INDEX IF NOT EXISTS idx_leads_franchise_id ON public.leads(franchise_id);
CREATE INDEX IF NOT EXISTS idx_leads_tasks ON public.leads USING GIN (tasks);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads(created_at);

-- Enable RLS for leads
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- PROFILES RLS POLICIES
-- =============================================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_all_for_admin" ON public.profiles;

-- Allow users to view their own profile
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Allow users to insert their own profile
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Allow users to update their own profile
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Allow users to delete their own profile
CREATE POLICY "profiles_delete_own"
  ON public.profiles FOR DELETE
  USING (auth.uid() = id);

-- Allow admins to view all profiles
CREATE POLICY "profiles_select_all_for_admin"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- =============================================================================
-- LEADS RLS POLICIES
-- =============================================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "leads_select_all" ON public.leads;
DROP POLICY IF EXISTS "leads_insert_all" ON public.leads;
DROP POLICY IF EXISTS "leads_update_all" ON public.leads;
DROP POLICY IF EXISTS "leads_delete_admin" ON public.leads;

-- All authenticated users can view leads
CREATE POLICY "leads_select_all"
  ON public.leads FOR SELECT
  TO authenticated
  USING (true);

-- All authenticated users can insert leads
CREATE POLICY "leads_insert_all"
  ON public.leads FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- All authenticated users can update leads
CREATE POLICY "leads_update_all"
  ON public.leads FOR UPDATE
  TO authenticated
  USING (true);

-- Only admins can delete leads
CREATE POLICY "leads_delete_admin"
  ON public.leads FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- =============================================================================
-- CREATE TRIGGERS
-- =============================================================================

-- Create function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'user'),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger for new user creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Create updated_at trigger for profiles
CREATE OR REPLACE FUNCTION update_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION update_profiles_updated_at();

-- Create updated_at trigger for leads
CREATE OR REPLACE FUNCTION update_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_updated_at ON public.leads;
CREATE TRIGGER leads_updated_at
BEFORE UPDATE ON public.leads
FOR EACH ROW
EXECUTE FUNCTION update_leads_updated_at();
