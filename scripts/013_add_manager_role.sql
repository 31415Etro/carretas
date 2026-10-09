-- Add manager role to the system

-- Add manager_id column to profiles table to track which manager a representative reports to
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_profiles_manager_id ON profiles(manager_id);

-- Update the role check constraint to include 'manager'
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check 
CHECK (role = ANY (ARRAY['admin'::text, 'sdr'::text, 'closer'::text, 'representative'::text, 'manager'::text, 'user'::text]));

-- Add comment for documentation
COMMENT ON COLUMN profiles.manager_id IS 'The manager that this user reports to (for representatives)';
