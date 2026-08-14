-- Migration: Set gustavojofelix@gmail.com as Admin
-- Description: Explicitly grants role = 'admin' to gustavojofelix@gmail.com in profiles table

UPDATE public.profiles
SET role = 'admin'
WHERE lower(email) = 'gustavojofelix@gmail.com';

-- Also ensure any user without role gets updated if needed
UPDATE public.profiles
SET role = 'admin'
WHERE role IS NULL;
