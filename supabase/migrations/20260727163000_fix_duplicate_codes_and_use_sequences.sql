/*
  # Correção de Códigos Duplicados e Implementação de Sequências
  
  1. Identificação e resolução de duplicações em `subscriber_code` e `company_code`.
  2. Criação de Sequências PostgreSQL (`seq_subscriber_code`, `seq_company_code`) para garantir a unicidade absoluta mesmo durante milhares de transações simultâneas.
  3. Atualização das funções de Trigger (`assign_subscriber_code` e `assign_company_code`) para utilizarem as novas sequências.
  4. Adição de Restrições UNIQUE nas tabelas para impedir que falhas externas introduzam duplicados no futuro.
*/

-- 1. Resolver Duplicados Existentes em Subscritores
DO $$ 
DECLARE
  rec RECORD;
  current_max INT;
BEGIN
  -- Obter o número mais alto atualmente em uso
  SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(subscriber_code, '^SUB', ''), '')::INTEGER), 0)
  INTO current_max
  FROM profiles
  WHERE subscriber_code ~ '^SUB[0-9]+$';

  -- Loop pelos registos que são duplicados (mantém o mais antigo, reatribui aos mais recentes)
  FOR rec IN (
    SELECT id
    FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY subscriber_code ORDER BY created_at ASC) as rn
      FROM profiles
      WHERE subscriber_code IS NOT NULL
    ) sub
    WHERE rn > 1
  ) LOOP
    current_max := current_max + 1;
    UPDATE profiles 
    SET subscriber_code = 'SUB' || LPAD(current_max::TEXT, 4, '0')
    WHERE id = rec.id;
  END LOOP;
END $$;

-- 2. Resolver Duplicados Existentes em Contribuintes (Empresas)
DO $$ 
DECLARE
  rec RECORD;
  current_max INT;
BEGIN
  -- Obter o número mais alto atualmente em uso
  SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(company_code, '^CTB', ''), '')::INTEGER), 0)
  INTO current_max
  FROM companies
  WHERE company_code ~ '^CTB[0-9]+$';

  -- Loop pelos registos que são duplicados (mantém o mais antigo, reatribui aos mais recentes)
  FOR rec IN (
    SELECT id
    FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY company_code ORDER BY created_at ASC) as rn
      FROM companies
      WHERE company_code IS NOT NULL
    ) sub
    WHERE rn > 1
  ) LOOP
    current_max := current_max + 1;
    UPDATE companies 
    SET company_code = 'CTB' || LPAD(current_max::TEXT, 4, '0')
    WHERE id = rec.id;
  END LOOP;
END $$;

-- 3. Criar e Inicializar as Sequências
CREATE SEQUENCE IF NOT EXISTS seq_subscriber_code;
CREATE SEQUENCE IF NOT EXISTS seq_company_code;

DO $$ 
DECLARE
  max_sub INT;
  max_ctb INT;
BEGIN
  -- Definir a sequência dos subscritores para arrancar a partir do maior número existente
  SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(subscriber_code, '^SUB', ''), '')::INTEGER), 0)
  INTO max_sub
  FROM profiles
  WHERE subscriber_code ~ '^SUB[0-9]+$';

  PERFORM setval('seq_subscriber_code', GREATEST(max_sub, 1));

  -- Definir a sequência dos contribuintes para arrancar a partir do maior número existente
  SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(company_code, '^CTB', ''), '')::INTEGER), 0)
  INTO max_ctb
  FROM companies
  WHERE company_code ~ '^CTB[0-9]+$';

  PERFORM setval('seq_company_code', GREATEST(max_ctb, 1));
END $$;

-- 4. Atualizar as Funções de Trigger para usarem as Sequências (Atómicas e Livres de Race Conditions)
CREATE OR REPLACE FUNCTION assign_subscriber_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.subscriber_code IS NULL OR NEW.subscriber_code = '' THEN
    NEW.subscriber_code := 'SUB' || LPAD(nextval('seq_subscriber_code')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assign_company_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.company_code IS NULL OR NEW.company_code = '' THEN
    NEW.company_code := 'CTB' || LPAD(nextval('seq_company_code')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Adicionar Restrições UNIQUE (Opcionalmente, remover antigas se já existirem)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS unique_subscriber_code;
ALTER TABLE profiles ADD CONSTRAINT unique_subscriber_code UNIQUE (subscriber_code);

ALTER TABLE companies DROP CONSTRAINT IF EXISTS unique_company_code;
ALTER TABLE companies ADD CONSTRAINT unique_company_code UNIQUE (company_code);
