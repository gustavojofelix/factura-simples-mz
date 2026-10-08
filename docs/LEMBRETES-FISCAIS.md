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

O prazo legal é mantido mesmo quando calha num fim-de-semana (ex.: 31/01/2027
é um domingo). Nesse caso o texto do lembrete recomenda tratar do assunto até ao
último dia útil anterior. Os feriados não são considerados.

### Calendário dos lembretes

| Marco     | Quando                                | 1.º trim. | 2.º trim. | 3.º trim. | 4.º trim. (ano seguinte) | Gravidade |
|-----------|---------------------------------------|-----------|-----------|-----------|--------------------------|-----------|
| `qend`    | dia seguinte ao fim do trimestre      | 01/04     | 01/07     | 01/10     | 01/01                    | info      |
| `d15`     | 15 dias antes do prazo                | 15/04     | 16/07     | 16/10     | 16/01                    | info      |
| `d7`      | 7 dias antes do prazo                 | 23/04     | 24/07     | 24/10     | 24/01                    | aviso     |
| `d1`      | 1 dia antes do prazo                  | 29/04     | 30/07     | 30/10     | 30/01                    | crítico   |
| `d0`      | no próprio dia do prazo               | 30/04     | 31/07     | 31/10     | 31/01                    | crítico   |
| `overdue` | dia seguinte ao prazo (incumprimento) | 01/05     | 01/08     | 01/11     | 01/02                    | crítico   |

São até 6 emails por trimestre, todos às 08:15 de Maputo. Nenhum é enviado para
um trimestre que tenha a declaração `submetida` ou `paga`.

## Como funciona

1. **Geração (todos os dias às 06:00 UTC / 08:00 Maputo)**. O job pg_cron
   `lembretes-fiscais-diario` corre `generate_tax_reminders()`. Para cada empresa
   não suspensa:
   - **Fim do trimestre** → `qend` (info), no 1.º dia do trimestre seguinte.
   - **15, 7 e 1 dia antes do prazo** → lembretes `d15` (info), `d7` (aviso) e
     `d1` (crítico).
   - **No dia do prazo** → `d0` (crítico).
   - **Prazo ultrapassado** → aviso de incumprimento `overdue` (crítico), uma vez
     por trimestre, com o texto de multas e penalidades.
   - Se um dia de execução falhar, é emitido só o marco mais urgente já atingido
     (ex.: a 5 dias do prazo sem `d7`, emite `d7`).
   - Um trimestre conta como cumprido se tiver uma declaração em
     `tax_declarations` com estado `submetida` ou `paga`. Nesse caso:
     - não há lembretes;
     - os alertas abertos desse trimestre são marcados como resolvidos;
     - os emails desse trimestre ainda na fila são cancelados (`cancelled_at`).
   - Só se verificam os últimos 4 trimestres, e nunca trimestres anteriores ao
     trimestre de criação da empresa.
   - O cálculo está em `compute_tax_reminders(data, empresa)`, que **não escreve
     nada**. `generate_tax_reminders` usa-o e grava os marcos novos.
2. **Registo**. Cada lembrete fica em `tax_reminders`, com uma linha por
   empresa, ano, trimestre e tipo. É também copiado para `ai_alerts`:
   - regra `lembrete_fiscal`;
   - `dedupe_key` `lembrete_fiscal:AAAA:Tn:tipo`;
   - link para `/impostos`.
3. **Aplicação**. A página **Impostos** mostra o painel "Obrigações fiscais"
   com os últimos lembretes. O dono da empresa tem aí o botão **Enviar lembrete
   de teste para mim**.
