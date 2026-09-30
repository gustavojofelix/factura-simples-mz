/*
  # Corpo das mensagens de e-mail com formatação

  Os corpos das mensagens da factura, do recibo e do extracto passam a ser
  escritos num editor com formatação (negrito, listas, ligações) e guardados
  como HTML. As etiquetas ocupam espaço, por isso o tecto sobe de 2000 para
  5000 caracteres.

  Os textos antigos, sem etiquetas, continuam válidos: a função de envio
  trata-os como texto simples, tal como antes.
*/

DO $$
DECLARE
  constraint_name text;
BEGIN
  -- As restrições foram criadas sem nome explícito; procura-as pela coluna.
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.document_settings'::regclass
      AND con.contype = 'c'
      AND att.attname IN ('email_body', 'receipt_email_body', 'statement_email_body')
  LOOP
    EXECUTE format('ALTER TABLE public.document_settings DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.document_settings
  ADD CONSTRAINT document_settings_email_body_length
    CHECK (char_length(email_body) <= 5000),
  ADD CONSTRAINT document_settings_receipt_email_body_length
    CHECK (char_length(receipt_email_body) <= 5000),
  ADD CONSTRAINT document_settings_statement_email_body_length
    CHECK (char_length(statement_email_body) <= 5000);
