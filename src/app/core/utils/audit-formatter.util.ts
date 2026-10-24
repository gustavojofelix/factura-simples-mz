import { currentLocale, t } from '../i18n/i18n';

export interface FormattedAuditItem {
  label: string;
  value: string;
  isChange?: boolean;
  oldValue?: string;
  newValue?: string;
}

/** Campos de 'details' com rótulo traduzido em audit.fields.<campo>. */
const KNOWN_FIELDS = new Set([
  'records_count',
  'count',
  'is_active',
  'status',
  'new_status',
  'name',
  'full_name',
  'email',
  'phone',
  'nuit',
  'code',
  'price',
  'stock',
  'unit',
  'type',
  'company_id',
  'company_name',
  'subscriber_id',
  'invoice_number',
  'receipt_number',
  'selected_clients',
  'invoice_id',
  'client_name',
  'client_id',
  'amount',
  'total',
  'subtotal',
  'tax_amount',
  'method',
  'payment_method',
  'billing_cycle',
  'plan_name',
  'plan',
  'scope',
  'discount_percent',
  'valid_until',
  'notes',
  'reason',
  'role',
  'tax_rate',
  'address',
  'currency',
  'description',
  'document_number',
  'due_date',
  'issue_date',
  'start_date',
  'end_date',
  'payment_date',
  'next_billing_date',
  'created_at',
  'updated_at',
  'old_total',
  'new_total',
  'old_role',
  'target_user_id',
  'payment_id',
  'reference',
  'reference_code',
  'items_count',
  'user_email',
  'period',
  'category',
  'ip_address',
  'invoice_total',
  'amount_paid',
  'amount_pending',
  'ispc_amount',
  'user_name'
]);

/** Valores com tradução em audit.values.<valor> (os valores em si vêm da base de dados). */
const KNOWN_VALUES = new Set([
  'true',
  'false',
  'active',
  'suspended',
  'inactive',
  'trial',
  'servico',
  'produto',
  'monthly',
  'yearly',
  'quarterly',
  'semiannual',
  'admin',
  'manager',
  'user',
  'cash',
  'mpesa',
  'emola',
  'bank_transfer',
  'pos',
  'draft',
  'issued',
  'paid',
  'cancelled',
  'password_reset_recovery',
  'rascunho',
  'pendente',
  'paga',
  'vencida',
  'anulada',
  'submetida',
  'atrasada',
  'dinheiro',
  'transferencia',
  'cheque',
  'carteira_movel',
  'outro'
]);

const CURRENCY_KEYS = [
  'price', 'amount', 'total', 'subtotal', 'tax_amount', 'old_total', 'new_total',
  'invoice_total', 'amount_paid', 'amount_pending', 'ispc_amount'
];

function normalizeAuditKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** Formata datas ISO; por omissão DD/MM/AAAA (as páginas da empresa passam o formato de Configurações > Sistema). */
export type AuditDateFormatter = (iso: string) => string;

export function formatAuditValue(key: string, val: any, formatDate?: AuditDateFormatter): string {
  if (val === null || val === undefined || val === '') {
    return '—';
  }

  const normalizedKey = normalizeAuditKey(key);

  if (typeof val === 'boolean') {
    if (normalizedKey === 'is_active') {
      return t(val ? 'common.status.active' : 'audit.values.deactivated');
    }
    return t(val ? 'common.actions.yes' : 'common.actions.no');
  }

  // Monetary values may arrive as numeric strings (e.g. "1500.00" from older entries)
  if (CURRENCY_KEYS.includes(normalizedKey) && typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val.trim())) {
    val = Number(val);
  }

  if (typeof val === 'number') {
    if (CURRENCY_KEYS.includes(normalizedKey)) {
      return new Intl.NumberFormat(currentLocale(), {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(val) + ' MZN';
    }
    if (['tax_rate', 'discount_percent'].includes(normalizedKey)) {
      return `${val}%`;
    }
    if (normalizedKey === 'records_count') {
      return t('audit.formatter.recordsCount', { count: val });
    }
    return val.toString();
  }

  const str = String(val).trim();
  const lower = str.toLowerCase();

  if (KNOWN_VALUES.has(lower)) {
    return t(`audit.values.${lower}`);
  }

  // Check if ISO Date format
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return formatDate ? formatDate(str) : d.toLocaleDateString(currentLocale());
    }
  }

  return str;
}

