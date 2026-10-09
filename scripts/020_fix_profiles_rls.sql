-- Fix Row Level Security policy for profiles table
-- Allow all authenticated users to view all profiles (needed for user selection dropdowns)

-- Drop the restrictive policy
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;

-- Create a new policy that allows all authenticated users to view all profiles
CREATE POLICY "profiles_select_all_authenticated" ON profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- Keep the existing insert and update policies that restrict to own profile
-- (These should already exist and are correct)
