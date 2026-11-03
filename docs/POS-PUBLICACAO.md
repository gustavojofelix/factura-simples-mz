# POS ISPC Fácil — Publicação (Fases 1 a 4)

> Para a equipa que vai publicar. Âmbito e decisões: ver `POS-ANALISE.md`.

## 1. O que entra

| Fase | Base de dados | Aplicação |
|---|---|---|
| 1. Fundação fiscal | `20261103100000_sales_documents_foundation.sql` | Facturas numeradas no servidor; stock por RPC; SAF-T com FR/NC; "Consumidor final" escondido |
| 2. Configuração | `20261103110000_pos_configuration.sql` | Menu **Ponto de Venda** (Geral, Terminais, Funcionários, Mesas, Produtos, Vendas e caixas); backoffice: secção POS na empresa |
| 3. POS loja | `20261103120000_pos_sales.sql` | Terminal `/pos` ligado ao servidor: emparelhamento, PIN, caixa, FR, NC, anulação, M-Pesa/e-Mola simulados |
| 4. Restaurante | `20261103130000_pos_restaurant.sql` | Mesas em tempo real, cozinha/bar, anulação de linhas com gerente, conta dividida, empregado de mesa sem caixa |

Edge Function nova: `supabase/functions/pos-pair-terminal` (`verify_jwt = false`, já em `config.toml`).

## 2. Ordem de publicação

1. **Migrações** (pela ordem do nome). Todas são idempotentes.
2. **Edge Function**: `supabase functions deploy pos-pair-terminal`.
3. **Aplicação** (web e Capacitor). Tem de sair **logo a seguir às migrações**:
   - o número das facturas passa a ser dado pelo servidor;
   - a versão antiga da aplicação continuaria a incrementar `companies.invoice_number` depois de cada factura, o que salta um número por factura enquanto as duas versões coexistirem.
4. **Backoffice → Planos**: activar a funcionalidade **Ponto de Venda (POS)** nos planos superiores, com `max_invoices_month` sem limite (decisão D5). Opcional: `max_pos_terminals` e `max_pos_staff`. Pilotos: activar empresa a empresa em Contribuintes → detalhes → Ponto de Venda.

## 3. Verificações depois de publicar

- A migração 1 só cria o índice único `invoices_company_number_key` se não houver números de factura repetidos. Se houver, fica um `WARNING` no log da migração: rever os duplicados e criar o índice à mão.
- Emitir uma factura normal na aplicação e confirmar que o número segue a sequência (FAC000NN).
- Emparelhar um terminal de teste e fazer uma venda: deve aparecer em Facturas como `FR 2026/00001`, paga.

## 4. Pontos em aberto

| Ponto | Situação |
|---|---|
| Texto da menção de isenção de IVA no talão | "IVA não liquidado: contribuinte sujeito ao ISPC", **a validar com o consultor fiscal** (`pos-print.ts`, `TAX_NOTE`) |
| M-Pesa / e-Mola | **Simulados** (decisão da fase de testes). As FR saem como pagas e o talão marca "simulação". A integração Sislog troca o `provider` em `pos_payment_requests`, sem mudar o ecrã |
| Chave Sislog no código | Continua em `process-subscription-payment/index.ts`. Rodar e passar para secrets **antes** de a usar no POS |
| Taxa de serviço | Não implementada (assumido como a gorjeta: não há) |
| Stock no POS | Pode ficar negativo (a venda já aconteceu). Na aplicação mantém-se a regra antiga |
| Fecho de caixa com vários terminais | O fecho é bloqueado se houver **qualquer** mesa aberta na empresa (um estabelecimento por empresa) |
| Adiado | ABS/app nativa (impressão silenciosa, gaveta), offline, multi-estabelecimento |
| Diferenças encontradas no ambiente local (fora do POS) | `profiles.last_sign_in_at` existe em produção mas não está em nenhuma migração. A lista de empresas do admin faz `.find` em `subscriptions`, mas a restrição `unique_company_subscription` devolve um objecto, não uma lista |
