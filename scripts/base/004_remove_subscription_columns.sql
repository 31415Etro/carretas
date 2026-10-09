-- Remove subscription-related columns from projects table

ALTER TABLE public.projects 
  DROP COLUMN IF EXISTS subscription_count,
  DROP COLUMN IF EXISTS pending_subscriptions,
  DROP COLUMN IF EXISTS expected_subscriptions;

-- Drop related indexes if they exist
DROP INDEX IF EXISTS idx_projects_subscription_count;
DROP INDEX IF EXISTS idx_projects_pending_subscriptions;
DROP INDEX IF EXISTS idx_projects_expected_subscriptions;
