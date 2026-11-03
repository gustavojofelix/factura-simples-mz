# POS ISPC Fácil — Análise final (âmbito decidido)

> Estado: **para revisão antes da implementação**. Data: 03/11/2026. Versão 2: substitui a análise geral anterior.

---

## 1. Decisões tomadas

| # | Decisão | Consequência directa |
|---|---|---|
| D1 | **Só empresas ISPC**: talão sem IVA | Sem motor de IVA. Preço = valor final. Talão com menção de isenção. |
| D2 | **Sempre FR (factura-recibo)**; sem NUIT → "Consumidor final" | Um único tipo de documento de venda no POS. Não há VD. |
| D3 | **Sem gorjeta** | (Assumido: também **sem taxa de serviço**.) O total do documento = volume de negócios do ISPC. |
| D4 | **Pagamento móvel pendente**: a venda só é emitida depois da confirmação | Por agora **simulada**. Estrutura pronta para a **Sislog** (futuro). |
| D5 | **POS só nos planos superiores**, todos **sem limite de facturas** | Nova funcionalidade `pos` no catálogo; `max_invoices_month` = ilimitado nesses planos. |
| D6 | **Tolerância na expiração** da subscrição para o POS | É preciso uma excepção no `enforce_active_subscription` (número de dias por decidir, ver 11). |
| D7 | **1 estabelecimento = 1 empresa (NUIT)** | O tipo de negócio (loja ou restaurante) é uma definição da empresa. Não há tabela de estabelecimentos. |
| Adiado | ABS (app nativa, impressão silenciosa, gaveta), offline, multi-estabelecimento | Nesta fase o POS é **web/PWA, só online**. |

---

## 2. Revisão sincera da recomendação de arquitectura

Na análise anterior recomendei um **produto separado** com plataforma partilhada. O argumento principal era o **mercado de empresas com IVA**. Com a **D1 (só ISPC)** esse argumento desaparece, por isso mudo a recomendação:

**Recomendo agora construir o POS dentro do ISPC Fácil**: mesmo repositório, mesma base de dados, mesmas tabelas fiscais. O POS fica como **uma app à parte para o utilizador final** (`<conta>.ispcfacil.com/pos`, sem o menu da aplicação).

Porquê:
- **Um único sítio para o ISPC.** As FR do POS entram em `invoices` e o cálculo do ISPC, o Modelo 30, o SAF-T, os relatórios e o extracto do cliente passam a incluí-las **sem sincronização** entre sistemas.
- **Não há IVA para complicar** o modelo fiscal do ISPC Fácil. A filosofia "simplificar o ISPC" mantém-se: o POS é só mais uma forma de emitir FR.
- Reaproveita login, contas, subscrições, backoffice, clientes, produtos, auditoria e i18n. **Menos de metade do trabalho** do que um produto separado.
- Com o offline e o ABS adiados, não há agora nenhum requisito técnico que obrigue a separar.

O que se perde (sinceramente):
- Se no futuro quiserem vender o POS a empresas com IVA, será preciso separar o motor fiscal. Para não fechar essa porta: o código do POS fica numa pasta própria (`pages/pos`, `core/pos/*`), as tabelas novas têm prefixo `pos_` e os cálculos ficam em RPCs isoladas.
- O POS herda a dívida técnica actual das facturas (numeração no browser, estado calculado no cliente). **Tem de ser corrigida antes**, e as Facturas também beneficiam (secção 4).

---

## 3. Visão geral da solução

```
Backoffice LTS (/admin)          Aplicação da empresa (/#/...)          Terminal POS (/pos)
─────────────────────────        ─────────────────────────────        ──────────────────────
Feature "pos" nos planos  ──►    Menu "Ponto de Venda"          ──►   Login do terminal
Tolerância de expiração          · Configuração POS                   PIN do operador
Override por empresa             · Funcionários e PIN                 Abrir/fechar caixa
Vista de empresas com POS        · Mesas e zonas (restaurante)        Venda → FR
                                 · Produtos/categorias no POS          Pagamentos (simulados)
                                 · Caixas e relatórios                Mesas / cozinha
                                 Facturas, ISPC, SAF-T, Painel ◄──── FR e NC na mesma tabela
```

