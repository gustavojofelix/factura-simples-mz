-- Migration: Add role to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text DEFAULT 'user' CHECK (role IN ('user', 'admin'));

-- Update existing profiles to have 'user' role if null (though DEFAULT should handle it for new ones)
UPDATE public.profiles SET role = 'user' WHERE role IS NULL;

-- Ensure the trigger handles the role if needed (though it defaults to 'user' in the table definition)
-- No changes needed to handle_new_user() as it doesn't currently handle roles, which is fine for default.
