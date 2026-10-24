/**
 * Converte erros do Supabase (PostgREST / Postgres / Auth / Edge Functions / rede)
 * numa mensagem que o utilizador final consegue perceber e corrigir.
 *
 * Regra: nunca mostrar só "Erro ao ..." sem motivo. Quando o erro não é
 * reconhecido, a mensagem genérica é acompanhada do detalhe técnico curto.
 *
 * As tabelas abaixo guardam CHAVES de tradução (t() só pode ser chamado depois
 * de as traduções estarem carregadas, por isso é chamado no momento do uso).
 */

import { t } from '../i18n/i18n';

/** Coluna → chave em errors.fields.* */
const FIELD_LABELS: Record<string, string> = {
  name: 'errors.fields.name',
  nuit: 'errors.fields.nuit',
  email: 'errors.fields.email',
  phone: 'errors.fields.phone',
  address: 'errors.fields.address',
  city: 'errors.fields.city',
  province: 'errors.fields.province',
  country: 'errors.fields.country',
  postal_code: 'errors.fields.postalCode',
  entity_type: 'errors.fields.entityType',
  code: 'errors.fields.code',
  barcode: 'errors.fields.barcode',
  price: 'errors.fields.price',
  unit_price: 'errors.fields.unitPrice',
  type: 'errors.fields.type',
  quantity: 'errors.fields.quantity',
  client_id: 'errors.fields.client',
  company_id: 'errors.fields.company',
  invoice_number: 'errors.fields.invoiceNumber',
  due_date: 'errors.fields.dueDate',
  issue_date: 'errors.fields.issueDate',
  amount: 'errors.fields.amount',
  role: 'errors.fields.role',
  description: 'errors.fields.description',
};

/** Mensagens para constraints conhecidas (nome da constraint ou parte dele). */
const CONSTRAINT_MESSAGES: Array<[RegExp, string]> = [
  [/companies.*nuit/i, 'errors.constraints.companyNuit'],
  [/clients.*nuit/i, 'errors.constraints.clientNuit'],
  [/clients.*email/i, 'errors.constraints.clientEmail'],
  [/products.*barcode/i, 'errors.constraints.productBarcode'],
  [/products.*code/i, 'errors.constraints.productCode'],
  [/invoices.*number/i, 'errors.constraints.invoiceNumber'],
  [/company_users/i, 'errors.constraints.companyUser'],
  [/profiles.*email|users.*email/i, 'errors.constraints.emailRegistered'],
  [/valid_role|role_check/i, 'errors.constraints.invalidRole'],
  [/entity_type/i, 'errors.constraints.invalidEntityType'],
  [/products_type_check/i, 'errors.constraints.invalidProductType'],
];

/** Códigos enviados em DETAIL pelas funções/triggers da base de dados. */
const DETAIL_MESSAGES: Record<string, string> = {
  DUPLICATE_COMPANY_NUIT: 'errors.constraints.companyNuit',
  SUBSCRIPTION_EXPIRED: 'errors.details.subscriptionExpired',
  SUBSCRIPTION_DOWNGRADE_BLOCKED: 'errors.details.downgradeBlocked',
};

const TEXT_MESSAGES: Array<[RegExp, string]> = [
  [/Failed to fetch|Load failed|NetworkError|ERR_CONNECTION|ERR_INTERNET/i, 'errors.text.network'],
  [/JWT expired|invalid JWT|refresh token/i, 'errors.text.sessionExpired'],
  [/row-level security|permission denied/i, 'errors.text.permissionDenied'],
  [/Invalid login credentials/i, 'errors.text.invalidCredentials'],
  [/Email not confirmed/i, 'errors.text.emailNotConfirmed'],
  [/User already registered|already been registered/i, 'errors.constraints.emailRegistered'],
  [/rate limit/i, 'errors.text.rateLimit'],
  [/payload too large|request entity too large/i, 'errors.text.fileTooLarge'],
];

function label(column: string): string {
  const key = FIELD_LABELS[column];
  return key ? t(key) : column.replace(/_/g, ' ');
}

function truncate(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function friendlyErrorMessage(error: unknown, fallback = t('errors.unexpected')): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;

  const err = error as any;
  const code: string = err.code ?? '';
  const message: string = err.message ?? err.error_description ?? err.error ?? '';
  const details: string = typeof err.details === 'string' ? err.details : '';

  if (details && DETAIL_MESSAGES[details]) return t(DETAIL_MESSAGES[details]);
  // Outros códigos em DETAIL (ex.: SUBSCRIPTION_INSERT_BLOCKED) vêm das nossas
  // funções/triggers, cuja mensagem já está em português — mesmo com SQLSTATE 42501.
  if (/^[A-Z][A-Z0-9_]+$/.test(details) && message) return message;

  for (const [pattern, key] of TEXT_MESSAGES) {
    if (pattern.test(message)) return t(key);
  }

  switch (code) {
    // RAISE EXCEPTION das nossas funções/triggers: a mensagem já está em português.
    case 'P0001':
      return message || fallback;
    case '23505': {
      const source = `${message} ${details}`;
      for (const [pattern, key] of CONSTRAINT_MESSAGES) {
        if (pattern.test(source)) return t(key);
      }
      const field = /Key \(([^)]+)\)/.exec(details)?.[1];
      return field
        ? t('errors.db.duplicateField', { field: field.split(',').map(f => label(f.trim())).join(' / ') })
        : t('errors.db.duplicate');
    }
    case '23502': {
      const column = /column "([^"]+)"/.exec(message)?.[1];
      return column ? t('errors.db.requiredField', { field: label(column) }) : t('errors.db.required');
    }
    case '23514': {
      for (const [pattern, key] of CONSTRAINT_MESSAGES) {
        if (pattern.test(message)) return t(key);
      }
      const constraint = /constraint "([^"]+)"/.exec(message)?.[1] ?? '';
      const column = Object.keys(FIELD_LABELS).find(c => constraint.includes(c));
      return column ? t('errors.db.invalidField', { field: label(column) }) : t('errors.db.invalid');
    }
    case '23503':
      return /delete|update or delete/i.test(message)
        ? t('errors.db.inUse')
        : t('errors.db.missingReference');
    case '22001':
      return t('errors.db.tooLong');
    case '22P02':
    case '22007':
    case '22008':
      return t('errors.db.invalidFormat');
    case '42501':
    case 'PGRST301':
      return t('errors.text.permissionDenied');
    case 'PGRST116':
      return t('errors.db.notFound');
  }

  if (err.status >= 500) return t('errors.serverUnavailable', { fallback });

  return message ? t('errors.withReason', { fallback, reason: truncate(message) }) : fallback;
}

/**
 * Para erros de supabase.functions.invoke: o corpo da resposta (com a mensagem
 * em português devolvida pela Edge Function) fica em error.context.
 */
export async function friendlyFunctionError(error: unknown, fallback = t('errors.unexpected')): Promise<string> {
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
