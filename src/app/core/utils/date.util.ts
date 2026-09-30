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

/** 'AAAA-MM-DD' → 'DD/MM/AAAA', sem passar por Date (evita desvios de fuso). */
export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [year, month, day] = iso.substring(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/** Primeiro e último dia de um trimestre (1 a 4). */
export function quarterRange(quarter: number, year: number): { start: Date; end: Date } {
  const firstMonth = (quarter - 1) * 3;
  return {
    start: new Date(year, firstMonth, 1),
    end: new Date(year, firstMonth + 3, 0)
  };
}