---

## 4. Fundação fiscal (pré-requisito, beneficia também as Facturas)

### 4.1 Tipo de documento

- `invoices.document_type`: `FT` (actual), `FR` (POS e, opcionalmente, aplicação), `NC` (devoluções).
- `invoices.origin`: `app` | `pos`.
- As facturas existentes recebem `FT` por migração.

### 4.2 Numeração atómica no servidor

- **Problema actual:** `invoice.service.ts:273-325` lê o contador, insere e só depois incrementa, tudo no browser. Dois utilizadores ao mesmo tempo podem gerar o mesmo número. Com o POS (vários operadores a facturar em simultâneo) isto **vai** acontecer.
- **Solução:** tabela `document_series(company_id, document_type, year, prefix, next_number)` e um trigger BEFORE INSERT com bloqueio de linha, igual ao que já existe para os recibos (`assign_receipt_number`).
- Formato sugerido: `FR 2026/00001`, `NC 2026/00001`. As FT mantêm o prefixo actual da empresa.
- Os rascunhos continuam sem número.

### 4.3 FR = factura + pagamento num só acto

O modelo actual separa a factura (pendente) do recibo (`payments` com `receipt_number`). Para a FR:
- O documento nasce com `status = 'paga'` e com **1..N linhas em `payments`** (pagamento misto).
- Os pagamentos de uma FR **não geram número de recibo (REC)**: o próprio documento é o recibo. O trigger `assign_receipt_number` tem de ignorar pagamentos de documentos `FR`.
- **Tudo numa transacção, por RPC** (`pos_issue_fr`): valida o caixa aberto, o operador, os preços e o total no servidor, insere o documento, as linhas e os pagamentos, e baixa o stock. **O cliente nunca envia totais em que o servidor confie.**
- Hoje o estado das facturas é calculado e gravado de volta pelo browser (`invoice.service.ts:109-147`). Nas FR o estado é fixo (`paga`) e não deve ser recalculado.

### 4.4 Consumidor final

- `invoices.client_id` é `NOT NULL`. Cria-se **um cliente técnico por empresa** (`clients.is_walk_in = true`, nome "Consumidor final", NUIT vazio), criado automaticamente e escondido das listas e do limite `max_clients`.
- FR com NUIT: escolher um cliente existente ou **criar rapidamente no POS** (nome + NUIT com validação e detecção de duplicados).
- O SAF-T já substitui os clientes sem NUIT por `999999999 / Consumidor final`, por isso não muda.

### 4.5 Linhas e desconto

- Sem IVA (D1), mas falta o **desconto**: `invoice_items.discount` e `invoices.discount_total`.
- `invoice_items.unit_cost` (opcional) para a margem nos relatórios.
- Quantidades decimais (produtos ao kg). Hoje a demo arredonda para inteiro.

### 4.6 Stock atómico

- Hoje o stock é alterado no browser, sem transacção (`invoice.service.ts:685-713`).
- Proposta: tabela `stock_movements` e baixa **dentro da RPC de emissão**. Regra a decidir: permitir stock negativo (recomendo, com alerta) ou bloquear a venda.
- Melhor ainda: passar as Facturas a usar a mesma lógica.

### 4.7 Devoluções e anulações (ponto importante)

- A regra actual `prevent_invalid_invoice_annulment` **impede anular uma factura que tenha pagamentos**. Como uma FR nasce sempre paga, **o POS nunca conseguiria anular uma FR** com a regra de hoje.
- Proposta:
  - **Anular FR** (erro na hora): só no **mesmo dia e caixa aberto**, com PIN de gerente e motivo. Anula o documento e os pagamentos e repõe o stock, numa RPC. Ajustar o trigger para permitir este caso nas FR.
  - **Devolução depois disso** (ou noutro dia): **NC** que referencia a FR, parcial ou total, com motivo e PIN de gerente.
  - Trimestre fechado: só NC (a regra actual mantém-se).
