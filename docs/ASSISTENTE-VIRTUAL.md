# Assistente Virtual (IA)

Assistente conversacional do ISPC Fácil. Responde a perguntas sobre os dados da
empresa activa, a dúvidas fiscais sobre o ISPC e o Modelo 30, gera relatórios
exportáveis, alimenta a pesquisa inteligente e produz alertas automáticos.

Modelo: **Claude Opus 5** (`claude-opus-5`), via API da Anthropic, chamado
exclusivamente a partir de uma Edge Function. A chave nunca chega ao cliente.

---

## Arquitectura

```
Angular  ──►  Edge Function ai-assistant  ──►  API Anthropic (Claude Opus 5)
   │               │
   │               └──►  RPC em SQL (com o JWT do utilizador)  ──►  Postgres + RLS
   │
   └──►  RPC ai_search            (pesquisa literal, sem modelo)
   └──►  tabela ai_alerts         (alertas gerados em SQL)
```

### Porque o modelo não fala directamente com a base de dados

O modelo não escreve SQL. Invoca um conjunto fechado de dez funções
(`ai_invoice_stats`, `ai_top_products`, `ai_receivables`, …) definidas em
`20260920110100_create_ai_analytics_functions.sql`. Duas invariantes sustentam
esta escolha:

1. **`p_company_id` nunca vem do modelo.** É injectado pela Edge Function a
   partir da empresa do pedido autenticado. Texto malicioso numa nota de factura
   não consegue induzir o assistente a ler dados de outra empresa.
2. **As RPC correm com o JWT do utilizador, não com a service role.** O RLS
   continua activo e as funções revalidam o acesso. O assistente nunca lê o que
   o utilizador não poderia abrir na própria aplicação.

A service role é usada apenas para verificar quota e registar consumo.

### Regra fiscal

O assistente **não responde a matéria fiscal de memória**. O prompt obriga-o a
chamar `ai_search_knowledge` e a responder apenas com base nos artigos
publicados em `ai_knowledge_articles`. Um artigo com `status <> 'publicado'` não
é devolvido, o que dá ao backoffice um travão editorial sobre aquilo que a IA
afirma em matéria de imposto.

O conteúdo inicial foi redigido a partir das regras já codificadas na
aplicação (`tax.service.ts`, `calculate_ispc_split`, `calculateDueDate`), para
que a explicação do assistente e o cálculo do Modelo 30 nunca divirjam:
escalões 3% / 4% / 5% / 20%, serviços não liberais a 12% e liberais a 15%,
prazos a 30 de Abril, 31 de Julho, 31 de Outubro e 31 de Janeiro.

---

## Instalação

### 1. Migrações

```bash
npx supabase db push
```

Aplica, por esta ordem:

| Ficheiro | Conteúdo |
|---|---|
| `20260920110000_create_ai_assistant_core.sql` | Conversas, mensagens, consumo, quotas e entradas no catálogo de planos |
| `20260920110100_create_ai_analytics_functions.sql` | As dez funções analíticas e os índices de apoio |
| `20260920110200_create_ai_knowledge_base.sql` | Base de conhecimento fiscal com pesquisa em português e 8 artigos |
| `20260920110300_create_ai_smart_alerts.sql` | Motor de alertas e agendamento diário |

### 2. Segredos

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase secrets set CRON_SECRET="$(openssl rand -hex 32)"
```

`CRON_SECRET` só é necessário se o agendamento externo for usado (ver ponto 4).
`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são injectados
automaticamente.

### 3. Edge Functions

```bash
npx supabase functions deploy ai-assistant
npx supabase functions deploy ai-alerts
```

### 4. Alertas diários

A migração tenta agendar `generate_ai_alerts_all()` com `pg_cron` às 05:00 UTC.
Confirme:

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'gerar-alertas-ia-diario';
```

Se a extensão não estiver disponível no projecto, a migração emite um `NOTICE` e
não falha. Nesse caso agende externamente:

```bash
curl -X POST https://<ref>.supabase.co/functions/v1/ai-alerts \
     -H "x-cron-secret: $CRON_SECRET"
