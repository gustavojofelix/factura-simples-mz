-- Língua da interface por utilizador (pt-MZ, en-GB, fr-FR).
-- NULL = ainda não escolhida: a app grava a língua actual no primeiro login.
-- Também usada para os e-mails enviados ao próprio utilizador (convites, subscrição).
-- Os documentos fiscais e os e-mails de facturas a clientes continuam em português.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS language text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_language_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_language_check
  CHECK (language IS NULL OR language IN ('pt-MZ', 'en-GB', 'fr-FR'));
