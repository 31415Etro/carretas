-- Add page_permissions column to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS page_permissions text[] DEFAULT '{}';

-- Add comment to explain the column
COMMENT ON COLUMN profiles.page_permissions IS 'Array of page permissions for the user';