- Corrigir os erros da demo: anular uma venda com devolução repõe o stock duas vezes, e é possível anular uma NC.

### 4.8 Integração com o ISPC

| Situação | Efeito na base do ISPC |
|---|---|
| FR emitida | **Soma** pela data do documento. Já acontece automaticamente, porque o cálculo soma `invoices.total` com estado diferente de rascunho e anulada. |
| FR anulada (mesmo dia) | Não conta (estado `anulada`), igual às facturas. |
| NC | **Subtrai** na data da NC (pode ser noutro trimestre). **Exige alterar** `calculate_ispc_for_period` **e** o cálculo de `tax.service.ts:129-165`, mantendo-os iguais (o código compara os dois). |
| Pagamentos da FR | **Não contam** (o recibo não é volume de negócios). |

Também:
- `reports.component.ts` e o Painel somam `invoices` sem conhecer as NC. Uma NC tem de **subtrair**, ou ser gravada com valores negativos (escolher uma convenção e aplicá-la em todo o lado).
- Ecrã de Impostos: mostrar o volume do trimestre dividido em "Facturas" e "POS".
- Modelo 30: sem alteração de formato.

### 4.9 Talão (sem IVA)

- Retirar o IVA de todo o POS (demo: `pos.service.ts:250-265`, talões e Z).
- Menção no rodapé, **a validar com o consultor**: por exemplo "IVA: não liquidado — contribuinte sujeito ao ISPC".
- Menções obrigatórias: nome e NUIT da empresa, morada, número e data da FR, cliente e NUIT (ou "Consumidor final"), linhas, total, métodos de pagamento, operador, "Processado por computador — ISPC Fácil".

### 4.10 SAF-T

- `InvoiceType` FR e NC (hoje tudo é FT; a NC já está prevista em `saft.service.ts:53`).
- NC com `References` à FR de origem.
- Mapear os métodos `mpesa` e `emola`.

---

## 5. Acesso e utilizadores

### 5.1 Como entra o terminal (sem ABS, só web por agora)

Problema: se o terminal ficar com a sessão de um dono ou gerente, qualquer caixa pode abrir `/#/painel` e ver tudo.

**Proposta, "utilizador de terminal":**
1. Na aplicação da empresa, o dono cria um **Terminal** ("Caixa 1").
2. O sistema gera um **código ou QR de emparelhamento** de uso único e válido por poucos minutos.
3. No dispositivo, em `/pos`, introduz-se o código. Uma Edge Function cria uma **sessão Supabase de um utilizador técnico do terminal**, com o papel `pos_terminal` no JWT.
4. Esse utilizador **só** tem acesso às RPCs e tabelas do POS da sua empresa. As rotas da aplicação rejeitam este papel.
5. O dono pode **revogar** o terminal.

> Alternativa mais rápida (MVP): o gerente faz login normal em `/pos` e a app fica presa ao POS. É mais simples, mas o token do gerente fica no dispositivo, por isso **não recomendo** para produção.

### 5.2 Operadores (funcionários POS)

- Tabela `pos_staff`: nome, PIN (hash bcrypt), papel, permissões, cor, activo, tentativas falhadas e bloqueio, e `user_id` opcional (ligação a um utilizador da aplicação).
- Os caixas e empregados de mesa **não precisam de email**.
- Verificação do PIN **no servidor** (RPC), com bloqueio após 5 tentativas.
- Limite: como os planos com POS são superiores, propõe-se `max_pos_staff` e `max_pos_terminals` no catálogo (podem ser ilimitados, mas deixam o controlo ao backoffice).

### 5.3 Papéis e permissões

