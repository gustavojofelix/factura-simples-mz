/*
  Dados de demonstração por tipo de negócio (teste de 14 dias).

  No registo a pessoa escolhe o tipo de negócio e a demo é carregada de acordo:
    services    clientes, produtos/serviços e facturas (o que existia)
    restaurant  café/restaurante: ementa por categorias, zonas e mesas, operadores
                do POS (caixa, empregado de mesa, gerente) e definições do POS
    retail      loja/mercearia: artigos com código de barras e ao peso, operadores
                do POS (caixa, gerente) e definições do POS
  Restaurante e loja ficam com o POS activo durante o período de teste
  (companies.pos_trial), sem mexer no plano nem criar excepções permanentes.
  Todos os operadores de demonstração entram com o PIN 1111 (a regra do PIN
  único continua a valer para os funcionários reais, em pos_set_staff_pin).
  remove_demo_data passa também a remover a demo do POS.
*/

-- 1. Colunas ---------------------------------------------------------------------
ALTER TABLE public.product_categories ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.pos_zones          ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.pos_tables         ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.pos_staff          ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
-- Fotografia/avatar do operador (caminho relativo da app ou URL pública).
ALTER TABLE public.pos_staff          ADD COLUMN IF NOT EXISTS avatar_url text;
-- POS disponível enquanto a subscrição estiver em teste (definido pela demo).
ALTER TABLE public.companies          ADD COLUMN IF NOT EXISTS pos_trial boolean NOT NULL DEFAULT false;

