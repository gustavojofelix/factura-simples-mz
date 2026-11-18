/*
  pos_staff tem permissões por coluna (o hash do PIN nunca é lido directamente).
  As colunas novas de 20261118100000 (avatar_url, is_demo) têm de ser concedidas,
  senão a lista de funcionários em Configurações → Ponto de Venda falha.
  O avatar também pode ser definido pela aplicação; is_demo só pelo seed.
*/
GRANT SELECT (avatar_url, is_demo) ON public.pos_staff TO authenticated;
GRANT INSERT (avatar_url) ON public.pos_staff TO authenticated;
GRANT UPDATE (avatar_url) ON public.pos_staff TO authenticated;