```

O utilizador pode sempre forçar o recálculo da sua empresa pelo botão de
actualizar no sino de alertas.

### 5. Frontend

Nada a configurar. Os componentes estão ligados ao layout principal e a rota
`/assistente` já existe.

---

## Planos e quotas

Os limites vivem no catálogo existente (`subscription_features` +
`subscription_plan_features`) e são editáveis no backoffice, em *Planos*.

| Funcionalidade | Código | Trial | Essencial | Profissional | Standard |
|---|---|---|---|---|---|
| Assistente Virtual | `ai_assistant` | sim | sim | sim | sim |
| Perguntas por mês | `max_ai_messages_month` | 30 | 100 | 500 | ilimitado |
| Alertas inteligentes | `ai_smart_alerts` | não | não | sim | sim |

A guarda é `ai_assert_quota()`, chamada pela Edge Function **antes** de gastar
qualquer token. Só as perguntas do utilizador contam: respostas e chamadas
internas de ferramentas não consomem quota, e um pedido que falhe antes de
chegar ao modelo não é cobrado.

---

## Custo

Cada interacção é registada em `ai_usage_events` com tokens e custo estimado.

```sql
SELECT c.name,
       count(*)                          AS perguntas,
       sum(e.input_tokens)               AS tokens_entrada,
       sum(e.output_tokens)              AS tokens_saida,
       round(sum(e.cost_usd)::numeric, 2) AS custo_usd
  FROM ai_usage_events e
  JOIN companies c ON c.id = e.company_id
 WHERE e.created_at >= date_trunc('month', now())
 GROUP BY c.name
 ORDER BY custo_usd DESC;
```

Duas decisões contêm o custo:

- **Cache de prompt.** O prompt de sistema é rigorosamente estável e tem o ponto
  de corte da cache; o contexto da empresa vem depois. O prefixo é partilhado por
  todos os subscritores, pelo que a taxa de acerto é alta. **Qualquer alteração a
  `SYSTEM_PROMPT` invalida a cache para toda a gente** — edite-o com essa
  consciência.
- **Effort.** O chat corre em `medium` e a pesquisa em `low`. O trabalho difícil
  está nas consultas SQL, não no raciocínio do modelo. Verifique
  `usage.cache_read_input_tokens` se o custo subir sem explicação.

---

## Editar a base de conhecimento fiscal

```sql
UPDATE ai_knowledge_articles
   SET body = '…', legal_reference = 'Lei n.º …'
 WHERE slug = 'quem-esta-sujeito-ao-ispc';
```

Para despublicar um artigo enquanto é revisto:

```sql
UPDATE ai_knowledge_articles SET status = 'revisao_pendente' WHERE slug = '…';
```

Artigos com `company_id` preenchido são FAQ privados de uma empresa e só
aparecem a essa empresa.

**O artigo `quem-esta-sujeito-ao-ispc` merece revisão jurídica antes da entrada
em produção.** Descreve o enquadramento em termos qualitativos e remete para a
Autoridade Tributária, deliberadamente sem afirmar o limite legal de volume de
negócios, que não é derivável do código da aplicação. Se a equipa tiver a
referência confirmada, acrescente-a ao corpo e ao `legal_reference`.

---

## Alertas

Seis regras, todas em SQL determinístico — nenhuma chama o modelo, porque correr
um LLM por empresa e por dia seria caro e daria resultados diferentes para os
mesmos dados:

| Regra | Dispara quando |
|---|---|
| `facturas_vencidas` | Existem facturas vencidas com valor por cobrar |
| `clientes_inactivos` | Clientes com 2+ compras sem facturar há mais de 90 dias |
| `prazo_fiscal` | Modelo 30 a vencer nos próximos 20 dias |
| `declaracao_atrasada` | Declaração por entregar depois da data limite |
| `queda_vendas` | Mês corrente 30% abaixo da média dos 3 anteriores (a partir do dia 15) |
| `limiar_ispc` | Facturação anual a 85% de um escalão de ISPC |

Cada alerta tem uma `dedupe_key` com o período, o que torna a execução diária
idempotente sem impedir que o alerta volte no período seguinte. Um alerta
dispensado pelo utilizador não regressa. `ai_resolve_stale_alerts()` fecha
automaticamente os alertas cujo motivo desapareceu.

---

## Limitações conhecidas

- **O SDK da Anthropic não está afixado numa versão.** `npm:@anthropic-ai/sdk`
  resolve a última. Afixe-a (`npm:@anthropic-ai/sdk@<versão>`) após o primeiro
  deploy bem sucedido, para que uma publicação futura do SDK não altere o
  comportamento sem aviso.
- **O parâmetro `fallbacks` é opcional em tempo de execução.** Se a conta ou a
  versão do SDK o rejeitarem, a função regista um aviso, desliga-o e repete o
  pedido sem ele. Uma recusa por política passa então a devolver uma mensagem ao
  utilizador em vez de ser reencaminhada para outro modelo.
- **O histórico é reenviado como texto.** As últimas 20 mensagens seguem sem os
  blocos de ferramentas, que ficam gravados apenas para auditoria. Numa conversa
  muito longa, o modelo perde o detalhe dos primeiros turnos.
- **O assistente é só de leitura.** Não cria nem altera facturas, clientes,
  produtos ou declarações.
- **`supabase/.env` contém um `GEMINI_API_KEY` sem utilização.** Nenhuma função
  o lê — `process-document` usa Google Cloud Vision para OCR. Vale a pena
  removê-lo ou confirmar que é intencional.
