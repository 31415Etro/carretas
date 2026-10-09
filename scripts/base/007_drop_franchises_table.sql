-- Drop franchises table and related data

-- First, drop any foreign key constraints that reference franchises
-- (There shouldn't be any based on the schema, but let's be safe)

-- Drop the franchises table
DROP TABLE IF EXISTS public.franchises CASCADE;

-- Remove franchises references from any other tables if they exist
-- (This is a safety measure in case there are any lingering references)
