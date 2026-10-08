import type { TaxDeclaration } from '../services/tax.service';
import type { Company } from '../services/company.service';

/**
 * Valores calculados do Modelo 30 (Declaração Periódica ISPC).
 * Fonte única partilhada pelo PDF (Model30Component) e pela exportação Excel,
 * para que os dois documentos nunca divirjam.
 */
export interface Model30Fields {
  f01: number;
  f02: number;
  f03: number;
  f04: number;
  f05: number;
  f06: number;
  f07: number;
  f08: number;
  f09: number;
  f10: number;
  /** Taxa efectiva (%) arredondada a 2 casas decimais. */
  f11: number;
  f12: number;
  f13: number;
  f14: number;
  f15: number;
  f16: number;
  /** Mês (2 dígitos) do Quadro 2 — mês de início do trimestre. */
  month: string;
  year: number;
  quarter: number;
  nuit: string;
  noOperations: boolean;
  bens: { 3: boolean; 4: boolean; 5: boolean };
  servicos: { 12: boolean; 15: boolean };
  /** Campos 10–12 só são preenchidos no IV trimestre. */
  showQ10: boolean;
}

export function roundTo(value: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * f) / f;
}

const QUARTER_START_MONTHS: { [key: number]: string } = { 1: '01', 2: '04', 3: '07', 4: '10' };

export function getModel30Month(period: number): string {
  return QUARTER_START_MONTHS[period] || '01';
}

export function isModel30BensRate(decl: TaxDeclaration, company: Company | null | undefined, rate: number): boolean {
  if (!company) return false;
  const cat2 = company.category2;
  if (cat2 === 'servicos_nao_liberais' || cat2 === 'servicos_liberais') return false;
  return decl.ispc_rate === rate;
}

export function isModel30ServicosRate(company: Company | null | undefined, rate: number): boolean {
  if (!company) return false;
  if (rate === 12 && company.category2 === 'servicos_nao_liberais') return true;
  if (rate === 15 && company.category2 === 'servicos_liberais') return true;
  return false;
}

export function computeModel30Fields(decl: TaxDeclaration, company: Company | null | undefined): Model30Fields {
  const model = decl.model_30_data || {};

  const f01 = decl.total_sales || 0;
  const f06 = model.annual_sales || 0;
  const f07 = model.annual_normal_tax || 0;
  const f08 = model.annual_excess_base || 0;
  const f09 = model.annual_excess_tax || 0;
  const f10 = model.annual_sales || 0;
  const f11 = roundTo(model.effective_rate || decl.ispc_rate || 0, 2);
  const f12 = model.annual_tax || 0;

  const splits = decl.ispc_splits || [];
  const normalSplits = splits.filter((s: any) => s.rate !== 20);
  const excessSplits = splits.filter((s: any) => s.rate === 20);

  let f02 = model.normal_tax_period ?? normalSplits.reduce((sum: number, s: any) => sum + (s.amount || 0), 0);
  const f03 = model.excess_base_period ?? excessSplits.reduce((sum: number, s: any) => sum + (s.base || 0), 0);
  const f04 = model.excess_tax_period ?? excessSplits.reduce((sum: number, s: any) => sum + (s.amount || 0), 0);
  let f05 = f02 + f04;

  // Sem splits disponíveis: usar o ispc_amount guardado
  if (splits.length === 0) {
    f02 = decl.ispc_amount || 0;
    f05 = f02;
  }

  const f13 = f12 > 0 ? f12 - f07 : 0;
  const f14 = f05 + f13;
  const f15 = 0;
  const f16 = f14 + f15;

  return {
    f01, f02, f03, f04, f05, f06, f07, f08, f09, f10, f11, f12, f13, f14, f15, f16,
    month: getModel30Month(decl.period),
    year: decl.year,
    quarter: decl.period,
    nuit: company?.nuit || '',
    noOperations: decl.total_sales === 0,
    bens: {
      3: isModel30BensRate(decl, company, 3),
      4: isModel30BensRate(decl, company, 4),
      5: isModel30BensRate(decl, company, 5),
    },
    servicos: {
      12: isModel30ServicosRate(company, 12),
      15: isModel30ServicosRate(company, 15),
    },
    showQ10: decl.period === 4,
  };
}

/** Rótulos do Quadro 8 (com as desigualdades corrigidas). */
export const MODEL30_RATE_LABELS = {
  bens3: '3% para o volume de negócios anual ≤ 1.000.000,00MT',
  bens4: '4% para o volume de negócios anual > 1.000.000,00MT e ≤ 2.500.000,00MT',
  bens5: '5% para o volume de negócios anual > 2.500.000,00MT e ≤ 4.000.000,00MT',
  serv12: '12% para prestação de serviços tais como, canalização, carpintaria, pedreiro, electricista, barbearia, jardinagem, mecânica',
  serv15: '15% para prestação de serviços de profissões liberais, tais como, advogados, economistas, geólogos, engenheiros, contabilistas.',
} as const;

const MODEL30_PAYMENT_METHOD_LABELS: Record<string, string> = {
  transferencia: 'Transferência Bancária',
  cheque: 'Cheque',
  dinheiro: 'Dinheiro',
  carteira_movel: 'Carteira Móvel',
  outro: 'Outro',
};

/** Rótulo legível do método de pagamento (PDF e Excel do Modelo 30). */
export function getModel30PaymentMethodLabel(method: string | null | undefined): string {
  if (!method) return '-';
  return MODEL30_PAYMENT_METHOD_LABELS[method] || method;
}