| Permissão | Caixa | Empregado de mesa | Gerente | Dono/Admin |
|---|:-:|:-:|:-:|:-:|
| Cobrar (emitir FR) | ✓ | opcional | ✓ | ✓ |
| Abrir e enviar pedidos de mesa | – | ✓ | ✓ | ✓ |
| Abrir e fechar caixa | ✓ | – | ✓ | ✓ |
| Entradas e saídas de caixa | – | – | ✓ | ✓ |
| Desconto sem autorização | – | – | até X% | ✓ |
| Remover linha já enviada à cozinha | – | – | ✓ | ✓ |
| Anular FR (mesmo dia) / NC | – | – | ✓ | ✓ |
| Relatório X | ✓ | – | ✓ | ✓ |

Quando falta permissão, aparece o pedido de autorização com o PIN do gerente (já existe na demo). Fica gravado em `pos_authorizations`.

---

## 6. Configuração na aplicação da empresa (novo menu "Ponto de Venda")

Visível para dono, admin e gerente quando o plano tem `pos`.

| Ecrã | Conteúdo |
|---|---|
| **Geral** | Tipo de negócio: **Loja/Retalho** ou **Restaurante/Bar**. Nome no talão, cabeçalho e rodapé, logotipo, largura do papel (58/80 mm), métodos de pagamento activos, NUIT obrigatório acima de X MT (opcional) |
| **Terminais** | Criar, emparelhar (código/QR), revogar, último acesso |
| **Funcionários** | Criar e editar, papel, permissões, gerar ou repor o PIN, activar ou desactivar |
| **Mesas e zonas** (só restaurante) | Zonas (Sala, Esplanada…), mesas (nome, lugares, ordem), activar ou desactivar |
| **Produtos no POS** | Categorias (nome, cor, ícone, ordem), "visível no POS", estação (cozinha, bar, nenhuma), imagem, vendido ao peso, disponível hoje |
| **Caixa** | Fundo de abertura padrão, motivos de entradas e saídas, tolerância de diferença (acima dela exige gerente), fecho cego (sim/não) |
| **Pagamentos** | Números M-Pesa e e-Mola (já existem em `companies`), modo **simulação** activo, tempo limite do pedido |
| **Abrir POS** | Botão que abre `/pos` num novo separador (repõe a entrada removida no commit 5ff59dc) |

Alterações à página **Produtos** existente: os campos acima entram num separador "POS" do diálogo do produto. A importação Excel passa a aceitar categoria e "visível no POS".

---

## 7. Caixa (abertura e fecho)

Tabelas:
- `pos_sessions`: terminal, número, aberta por e quando, fundo, fechada por e quando, esperado, contado, diferença, aprovada por, notas, estado.
- `pos_session_counts`: contagem por denominação (MZN) e total por método.
- `pos_cash_movements`: tipo (entrada/saída), valor, motivo, operador, autorizado por.
- `pos_z_reports`: snapshot **imutável** do Z (JSON), numerado por terminal. Reimpressão marcada como "2.ª via".

Regras:
- Uma sessão aberta por terminal (**gaveta partilhada**). O relatório mostra o detalhe por operador.
- Não se vende sem caixa aberta.
- Não se fecha com: mesas abertas (já na demo), ou pagamentos móveis pendentes.
- Diferença acima da tolerância: exige gerente e justificação.
- Fecho por método:
  - numerário: contado
  - M-Pesa/e-Mola: só soma (em simulação), com conferência manual
- Caixa aberta há mais de 16 h: aviso no Painel da empresa; o gerente pode forçar o fecho.
- **Relatório X** (parcial) e **Z** (fecho) guardados no servidor e consultáveis na aplicação.

---

## 8. Pagamentos (D4: confirmação antes de emitir, simulado)

### 8.1 Fluxo

```
Carrinho → Cobrar → escolhe método(s)
  ├─ Numerário: valor entregue → troco → emitir FR
  ├─ M-Pesa / e-Mola:
  │     telefone do cliente → "pedido enviado" (estado PENDENTE)
  │     → [SIMULAÇÃO] confirmado ao fim de N s / botão "simular confirmação" / "simular falha"
  │     → CONFIRMADO → emitir FR      (FALHADO/EXPIRADO → tentar de novo ou mudar de método)
  └─ Misto: cada parte móvel tem de ficar CONFIRMADA antes de a FR ser emitida;
            o numerário entra no fim (só o numerário dá troco)
```

