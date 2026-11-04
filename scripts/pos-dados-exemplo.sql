-- =============================================================================
-- POS — dados de exemplo (no máximo 3 por entidade) para a conta alvor-software
--
-- Correr no SQL Editor do Supabase (produção), DEPOIS das migrações do POS.
-- Pode correr-se várias vezes: não duplica nada.
--
-- Cria:
--   · excepção "POS activo" para a empresa (sem mexer no plano)
--   · configuração: Restaurante / Bar, 80 mm, tolerância de 50 MZN
--   · 3 categorias, 3 produtos, 3 clientes com NUIT
--   · 3 funcionários com PIN: Ana (Caixa) 2580 · Carlos (Gerente) 9731 · Fátima (Empregada) 3691
--   · 3 zonas, 3 mesas (S1, E1, B1)
--   · 3 terminais (por emparelhar: o código gera-se na aplicação, em Terminais)
--
-- NÃO cria vendas: em produção cada venda é uma factura-recibo real.
--
-- Se a conta tiver mais do que uma empresa, escreva o nome em v_company_name.
-- =============================================================================
DO $$
DECLARE
  v_account_slug text := 'alvor-software';
  v_company_name text := NULL;           -- ex.: 'Alvor Software Lda'
  v_company uuid;
  v_count integer;
  v_cat_food uuid;
  v_cat_drinks uuid;
  v_cat_shop uuid;
  v_zone_sala uuid;
  v_zone_esplanada uuid;
  v_zone_bar uuid;
