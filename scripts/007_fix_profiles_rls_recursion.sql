-- Fix infinite recursion in profiles RLS policies
-- Drop the problematic admin policy that causes recursion
DROP POLICY IF EXISTS "profiles_select_all_for_admin" ON profiles;

-- The admin policy was causing infinite recursion because it queried
-- the profiles table while trying to access the profiles table.
-- 
-- For admin operations (viewing all users), use the Supabase service role
-- in server-side code (API routes or server actions) instead of RLS policies.
-- 
-- The remaining policies allow users to manage only their own profile:
-- - profiles_select_own: Users can view their own profile
-- - profiles_insert_own: Users can create their own profile
-- - profiles_update_own: Users can update their own profile
-- - profiles_delete_own: Users can delete their own profile
