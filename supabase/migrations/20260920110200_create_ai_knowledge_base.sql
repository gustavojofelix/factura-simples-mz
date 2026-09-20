-- Assistente Virtual (IA) — base de conhecimento fiscal
--
-- O assistente NÃO responde a perguntas fiscais de memória. Responde apenas a
-- partir dos artigos publicados nesta tabela, que são pesquisáveis por texto
-- integral em português. Um artigo por publicar não é devolvido ao modelo, o
-- que dá ao backoffice um travão editorial sobre aquilo que a IA afirma em
-- matéria de imposto.
--
-- Os artigos abaixo foram redigidos a partir das regras já codificadas na
-- própria aplicação (tax.service.ts, calculate_ispc_split, calculateDueDate),
-- para que a explicação do assistente e o cálculo do Modelo 30 nunca divirjam.

CREATE TABLE IF NOT EXISTS public.ai_knowledge_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  -- 'ispc' | 'modelo_30' | 'prazos' | 'facturacao' | 'aplicacao'
  category text NOT NULL DEFAULT 'ispc',
  -- Formas alternativas de fazer a mesma pergunta, para melhorar a pesquisa.
  question_variants text[] NOT NULL DEFAULT '{}',
  body text NOT NULL,
  legal_reference text,
  status text NOT NULL DEFAULT 'publicado'
    CHECK (status IN ('publicado', 'revisao_pendente', 'arquivado')),
  -- NULL = artigo global; preenchido = FAQ próprio de uma empresa.
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- O vector de pesquisa é mantido por trigger e não por coluna gerada.
--
-- Uma coluna gerada exige uma expressão estritamente IMMUTABLE, e
-- array_to_string é STABLE: a função de saída dos elementos de um array pode
-- depender de definições da sessão. Tentar gerá-la assim devolve
-- "generation expression is not immutable" (42P17). Um trigger não tem essa
-- restrição, e ao mesmo tempo dispensa-nos de garantir a volatilidade de cada
-- função envolvida.
ALTER TABLE public.ai_knowledge_articles
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION public.ai_knowledge_refresh_search_vector()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('portuguese', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('portuguese',
              coalesce(array_to_string(NEW.question_variants, ' '), '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(NEW.body, '')), 'B');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_knowledge_search_vector ON public.ai_knowledge_articles;
CREATE TRIGGER ai_knowledge_search_vector
  BEFORE INSERT OR UPDATE OF title, question_variants, body
  ON public.ai_knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION public.ai_knowledge_refresh_search_vector();

-- Preenche linhas que já existissem antes do trigger. O UPDATE acima não é
-- disparado por uma alteração apenas a search_vector, por isso a expressão é
-- repetida aqui.
UPDATE public.ai_knowledge_articles
   SET search_vector =
     setweight(to_tsvector('portuguese', coalesce(title, '')), 'A') ||
     setweight(to_tsvector('portuguese',
               coalesce(array_to_string(question_variants, ' '), '')), 'A') ||
     setweight(to_tsvector('portuguese', coalesce(body, '')), 'B')
 WHERE search_vector IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_search
  ON public.ai_knowledge_articles USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_status
  ON public.ai_knowledge_articles (status, category, sort_order);

ALTER TABLE public.ai_knowledge_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read published knowledge articles" ON public.ai_knowledge_articles;
CREATE POLICY "Read published knowledge articles"
  ON public.ai_knowledge_articles FOR SELECT
  TO authenticated
  USING (
    (status = 'publicado' AND (company_id IS NULL OR public.ai_can_access_company(company_id)))
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Admins manage knowledge articles" ON public.ai_knowledge_articles;
CREATE POLICY "Admins manage knowledge articles"
  ON public.ai_knowledge_articles FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS update_ai_knowledge_updated_at ON public.ai_knowledge_articles;
CREATE TRIGGER update_ai_knowledge_updated_at
  BEFORE UPDATE ON public.ai_knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Pesquisa na base de conhecimento — ferramenta do assistente
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_search_knowledge(
  p_query text,
  p_company_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 4
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 4), 1), 10);
  v_query text := trim(COALESCE(p_query, ''));
  v_ts tsquery;
  v_rows jsonb;
BEGIN
  IF p_company_id IS NOT NULL THEN
    PERFORM public.ai_guard(p_company_id);
  END IF;

  IF length(v_query) < 2 THEN
    RETURN jsonb_build_object('artigos', '[]'::jsonb);
  END IF;

  -- websearch_to_tsquery tolera pontuação e frases soltas; se a pergunta não
  -- produzir termos úteis, cai-se para correspondência por texto simples.
  v_ts := websearch_to_tsquery('portuguese', v_query);

  SELECT COALESCE(jsonb_agg(t ORDER BY relevancia DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'titulo', a.title,
             'categoria', a.category,
             'conteudo', a.body,
             'referencia_legal', a.legal_reference
           ) AS t,
           ts_rank(a.search_vector, v_ts) AS relevancia
      FROM public.ai_knowledge_articles a
     WHERE a.status = 'publicado'
       AND (a.company_id IS NULL OR a.company_id = p_company_id)
       AND (
         a.search_vector @@ v_ts
         OR a.title ILIKE '%' || v_query || '%'
       )
     ORDER BY ts_rank(a.search_vector, v_ts) DESC, a.sort_order
     LIMIT v_limit
  ) s;

  RETURN jsonb_build_object('consulta', v_query, 'artigos', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ai_search_knowledge(text, uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- Conteúdo inicial
-- ---------------------------------------------------------------------------

INSERT INTO public.ai_knowledge_articles
  (slug, title, category, question_variants, body, legal_reference, status, sort_order)
VALUES
(
  'o-que-e-o-ispc',
  'O que é o ISPC?',
  'ispc',
  ARRAY['o que é o ispc', 'para que serve o ispc', 'significado de ispc', 'imposto simplificado'],
  'O ISPC — Imposto Simplificado para Pequenos Contribuintes — é um imposto moçambicano criado para simplificar a vida fiscal dos pequenos negócios.

Substitui, numa única obrigação, o imposto sobre o rendimento (IRPS ou IRPC) e o IVA. Quem está enquadrado no ISPC não entrega declarações separadas desses impostos pela mesma actividade.

O imposto incide sobre o **volume de negócios** — ou seja, sobre o total facturado — e não sobre o lucro. Não há dedução de despesas: aplica-se a taxa directamente às vendas do período.

A declaração e o pagamento são **trimestrais**, através do Modelo 30.',
  'Código do ISPC',
  'publicado', 10
),
(
  'o-que-e-o-modelo-30',
  'O que é o Modelo 30?',
  'modelo_30',
  ARRAY['o que é o modelo 30', 'modelo 30', 'declaração periódica', 'formulário do ispc', 'para que serve o modelo 30'],
  'O Modelo 30 é a **Declaração Periódica do ISPC**: o formulário trimestral em que o contribuinte declara à Autoridade Tributária quanto facturou no trimestre e quanto ISPC daí resulta.

O que consta do Modelo 30:
- identificação do contribuinte (nome e NUIT);
- o trimestre e o ano a que respeita;
- o **volume de negócios do trimestre** (total das facturas emitidas, excluindo rascunhos e facturas anuladas);
- a **base tributável** repartida pelos escalões de taxa aplicáveis;
- o **ISPC apurado** a pagar.

No ISPC Fácil o Modelo 30 é gerado automaticamente em *Impostos*: a aplicação soma as facturas emitidas no trimestre, aplica os escalões e produz o documento pronto a submeter. Não é preciso preencher valores à mão.',
  'Código do ISPC — Declaração Periódica',
  'publicado', 20
),
(
  'como-calcular-o-ispc',
  'Como se calcula o ISPC?',
  'ispc',
  ARRAY['como calcular o ispc', 'qual é a taxa do ispc', 'taxas do ispc', 'escalões do ispc', 'quanto vou pagar de ispc', 'como é apurado o imposto'],
  'O ISPC aplica-se ao **volume de negócios acumulado do ano**, não ao lucro, e a taxa sobe por escalões à medida que a facturação anual cresce.

**Actividades de escala** (agrícola, silvícola, pesqueira, pecuária, avícola, apícola, industrial e comercial):

| Volume de negócios anual acumulado | Taxa |
|---|---|
| Até 1.000.000 MT | 3% |
| De 1.000.000 MT a 2.500.000 MT | 4% |
| De 2.500.000 MT a 4.000.000 MT | 5% |
| Acima de 4.000.000 MT | 20% |

**Prestação de serviços** — taxa única sobre a facturação, sem escalões progressivos, até 4.000.000 MT:

| Tipo de serviço | Taxa |
|---|---|
| Serviços não liberais (canalização, carpintaria, pedreiro, electricista, barbearia, jardinagem, mecânica) | 12% |
| Serviços liberais (advogados, economistas, geólogos, engenheiros, contabilistas) | 15% |

Acima de 4.000.000 MT de facturação anual, o excedente é tributado a 20% em qualquer dos casos.

**O escalão é acumulado ao longo do ano, não reiniciado a cada trimestre.** O cálculo de cada trimestre parte do total já facturado nos trimestres anteriores do mesmo ano. Se a empresa já facturou 900.000 MT e factura mais 300.000 MT no trimestre seguinte, os primeiros 100.000 MT desse trimestre ainda são tributados a 3% e os restantes 200.000 MT a 4%.

**Exemplo.** Actividade comercial, primeiro ano. 1.º trimestre: 400.000 MT → 3% = 12.000 MT. 2.º trimestre: 800.000 MT. Acumulado antes do trimestre: 400.000 MT. Os primeiros 600.000 MT completam o primeiro escalão (3% = 18.000 MT) e os restantes 200.000 MT entram no segundo (4% = 8.000 MT). ISPC do 2.º trimestre: 26.000 MT.',
  'Código do ISPC — taxas e base tributável',
  'publicado', 30
),
(
  'quando-pagar-o-ispc',
  'Quando devo declarar e pagar o ISPC?',
  'prazos',
  ARRAY['quando devo pagar o imposto', 'prazo do ispc', 'datas limite', 'quando entregar o modelo 30', 'até quando posso pagar', 'prazo de entrega'],
  'A declaração e o pagamento do ISPC são **trimestrais**. O prazo termina no último dia do mês seguinte ao fim de cada trimestre:

| Trimestre | Período facturado | Data limite |
|---|---|---|
| 1.º | Janeiro a Março | **30 de Abril** |
| 2.º | Abril a Junho | **31 de Julho** |
| 3.º | Julho a Setembro | **31 de Outubro** |
| 4.º | Outubro a Dezembro | **31 de Janeiro do ano seguinte** |

A entrega do Modelo 30 e o pagamento fazem-se na mesma data limite.

O atraso na entrega ou no pagamento sujeita o contribuinte a multas e a juros de mora, aplicados pela Autoridade Tributária sobre o valor em dívida. Se a data limite cair em fim-de-semana ou feriado, confirme junto da Repartição de Finanças qual o dia útil aceite.

No ISPC Fácil, o separador *Impostos* mostra o estado de cada trimestre e a data limite correspondente.',
  'Código do ISPC — prazos de entrega e pagamento',
  'publicado', 40
),
(
  'quem-esta-sujeito-ao-ispc',
  'Quem está sujeito ao ISPC?',
  'ispc',
  ARRAY['quem está sujeito ao ispc', 'quem paga ispc', 'quem pode aderir ao ispc', 'estou enquadrado no ispc', 'quem pode usar o regime simplificado', 'requisitos do ispc'],
  'Estão abrangidas pelo ISPC as **pessoas singulares e colectivas** que exerçam em Moçambique actividades de pequena dimensão — agrícolas, silvícolas, pecuárias, pesqueiras, avícolas, apícolas, industriais ou comerciais, incluindo prestação de serviços — e cujo volume de negócios anual se mantenha dentro do limite previsto para o regime.

O regime é **opcional**: quem reúne as condições pode optar pelo ISPC ou manter-se no regime normal de IRPS/IRPC e IVA. A opção faz-se junto da Repartição de Finanças da área do contribuinte.

**Ficam de fora do ISPC**, entre outros:
- os contribuintes que ultrapassem o limite de volume de negócios do regime;
- os que sejam obrigados a possuir contabilidade organizada;
- os que importem ou exportem bens.

**Confirme sempre o seu enquadramento junto da Autoridade Tributária.** Os limites de volume de negócios e as condições de adesão são fixados por lei e podem ser revistos; a Repartição de Finanças da sua área é a fonte autoritária sobre o seu caso concreto.',
  'Código do ISPC — incidência subjectiva',
  'publicado', 50
),
(
  'ispc-sem-facturacao',
  'Tenho de declarar mesmo sem vendas no trimestre?',
  'prazos',
  ARRAY['não vendi nada', 'trimestre sem vendas', 'declaração a zero', 'tenho de entregar sem facturar', 'sem facturação'],
  'Sim. A obrigação declarativa mantém-se mesmo que não tenha emitido qualquer factura no trimestre.

Nesse caso entrega o Modelo 30 com **volume de negócios zero** e **ISPC a pagar zero**. Não há imposto a liquidar, mas a declaração tem de ser entregue dentro do prazo normal do trimestre.

Não entregar a declaração — ainda que a zero — é uma falta autónoma, sancionável com multa, independentemente de não haver imposto devido.',
  'Código do ISPC — obrigações declarativas',
  'publicado', 60
),
(
  'base-de-calculo-facturas',
  'Que facturas contam para o ISPC?',
  'facturacao',
  ARRAY['que facturas contam', 'rascunhos contam', 'facturas anuladas', 'o que entra no volume de negócios', 'facturas não pagas contam'],
  'Para o ISPC conta o **total facturado no trimestre**, não o total recebido.

Entram no volume de negócios as facturas com estado **pendente**, **paga** e **vencida** — ou seja, todas as que foram efectivamente emitidas ao cliente.

Ficam de fora:
- as facturas em **rascunho**, que ainda não foram emitidas e não existem fiscalmente;
- as facturas **anuladas**, cuja emissão foi revertida.

Consequência prática importante: **uma factura emitida e ainda não paga já gera ISPC**. O imposto é devido pela emissão, não pela cobrança. Por isso convém acompanhar de perto as contas a receber — o separador *Relatórios* e o assistente mostram o valor pendente por receber a qualquer momento.',
  NULL,
  'publicado', 70
),
(
  'multas-e-juros',
  'O que acontece se eu entregar ou pagar fora do prazo?',
  'prazos',
  ARRAY['multa por atraso', 'juros de mora', 'paguei fora do prazo', 'perdi o prazo', 'entreguei tarde'],
  'O incumprimento do prazo tem duas consequências distintas, que podem somar-se:

- **Falta ou atraso na entrega do Modelo 30** — multa por incumprimento da obrigação declarativa, devida mesmo que não houvesse imposto a pagar.
- **Atraso no pagamento do ISPC apurado** — juros de mora sobre o valor em dívida, contados desde a data limite até ao pagamento efectivo.

Os montantes concretos das multas e a taxa de juro de mora são fixados pela legislação em vigor e actualizados periodicamente. Para saber o valor exacto aplicável ao seu caso, contacte a Repartição de Finanças da sua área ou consulte a Autoridade Tributária de Moçambique.

Regularizar voluntariamente, antes de qualquer notificação, é em regra mais favorável do que aguardar a acção da administração fiscal.',
  NULL,
  'publicado', 80
)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  category = EXCLUDED.category,
  question_variants = EXCLUDED.question_variants,
  body = EXCLUDED.body,
  legal_reference = EXCLUDED.legal_reference,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

COMMENT ON TABLE public.ai_knowledge_articles IS
  'Fonte única das respostas fiscais do assistente. O modelo é instruído a não responder a matéria fiscal fora destes artigos. Artigos com status <> ''publicado'' não são devolvidos.';
