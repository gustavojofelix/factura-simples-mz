# Funções Edge — configuração necessária

As credenciais do servidor de correio deixaram de estar no código. Sem as
variáveis abaixo definidas no projecto Supabase, todas as funções que enviam
e-mail devolvem erro em vez de enviar.

## Variáveis de ambiente do servidor de correio

| Variável | Obrigatória | Descrição |
|---|---|---|
| `SMTP_HOST` | Sim | Servidor de correio, por exemplo `mail.ispcfacil.co.mz` |
| `SMTP_USER` | Sim | Conta de envio |
| `SMTP_PASS` | Sim | Palavra-passe da conta de envio |
| `SMTP_PORT` | Não | Porta. Assume 465 se não for definida. A ligação usa TLS quando a porta é 465 |
| `SMTP_FROM_EMAIL` | Não | Endereço no campo de remetente. Assume `SMTP_USER` se não for definida |
| `ADMIN_NOTIFICATION_EMAIL` | Não | Destino das notificações internas (LTS). Aceita vários endereços separados por vírgula, por exemplo `info@ispcfacil.com,financas@ispcfacil.com`. Assume `info@ispcfacil.com` |

Definir com a linha de comandos do Supabase:

```bash
supabase secrets set \
  SMTP_HOST=mail.ispcfacil.co.mz \
  SMTP_PORT=465 \
  SMTP_USER=notifications@ispcfacil.co.mz \
  SMTP_PASS='a-nova-palavra-passe' \
  SMTP_FROM_EMAIL=notifications@ispcfacil.co.mz \
  ADMIN_NOTIFICATION_EMAIL=info@ispcfacil.com
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são injectadas
automaticamente pela plataforma e não precisam de ser definidas.

## Funções afectadas

Estas lêem as variáveis acima e não enviam e-mail se elas faltarem:

- `send-invoice-email`
- `invite-user`
- `notify-admin`
- `sislog-webhook`
- `subscription-notify`
- `send-tax-reminders`

## Envio partilhado (`_shared/email.ts`)

`sislog-webhook`, `notify-admin` e `subscription-notify` usam o módulo
`_shared/email.ts` (importado com `../_shared/email.ts`; a CLI inclui a pasta
`_shared` no bundle de cada função). O `sendEmail` desse módulo:

- nunca lança excepção e devolve `{ ok, status, error }`;
- regista cada tentativa na tabela `public.email_log` com o estado `sent`,
  `failed` ou `skipped`;
- sem `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` regista `skipped` com o erro
  `SMTP_CONFIG_MISSING` e escreve `skipped: SMTP not configured` nos logs da
  função, em vez de falhar em silêncio.

Os administradores vêem `email_log` (RLS só para `profiles.role = 'admin'`).

## E-mails de subscrição

Quando um pagamento M-Pesa / e-Mola é concluído:

1. O cliente recebe "Subscrição Activada – Confirmação de Pagamento". Os
   destinatários são o dono da empresa, quem iniciou o pagamento
   (`subscription_payments.payer_email`) e o e-mail de notificações das
   Configurações do Sistema quando `enable_notifications` está activo. Os
   endereços repetidos são removidos.
2. A LTS (`ADMIN_NOTIFICATION_EMAIL`) recebe um e-mail interno separado, com
   empresa, NUIT, dono, plano, valor, referências Sislog e a origem
   (webhook ou confirmação manual).

O `sislog-webhook` responde 200 à Sislog de imediato e envia os e-mails em
segundo plano (`EdgeRuntime.waitUntil`). O envio é idempotente: as colunas
`client_notified_at` e `admin_notified_at` evitam duplicados quando a Sislog
repete o pedido, e um pedido repetido volta a tentar o que ainda não saiu.
Quando um pagamento falha na carteira, só a LTS recebe um aviso. Não há
e-mail no início do pagamento.

Na confirmação manual em Admin > Receitas, o painel chama `subscription-notify`
depois de activar a subscrição. No mesmo painel, o botão **Reenviar e-mails**
volta a enviar os dois e-mails de um pagamento concluído e mostra o histórico
de `email_log`. Esse botão serve também para testar a configuração SMTP.

Ordem de publicação: aplicar a migração
`20261009110000_email_notifications_log.sql` e depois publicar
`sislog-webhook`, `process-subscription-payment`, `notify-admin` e
`subscription-notify`. A migração **tem de estar aplicada antes** de publicar
`sislog-webhook`: sem as colunas `client_notified_at` / `admin_notified_at` o
webhook não consegue saber o que já foi enviado. Nesse caso, nas repetições da
Sislog não volta a enviar e-mails, para não haver duplicados.

## Mudança de palavra-passe

A palavra-passe anterior esteve em texto aberto no repositório e continua no
histórico do git. Retirá-la do código não a torna secreta. **Tem de ser mudada
no cPanel** e a nova definida apenas como segredo. Depois da mudança, convém
testar as quatro funções acima, e não só o envio de facturas.

## Ordem de publicação

Aplique primeiro a migração `20260929120000_create_document_settings.sql` e só
depois publique as funções. A função de envio lê a personalização da empresa e,
se a tabela ainda não existir, recorre aos valores por omissão em vez de falhar.
Ainda assim, publicar por esta ordem evita um período em que as empresas veriam
os textos genéricos.

## Marcadores dos textos de e-mail

Os textos configurados por cada empresa aceitam estes marcadores. Um marcador
desconhecido fica tal e qual no texto, em vez de desaparecer, para que um erro
de escrita seja visível.

| Marcador | Substituído por |
|---|---|
| `{{cliente}}` | Nome do cliente |
| `{{empresa}}` | Nome da empresa emissora |
| `{{numero_factura}}` | Número sequencial da factura |
| `{{numero_recibo}}` | Número do recibo |
| `{{total}}` | Valor total da factura |
| `{{valor_pago}}` | Valor pago |
| `{{valor_pendente}}` | Valor por pagar |
| `{{data}}` | Data do documento |
| `{{data_vencimento}}` | Data de vencimento |

O remetente é sempre o endereço da plataforma, com o nome da empresa no campo
visível. Enviar em nome do domínio de cada empresa faria as mensagens falhar a
autenticação do domínio e cair em spam. As respostas seguem para o endereço
configurado pela empresa.

## Credenciais ainda por tratar

`process-subscription-payment` continua a ter as credenciais da plataforma de
pagamentos escritas no código, nas constantes `SISLOG_USER` e `SISLOG_API_KEY`.
Não foram alteradas para não arriscar interromper os pagamentos, mas merecem o
mesmo tratamento num momento controlado.
