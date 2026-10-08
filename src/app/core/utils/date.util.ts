/**
 * Converte uma data do calendário (datepicker) para 'AAAA-MM-DD' usando a
 * data local.
 *
 * Não usar toISOString(): converte para UTC e, em Moçambique (UTC+2), a
 * meia-noite local passa para as 22h do dia anterior.
 */
export function toIsoDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  if (typeof date === 'string') return date.substring(0, 10);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Formatos de data suportados nas Configurações do Sistema. */
export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
export const DATE_FORMATS: readonly DateFormat[] = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
export const DEFAULT_DATE_FORMAT: DateFormat = 'DD/MM/YYYY';

/** Normaliza um valor vindo da BD/localStorage para um formato suportado. */
export function toDateFormat(value: unknown): DateFormat {
  return DATE_FORMATS.includes(value as DateFormat) ? (value as DateFormat) : DEFAULT_DATE_FORMAT;
}

/** Junta ano/mês/dia (já com zeros à esquerda) segundo o formato escolhido. */
export function formatDateParts(year: string, month: string, day: string, format: DateFormat = DEFAULT_DATE_FORMAT): string {
  switch (format) {
    case 'MM/DD/YYYY': return `${month}/${day}/${year}`;
    case 'YYYY-MM-DD': return `${year}-${month}-${day}`;
    default: return `${day}/${month}/${year}`;
  }
}

/** Dia e mês (sem ano) na ordem do formato escolhido: 'DD/MM', 'MM/DD' ou 'MM-DD'. */
export function formatDayMonthParts(month: string, day: string, format: DateFormat = DEFAULT_DATE_FORMAT): string {
  switch (format) {
    case 'MM/DD/YYYY': return `${month}/${day}`;
    case 'YYYY-MM-DD': return `${month}-${day}`;
    default: return `${day}/${month}`;
  }
}

/** 'AAAA-MM-DD' → data no formato escolhido, sem passar por Date (evita desvios de fuso). */
export function formatIsoDate(iso: string | null | undefined, format: DateFormat = DEFAULT_DATE_FORMAT): string {
  if (!iso) return '';
  const [year, month, day] = iso.substring(0, 10).split('-');
  return formatDateParts(year, month, day, format);
}

/** 'AAAA-MM-DD' → Date à meia-noite local. Devolve null se o texto não for válido. */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Primeiro e último dia de um trimestre (1 a 4). */
export function quarterRange(quarter: number, year: number): { start: Date; end: Date } {
  const firstMonth = (quarter - 1) * 3;
  return {
    start: new Date(year, firstMonth, 1),
    end: new Date(year, firstMonth + 3, 0)
  };
}
