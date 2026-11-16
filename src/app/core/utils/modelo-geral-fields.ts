import type { TaxDeclaration } from '../services/tax.service';
import type { Company } from '../services/company.service';
import { roundTo } from './model30-fields';

/**
 * Valores calculados da Declaração Modelo Geral (M/G) usada para o ISPC.
 * Fonte única partilhada pelo PDF (ModeloGeralComponent) e pela exportação
 * Excel, para que os dois documentos nunca divirjam.
 *
 * O apuramento é o da declaração (ispc_splits / ispc_amount), apenas
 * distribuído pelos campos do M/G:
 *  - Quadro 8, linhas 01–04 / 05–08: uma linha por taxa (base × taxa = montante),
 *    ou seja, mais de uma linha só quando no trimestre se mudou de escalão ou
 *    houve excesso (20%);
 *  - Quadro 8, linhas 10–14 (receitas sem base tributável): não se aplicam ao
 *    ISPC, ficam em branco;
 *  - Quadro 10: 07 = Subtotal-1 + Subtotal-2, 08 = juros, 09 = 07 + 08.
 */
export interface ModeloGeralLine {
  description: string;
  base: number;
  /** Taxa em percentagem (ex.: 4 = 4%). */
  rate: number;
  amount: number;
}

export interface ModeloGeralOtherLine {
  description: string;
  amount: number;
}

export type ModeloGeralPaymentMethod = 'numerario' | 'cheque' | 'outros' | null;

export interface ModeloGeralFields {
  /** Mês (2 dígitos) do Quadro 2 — último mês do trimestre. */
  month: string;
  year: number;
  quarter: number;
  late: boolean;
  nuit: string;
  /** Linhas 01–04 (base, taxa, montante 05–08). Máximo 4. */
  lines: ModeloGeralLine[];
  subtotal1: number;
  /** Linhas 10–13 (receitas sem base tributável). Máximo 4. */
  otherLines: ModeloGeralOtherLine[];
  subtotal2: number;
  /** Campo 07 do Quadro 10. */
  amountDue: number;
  /** Campo 08 do Quadro 10. */
  interest: number;
  /** Campo 09 do Quadro 10 (importância a pagar). */
  total: number;
  paymentMethod: ModeloGeralPaymentMethod;
  /** Texto a seguir a «Outros» (ex.: transferência bancária). */
  paymentOther: string;
  paymentReference: string;
}

const QUARTER_END_MONTHS: { [key: number]: string } = { 1: '03', 2: '06', 3: '09', 4: '12' };

export function getModeloGeralMonth(period: number): string {
  return QUARTER_END_MONTHS[period] || '12';
}

const OTHER_PAYMENT_LABELS: Record<string, string> = {
  transferencia: 'Transferência bancária',
  carteira_movel: 'Carteira móvel',
  outro: 'Outro',
};

/** Taxa formatada como no formulário: «4%», «2,5%». */
export function formatModeloGeralRate(rate: number): string {
  return `${new Intl.NumberFormat('pt-MZ', { maximumFractionDigits: 2 }).format(rate)}%`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Entrega fora do prazo: submetida (ou, se ainda não, hoje) depois da data limite. */
function isLate(decl: TaxDeclaration): boolean {
  if (!decl.due_date) return false;
  const ref = decl.submission_date?.slice(0, 10) || (decl.status === 'paga' ? null : todayIso());
  return !!ref && ref > decl.due_date.slice(0, 10);
}

export function computeModeloGeralFields(decl: TaxDeclaration, company: Company | null | undefined): ModeloGeralFields {
  const period = `${decl.period}.º trimestre de ${decl.year}`;

  // Uma linha por taxa (os escalões e o excesso de 20% já vêm separados nos splits).
  const byRate = new Map<number, { base: number; amount: number; isExcess: boolean }>();
  for (const s of decl.ispc_splits || []) {
    if (!s || (!s.base && !s.amount)) continue;
    const cur = byRate.get(s.rate) || { base: 0, amount: 0, isExcess: !!s.isExcess };
    cur.base += s.base || 0;
    cur.amount += s.amount || 0;
    byRate.set(s.rate, cur);
  }

  let lines: ModeloGeralLine[];
  if (byRate.size === 0 || byRate.size > 4) {
    // Sem splits (ou, por segurança, mais taxas do que linhas): uma linha com a taxa da declaração.
    const base = decl.total_sales || 0;
    const amount = decl.ispc_amount || 0;
    const rate = byRate.size > 4 && base > 0 ? roundTo((amount / base) * 100, 2) : (decl.ispc_rate || 0);
    lines = [{ description: `ISPC – ${period}`, base, rate, amount }];
  } else {
    const entries = [...byRate.entries()].sort((a, b) => a[0] - b[0]);
    const single = entries.length === 1;
    lines = entries.map(([rate, v]) => ({
      description: single
        ? `ISPC – ${period}`
        : `ISPC – ${period} (${v.isExcess ? 'excesso' : `escalão ${formatModeloGeralRate(rate)}`})`,
      base: roundTo(v.base, 2),
      rate,
      amount: roundTo(v.amount, 2),
    }));
  }

  const otherLines: ModeloGeralOtherLine[] = [];

  const subtotal1 = roundTo(lines.reduce((sum, l) => sum + l.amount, 0), 2);
  const subtotal2 = roundTo(otherLines.reduce((sum, l) => sum + l.amount, 0), 2);
  const amountDue = roundTo(subtotal1 + subtotal2, 2);
  const interest = 0;

  const payment = (decl.payments || [])[0];
  let paymentMethod: ModeloGeralPaymentMethod = null;
  let paymentOther = '';
  if (payment?.payment_method === 'dinheiro') paymentMethod = 'numerario';
  else if (payment?.payment_method === 'cheque') paymentMethod = 'cheque';
  else if (payment?.payment_method) {
    paymentMethod = 'outros';
    paymentOther = OTHER_PAYMENT_LABELS[payment.payment_method] || payment.payment_method;
  }

  return {
    month: getModeloGeralMonth(decl.period),
    year: decl.year,
    quarter: decl.period,
    late: isLate(decl),
    nuit: company?.nuit || '',
    lines,
    subtotal1,
    otherLines,
    subtotal2,
    amountDue,
    interest,
    total: roundTo(amountDue + interest, 2),
    paymentMethod,
    paymentOther,
    paymentReference: payment?.reference || '',
  };
}
