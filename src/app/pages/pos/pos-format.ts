import { currentLocale } from '../../core/i18n/i18n';

/** Valor em MZN, como InvoiceService.formatCurrency. */
export function formatPosMoney(value: number, locale: string = currentLocale()): string {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safeValue) + ' MZN';
}

export function formatPosDate(iso: string, locale: string = currentLocale()): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

export function formatPosTime(iso: string, locale: string = currentLocale()): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
