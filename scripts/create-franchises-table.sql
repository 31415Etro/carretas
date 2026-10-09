-- Create franchises table
CREATE TABLE IF NOT EXISTS public.franchises (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  created_by UUID REFERENCES public.profiles(id)
);

-- Add RLS policies
ALTER TABLE public.franchises ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view all franchises
CREATE POLICY "Users can view all franchises"
ON public.franchises
FOR SELECT
TO authenticated
USING (true);

-- Policy: Admins can insert franchises
CREATE POLICY "Admins can insert franchises"
ON public.franchises
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
);

-- Policy: Admins can update franchises
CREATE POLICY "Admins can update franchises"
ON public.franchises
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
);

-- Policy: Admins can delete franchises
CREATE POLICY "Admins can delete franchises"
ON public.franchises
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS franchises_name_idx ON public.franchises(name);
CREATE INDEX IF NOT EXISTS franchises_created_at_idx ON public.franchises(created_at);
