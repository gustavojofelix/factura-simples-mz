# Lembretes fiscais — Modelo 30 (ISPC)

O sistema avisa o contribuinte do ISPC da obrigação de entregar a Declaração
Modelo 30 e pagar o imposto de cada trimestre, e avisa de incumprimento quando o
prazo passa.

## Prazos

| Trimestre | Período   | Prazo de entrega e pagamento |
|-----------|-----------|------------------------------|
| 1.º       | Jan – Mar | 30 de Abril                  |
| 2.º       | Abr – Jun | 31 de Julho                  |
| 3.º       | Jul – Set | 31 de Outubro                |
| 4.º       | Out – Dez | 31 de Janeiro do ano seguinte|

## Como funciona

1. **Geração (todos os dias às 06:00 UTC / 08:00 Maputo)** — o job pg_cron
   `lembretes-fiscais-diario` corre `generate_tax_reminders()`. Para cada empresa
   não suspensa:
   - **15, 7 e 1 dia antes do prazo** → lembretes `d15` (info), `d7` (aviso) e
     `d1` (crítico). Se um dia de execução falhar, é emitido o marco mais urgente
     já atingido (ex.: a 5 dias do prazo sem `d7`, emite `d7`), e só esse.
   - **Prazo ultrapassado** → aviso de incumprimento `overdue` (crítico), uma vez
     por trimestre, com o texto de multas e penalidades.
   - Considera-se cumprido o trimestre que tenha uma declaração em
     `tax_declarations` com estado `submetida` ou `paga`. Nesse caso não há
     lembretes e os alertas abertos desse trimestre são marcados como resolvidos.
   - Só se verificam os últimos 4 trimestres e nunca trimestres anteriores ao
     trimestre de criação da empresa.
2. **Registo** — cada lembrete fica em `tax_reminders` (uma linha por empresa,
   ano, trimestre e tipo) e é copiado para `ai_alerts` (regra `lembrete_fiscal`,
   `dedupe_key` `lembrete_fiscal:AAAA:Tn:tipo`, link para `/impostos`).
3. **Aplicação** — a página **Impostos** mostra o painel "Obrigações fiscais"
   com os últimos lembretes.
4. **Email (06:15 UTC)** — o job `lembretes-fiscais-email` (só existe se o
   pg_net estiver disponível) chama a Edge Function `send-tax-reminders`, que
   gera os lembretes do dia (idempotente), envia **uma mensagem por empresa** com
   os lembretes ainda não enviados para o email do dono da conta e o email da
   empresa, e marca `emailed_at` (ou `email_error` em caso de falha; o envio é
   tentado de novo na execução seguinte).

### Texto das penalidades

O texto sobre multas e juros está numa única função SQL,
`public.tax_penalty_notice()`. **Deve ser validado por um especialista fiscal**
antes de entrar em produção. Para alterar, basta um `CREATE OR REPLACE FUNCTION`
numa nova migração; os lembretes já emitidos mantêm o texto antigo.

## Configuração

Segredos da Edge Function (`supabase secrets set ...`):

| Segredo                                | Uso                                                   |
|----------------------------------------|-------------------------------------------------------|
| `CRON_SECRET`                          | Autentica o pedido (cabeçalho `x-cron-secret`)        |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Servidor de email                         |
| `SMTP_FROM_EMAIL`                      | Remetente (se omitido, usa `SMTP_USER`)               |
| `SITE_URL`                             | Opcional; link na mensagem (por omissão `https://ispcfacil.co.mz`) |

Para o envio automático a partir da base de dados (pg_net), guarde no Vault o
URL do projecto e o mesmo valor de `CRON_SECRET`:

```sql
select vault.create_secret('https://<ref-do-projecto>.supabase.co', 'project_url');
select vault.create_secret('<valor de CRON_SECRET>', 'cron_secret');
```

Sem o Vault, a função `dispatch_tax_reminder_emails()` tenta as definições
`app.settings.supabase_url` e `app.settings.cron_secret`. Se o pg_net não
existir no projecto, agende externamente um `POST` diário para a função (ver
`curl` abaixo, sem `reference_date` nem `dry_run`).

Verificar os jobs:

```sql
select jobname, schedule, command, active from cron.job where jobname like 'lembretes-fiscais%';
select * from cron.job_run_details order by start_time desc limit 10;
```

## Como testar

`generate_tax_reminders` aceita uma data de referência e uma empresa, o que
permite simular qualquer dia sem esperar pelo calendário. Execute no SQL Editor
do Supabase (corre como `postgres`).

> A empresa de teste tem de ter sido criada **antes** do trimestre testado
> (trimestres anteriores à criação da empresa são ignorados) e não pode ter
> declaração `submetida`/`paga` para esse trimestre.

```sql
-- Escolher a empresa
select id, name, created_at from companies order by created_at;

-- 3.º trimestre de 2026 (prazo 31/10/2026)
select generate_tax_reminders('2026-10-16'::date, '<company_id>');  -- 15 dias → d15
select generate_tax_reminders('2026-10-24'::date, '<company_id>');  --  7 dias → d7
select generate_tax_reminders('2026-10-30'::date, '<company_id>');  --  1 dia  → d1
select generate_tax_reminders('2026-11-01'::date, '<company_id>');  -- prazo passou → overdue

-- Se a empresa foi criada no 4.º trimestre de 2026, use o prazo de 31/01/2027:
-- '2027-01-16' (d15), '2027-01-24' (d7), '2027-01-30' (d1), '2027-02-01' (overdue)

-- Ver o resultado
select kind, year, quarter, due_date, title, body, created_at, emailed_at, email_error
  from tax_reminders where company_id = '<company_id>' order by created_at;

select rule_code, severity, status, dedupe_key, title
  from ai_alerts where company_id = '<company_id>' and dedupe_key like 'lembrete_fiscal:%'
  order by created_at;
```

Cada chamada devolve o número de lembretes novos; repetir a mesma data devolve
`0` (idempotente). Depois, abra **Impostos** na aplicação para ver o painel
"Obrigações fiscais".

Testar o cumprimento: crie e marque como submetida a declaração do trimestre na
página Impostos e volte a correr a geração — não surgem novos lembretes e os
alertas abertos do trimestre passam a `resolvida`.

### Testar o email

Simulação (gera os lembretes mas não envia nem marca nada; a resposta mostra
destinatários e títulos dos lembretes):

```bash
curl -X POST "https://<ref-do-projecto>.supabase.co/functions/v1/send-tax-reminders" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: <CRON_SECRET>" \
  -d '{"reference_date":"2026-10-16","company_id":"<company_id>","dry_run":true}'
```

Envio real: o mesmo pedido sem `"dry_run":true`. Para enviar só o que já existe
na fila, sem gerar, acrescente `"skip_generate":true`. Para forçar um novo envio
de um lembrete já enviado:

```sql
update tax_reminders set emailed_at = null, email_error = null where company_id = '<company_id>';
```

### Limpar os dados de teste

```sql
delete from tax_reminders where company_id = '<company_id>';
delete from ai_alerts where company_id = '<company_id>' and dedupe_key like 'lembrete_fiscal:%';
```
