-- Migration: Add representative role to user_role enum
-- Description: Extends the user_role enum type to include 'representative' as a new role option
-- Author: System
-- Date: 2025-12-18

DO $$ 
BEGIN
    -- Check if the enum value already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'representative' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
    ) THEN
        -- Add 'representative' to the user_role enum
        ALTER TYPE user_role ADD VALUE 'representative';
        
        RAISE NOTICE 'Successfully added representative role to user_role enum';
    ELSE
        RAISE NOTICE 'Representative role already exists in user_role enum';
    END IF;
END $$;

-- Verify the enum values
DO $$
DECLARE
    enum_values text;
BEGIN
    SELECT string_agg(enumlabel, ', ' ORDER BY enumsortorder)
    INTO enum_values
    FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role');
    
    RAISE NOTICE 'Current user_role enum values: %', enum_values;
END $$;

-- Comment explaining the representative role
COMMENT ON TYPE user_role IS 'User roles: admin (full access), sdr (sales development), closer (deal closing), representative (sales representative)';
