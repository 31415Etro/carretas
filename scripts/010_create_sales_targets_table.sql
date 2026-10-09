-- Create sales_targets table to track annual goals for each salesperson
-- This table stores revenue and quantity goals per user per year

CREATE TABLE IF NOT EXISTS public.sales_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  revenue_target NUMERIC(12, 2) DEFAULT 0,
  leads_target INTEGER DEFAULT 0,
  closed_deals_target INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  
  -- Ensure only one target per user per year
  UNIQUE(user_id, year)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sales_targets_user_id ON public.sales_targets(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_targets_year ON public.sales_targets(year);
CREATE INDEX IF NOT EXISTS idx_sales_targets_user_year ON public.sales_targets(user_id, year);

-- Enable RLS
ALTER TABLE public.sales_targets ENABLE ROW LEVEL SECURITY;

-- RLS Policies - allow authenticated users to view targets
DROP POLICY IF EXISTS "sales_targets_select_all" ON public.sales_targets;
CREATE POLICY "sales_targets_select_all"
  ON public.sales_targets FOR SELECT TO authenticated USING (true);

-- Only admins can insert/update/delete targets
DROP POLICY IF EXISTS "sales_targets_insert_admin" ON public.sales_targets;
CREATE POLICY "sales_targets_insert_admin"
  ON public.sales_targets FOR INSERT TO authenticated 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "sales_targets_update_admin" ON public.sales_targets;
CREATE POLICY "sales_targets_update_admin"
  ON public.sales_targets FOR UPDATE TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "sales_targets_delete_admin" ON public.sales_targets;
CREATE POLICY "sales_targets_delete_admin"
  ON public.sales_targets FOR DELETE TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Add comment for documentation
COMMENT ON TABLE public.sales_targets IS 'Annual sales targets for each salesperson including revenue, leads, and closed deals goals';
COMMENT ON COLUMN public.sales_targets.revenue_target IS 'Total revenue goal in BRL for the year';
COMMENT ON COLUMN public.sales_targets.leads_target IS 'Number of leads goal for the year';
COMMENT ON COLUMN public.sales_targets.closed_deals_target IS 'Number of closed deals goal for the year';