- A **FR só é criada depois** de todas as partes estarem confirmadas (D4). Até lá, o carrinho fica "em cobrança" e não pode ser alterado.
- O ecrã do cliente mostra "Aguarde a confirmação no seu telemóvel".
- Em simulação, a referência gerada é marcada `SIM-…`, e o talão e os relatórios mostram "(simulação)" para não confundir com dinheiro real.

### 8.2 Modelo pronto para a Sislog

- Tabela `pos_payment_requests`: sessão, terminal, método, valor, telefone, **provider** (`simulator` | `sislog`), referência, estado (`pending` | `confirmed` | `failed` | `expired` | `cancelled`), payload do fornecedor, criado e confirmado em, `invoice_id` (preenchido quando a FR é emitida).
- Mesmo padrão de `subscription_payments` + `sislog-webhook`, que já funciona para subscrições:
  - futuro: Edge Function `pos-payment-request` (pede a referência à Sislog)
  - futuro: o webhook actualiza o estado
  - o POS recebe a actualização por **Supabase Realtime**
- O **simulador** implementa a mesma interface (mesma tabela, mesmos estados). Mudar para a Sislog é trocar o provider, sem mexer no ecrã.
- **Antes de reutilizar a Sislog:** rodar a chave que está escrita em `process-subscription-payment/index.ts:17-19` e passá-la para secrets. Confirmar com a Sislog se o serviço suporta **pagamentos para a conta merchant de cada empresa** (o dinheiro não pode passar pela LTS).

### 8.3 Devoluções

- NC devolvida pelo **mesmo método** da FR por defeito. Numerário: sai da gaveta. M-Pesa/e-Mola: registo manual (e simulado) da devolução.

---

## 9. Restaurante (dentro do âmbito, sem ABS)

| Funcionalidade | Estado demo → real |
|---|---|
| Mesas por zona, mesa = cliente da conta, pessoas | Existe → passa para o servidor (`pos_table_orders`, `pos_table_order_lines`) |
| **Vários empregados e terminais vêem a mesma mesa em tempo real** | Novo (Supabase Realtime). O empregado usa o POS no telemóvel (PWA) |
| Envio à cozinha/bar por estação | Existe → impressão pelo diálogo do browser (silenciosa fica para o ABS) |
| Anular linha enviada: PIN do gerente + motivo + talão "ANULADO" | **Novo** (erro da demo) |
| Notas por linha ("sem cebola") | Novo |
| Mudar de mesa, balcão/take-away | Existe |
| **Dividir conta** (por itens ou partes iguais), uma FR por parte | Novo |
| Conta prévia "não serve de factura" | Existe |
| Juntar mesas, cursos, KDS, reservas | Fase posterior |
| A FR de uma mesa leva o nome da mesa e as pessoas como referência; cliente = Consumidor final ou o cliente com NUIT | Ajuste de D2 |

> Nota sobre D2 e D3: com "mesa = cliente", a FR é emitida para "Consumidor final" (ou para o NUIT pedido) com a **mesa nas observações**. A mesa não é um cliente fiscal.

---

## 10. Planos e subscrição

### 10.1 Plano (D5)

- Nova funcionalidade `pos` (booleana) em `subscription_features`, activada nos planos superiores. Opcional: `max_pos_terminals`, `max_pos_staff`.
- Nesses planos, `max_invoices_month = ilimitado`. Confirmar que nenhum plano com `pos` tem limite, ou fazer o trigger ignorar `origin = 'pos'` como garantia.
- Verificação no servidor (`assert_subscription_feature(company, 'pos')`) nas RPCs do POS, e no frontend com guard na rota `/pos` e no menu.
- Backoffice: **override por empresa** (activar o POS fora do plano, para pilotos). Hoje as funcionalidades só existem por plano.
- Downgrade: já é bloqueado (`20261028100000_block_downgrade_always.sql`), por isso não há o caso de "perder o POS" por downgrade.

