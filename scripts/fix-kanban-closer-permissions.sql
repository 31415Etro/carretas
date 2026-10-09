-- Fix permissions for all users to include kanban_closer
-- This ensures all existing users have access to the Closer Board

-- Update all closer users to have kanban_closer permission
UPDATE profiles
SET permissions = ARRAY(
  SELECT DISTINCT unnest(
    COALESCE(permissions, ARRAY[]::text[]) || 
    ARRAY['kanban_closer']::text[]
  )
)
WHERE role = 'closer'
AND NOT ('kanban_closer' = ANY(COALESCE(permissions, ARRAY[]::text[])));

-- Update all admin users to have all permissions including kanban_closer
UPDATE profiles
SET permissions = ARRAY[
  'dashboard',
  'leads', 
  'kanban_sdr',
  'kanban_closer',
  'calendar',
  'projects',
  'franchises',
  'analytics',
  'users',
  'messages',
  'clients'
]::text[]
WHERE role = 'admin';

-- Verify the changes
SELECT 
  id,
  name,
  email,
  role,
  permissions
FROM profiles
WHERE role IN ('admin', 'closer')
ORDER BY role, name;
