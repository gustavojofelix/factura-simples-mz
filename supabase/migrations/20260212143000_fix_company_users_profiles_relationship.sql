-- Migration: Fix relationship between company_users and profiles
-- This enables PostgREST to perform automatic joins between these tables

-- 1. Add Foreign Key if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'company_users_user_id_fkey_profiles'
    ) THEN
        ALTER TABLE company_users 
        ADD CONSTRAINT company_users_user_id_fkey_profiles 
        FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 2. Add index for better join performance
CREATE INDEX IF NOT EXISTS idx_company_users_user_profile ON company_users(user_id);
