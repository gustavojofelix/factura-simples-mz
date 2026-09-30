/*
  # Mensagem de e-mail do extracto de conta

  Assunto e texto do e-mail enviado com o extracto de um cliente, editáveis
  em Configurações → Documentos, tal como os da factura e do recibo.

  Marcadores disponíveis: {{cliente}}, {{empresa}}, {{periodo}},
  {{data_inicio}}, {{data_fim}}, {{saldo_anterior}}, {{total_facturado}},
  {{total_pago}}, {{saldo}}.
*/

ALTER TABLE public.document_settings
  ADD COLUMN IF NOT EXISTS statement_email_subject text NOT NULL
    DEFAULT 'Extracto de conta {{periodo}} - {{empresa}}'
    CHECK (char_length(statement_email_subject) <= 200),
  ADD COLUMN IF NOT EXISTS statement_email_body text NOT NULL
    DEFAULT 'Segue em anexo o extracto da sua conta referente ao período {{periodo}}. O saldo em dívida à data final é de {{saldo}}.'
    CHECK (char_length(statement_email_body) <= 2000);