### 10.2 Tolerância na expiração (D6)

O trigger `enforce_active_subscription` bloqueia **INSERT em `invoices` e `payments`** logo que a subscrição expira. Proposta:

| Dias após expirar | POS | Aplicação |
|---|---|---|
| 0 a N (ex.: 5) | **Funciona**, com um aviso permanente "Subscrição expirada — renove até DD/MM" no POS e na aplicação | Bloqueada como hoje (só Configurações) |
| Depois de N | **Não abre novas caixas nem vende**; permite **fechar a caixa aberta e imprimir o Z** | Bloqueada |

- Implementação: `company_subscription_active(company, p_grace_days)`; o trigger deixa passar quando `origin = 'pos'` e ainda está dentro da tolerância.
- O número de dias fica configurável no backoffice (global, com override por empresa).
- Avisos: email e notificação ao dono X dias antes de expirar (já existe o mecanismo `subscription-notify`).

---

## 11. Relatórios e integração com a aplicação

| Módulo | Alteração |
|---|---|
| **Relatórios → Ponto de Venda** (novo) | Vendas por dia e hora, por operador, por produto e categoria, por método de pagamento, caixas (lista de Z com diferenças), descontos, anulações e NC por operador e por quem autorizou; restaurante: por mesa e zona, valor médio por pessoa. Exportação Excel/PDF |
| **Painel** | "Vendas POS hoje", caixas abertas, alertas (diferença no Z, caixa esquecida) |
| **Facturas** | Filtros por tipo (FT/FR/NC) e origem (App/POS); detalhe da FR com reimpressão (2.ª via); NC visível |
| **Impostos** | Volume do trimestre = FT + FR − NC, com a divisão por origem; ISPC recalculado |
| **Relatórios actuais** | Considerar `document_type` e subtrair as NC |
| **Clientes / Extractos** | FR e NC incluídas; "Consumidor final" escondido |
| **SAF-T** | FR e NC (4.10) |
| **Auditoria** | Abrir e fechar caixa, autorizações, anulações, NC, PIN errado, emparelhamento e revogação de terminais. **No servidor** (triggers/RPC), não só no cliente |
| **Assistente IA** | Pode responder sobre vendas POS (futuro) |

---

## 12. Backoffice LTS (`/admin`)

- Funcionalidade `pos` e limites nos **Planos**.
- **Empresas**: ver se têm POS, tipo de negócio, terminais (último acesso), caixas abertas; activar ou desactivar o POS (override); revogar terminais (suporte).
- **Tolerância de expiração**: valor global e por empresa.
- **Modo demonstração**: a demo actual com JSON fica acessível como "demo" (conta de demonstração ou `/pos?demo=1`) para apresentações comerciais.

---

## 13. O que fica explicitamente fora (para a fase seguinte)

| Adiado | Implicação **agora** |
|---|---|
| **ABS / app nativa** | Impressão pelo diálogo do browser. Em **Windows + Chrome**, o modo `--kiosk-printing` imprime sem diálogo na impressora predefinida, uma boa solução provisória para lojas com PC. Sem gaveta automática. |
| **Offline** | Sem internet **não se vende**. O POS tem de mostrar isto claramente, manter o carrinho e as mesas, e voltar a tentar sozinho. Nunca emitir documentos "locais" sem número do servidor. |
| **Multi-estabelecimento** | Tipo de negócio e mesas por empresa. Para não fechar a porta, as tabelas `pos_*` levam `company_id` e, mais tarde, recebem `establishment_id` (migração simples). |
| Ecrã do cliente remoto | Mantém-se via BroadcastChannel (segundo monitor no mesmo PC). |

---

## 14. Modelo de dados (resumo das alterações)

