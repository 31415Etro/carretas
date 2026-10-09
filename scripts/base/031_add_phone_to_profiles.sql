-- Add phone column to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

-- Add comment to column
COMMENT ON COLUMN profiles.phone IS 'User phone number';