export function formatAuditLabel(key: string): string {
  const normalizedKey = normalizeAuditKey(key);
  if (KNOWN_FIELDS.has(key)) return t(`audit.fields.${key}`);
  if (KNOWN_FIELDS.has(normalizedKey)) return t(`audit.fields.${normalizedKey}`);
  return normalizedKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function formatAuditDetails(rawDetails: any, formatDate?: AuditDateFormatter): FormattedAuditItem[] {
  if (!rawDetails) return [];

  let details = rawDetails;
  if (typeof details === 'string') {
    try {
      details = JSON.parse(details);
    } catch {
      return [{ label: t('audit.formatter.details'), value: details }];
    }
  }

  if (typeof details !== 'object' || details === null) {
    return [{ label: t('audit.formatter.details'), value: String(details) }];
  }

  const items: FormattedAuditItem[] = [];

  // 1. Check if updates and/or old are present
  const updates = details.updates;
  const oldValues = details.old;

  if (updates && typeof updates === 'object') {
    for (const [key, newVal] of Object.entries(updates)) {
      const oldVal = oldValues && typeof oldValues === 'object' ? oldValues[key] : undefined;
      if (oldVal !== undefined) {
        items.push({
          label: formatAuditLabel(key),
          value: t('audit.formatter.changeFromTo', {
            old: formatAuditValue(key, oldVal, formatDate),
            new: formatAuditValue(key, newVal, formatDate)
          }),
          isChange: true,
          oldValue: formatAuditValue(key, oldVal, formatDate),
          newValue: formatAuditValue(key, newVal, formatDate)
        });
      } else {
        items.push({
          label: formatAuditLabel(key),
          value: formatAuditValue(key, newVal, formatDate)
        });
      }
    }
  }

  // 2. Add other fields in details (excluding 'updates' and 'old')
  for (const [key, val] of Object.entries(details)) {
    if (key === 'updates' || key === 'old') continue;

    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      // Nested object
      for (const [subKey, subVal] of Object.entries(val)) {
        items.push({
          label: `${formatAuditLabel(key)}: ${formatAuditLabel(subKey)}`,
          value: formatAuditValue(subKey, subVal, formatDate)
        });
      }
    } else if (Array.isArray(val)) {
      items.push({
        label: formatAuditLabel(key),
        value: val.map(item => typeof item === 'object' ? JSON.stringify(item) : formatAuditValue(key, item, formatDate)).join(', ')
      });
    } else {
      items.push({
        label: formatAuditLabel(key),
        value: formatAuditValue(key, val, formatDate)
      });
    }
  }

  return items;
}

export interface AuditCategory {
  id: string;
  label: string;
}

/** Categorias gravadas em audit_logs.category; o rótulo está em audit.categories.<id>. */
export const AUDIT_CATEGORY_IDS = [
  'auth', 'clients', 'products', 'invoices', 'reports', 'declarations',
  'payments', 'settings', 'users', 'subscriptions', 'system'
] as const;

/** Categorias com o rótulo na língua da interface (chamar em tempo de execução). */
export function getAuditCategories(): AuditCategory[] {
  return AUDIT_CATEGORY_IDS.map(id => ({ id, label: t(`audit.categories.${id}`) }));
}

export function getAuditCategoryLabel(category: string): string {
  return (AUDIT_CATEGORY_IDS as readonly string[]).includes(category)
    ? t(`audit.categories.${category}`)
    : category;
}

export function getAuditCategoryBadge(category: string): string {
  switch (category) {
    case 'auth': return 'bg-cyan-50 border-cyan-200 text-cyan-700';
    case 'clients': return 'bg-sky-50 border-sky-200 text-sky-700';
    case 'products': return 'bg-violet-50 border-violet-200 text-violet-700';
    case 'invoices': return 'bg-indigo-50 border-indigo-200 text-indigo-700';
    case 'reports': return 'bg-emerald-50 border-emerald-200 text-emerald-700';
    case 'declarations': return 'bg-amber-50 border-amber-200 text-amber-700';
    case 'payments': return 'bg-green-50 border-green-200 text-green-700';
    case 'settings': return 'bg-purple-50 border-purple-200 text-purple-700';
    case 'users': return 'bg-pink-50 border-pink-200 text-pink-700';
    case 'subscriptions': return 'bg-rose-50 border-rose-200 text-rose-700';
    default: return 'bg-slate-50 border-slate-200 text-slate-700';
  }
}

export function getAuditCategoryIcon(category: string): string {
  switch (category) {
    case 'auth': return 'login';
    case 'clients': return 'people';
    case 'products': return 'inventory_2';
    case 'invoices': return 'receipt_long';
    case 'reports': return 'bar_chart';
    case 'declarations': return 'description';
    case 'payments': return 'payments';
    case 'settings': return 'settings';
    case 'users': return 'manage_accounts';
    case 'subscriptions': return 'workspace_premium';
    default: return 'history';
  }
}