```
invoices              + document_type (FT|FR|NC), origin (app|pos), series_id, pos_session_id, pos_terminal_id,
                        pos_staff_id, table_ref, covers, discount_total, related_invoice_id, reason
invoice_items         + discount, unit_cost, notes; quantity decimal
payments              + method (enum: dinheiro, mpesa, emola, cartao, transferencia, ...), phone, reference,
                        amount_tendered, change_given, payment_request_id; sem receipt_number quando FR
document_series       (company_id, document_type, year, prefix, next_number)       -- atómica
clients               + is_walk_in
products              + category_id, pos_visible, station, image_url, sold_by_weight, available
product_categories    (company_id, name, color, icon, sort)
stock_movements       (company_id, product_id, qty, type, invoice_id, staff_id, created_at)
companies             + pos_business_type (retail|restaurant), pos_settings jsonb
pos_terminals         (company_id, name, auth_user_id, pairing_code_hash, last_seen_at, revoked_at)
pos_staff             (company_id, user_id?, name, pin_hash, role, permissions, color, failed_attempts, locked_until, is_active)
pos_zones / pos_tables
pos_table_orders / pos_table_order_lines (status pending|sent|voided, notes, voided_by, void_reason)
pos_sessions / pos_session_counts / pos_cash_movements / pos_z_reports
pos_payment_requests  (provider simulator|sislog, status, phone, reference, invoice_id, ...)
pos_authorizations    (action, requested_by, authorized_by, reason, target, created_at)
subscription_features + pos, max_pos_terminals, max_pos_staff
RPCs                  pos_pair_terminal, pos_verify_pin, pos_open_session, pos_cash_movement, pos_close_session,
                      pos_issue_fr, pos_void_fr, pos_issue_nc, pos_request_payment, pos_simulate_payment,
                      calculate_ispc_for_period (com NC)
```

---

## 15. Fases de implementação

| Fase | Conteúdo | Entrega |
|---|---|---|
| **1. Fundação** | `document_type`, séries atómicas (**corrige também as Facturas**), Consumidor final, desconto e quantidades decimais, stock em movimentos, ISPC e relatórios com NC, funcionalidade `pos` e tolerância de expiração | Base fiscal pronta e testada com as facturas actuais |
| **2. Configuração** | Menu Ponto de Venda: geral, terminais e emparelhamento, funcionários/PIN/permissões, categorias e produtos POS, mesas e zonas, regras de caixa; override no backoffice | A empresa configura o POS sozinha |
| **3. POS Loja** | Login do terminal, PIN no servidor, caixas e Z no servidor, `pos_issue_fr`, pagamentos (numerário + simulação M-Pesa/e-Mola + misto), anular FR e NC, talão sem IVA, relatórios POS, Painel | **Piloto loja** |
| **4. POS Restaurante** | Mesas e pedidos no servidor em tempo real, empregado no telemóvel, anulação de linhas com PIN, notas, dividir conta | **Piloto restaurante** |
| **5. Depois** | Sislog real, ABS/app nativa, offline, multi-estabelecimento, KDS, reservas | — |

---

## 16. Decisões que ainda faltam (pequenas, mas bloqueiam detalhes)

1. **Dias de tolerância** na expiração (proposta: 5) e se o valor é fixo ou por plano.
2. **Taxa de serviço**: assumi que também não há (como a gorjeta). Confirmar.
3. **Devoluções**: aceitar o modelo "anular a FR só no mesmo dia; depois disso, NC"?
4. **Stock negativo**: permitir com alerta (proposta) ou bloquear a venda?
5. **Login do terminal**: utilizador técnico com emparelhamento (proposta) ou login do gerente no MVP?
6. **Quais planos** recebem o POS, e se há limite de terminais e funcionários.
7. **Texto da menção de isenção de IVA** no talão (consultor fiscal).
8. **Simulação em produção**: os clientes reais podem usar o modo simulação para M-Pesa/e-Mola (a FR fica emitida como paga) até a Sislog estar integrada, ou nesta fase só se aceita o registo **manual** da referência real?
9. **FR na aplicação**: a aplicação da empresa (fora do POS) também passa a poder emitir FR, ou fica só no POS?
