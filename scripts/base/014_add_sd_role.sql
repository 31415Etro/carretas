-- Add 'sd' role to the profiles table constraint
-- This allows users with SD (Systems Design) role to be created

-- Drop the old constraint
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Add the new constraint with 'sd' included
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check 
CHECK (role = ANY (ARRAY['admin'::text, 'sdr'::text, 'closer'::text, 'representative'::text, 'manager'::text, 'sd'::text, 'user'::text]));
