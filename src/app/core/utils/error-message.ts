/**
 * Converte erros do Supabase (PostgREST / Postgres / Auth / Edge Functions / rede)
 * numa mensagem que o utilizador final consegue perceber e corrigir.
 *
 * Regra: nunca mostrar só "Erro ao ..." sem motivo. Quando o erro não é
 * reconhecido, a mensagem genérica é acompanhada do detalhe técnico curto.
 */

const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  nuit: 'NUIT',
  email: 'Email',
  phone: 'Telefone',
  address: 'Endereço',
  city: 'Cidade',
  province: 'Província',
  country: 'País',
  postal_code: 'Código postal',
  entity_type: 'Tipo de entidade',
  code: 'Código',
  barcode: 'Código de barras',
  price: 'Preço',
  unit_price: 'Preço unitário',
  type: 'Tipo',
  quantity: 'Quantidade',
  client_id: 'Cliente',
  company_id: 'Empresa',
  invoice_number: 'Número da factura',
  due_date: 'Data de vencimento',
  issue_date: 'Data de emissão',
  amount: 'Valor',
  role: 'Função',
  description: 'Descrição',
};

/** Mensagens para constraints conhecidas (nome da constraint ou parte dele). */
const CONSTRAINT_MESSAGES: Array<[RegExp, string]> = [
  [/companies.*nuit/i, 'Já existe uma empresa registada com este NUIT.'],
  [/clients.*nuit/i, 'Já existe um cliente com este NUIT nesta empresa.'],
  [/clients.*email/i, 'Já existe um cliente com este email nesta empresa.'],
  [/products.*barcode/i, 'Já existe um produto com este código de barras.'],
  [/products.*code/i, 'Já existe um produto com este código.'],
  [/invoices.*number/i, 'Já existe um documento com este número.'],
  [/company_users/i, 'Este utilizador já tem acesso a esta empresa.'],
  [/profiles.*email|users.*email/i, 'Este email já está registado.'],
  [/valid_role|role_check/i, 'Função de utilizador inválida.'],
  [/entity_type/i, 'Tipo de entidade inválido (use Singular ou Colectiva).'],
  [/products_type_check/i, 'Tipo de produto inválido (use Produto ou Serviço).'],
];

/** Códigos enviados em DETAIL pelas funções/triggers da base de dados. */
const DETAIL_MESSAGES: Record<string, string> = {
  DUPLICATE_COMPANY_NUIT: 'Já existe uma empresa registada com este NUIT.',
  SUBSCRIPTION_EXPIRED: 'A subscrição desta empresa expirou. Renove o plano em Configurações → Subscrição para continuar.',
  SUBSCRIPTION_DOWNGRADE_BLOCKED: 'Não é possível fazer downgrade enquanto a subscrição estiver activa.',
};

const TEXT_MESSAGES: Array<[RegExp, string]> = [
  [/Failed to fetch|Load failed|NetworkError|ERR_CONNECTION|ERR_INTERNET/i, 'Sem ligação ao servidor. Verifique a sua internet e tente novamente.'],
  [/JWT expired|invalid JWT|refresh token/i, 'A sua sessão expirou. Entre novamente no sistema.'],
  [/row-level security|permission denied/i, 'Não tem permissão para esta acção. Apenas o proprietário ou um administrador da empresa a pode fazer.'],
  [/Invalid login credentials/i, 'Email ou palavra-passe incorrectos.'],
  [/Email not confirmed/i, 'Email não confirmado. Verifique a sua caixa de entrada.'],
  [/User already registered|already been registered/i, 'Este email já está registado.'],
  [/rate limit/i, 'Demasiadas tentativas. Aguarde alguns minutos e tente novamente.'],
  [/payload too large|request entity too large/i, 'O ficheiro é demasiado grande.'],
];

function label(column: string): string {
  return FIELD_LABELS[column] ?? column.replace(/_/g, ' ');
}

function truncate(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function friendlyErrorMessage(error: unknown, fallback = 'Ocorreu um erro inesperado.'): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;

  const err = error as any;
  const code: string = err.code ?? '';
  const message: string = err.message ?? err.error_description ?? err.error ?? '';
  const details: string = typeof err.details === 'string' ? err.details : '';

  if (details && DETAIL_MESSAGES[details]) return DETAIL_MESSAGES[details];

  for (const [pattern, text] of TEXT_MESSAGES) {
    if (pattern.test(message)) return text;
  }

  switch (code) {
    // RAISE EXCEPTION das nossas funções/triggers: a mensagem já está em português.
    case 'P0001':
      return message || fallback;
    case '23505': {
      const source = `${message} ${details}`;
      for (const [pattern, text] of CONSTRAINT_MESSAGES) {
        if (pattern.test(source)) return text;
      }
      const field = /Key \(([^)]+)\)/.exec(details)?.[1];
      return field
        ? `Já existe um registo com o mesmo ${field.split(',').map(f => label(f.trim())).join(' / ')}.`
        : 'Já existe um registo com estes dados.';
    }
    case '23502': {
      const column = /column "([^"]+)"/.exec(message)?.[1];
      return column ? `O campo «${label(column)}» é obrigatório.` : 'Falta preencher um campo obrigatório.';
    }
    case '23514': {
      for (const [pattern, text] of CONSTRAINT_MESSAGES) {
        if (pattern.test(message)) return text;
      }
      const constraint = /constraint "([^"]+)"/.exec(message)?.[1] ?? '';
      const column = Object.keys(FIELD_LABELS).find(c => constraint.includes(c));
      return column ? `Valor inválido no campo «${label(column)}».` : 'Um dos valores introduzidos não é válido.';
    }
    case '23503':
      return /delete|update or delete/i.test(message)
        ? 'Este registo está a ser usado noutros documentos e não pode ser eliminado.'
        : 'O registo associado (cliente, produto ou empresa) já não existe.';
    case '22001':
      return 'Um dos campos excede o tamanho máximo permitido.';
    case '22P02':
    case '22007':
    case '22008':
      return 'Um dos campos tem um formato inválido (número ou data).';
    case '42501':
    case 'PGRST301':
      return 'Não tem permissão para esta acção. Apenas o proprietário ou um administrador da empresa a pode fazer.';
    case 'PGRST116':
      return 'O registo não foi encontrado ou não tem acesso a ele.';
  }

  if (err.status >= 500) return `${fallback} O servidor não respondeu correctamente; tente novamente dentro de instantes.`;

  return message ? `${fallback} Motivo: ${truncate(message)}` : fallback;
}

/**
 * Para erros de supabase.functions.invoke: o corpo da resposta (com a mensagem
 * em português devolvida pela Edge Function) fica em error.context.
 */
export async function friendlyFunctionError(error: unknown, fallback = 'Ocorreu um erro inesperado.'): Promise<string> {
  const context = (error as any)?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.clone().json();
      const text = body?.error || body?.message;
      if (typeof text === 'string' && text.trim()) return text;
    } catch {
      // corpo não é JSON; segue para a tradução genérica
    }
  }
  return friendlyErrorMessage(error, fallback);
}