4. **Email (06:15 UTC)**. O job `lembretes-fiscais-email` só existe se o pg_net
   estiver disponível. Chama a Edge Function `send-tax-reminders` em modo
   `run`, que:
   1. gera os lembretes do dia (idempotente);
   2. junta os lembretes ainda não enviados (`emailed_at` e `cancelled_at`
      nulos) numa **única mensagem por empresa**;
   3. envia essa mensagem para o email do dono da conta e para o email da
      empresa;
   4. marca `emailed_at`. Se o envio falhar, marca `email_error` e volta a
      tentar na execução seguinte.

   Se houver vários lembretes do mesmo trimestre na fila, só segue o mais
   urgente. Os outros ficam com `cancelled_at` ("Substituído por lembrete mais
   recente"). Cada envio fica registado em `email_log` (`kind = 'tax_reminder'`).

### Cancelamento (`cancelled_at`)

Um lembrete com `cancelled_at` preenchido não é enviado por email, mas continua
visível na página Impostos. O motivo fica em `email_error`:

| Motivo                                  | Quando                                                        |
|-----------------------------------------|---------------------------------------------------------------|
| `Cancelado: declaração submetida/paga`  | O trimestre foi regularizado antes do envio.                  |
| `Substituído por lembrete mais recente` | Havia na fila um lembrete mais urgente do mesmo trimestre.    |
| `Empresa suspensa`                      | A empresa foi suspensa antes do envio.                        |
| `Backlog inicial não enviado`           | Aviso com prazo anterior a 01/10/2026 (até ao 2.º trimestre de 2026). O motor insere-o já cancelado em qualquer execução (cron em falta, empresa reactivada, outro ambiente); o modo `run` cancela-o se o encontrar na fila; a migração 20261009130000 cancelou os que já existiam. |
| `Desactualizado: marco ultrapassado`    | Lembrete que ficou na fila (ex.: SMTP em falta) até se atingir um marco mais urgente — por exemplo um `d7` quando já falta 1 dia, ou um `d0` depois do prazo. O motor emite o marco actual. Um `d15`/`d7` ainda dentro da sua janela é enviado com o texto refeito para os dias que realmente faltam. |

### Texto dos lembretes e das penalidades

Os títulos e textos de todos os marcos estão numa única função SQL:
`public.tax_reminder_text(kind, ano, trimestre, prazo, dias)`.

O texto sobre multas e juros está em `public.tax_penalty_notice()`. **Deve ser
validado por um especialista fiscal** antes de entrar em produção. Para alterar
qualquer destes textos, basta um `CREATE OR REPLACE FUNCTION` numa nova
migração. Os lembretes já emitidos mantêm o texto antigo.

## Configuração

Segredos da Edge Function. Definem-se no Dashboard: Edge Functions → Secrets.
A CLI não consegue lê-los.

| Segredo                                            | Uso                                                       |
|----------------------------------------------------|-----------------------------------------------------------|
| `CRON_SECRET`                                      | Autentica o agendador (cabeçalho `x-cron-secret`)         |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Servidor de email                                         |
| `SMTP_FROM_EMAIL`                                  | Remetente (se omitido, usa `SMTP_USER`)                   |
| `SITE_URL`                                         | Opcional. Link na mensagem (por omissão `https://ispcfacil.co.mz`) |

Para o envio automático a partir da base de dados (pg_net), guarde no Vault o
URL do projecto e o mesmo valor de `CRON_SECRET`:

```sql
select vault.create_secret('https://<ref-do-projecto>.supabase.co', 'project_url');
select vault.create_secret('<valor de CRON_SECRET>', 'cron_secret');
```

Sem o Vault, a função `dispatch_tax_reminder_emails()` tenta as definições
`app.settings.supabase_url` e `app.settings.cron_secret`. Se o pg_net não
existir no projecto, agende externamente um `POST` diário para a função com o
corpo `{}` (ver o passo 3 do curl abaixo).

## Como testar

> **Atenção:** não use `generate_tax_reminders('<data>', ...)` com uma data
> simulada. Grava lembretes **reais** em `tax_reminders` e `ai_alerts`, e:
> - a execução seguinte das 06:15 UTC envia-os por email ao cliente;
> - impedem que os lembretes verdadeiros sejam emitidos.
>
> Para testar, use os modos `preview` e `test` da Edge Function, ou
> `compute_tax_reminders`. Nenhum deles escreve nada.

### Modos da Edge Function `send-tax-reminders`

| Modo      | Escreve? | Envia email?                        | `reference_date` | Quem pode chamar                              |
|-----------|----------|-------------------------------------|------------------|-----------------------------------------------|
| `run`     | sim      | sim, aos clientes                   | ignorada (hoje)  | agendador (`x-cron-secret`), admin            |
| `preview` | não      | não                                 | sim              | agendador, admin                              |
| `test`    | não      | só para `to` (nunca para o cliente) | sim              | agendador, admin; dono (só hoje, só para si)  |

Campos do corpo:

| Campo            | Significado |
|------------------|-------------|
| `mode`           | `run`, `preview` ou `test`. |
| `reference_date` | Data simulada, no formato AAAA-MM-DD. |
| `company_id`     | Id da empresa. |
| `to`             | Email que recebe o teste. Por omissão é o email do admin que chama; com `x-cron-secret` é obrigatório. |
| `sample`         | Por omissão `true`. Se nada estiver previsto nessa data, envia um lembrete de exemplo, para se poder verificar o SMTP. |
| `skip_generate`  | Só no modo `run`. |
| `dry_run`        | `dry_run: true` continua a funcionar e equivale a `mode: "preview"`. |

Todas as respostas trazem `smtp_configured` e `from`. `smtp_configured` é
`true` se `SMTP_HOST`, `SMTP_USER` e `SMTP_PASS` existirem. Quando falta o SMTP,
o modo `test` responde 200 com `ok: false` e `code: "SMTP_CONFIG_MISSING"`.

### Passo a passo (Back Office)

1. Entre como administrador → **Contribuintes** → abra os detalhes de uma
   empresa.
2. Na secção **Testar lembretes fiscais**, escolha a **Data simulada**. Use o
   calendário acima. Exemplos para o 3.º trimestre:
   - `2026-10-01` → `qend`
   - `2026-10-31` → `d0`
   - `2026-11-01` → `overdue`
3. **Pré-visualizar** não grava nada e mostra:
   - os lembretes que o motor emitiria nessa data, e se já foram emitidos;
   - os destinatários reais;
   - o estado do servidor de email;
   - o histórico de lembretes da empresa.
4. **Enviar lembrete de teste** envia uma mensagem `[TESTE]` com os lembretes
   que o modo `run` enviaria nessa data — os ainda não emitidos e com prazo a
   partir de 01/10/2026; os já emitidos e o backlog anterior só aparecem na
   resposta (`not_emailed`) — para o email em **Enviar para** (vazio = o seu email). O cliente
   não recebe nada e nada fica marcado como enviado. Se aparecer "Servidor de
   email NÃO configurado", configure os segredos SMTP (ver Configuração).

Na página **Impostos**, o dono da empresa tem o botão **Enviar lembrete de
teste para mim**. Usa a data de hoje, a sua empresa e o seu email, com um
máximo de 3 pedidos em 10 minutos.

### Passo a passo (curl)

Antes de começar, defina estas variáveis:
- `REF`: referência do projecto;
- `SECRET`: valor de `CRON_SECRET`;
- `COMPANY`: id da empresa. Obtenha-o com
  `select id, name, created_at from companies order by created_at;`.

1. Pré-visualizar o que seria emitido a 31/10/2026 (dia do prazo do 3.º
   trimestre), sem escrever nada:

   ```bash
   curl -X POST "https://$REF.supabase.co/functions/v1/send-tax-reminders" \
     -H "Content-Type: application/json" \
     -H "x-cron-secret: $SECRET" \
     -d "{\"mode\":\"preview\",\"company_id\":\"$COMPANY\",\"reference_date\":\"2026-10-31\"}"
   ```

   Sem `company_id`, mostra todas as empresas (até 200 linhas). A resposta tem:
   - `reminders`: com `kind`, `due_date`, `days_left`, `title` e `already_issued`;
   - `queued`: a fila real;
   - `history`;
   - `recipients`;
   - `smtp_configured`.

2. Enviar um teste para um endereço interno, simulando o fim do trimestre:

   ```bash
   curl -X POST "https://$REF.supabase.co/functions/v1/send-tax-reminders" \
     -H "Content-Type: application/json" \
     -H "x-cron-secret: $SECRET" \
     -d "{\"mode\":\"test\",\"company_id\":\"$COMPANY\",\"reference_date\":\"2026-10-01\",\"to\":\"info@ispcfacil.com\",\"sample\":true}"
   ```

   Quando o servidor SMTP aceita a mensagem, a resposta tem `ok: true` e
   `message_id`. `reminders` lista o que foi no email; `not_emailed` lista o
   que ficou de fora (`ja_emitido` ou `backlog_anterior_ao_corte`). Se nada
   ficar para enviar, segue o lembrete de exemplo (`sample_used: true`). Para ver cada marco, repita com estas datas:
   `2026-10-16`, `2026-10-24`, `2026-10-30`, `2026-10-31` e `2026-11-01`.
   O envio fica em `email_log` com `kind = 'tax_reminder_test'`.

3. Execução real. É o que o pg_cron faz todos os dias e **envia aos clientes**:

   ```bash
   curl -X POST "https://$REF.supabase.co/functions/v1/send-tax-reminders" \
     -H "Content-Type: application/json" \
     -H "x-cron-secret: $SECRET" \
     -d '{}'
   ```

### Pelo SQL Editor (só leitura)

```sql
-- O que o motor emitiria numa data, sem gravar nada
select kind, year, quarter, due_date, days_left, already_issued, title
  from compute_tax_reminders('2026-10-31'::date, '<company_id>');

-- Fila de email e histórico
select kind, year, quarter, due_date, created_at, emailed_at, cancelled_at, email_error
  from tax_reminders where company_id = '<company_id>' order by created_at desc;

-- Registo de envios
select created_at, kind, recipients, status, error
  from email_log where kind like 'tax_reminder%' order by created_at desc limit 20;
```

> A empresa de teste tem de cumprir duas condições para o trimestre testado:
> - ter sido criada **antes** dele (os trimestres anteriores à criação são
>   ignorados);
> - não ter uma declaração `submetida`/`paga` para ele.

Para testar o cumprimento:
1. Na página Impostos, marque como submetida a declaração do trimestre.
2. Pré-visualize de novo: o trimestre deixa de aparecer.
3. Na execução seguinte, os alertas abertos passam a `resolvida` e os emails
   desse trimestre na fila ficam cancelados.

### Diagnóstico em produção

```sql
select jobname, schedule, active from cron.job where jobname like 'lembretes-fiscais%';
select * from cron.job_run_details order by start_time desc limit 10;
select id, status_code, content from net._http_response order by created desc limit 5;
```

| Sintoma                                                  | Causa                                                     |
|----------------------------------------------------------|-----------------------------------------------------------|
| `dispatch_tax_reminder_emails()` devolve `NULL`          | Faltam no Vault os segredos `project_url` e/ou `cron_secret`. |
| `net._http_response` mostra `SMTP_CONFIG_MISSING`        | Faltam os segredos SMTP da Edge Function.                 |

### Limpar dados de teste antigos

Isto só é necessário se alguém usou `generate_tax_reminders` com datas
simuladas:

```sql
delete from tax_reminders where company_id = '<company_id>' and emailed_at is null;
delete from ai_alerts where company_id = '<company_id>' and dedupe_key like 'lembrete_fiscal:%';
```
