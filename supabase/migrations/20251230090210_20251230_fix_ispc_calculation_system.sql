/*
  # Corrigir Sistema de Cálculo de ISPC
  
  ## Alterações
  
  ### 1. Tabela companies
    - Adiciona campo `business_activity_type` (tipo de atividade para determinar taxa ISPC)
    - Valores possíveis:
      - 'comercio_ate_1m': Comércio/Indústria - Volume anual até 1.000.000 MT (taxa 3%)
      - 'comercio_1m_2.5m': Comércio/Indústria - Volume anual 1M-2.5M MT (taxa 4%)
      - 'comercio_2.5m_4m': Comércio/Indústria - Volume anual 2.5M-4M MT (taxa 5%)
      - 'servicos_gerais': Serviços gerais (canalização, carpintaria, etc) (taxa 12%)
      - 'servicos_liberais': Profissões liberais (advogados, engenheiros, etc) (taxa 15%)
      - 'agricola_pecuaria': Atividades agrícola, pecuária, silvícola, pesqueira, avícola, apícola
  
  ### 2. Tabela products
    - Remove campo `ispc_category` (não mais necessário)
    - Remove campo `ispc_rate` (imposto é calculado a nível de empresa, não de produto)
  
  ### 3. Tabela invoice_items
    - Remove campo `ispc_rate` (não mais necessário)
    - Remove campo `ispc_amount` (não mais necessário)
  
  ### 4. Tabela invoices
    - Remove campo `ispc_amount` (não mais necessário nas faturas)
  
  ## Justificativa
  
  O ISPC é calculado baseado no volume anual de negócios da EMPRESA e no tipo de atividade,
  não baseado em produtos ou itens individuais. As faturas devem mostrar apenas valores de
  vendas, e o cálculo de ISPC é feito trimestralmente no Modelo 30.
*/

-- Adicionar campo business_activity_type na tabela companies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'companies' AND column_name = 'business_activity_type'
  ) THEN
    ALTER TABLE companies ADD COLUMN business_activity_type text DEFAULT 'comercio_ate_1m';
    
    -- Adicionar constraint para valores válidos
    ALTER TABLE companies ADD CONSTRAINT companies_business_activity_type_check 
      CHECK (business_activity_type IN (
        'comercio_ate_1m',
        'comercio_1m_2.5m', 
        'comercio_2.5m_4m',
        'servicos_gerais',
        'servicos_liberais',
        'agricola_pecuaria'
      ));
  END IF;
END $$;

-- Remover campos de ISPC da tabela products
DO $$
BEGIN
  -- Remover ispc_category se existir
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'products' AND column_name = 'ispc_category'
  ) THEN
    ALTER TABLE products DROP COLUMN ispc_category;
  END IF;
  
  -- Remover ispc_rate se existir
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'products' AND column_name = 'ispc_rate'
  ) THEN
    ALTER TABLE products DROP COLUMN ispc_rate;
  END IF;
END $$;

-- Remover campos de ISPC da tabela invoice_items
DO $$
BEGIN
  -- Remover ispc_rate se existir
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoice_items' AND column_name = 'ispc_rate'
  ) THEN
    ALTER TABLE invoice_items DROP COLUMN ispc_rate;
  END IF;
  
  -- Remover ispc_amount se existir
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoice_items' AND column_name = 'ispc_amount'
  ) THEN
    ALTER TABLE invoice_items DROP COLUMN ispc_amount;
  END IF;
END $$;

-- Remover campo ispc_amount da tabela invoices
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'ispc_amount'
  ) THEN
    ALTER TABLE invoices DROP COLUMN ispc_amount;
  END IF;
END $$;

-- Comentário explicativo na tabela companies
COMMENT ON COLUMN companies.business_activity_type IS 'Tipo de atividade da empresa para cálculo de ISPC. Determina a taxa aplicável baseado no volume anual de negócios e natureza da atividade.';