BEGIN
  -- 1. Empresa ----------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM companies c JOIN accounts a ON a.id = c.account_id
   WHERE a.slug = v_account_slug
     AND (v_company_name IS NULL OR c.name ILIKE v_company_name);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Nenhuma empresa encontrada na conta % (nome: %).', v_account_slug, COALESCE(v_company_name, 'qualquer');
  ELSIF v_count > 1 THEN
    RAISE EXCEPTION 'A conta % tem % empresas: %. Escreva o nome de uma delas em v_company_name.',
      v_account_slug, v_count,
      (SELECT string_agg('"' || c.name || '"', ', ' ORDER BY c.name)
         FROM companies c JOIN accounts a ON a.id = c.account_id WHERE a.slug = v_account_slug);
  END IF;

  SELECT c.id INTO v_company
    FROM companies c JOIN accounts a ON a.id = c.account_id
   WHERE a.slug = v_account_slug
     AND (v_company_name IS NULL OR c.name ILIKE v_company_name);

  RAISE NOTICE 'Empresa: % (%)', (SELECT name FROM companies WHERE id = v_company), v_company;

  -- 2. POS activo (excepção no backoffice) e configuração ----------------------
  INSERT INTO company_feature_overrides (company_id, feature_code, enabled, notes)
  VALUES (v_company, 'pos', true, 'Dados de exemplo do POS')
  ON CONFLICT (company_id, feature_code) DO UPDATE SET enabled = true;

  UPDATE companies
     SET pos_business_type = 'restaurant',
         pos_settings = jsonb_build_object(
           'paper_width', 80,
           'payment_methods', jsonb_build_array('cash', 'mpesa', 'emola', 'card'),
           'mobile_timeout', 90,
           'receipt_footer', 'Obrigado e volte sempre!',
           'cash', jsonb_build_object('default_float', 1000, 'tolerance', 50, 'blind_close', false))
   WHERE id = v_company;

  -- 3. Categorias -------------------------------------------------------------
  INSERT INTO product_categories (company_id, name, color, icon, sort_order)
  VALUES (v_company, 'Pratos', '#f16c39', 'fa-utensils', 1),
         (v_company, 'Bebidas', '#0ea5e9', 'fa-martini-glass', 2),
         (v_company, 'Mercearia', '#10b981', 'fa-basket-shopping', 3)
  ON CONFLICT (company_id, lower(btrim(name))) DO NOTHING;

  SELECT id INTO v_cat_food FROM product_categories WHERE company_id = v_company AND name = 'Pratos';
  SELECT id INTO v_cat_drinks FROM product_categories WHERE company_id = v_company AND name = 'Bebidas';
  SELECT id INTO v_cat_shop FROM product_categories WHERE company_id = v_company AND name = 'Mercearia';

  -- 4. Produtos (o código PRD000N é atribuído automaticamente) -----------------
  IF NOT EXISTS (SELECT 1 FROM products WHERE company_id = v_company AND name = 'Frango à Zambeziana') THEN
    INSERT INTO products (company_id, name, price, type, unit, stock, category_id, pos_visible, pos_station)
    VALUES (v_company, 'Frango à Zambeziana', 650, 'produto', 'un', NULL, v_cat_food, true, 'kitchen');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE company_id = v_company AND name = '2M (garrafa)') THEN
    INSERT INTO products (company_id, name, price, type, unit, stock, category_id, pos_visible, pos_station)
    VALUES (v_company, '2M (garrafa)', 90, 'produto', 'un', 48, v_cat_drinks, true, 'bar');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE company_id = v_company AND name = 'Arroz Tio Lucas 5kg') THEN
    INSERT INTO products (company_id, name, price, type, unit, stock, barcode, category_id, pos_visible)
    VALUES (v_company, 'Arroz Tio Lucas 5kg', 450, 'produto', 'un', 20, '6001001000011', v_cat_shop, true);
  END IF;

  -- 5. Clientes com NUIT ------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM clients WHERE company_id = v_company AND nuit = '400555666') THEN
    INSERT INTO clients (company_id, name, nuit, phone, email)
    VALUES (v_company, 'Construções Matola Lda', '400555666', '841112233', 'compras@matola.co.mz');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clients WHERE company_id = v_company AND nuit = '400777888') THEN
    INSERT INTO clients (company_id, name, nuit, phone)
    VALUES (v_company, 'Hotel Costa do Sol', '400777888', '823334455');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clients WHERE company_id = v_company AND nuit = '100200300') THEN
    INSERT INTO clients (company_id, name, nuit, phone)
    VALUES (v_company, 'Maria Machava', '100200300', '865556677');
  END IF;

  -- 6. Funcionários e PIN (bcrypt; o PIN nunca fica em claro) -----------------
  IF NOT EXISTS (SELECT 1 FROM pos_staff WHERE company_id = v_company AND name = 'Ana Mabunda') THEN
    INSERT INTO pos_staff (company_id, name, role, color, permissions, pin_hash)
    VALUES (v_company, 'Ana Mabunda', 'cashier', '#f16c39', '{"max_discount_pct": 5}',
            extensions.crypt('2580', extensions.gen_salt('bf', 8)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pos_staff WHERE company_id = v_company AND name = 'Carlos Nhantumbo') THEN
    INSERT INTO pos_staff (company_id, name, role, color, pin_hash)
    VALUES (v_company, 'Carlos Nhantumbo', 'manager', '#0ea5e9',
            extensions.crypt('9731', extensions.gen_salt('bf', 8)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pos_staff WHERE company_id = v_company AND name = 'Fátima Cossa') THEN
    INSERT INTO pos_staff (company_id, name, role, color, pin_hash)
    VALUES (v_company, 'Fátima Cossa', 'waiter', '#8b5cf6',
            extensions.crypt('3691', extensions.gen_salt('bf', 8)));
  END IF;

  -- 7. Zonas e mesas ----------------------------------------------------------
  INSERT INTO pos_zones (company_id, name, icon, sort_order)
  SELECT v_company, z.name, z.icon, z.ord
    FROM (VALUES ('Sala', 'fa-chair', 1), ('Esplanada', 'fa-umbrella-beach', 2), ('Bar', 'fa-martini-glass', 3)) z(name, icon, ord)
   WHERE NOT EXISTS (SELECT 1 FROM pos_zones WHERE company_id = v_company AND name = z.name);

  SELECT id INTO v_zone_sala FROM pos_zones WHERE company_id = v_company AND name = 'Sala' LIMIT 1;
  SELECT id INTO v_zone_esplanada FROM pos_zones WHERE company_id = v_company AND name = 'Esplanada' LIMIT 1;
  SELECT id INTO v_zone_bar FROM pos_zones WHERE company_id = v_company AND name = 'Bar' LIMIT 1;

  INSERT INTO pos_tables (company_id, zone_id, name, seats, sort_order)
  VALUES (v_company, v_zone_sala, 'S1', 4, 1),
         (v_company, v_zone_esplanada, 'E1', 6, 2),
         (v_company, v_zone_bar, 'B1', 2, 3)
  ON CONFLICT (company_id, lower(btrim(name))) DO NOTHING;

  -- 8. Terminais (emparelhar depois na aplicação: Configurações → Ponto de Venda → Terminais) --
  INSERT INTO pos_terminals (company_id, name)
  SELECT v_company, t.name
    FROM (VALUES ('Caixa 1'), ('Bar'), ('Telemóvel Fátima')) t(name)
   WHERE NOT EXISTS (SELECT 1 FROM pos_terminals WHERE company_id = v_company AND name = t.name AND revoked_at IS NULL);

  RAISE NOTICE 'Dados de exemplo do POS criados.';
END $$;

-- Verificação: deve mostrar 3 em cada linha (ou mais, se já existiam dados).
SELECT 'categorias' AS entidade, count(*) FROM product_categories pc JOIN companies c ON c.id = pc.company_id JOIN accounts a ON a.id = c.account_id WHERE a.slug = 'alvor-software'
UNION ALL SELECT 'produtos no POS', count(*) FROM products p JOIN companies c ON c.id = p.company_id JOIN accounts a ON a.id = c.account_id WHERE a.slug = 'alvor-software' AND p.category_id IS NOT NULL
UNION ALL SELECT 'clientes com NUIT', count(*) FROM clients cl JOIN companies c ON c.id = cl.company_id JOIN accounts a ON a.id = c.account_id WHERE a.slug = 'alvor-software' AND cl.nuit IN ('400555666', '400777888', '100200300')
UNION ALL SELECT 'funcionários', count(*) FROM pos_staff s JOIN companies c ON c.id = s.company_id JOIN accounts a ON a.id = c.account_id WHERE a.slug = 'alvor-software'
UNION ALL SELECT 'zonas', count(*) FROM pos_zones z JOIN companies c ON c.id = z.company_id JOIN accounts a ON a.id = c.account_id WHERE a.slug = 'alvor-software'
UNION ALL SELECT 'mesas', count(*) FROM pos_tables t JOIN companies c ON c.id = t.company_id JOIN accounts a ON a.id = c.account_id WHERE a.slug = 'alvor-software'
UNION ALL SELECT 'terminais', count(*) FROM pos_terminals t JOIN companies c ON c.id = t.company_id JOIN accounts a ON a.id = c.account_id WHERE a.slug = 'alvor-software' AND t.revoked_at IS NULL;
