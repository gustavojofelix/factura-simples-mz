-- Migration: Seed initial content for terms and privacy in landing_content
INSERT INTO public.landing_content (section, content)
VALUES
  (
    'terms',
    '{
      "title": "Termos de Uso",
      "subtitle": "As regras para utilizar o ISPC Fácil de forma segura e transparente.",
      "intro": "Ao criar uma conta ou utilizar o ISPC Fácil, confirma que leu e aceita estes termos de uso.",
      "lastUpdatedText": "Última actualização: 2026",
      "sections": [
        {
          "title": "1. Aceitação dos termos",
          "content": "Estes termos regulam o acesso e a utilização da plataforma ISPC Fácil. Caso não concorde com alguma condição, não deverá utilizar o serviço."
        },
        {
          "title": "2. Descrição do serviço",
          "content": "O ISPC Fácil é uma ferramenta de apoio à facturação, gestão financeira e cálculo do ISPC para empreendedores e empresas em Moçambique."
        },
        {
          "title": "3. Responsabilidades do utilizador",
          "content": "O utilizador compromete-se a fornecer informações verdadeiras e actualizadas, proteger as suas credenciais e utilizar a plataforma em conformidade com a legislação aplicável."
        },
        {
          "title": "4. Limitação de responsabilidade",
          "content": "A plataforma é uma ferramenta de apoio. A responsabilidade final pela exactidão das informações, facturas, declarações fiscais e pagamentos pertence ao utilizador."
        },
        {
          "title": "5. Disponibilidade e alterações",
          "content": "Podemos actualizar, melhorar ou alterar funcionalidades do serviço. Poderemos também actualizar estes termos, comunicando as alterações relevantes através da plataforma."
        },
        {
          "title": "6. Contacto",
          "content": "Para questões sobre estes termos ou sobre a utilização do serviço, utilize os canais de contacto disponibilizados na plataforma."
        }
      ]
    }'::jsonb
  ),
  (
    'privacy',
    '{
      "title": "Política de Privacidade",
      "subtitle": "Como o ISPC Fácil recolhe, utiliza e protege os seus dados.",
      "intro": "A sua privacidade é importante para nós. Esta política explica de forma clara que dados recolhemos e para que finalidades os utilizamos.",
      "lastUpdatedText": "Última actualização: 2026",
      "sections": [
        {
          "title": "1. Dados que recolhemos",
          "content": "Podemos recolher o seu nome, endereço de email, telefone e informações da sua empresa quando cria uma conta, utiliza a plataforma ou entra em contacto connosco."
        },
        {
          "title": "2. Como utilizamos os seus dados",
          "content": "Utilizamos estas informações para disponibilizar os serviços de facturação, calcular o ISPC, gerir a sua conta, prestar suporte e comunicar informações importantes sobre o serviço."
        },
        {
          "title": "3. Protecção e conservação",
          "content": "Aplicamos medidas técnicas e organizativas para proteger os seus dados contra acesso, alteração ou divulgação não autorizados. Conservamos os dados apenas durante o tempo necessário para cumprir as finalidades descritas e as obrigações legais aplicáveis."
        },
        {
          "title": "4. Partilha de informações",
          "content": "Não vendemos os seus dados pessoais. Apenas os partilhamos com prestadores essenciais ao funcionamento da plataforma ou quando tal for exigido por lei, incluindo pelas autoridades competentes."
        },
        {
          "title": "5. Os seus direitos",
          "content": "Pode solicitar o acesso, a rectificação ou a eliminação dos seus dados, bem como esclarecer dúvidas sobre esta política, através dos canais de contacto disponibilizados na plataforma."
        }
      ]
    }'::jsonb
  )
ON CONFLICT (section) DO NOTHING;
