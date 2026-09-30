export interface FormattedAuditItem {
  label: string;
  value: string;
  isChange?: boolean;
  oldValue?: string;
  newValue?: string;
}

const KEY_LABELS: Record<string, string> = {
  records_count: 'Total de Registos Afectados',
  count: 'Quantidade',
  is_active: 'Estado de Activação',
  status: 'Estado',
  new_status: 'Novo Estado',
  name: 'Nome',
  full_name: 'Nome Completo',
  email: 'E-mail',
  phone: 'Contacto Telefónico',
  nuit: 'NUIT',
  code: 'Código',
  price: 'Preço Unitário',
  stock: 'Quantidade em Stock',
  unit: 'Unidade de Medida',
  type: 'Tipo',
  company_id: 'ID do Contribuinte',
  company_name: 'Nome da Empresa / Contribuinte',
  subscriber_id: 'ID do Subscritor',
  invoice_number: 'Número da Factura',
  receipt_number: 'Número do Recibo',
  selected_clients: 'Clientes Seleccionados',
  invoice_id: 'ID da Factura',
  client_name: 'Nome do Cliente',
  client_id: 'ID do Cliente',
  amount: 'Valor / Montante',
  total: 'Valor Total',
  subtotal: 'Subtotal',
  tax_amount: 'Valor do Imposto',
  method: 'Método de Pagamento',
  payment_method: 'Método de Pagamento',
  billing_cycle: 'Ciclo de Facturação',
  plan_name: 'Plano',
  plan: 'Plano',
  scope: 'Âmbito de Aplicação',
  discount_percent: 'Percentagem de Desconto',
  valid_until: 'Data de Validade',
  notes: 'Observações / Notas',
  reason: 'Motivo',
  role: 'Função / Papel',
  tax_rate: 'Taxa de Imposto (%)',
  address: 'Endereço',
  currency: 'Moeda',
  description: 'Descrição',
  document_number: 'Número do Documento',
  due_date: 'Data de Vencimento',
  issue_date: 'Data de Emissão',
  start_date: 'Data Inicial',
  end_date: 'Data Final',
  payment_date: 'Data de Pagamento',
  next_billing_date: 'Próxima Data de Cobrança',
  created_at: 'Data de Criação',
  updated_at: 'Data de Actualização',
  old_total: 'Total Anterior',
  new_total: 'Novo Total',
  old_role: 'Função Anterior',
  target_user_id: 'ID do Utilizador',
  payment_id: 'ID do Pagamento',
  reference: 'Referência',
  reference_code: 'Código de Referência',
  items_count: 'Total de Itens',
  user_email: 'E-mail do Utilizador',
  period: 'Período',
  category: 'Categoria',
  ip_address: 'Endereço IP',
  invoice_total: 'Total da Factura',
  amount_paid: 'Total Pago',
  amount_pending: 'Valor Pendente',
  ispc_amount: 'Valor do Imposto (ISPC)',
  user_name: 'Nome do Utilizador'
};

const VALUE_TRANSLATIONS: Record<string, string> = {
  'true': 'Activo / Sim',
  'false': 'Desactivado / Não',
  'active': 'Activo',
  'suspended': 'Suspenso',
  'inactive': 'Inactivo',
  'trial': 'Período de Teste',
  'servico': 'Serviço',
  'produto': 'Produto',
  'monthly': 'Mensal',
  'yearly': 'Anual',
  'quarterly': 'Trimestral',
  'semiannual': 'Semestral',
  'admin': 'Administrador',
  'manager': 'Gestor',
  'user': 'Utilizador',
  'cash': 'Numerário (Dinheiro)',
  'mpesa': 'M-Pesa',
  'emola': 'e-Mola',
  'bank_transfer': 'Transferência Bancária',
  'pos': 'POS / Cartão',
  'draft': 'Rascunho',
  'issued': 'Emitida',
  'paid': 'Paga',
  'cancelled': 'Cancelada',
  'password_reset_recovery': 'Recuperação por E-mail',
  // Invoice / declaration statuses
  'rascunho': 'Rascunho',
  'pendente': 'Pendente',
  'paga': 'Paga',
  'vencida': 'Vencida',
  'anulada': 'Anulada',
  'submetida': 'Submetida',
  'atrasada': 'Atrasada',
  // Invoice payment methods
  'dinheiro': 'Dinheiro',
  'transferencia': 'Transferência Bancária',
  'cheque': 'Cheque',
  'carteira_movel': 'Carteira Móvel',
  'outro': 'Outro'
};

const CURRENCY_KEYS = [
  'price', 'amount', 'total', 'subtotal', 'tax_amount', 'old_total', 'new_total',
  'invoice_total', 'amount_paid', 'amount_pending', 'ispc_amount'
];

function normalizeAuditKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export function formatAuditValue(key: string, val: any): string {
  if (val === null || val === undefined || val === '') {
    return '—';
  }

  const normalizedKey = normalizeAuditKey(key);

  if (typeof val === 'boolean') {
    if (normalizedKey === 'is_active') {
      return val ? 'Activo' : 'Desactivado';
    }
    return val ? 'Sim' : 'Não';
  }

  // Monetary values may arrive as numeric strings (e.g. "1500.00" from older entries)
  if (CURRENCY_KEYS.includes(normalizedKey) && typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val.trim())) {
    val = Number(val);
  }

  if (typeof val === 'number') {
    if (CURRENCY_KEYS.includes(normalizedKey)) {
      return new Intl.NumberFormat('pt-MZ', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(val) + ' MZN';
    }
    if (['tax_rate', 'discount_percent'].includes(normalizedKey)) {
      return `${val}%`;
    }
    if (normalizedKey === 'records_count') {
      return val === 1 ? '1 registo' : `${val} registos`;
    }
    return val.toString();
  }

  const str = String(val).trim();
  const lower = str.toLowerCase();

  if (VALUE_TRANSLATIONS[lower]) {
    return VALUE_TRANSLATIONS[lower];
  }

  // Check if ISO Date format
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('pt-MZ');
    }
  }

  return str;
}

export function formatAuditLabel(key: string): string {
  const normalizedKey = normalizeAuditKey(key);
  return KEY_LABELS[key] || KEY_LABELS[normalizedKey] || normalizedKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function formatAuditDetails(rawDetails: any): FormattedAuditItem[] {
  if (!rawDetails) return [];

  let details = rawDetails;
  if (typeof details === 'string') {
    try {
      details = JSON.parse(details);
    } catch {
      return [{ label: 'Detalhes', value: details }];
    }
  }

  if (typeof details !== 'object' || details === null) {
    return [{ label: 'Detalhes', value: String(details) }];
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
          value: `De "${formatAuditValue(key, oldVal)}" para "${formatAuditValue(key, newVal)}"`,
          isChange: true,
          oldValue: formatAuditValue(key, oldVal),
          newValue: formatAuditValue(key, newVal)
        });
      } else {
        items.push({
          label: formatAuditLabel(key),
          value: formatAuditValue(key, newVal)
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
          value: formatAuditValue(subKey, subVal)
        });
      }
    } else if (Array.isArray(val)) {
      items.push({
        label: formatAuditLabel(key),
        value: val.map(item => typeof item === 'object' ? JSON.stringify(item) : formatAuditValue(key, item)).join(', ')
      });
    } else {
      items.push({
        label: formatAuditLabel(key),
        value: formatAuditValue(key, val)
      });
    }
  }

  return items;
}
