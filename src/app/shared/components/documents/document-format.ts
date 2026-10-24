/**
 * Formatação e textos dos documentos fiscais (factura, recibo, extractos).
 *
 * Os documentos ficam SEMPRE em português de Moçambique, seja qual for a língua
 * da interface. Por isso não usam t() nem currentLocale(), nem os helpers dos
 * serviços que seguem a língua da interface: usam estes, fixos em pt-MZ.
 */
import type { StatementStatus } from '../../../core/services/statement.service';

export const DOCUMENT_LOCALE = 'pt-MZ';

const moneyFormatter = new Intl.NumberFormat(DOCUMENT_LOCALE, {
  style: 'decimal',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/** Valor monetário no formato dos documentos: "1 234,50 MZN". */
export function formatDocumentCurrency(value: number | null | undefined): string {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  return moneyFormatter.format(safeValue) + ' MZN';
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência Bancária',
  cheque: 'Cheque',
  carteira_movel: 'Carteira Móvel',
  outro: 'Outro'
};

/** Método de pagamento, em português, para o recibo. */
export function documentPaymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] || method;
}

const STATEMENT_STATUS_LABELS: Record<StatementStatus, string> = {
  pago: 'Pago',
  em_divida: 'Em dívida',
  vencido: 'Vencido'
};

/** Estado de um cliente no extracto resumo, em português. */
export function documentStatementStatusLabel(status: StatementStatus): string {
  return STATEMENT_STATUS_LABELS[status] || status;
}