-- 2. Acesso ao POS: também durante o teste, se a empresa o pediu na demo ------------
CREATE OR REPLACE FUNCTION public.company_pos_access(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub record;
  v_today date := (now() AT TIME ZONE 'Africa/Maputo')::date;
  v_grace integer;
  v_enabled boolean;
  v_active boolean;
  v_in_grace boolean := false;
  v_grace_until date;
  v_end date;
  v_plan_id uuid;
BEGIN
  SELECT s.plan_id, s.status, s.end_date
    INTO v_sub
    FROM subscriptions s
   WHERE s.company_id = p_company_id
   ORDER BY (s.status IN ('active', 'trialing')) DESC, s.end_date DESC NULLS FIRST, s.updated_at DESC
   LIMIT 1;

  v_plan_id := COALESCE(
    (SELECT COALESCE(p.plan_id, (SELECT f.id FROM public.subscription_find_plan(p.plan_name) f))
       FROM public.subscription_current_period(p_company_id) p
      WHERE p.id IS NOT NULL),
    v_sub.plan_id
  );

  SELECT COALESCE(o.enabled, pf.enabled, false)
    INTO v_enabled
    FROM subscription_features f
    LEFT JOIN subscription_plan_features pf ON pf.feature_id = f.id AND pf.plan_id = v_plan_id
    LEFT JOIN company_feature_overrides o ON o.company_id = p_company_id AND o.feature_code = f.code
   WHERE f.code = 'pos' AND f.is_active;
  v_enabled := COALESCE(v_enabled, false);

  -- Teste de 14 dias com demo de restaurante ou loja.
  IF NOT v_enabled AND v_sub.status = 'trialing'
     AND EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND pos_trial) THEN
    v_enabled := true;
  END IF;

  v_grace := COALESCE(
    (SELECT (value #>> '{}')::integer FROM platform_settings WHERE key = 'pos_grace_days'),
    5
  );

  v_end := (v_sub.end_date AT TIME ZONE 'Africa/Maputo')::date;

  v_active := v_sub.status IN ('active', 'trialing')
              AND (v_end IS NULL OR v_end >= v_today);

  IF NOT COALESCE(v_active, false) AND v_end IS NOT NULL
     AND v_sub.status IN ('active', 'trialing', 'past_due') THEN
    v_grace_until := v_end + v_grace;
    v_in_grace := v_today <= v_grace_until;
  END IF;

  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'active', COALESCE(v_active, false),
    'in_grace', v_in_grace,
    'grace_until', v_grace_until,
    'end_date', v_end,
    'allowed', v_enabled AND (COALESCE(v_active, false) OR v_in_grace)
  );
END;
$$;

-- 3. Terminal: a lista de operadores inclui o avatar --------------------------------
CREATE OR REPLACE FUNCTION public.pos_terminal_info()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_terminal pos_terminals%ROWTYPE;
BEGIN
  v_terminal := public.pos_current_terminal();
  IF v_terminal.id IS NULL THEN
    RAISE EXCEPTION 'Este dispositivo não está emparelhado ou foi revogado.'
      USING ERRCODE = '42501', DETAIL = 'POS_TERMINAL_REVOKED';
  END IF;

  UPDATE pos_terminals SET last_seen_at = now() WHERE id = v_terminal.id;

  RETURN jsonb_build_object(
    'terminal', jsonb_build_object('id', v_terminal.id, 'name', v_terminal.name),
    'company', (
      SELECT jsonb_build_object('id', c.id, 'name', c.name, 'nuit', c.nuit, 'logo_url', c.logo_url,
                                'business_type', c.pos_business_type)
        FROM companies c WHERE c.id = v_terminal.company_id
    ),
    'access', public.company_pos_access(v_terminal.company_id),
    'staff', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'role', s.role, 'color', s.color,
               'avatar_url', s.avatar_url,
               'has_pin', s.pin_hash IS NOT NULL,
               'locked', s.locked_until IS NOT NULL AND s.locked_until > now())
             ORDER BY s.role = 'manager', s.name)
        FROM pos_staff s
       WHERE s.company_id = v_terminal.company_id AND s.is_active
    ), '[]'::jsonb),
    'open_session', (
      SELECT jsonb_build_object('id', ps.id, 'number', ps.number, 'opened_at', ps.opened_at,
                                'opened_by', (SELECT name FROM pos_staff WHERE id = ps.opened_by))
        FROM pos_sessions ps WHERE ps.terminal_id = v_terminal.id AND ps.status = 'open'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_terminal_info() TO authenticated;

-- 4. Carregar (substitui a versão de 1 argumento) ---------------------------------
DROP FUNCTION IF EXISTS public.seed_demo_data(uuid);

CREATE OR REPLACE FUNCTION public.seed_demo_data(p_company_id uuid, p_business_type text DEFAULT 'services')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_account uuid;
  v_uid uuid := auth.uid();
  v_type text := CASE WHEN p_business_type IN ('restaurant', 'retail') THEN p_business_type ELSE 'services' END;
  c_mercearia uuid; c_construtora uuid; c_ana uuid; c_escola uuid; c_transportes uuid;
  v_prod jsonb := '{}'::jsonb;   -- nome do produto → id
  v_cat jsonb := '{}'::jsonb;    -- nome da categoria → id
  v_zone jsonb := '{}'::jsonb;   -- nome da zona → id
  v_invoices jsonb;              -- [[dias atrás, prazo, cliente, pago, [[produto, qtd], ...]], ...]
  v_id uuid;
  v_inv uuid;
  v_seq int := 0;
  v_products int := 0;
  r record;
  l jsonb;
BEGIN
  SELECT account_id INTO v_account FROM companies WHERE id = p_company_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_account_owner(v_account) THEN
    RAISE EXCEPTION 'Só o titular da conta pode carregar dados de demonstração' USING ERRCODE = '42501';
  END IF;

  -- Idempotente: não duplica se já houver dados demo.
  IF EXISTS (SELECT 1 FROM clients WHERE company_id = p_company_id AND is_demo)
     OR EXISTS (SELECT 1 FROM products WHERE company_id = p_company_id AND is_demo) THEN
    RETURN jsonb_build_object('seeded', false);
  END IF;

  PERFORM set_config('app.demo_data', 'on', true);

  -- Clientes (comuns aos três tipos) ------------------------------------------------
  INSERT INTO clients (company_id, name, nuit, phone, email, address, is_active, is_demo)
  VALUES (p_company_id, 'Mercearia Esperança, Lda', '400100201', '+258 84 100 2001', 'compras@mercearia-esperanca.example', 'Av. Eduardo Mondlane, 1200, Maputo', true, true)
  RETURNING id INTO c_mercearia;
  INSERT INTO clients (company_id, name, nuit, phone, email, address, is_active, is_demo)
  VALUES (p_company_id, 'Construtora Horizonte, Lda', '400100202', '+258 82 100 2002', 'financeiro@horizonte.example', 'Rua da Beira, 45, Matola', true, true)
  RETURNING id INTO c_construtora;
  INSERT INTO clients (company_id, name, nuit, phone, email, address, is_active, is_demo)
  VALUES (p_company_id, 'Ana Machava', '100100203', '+258 86 100 2003', 'ana.machava@example.com', 'Bairro Central, Maputo', true, true)
  RETURNING id INTO c_ana;
  INSERT INTO clients (company_id, name, nuit, phone, email, address, is_active, is_demo)
  VALUES (p_company_id, 'Escola Primária Luz do Saber', '500100204', '+258 84 100 2004', 'direccao@luzdosaber.example', 'Av. Julius Nyerere, 300, Maputo', true, true)
  RETURNING id INTO c_escola;
  INSERT INTO clients (company_id, name, nuit, phone, email, address, is_active, is_demo)
  VALUES (p_company_id, 'Transportes Rápido Sul, Lda', '400100205', '+258 87 100 2005', 'geral@rapidosul.example', 'EN4, Km 12, Boane', true, true)
  RETURNING id INTO c_transportes;

  -- Categorias do POS (restaurante e loja) -------------------------------------------
  FOR r IN
    SELECT * FROM (VALUES
      ('restaurant', 'Cafetaria',  '#8b5cf6', 'fa-mug-hot', 1),
      ('restaurant', 'Pratos',     '#f16c39', 'fa-utensils', 2),
      ('restaurant', 'Bebidas',    '#0ea5e9', 'fa-martini-glass', 3),
      ('restaurant', 'Sobremesas', '#e11d48', 'fa-ice-cream', 4),
      ('retail',     'Mercearia',  '#10b981', 'fa-basket-shopping', 1),
      ('retail',     'Frescos',    '#f59e0b', 'fa-carrot', 2),
      ('retail',     'Bebidas',    '#0ea5e9', 'fa-bottle-water', 3),
      ('retail',     'Higiene e limpeza', '#6366f1', 'fa-pump-soap', 4)
    ) AS t(btype, name, color, icon, sort_order)
    WHERE t.btype = v_type
  LOOP
    INSERT INTO product_categories (company_id, name, color, icon, sort_order, is_active, is_demo)
    VALUES (p_company_id, r.name, r.color, r.icon, r.sort_order, true, true)
    RETURNING id INTO v_id;
    v_cat := v_cat || jsonb_build_object(r.name, v_id);
  END LOOP;

  -- Produtos e serviços ------------------------------------------------------------
  -- (tipo, nome, descrição, preço, produto|servico, unidade, stock, categoria, estação, ao peso, no POS, código de barras)
  FOR r IN
    SELECT * FROM (VALUES
      -- Serviços / outro
      ('services', 'Saco de cimento 50 kg', 'Cimento Portland', 650, 'produto', 'un', 140, NULL, NULL, false, true, NULL),
      ('services', 'Resma de papel A4', '500 folhas, 80 g', 380, 'produto', 'un', 50, NULL, NULL, false, true, NULL),
      ('services', 'Água mineral 1,5 L (caixa de 6)', NULL, 420, 'produto', 'cx', 25, NULL, NULL, false, true, NULL),
      ('services', 'Consultoria (hora)', 'Apoio técnico e administrativo', 2500, 'servico', 'h', NULL, NULL, NULL, false, true, NULL),
      ('services', 'Instalação e manutenção', NULL, 4500, 'servico', 'un', NULL, NULL, NULL, false, true, NULL),
      ('services', 'Transporte e entrega', NULL, 1200, 'servico', 'un', NULL, NULL, NULL, false, true, NULL),
      -- Café / restaurante
      ('restaurant', 'Café expresso', NULL, 60, 'produto', 'un', NULL, 'Cafetaria', 'bar', false, true, NULL),
      ('restaurant', 'Galão', NULL, 90, 'produto', 'un', NULL, 'Cafetaria', 'bar', false, true, NULL),
      ('restaurant', 'Cappuccino', NULL, 110, 'produto', 'un', NULL, 'Cafetaria', 'bar', false, true, NULL),
      ('restaurant', 'Chá de príncipe', NULL, 50, 'produto', 'un', NULL, 'Cafetaria', 'bar', false, true, NULL),
      ('restaurant', 'Torrada mista', NULL, 150, 'produto', 'un', NULL, 'Cafetaria', 'kitchen', false, true, NULL),
      ('restaurant', 'Pão com chouriço', NULL, 120, 'produto', 'un', NULL, 'Cafetaria', 'kitchen', false, true, NULL),
      ('restaurant', 'Frango à zambeziana', 'Com arroz ou xima', 650, 'produto', 'un', NULL, 'Pratos', 'kitchen', false, true, NULL),
      ('restaurant', 'Matapa com caranguejo', 'Com arroz de coco', 720, 'produto', 'un', NULL, 'Pratos', 'kitchen', false, true, NULL),
      ('restaurant', 'Camarão grelhado', 'Com batata frita e salada', 1200, 'produto', 'un', NULL, 'Pratos', 'kitchen', false, true, NULL),
      ('restaurant', 'Prego no pão', NULL, 280, 'produto', 'un', NULL, 'Pratos', 'kitchen', false, true, NULL),
      ('restaurant', 'Chamuças (4 un.)', NULL, 180, 'produto', 'un', NULL, 'Pratos', 'kitchen', false, true, NULL),
      ('restaurant', 'Refresco natural', NULL, 120, 'produto', 'un', NULL, 'Bebidas', 'bar', false, true, NULL),
      ('restaurant', 'Água mineral 0,5 L', NULL, 60, 'produto', 'un', NULL, 'Bebidas', 'bar', false, true, NULL),
      ('restaurant', 'Cerveja nacional', NULL, 90, 'produto', 'un', NULL, 'Bebidas', 'bar', false, true, NULL),
      ('restaurant', 'Sumo de maracujá', NULL, 150, 'produto', 'un', NULL, 'Bebidas', 'bar', false, true, NULL),
      ('restaurant', 'Bolo de coco', NULL, 160, 'produto', 'un', NULL, 'Sobremesas', 'kitchen', false, true, NULL),
      ('restaurant', 'Pudim caseiro', NULL, 140, 'produto', 'un', NULL, 'Sobremesas', 'kitchen', false, true, NULL),
      ('restaurant', 'Serviço de catering (por pessoa)', 'Almoço servido no local do cliente', 450, 'servico', 'pax', NULL, NULL, NULL, false, false, NULL),
      -- Loja / mercearia
      ('retail', 'Arroz 5 kg', NULL, 450, 'produto', 'un', 60, 'Mercearia', NULL, false, true, '6009000000017'),
      ('retail', 'Farinha de milho 5 kg', NULL, 320, 'produto', 'un', 45, 'Mercearia', NULL, false, true, '6009000000024'),
      ('retail', 'Óleo alimentar 1 L', NULL, 180, 'produto', 'un', 80, 'Mercearia', NULL, false, true, '6009000000031'),
      ('retail', 'Açúcar 1 kg', NULL, 95, 'produto', 'un', 100, 'Mercearia', NULL, false, true, '6009000000048'),
      ('retail', 'Feijão manteiga 1 kg', NULL, 160, 'produto', 'un', 40, 'Mercearia', NULL, false, true, '6009000000055'),
      ('retail', 'Tomate', 'Vendido ao quilo', 90, 'produto', 'kg', 30, 'Frescos', NULL, true, true, NULL),
      ('retail', 'Cebola', 'Vendida ao quilo', 70, 'produto', 'kg', 40, 'Frescos', NULL, true, true, NULL),
      ('retail', 'Banana', 'Vendida ao quilo', 60, 'produto', 'kg', 25, 'Frescos', NULL, true, true, NULL),
      ('retail', 'Água mineral 1,5 L', NULL, 50, 'produto', 'un', 120, 'Bebidas', NULL, false, true, '6009000000062'),
      ('retail', 'Refrigerante 2 L', NULL, 120, 'produto', 'un', 60, 'Bebidas', NULL, false, true, '6009000000079'),
      ('retail', 'Cerveja nacional (lata)', NULL, 75, 'produto', 'un', 96, 'Bebidas', NULL, false, true, '6009000000086'),
      ('retail', 'Sabão em barra', NULL, 60, 'produto', 'un', 70, 'Higiene e limpeza', NULL, false, true, '6009000000093'),
      ('retail', 'Detergente em pó 1 kg', NULL, 210, 'produto', 'un', 35, 'Higiene e limpeza', NULL, false, true, '6009000000109'),
      ('retail', 'Pasta de dentes', NULL, 85, 'produto', 'un', 50, 'Higiene e limpeza', NULL, false, true, '6009000000116')
    ) AS t(btype, name, description, price, ptype, unit, stock, category, station, by_weight, visible, barcode)
    WHERE t.btype = v_type
  LOOP
    INSERT INTO products (company_id, name, description, price, type, unit, stock, is_active, is_demo,
                          category_id, pos_station, sold_by_weight, pos_visible, barcode)
    VALUES (p_company_id, r.name, r.description, r.price, r.ptype, r.unit, r.stock, true, true,
            (v_cat ->> r.category)::uuid, r.station, r.by_weight, r.visible, r.barcode)
    RETURNING id INTO v_id;
    v_prod := v_prod || jsonb_build_object(r.name, v_id);
    v_products := v_products + 1;
  END LOOP;

  -- Facturas de demonstração ---------------------------------------------------------
  v_invoices := CASE v_type
    WHEN 'restaurant' THEN jsonb_build_array(
      jsonb_build_array(40, 15, c_construtora, true,  jsonb_build_array(jsonb_build_array('Serviço de catering (por pessoa)', 40))),
      jsonb_build_array(25, 15, c_escola,      true,  jsonb_build_array(jsonb_build_array('Serviço de catering (por pessoa)', 60), jsonb_build_array('Sumo de maracujá', 60))),
      jsonb_build_array(12, 15, c_transportes, false, jsonb_build_array(jsonb_build_array('Frango à zambeziana', 12), jsonb_build_array('Refresco natural', 12))),
      jsonb_build_array(3,  30, c_mercearia,   false, jsonb_build_array(jsonb_build_array('Serviço de catering (por pessoa)', 25))))
    WHEN 'retail' THEN jsonb_build_array(
      jsonb_build_array(40, 15, c_escola,      true,  jsonb_build_array(jsonb_build_array('Arroz 5 kg', 20), jsonb_build_array('Óleo alimentar 1 L', 20))),
      jsonb_build_array(22, 15, c_construtora, true,  jsonb_build_array(jsonb_build_array('Água mineral 1,5 L', 120))),
      jsonb_build_array(10, 15, c_mercearia,   false, jsonb_build_array(jsonb_build_array('Farinha de milho 5 kg', 15), jsonb_build_array('Açúcar 1 kg', 30))),
      jsonb_build_array(2,  30, c_transportes, false, jsonb_build_array(jsonb_build_array('Refrigerante 2 L', 24), jsonb_build_array('Água mineral 1,5 L', 48))))
    ELSE jsonb_build_array(
      jsonb_build_array(45, 15, c_construtora, true,  jsonb_build_array(jsonb_build_array('Saco de cimento 50 kg', 40))),
      jsonb_build_array(30, 15, c_mercearia,   true,  jsonb_build_array(jsonb_build_array('Resma de papel A4', 10), jsonb_build_array('Água mineral 1,5 L (caixa de 6)', 5))),
      jsonb_build_array(20, 15, c_escola,      false, jsonb_build_array(jsonb_build_array('Consultoria (hora)', 4))),
      jsonb_build_array(12, 15, c_ana,         true,  jsonb_build_array(jsonb_build_array('Instalação e manutenção', 1), jsonb_build_array('Transporte e entrega', 1))),
      jsonb_build_array(5,  30, c_transportes, false, jsonb_build_array(jsonb_build_array('Água mineral 1,5 L (caixa de 6)', 10))),
      jsonb_build_array(1,  30, c_construtora, false, jsonb_build_array(jsonb_build_array('Saco de cimento 50 kg', 20), jsonb_build_array('Transporte e entrega', 1))))
  END;

  FOR r IN
    SELECT (x->>0)::int AS days_ago, (x->>1)::int AS term, (x->>2)::uuid AS client_id, (x->>3)::boolean AS paid,
           -- Linhas com id e preço do produto.
           (SELECT jsonb_agg(jsonb_build_array(p.id, p.name, (y->>1)::numeric, p.price))
              FROM jsonb_array_elements(x->4) y
              JOIN products p ON p.id = (v_prod ->> (y->>0))::uuid) AS lines
      FROM jsonb_array_elements(v_invoices) x
  LOOP
    v_seq := v_seq + 1;
    INSERT INTO invoices (
      company_id, client_id, invoice_number, date, due_date,
      subtotal, total, amount_paid, amount_pending, status, payment_date,
      document_type, origin, notes, created_by, issued_at, is_demo
    )
    SELECT
      p_company_id, r.client_id,
      'DEMO ' || lpad(v_seq::text, 5, '0'),
      CURRENT_DATE - r.days_ago,
      CURRENT_DATE - r.days_ago + r.term,
      tot, tot,
      CASE WHEN r.paid THEN tot ELSE 0 END,
      CASE WHEN r.paid THEN 0 ELSE tot END,
      CASE WHEN r.paid THEN 'paga'
           WHEN CURRENT_DATE - r.days_ago + r.term < CURRENT_DATE THEN 'vencida'
           ELSE 'pendente' END,
      CASE WHEN r.paid THEN CURRENT_DATE - r.days_ago + 3 END,
      'FT', 'app', 'Factura de demonstração', v_uid,
      (CURRENT_DATE - r.days_ago)::timestamptz + interval '10 hours',
      true
    FROM (
      SELECT sum((l2->>2)::numeric * (l2->>3)::numeric) AS tot
        FROM jsonb_array_elements(r.lines) l2
    ) s
    RETURNING id INTO v_inv;

    INSERT INTO invoice_items (invoice_id, product_id, product_name, description, quantity, unit_price, subtotal, total)
    SELECT v_inv, (l2->>0)::uuid, l2->>1, l2->>1, (l2->>2)::numeric, (l2->>3)::numeric,
           (l2->>2)::numeric * (l2->>3)::numeric, (l2->>2)::numeric * (l2->>3)::numeric
      FROM jsonb_array_elements(r.lines) l2;
  END LOOP;

  -- POS: zonas, mesas, operadores e definições ----------------------------------------
  IF v_type IN ('restaurant', 'retail') THEN
    IF v_type = 'restaurant' THEN
      FOR r IN
        SELECT * FROM (VALUES ('Sala', 'fa-chair', 0, 'S', 6, 4), ('Esplanada', 'fa-umbrella-beach', 1, 'E', 4, 2), ('Balcão', 'fa-martini-glass', 2, 'B', 3, 1))
          AS t(name, icon, sort_order, prefix, n, seats)
      LOOP
        INSERT INTO pos_zones (company_id, name, icon, sort_order, is_active, is_demo)
        VALUES (p_company_id, r.name, r.icon, r.sort_order, true, true)
        RETURNING id INTO v_id;
        INSERT INTO pos_tables (company_id, zone_id, name, seats, sort_order, is_active, is_demo)
        SELECT p_company_id, v_id, r.prefix || g, r.seats, g, true, true FROM generate_series(1, r.n) g;
      END LOOP;
    END IF;

    -- Todos os operadores de demonstração entram com o PIN 1111.
    INSERT INTO pos_staff (company_id, name, role, permissions, color, avatar_url, pin_hash, is_active, is_demo)
    SELECT p_company_id, t.name, t.role, t.permissions, t.color, t.avatar, crypt('1111', gen_salt('bf', 8)), true, true
      FROM (VALUES
        ('restaurant', 'Gustavo Felix',   'waiter',  '{"sell": true, "can_charge": true, "max_discount_pct": 5}'::jsonb, '#0ea5e9', 'assets/demo/avatars/gustavo-felix.svg'),
        ('restaurant', 'Marta Cossa',     'cashier', '{"max_discount_pct": 10}'::jsonb, '#f16c39', 'assets/demo/avatars/marta-cossa.svg'),
        ('restaurant', 'Helena Mondlane', 'manager', '{}'::jsonb, '#8b5cf6', 'assets/demo/avatars/helena-mondlane.svg'),
        ('retail',     'Marta Cossa',     'cashier', '{"max_discount_pct": 10}'::jsonb, '#f16c39', 'assets/demo/avatars/marta-cossa.svg'),
        ('retail',     'Gustavo Felix',   'cashier', '{"max_discount_pct": 5}'::jsonb, '#0ea5e9', 'assets/demo/avatars/gustavo-felix.svg'),
        ('retail',     'Helena Mondlane', 'manager', '{}'::jsonb, '#8b5cf6', 'assets/demo/avatars/helena-mondlane.svg')
      ) AS t(btype, name, role, permissions, color, avatar)
     WHERE t.btype = v_type;

    UPDATE companies
       SET pos_business_type = v_type,
           pos_trial = true,
           pos_settings = COALESCE(pos_settings, '{}'::jsonb) || jsonb_build_object(
             'paper_width', 80,
             'payment_methods', jsonb_build_array('cash', 'mpesa', 'emola', 'card'),
             'mobile_timeout', 90,
             'receipt_footer', 'Obrigado e volte sempre!',
             'cash', jsonb_build_object('default_float', 1000, 'tolerance', 50, 'blind_close', false))
     WHERE id = p_company_id;
  END IF;

  PERFORM set_config('app.demo_data', '', true);

  RETURN jsonb_build_object('seeded', true, 'business_type', v_type, 'clients', 5,
                            'products', v_products, 'invoices', v_seq);
END;
$$;

-- 5. Remover: também a demo do POS -------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_demo_data(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid;
  v_invoices int;
  v_clients int;
  v_products int := 0;
  v_pos int := 0;
  r record;
BEGIN
  SELECT account_id INTO v_account FROM companies WHERE id = p_company_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_account_owner(v_account) THEN
    RAISE EXCEPTION 'Só o titular da conta pode remover os dados de demonstração' USING ERRCODE = '42501';
  END IF;

  -- Documentos reais (ex.: notas de crédito) ligados a facturas demo.
  IF EXISTS (
    SELECT 1 FROM invoices r
      JOIN invoices d ON d.id = r.related_invoice_id
     WHERE d.company_id = p_company_id AND d.is_demo AND NOT r.is_demo
  ) THEN
    RAISE EXCEPTION 'Há documentos reais associados a facturas de demonstração; não é possível removê-las.'
      USING ERRCODE = 'P0001', DETAIL = 'DEMO_DATA_IN_USE';
  END IF;

  PERFORM set_config('app.demo_data', 'on', true);

  -- Os pagamentos e as linhas caem em cascata.
  DELETE FROM invoices WHERE company_id = p_company_id AND is_demo;
  GET DIAGNOSTICS v_invoices = ROW_COUNT;

  -- Clientes demo já usados em facturas reais ficam (como clientes normais).
  DELETE FROM clients c
   WHERE c.company_id = p_company_id AND c.is_demo
     AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.client_id = c.id);
  GET DIAGNOSTICS v_clients = ROW_COUNT;
  UPDATE clients SET is_demo = false WHERE company_id = p_company_id AND is_demo;

  -- Produtos, operadores, mesas, zonas e categorias demo: os que já foram usados
  -- em vendas reais ficam (como dados normais; os operadores ficam inactivos).
  FOR r IN SELECT id FROM products WHERE company_id = p_company_id AND is_demo LOOP
    BEGIN
      DELETE FROM products WHERE id = r.id
        AND NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.product_id = r.id);
      IF FOUND THEN v_products := v_products + 1; END IF;
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
  END LOOP;
  UPDATE products SET is_demo = false WHERE company_id = p_company_id AND is_demo;

  DELETE FROM pos_operator_sessions o USING pos_staff s
   WHERE o.staff_id = s.id AND s.company_id = p_company_id AND s.is_demo;
  FOR r IN SELECT id FROM pos_staff WHERE company_id = p_company_id AND is_demo LOOP
    BEGIN
      DELETE FROM pos_staff WHERE id = r.id;
      v_pos := v_pos + 1;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE pos_staff SET is_active = false, is_demo = false WHERE id = r.id;
    END;
  END LOOP;

  FOR r IN SELECT id FROM pos_tables WHERE company_id = p_company_id AND is_demo LOOP
    BEGIN
      DELETE FROM pos_tables WHERE id = r.id;
      v_pos := v_pos + 1;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE pos_tables SET is_demo = false WHERE id = r.id;
    END;
  END LOOP;
  -- As mesas que ficarem perdem a zona (ON DELETE SET NULL).
  DELETE FROM pos_zones WHERE company_id = p_company_id AND is_demo;
  DELETE FROM product_categories WHERE company_id = p_company_id AND is_demo;

  -- Recibos emitidos sobre facturas demo: se não restar nenhum, a série recomeça.
  IF NOT EXISTS (SELECT 1 FROM payments WHERE company_id = p_company_id) THEN
    UPDATE companies SET receipt_next_number = 1 WHERE id = p_company_id;
  END IF;

  PERFORM set_config('app.demo_data', '', true);

  RETURN jsonb_build_object('invoices', v_invoices, 'clients', v_clients, 'products', v_products, 'pos', v_pos);
END;
$$;

REVOKE ALL ON FUNCTION public.seed_demo_data(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_demo_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_demo_data(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_demo_data(uuid) TO authenticated;
