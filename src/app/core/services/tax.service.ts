import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';
import { AuditLogService } from './audit-log.service';
import { ActivityService } from './activity.service';

export interface TaxDeclaration {
  id: string;
  company_id: string;
  period: number;
  year: number;
  start_date: string;
  end_date: string;
  total_sales: number;
  ispc_base: number;
  ispc_rate: number;
  ispc_amount: number;
  status: 'pendente' | 'submetida' | 'paga' | 'atrasada';
  submission_date?: string;
  due_date?: string;
  payment_date?: string;
  model_30_data?: Model30Data;
  notes?: string;
  created_at: string;
  updated_at: string;
  payments?: TaxPayment[];
  ispc_splits?: IspcSplit[];
}

export interface Model30Data {
  ispc_splits?: IspcSplit[];
  annual_sales?: number;
  annual_normal_tax?: number;
  annual_excess_base?: number;
  annual_excess_tax?: number;
  annual_tax?: number;
  effective_rate?: number;
  normal_tax_period?: number;
  excess_base_period?: number;
  excess_tax_period?: number;
}

export interface TaxPayment {
  id: string;
  tax_declaration_id: string;
  amount: number;
  payment_date: string;
  payment_method?: string;
  reference?: string;
  receipt_url?: string;
  notes?: string;
  created_at: string;
}

export interface TaxCalculation {
  period: number;
  year: number;
  startDate: string;
  endDate: string;
  totalSales: number;
  ispcBase: number;
  ispcRate: number;
  ispcAmount: number;
  invoiceCount: number;
  ispcSplits: IspcSplit[];
  model30Data: Model30Data;
}

export interface IspcSplit {
  base: number;
  rate: number;
  amount: number;
  isExcess: boolean;
  label: string;
}

export interface TaxSummary {
  yearToDate: number;
  currentQuarter: number;
  overdue: number;
  nextDue: number;
  totalPaid: number;
  pendingDeclarations: number;
}

@Injectable({
  providedIn: 'root'
})
export class TaxService {
  declarations = signal<TaxDeclaration[]>([]);
  isLoading = signal(false);

  constructor(
    private supabase: SupabaseService,
    private companyService: CompanyService,
    private auditLogService: AuditLogService,
    private activityService: ActivityService
  ) {}

  private toCents(value: number | string | null | undefined): number {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount)) throw new Error('Valor monetário inválido');
    return Math.round(amount * 100);
  }

  private fromCents(value: number): number {
    return value / 100;
  }

  private taxCents(baseCents: number, rate: number): number {
    return Math.round((baseCents * rate) / 100);
  }

  private calculateSplits(
    periodSales: number,
    annualSalesBeforePeriod: number,
    baseRate: number,
    isScaleActivity: boolean
  ): { amount: number; splits: IspcSplit[]; annualSalesAfterPeriod: number } {
    let remainingCents = this.toCents(periodSales);
    let accumulatedCents = this.toCents(annualSalesBeforePeriod);
    let totalTaxCents = 0;
    const splits: IspcSplit[] = [];
    const thresholds = isScaleActivity
      ? [{ limit: 1_000_000 * 100, rate: 3 }, { limit: 2_500_000 * 100, rate: 4 }, { limit: 4_000_000 * 100, rate: 5 }]
      : [{ limit: 4_000_000 * 100, rate: baseRate }];

    for (const threshold of thresholds) {
      if (remainingCents <= 0 || accumulatedCents >= threshold.limit) continue;
      const baseCents = Math.min(remainingCents, threshold.limit - accumulatedCents);
      const amountCents = this.taxCents(baseCents, threshold.rate);
      splits.push({
        base: this.fromCents(baseCents),
        rate: threshold.rate,
        amount: this.fromCents(amountCents),
        isExcess: false,
        label: `Base Tributável (${threshold.rate}%)`
      });
      totalTaxCents += amountCents;
      remainingCents -= baseCents;
      accumulatedCents += baseCents;
    }

    if (remainingCents > 0) {
      const amountCents = this.taxCents(remainingCents, 20);
      splits.push({
        base: this.fromCents(remainingCents),
        rate: 20,
        amount: this.fromCents(amountCents),
        isExcess: true,
        label: 'Excesso de Limite ISPC'
      });
      totalTaxCents += amountCents;
      accumulatedCents += remainingCents;
    }

    return {
      amount: this.fromCents(totalTaxCents),
      splits,
      annualSalesAfterPeriod: this.fromCents(accumulatedCents)
    };
  }

  async loadDeclarations(): Promise<void> {
    const company = this.companyService.activeCompany();
    if (!company) return;

    this.isLoading.set(true);

    try {
      const { data, error } = await this.supabase.db
        .from('tax_declarations')
        .select(`
          id, company_id, period, year, start_date, end_date,
          total_sales, ispc_base, ispc_rate, ispc_amount, status,
          submission_date, due_date, payment_date, model_30_data,
          notes, created_at, updated_at,
          payments:tax_payments(
            id, tax_declaration_id, amount, payment_date,
            payment_method, reference, receipt_url, notes, created_at
          )
        `)
        .eq('company_id', company.id)
        .order('year', { ascending: false })
        .order('period', { ascending: false });

      if (error) throw error;

      const declarationsWithPayments = (data || []).map((declaration: any) => ({
        ...declaration,
        payments: declaration.payments || [],
        ispc_splits: declaration.model_30_data?.ispc_splits || []
      }));

      this.declarations.set(declarationsWithPayments);
    } catch (error) {
      console.error('Erro ao carregar declarações:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Retorna a taxa de ISPC baseada nas categorias de atividade e volume selecionado
   */
  private async getConfiguredActivityRate(company: any): Promise<{ baseRate: number; isScaleActivity: boolean }> {
    const cat2 = company.category2;
    const fallbackRate = cat2 === 'servicos_nao_liberais'
      ? 12
      : cat2 === 'servicos_liberais'
        ? 15
        : parseInt(company.business_volume || '3');
    const fallbackIsScale = cat2 !== 'servicos_nao_liberais' && cat2 !== 'servicos_liberais';

    try {
      const activities = await this.activityService.getCompanyActivities(company.id);
      const selected = activities.find(activity => activity.activity_role === 'servico')
        || activities.find(activity => activity.is_primary)
        || activities[0];
      const rule = selected?.activity_type?.activity_type_rules?.find(rule => rule.is_active && rule.rule_type === 'ispc_rate');

      if (rule?.tax_rate !== undefined && rule.tax_rate !== null) {
        const rateNum = Number(rule.tax_rate);
        const isService = selected?.activity_role === 'servico' || cat2 === 'servicos_nao_liberais' || cat2 === 'servicos_liberais' || rateNum === 12 || rateNum === 15;
        return {
          baseRate: rateNum,
          isScaleActivity: !isService
        };
      }
    } catch (error) {
      console.warn('Não foi possível carregar a regra da actividade; a usar compatibilidade antiga.', error);
    }

    return { baseRate: fallbackRate, isScaleActivity: fallbackIsScale };
  }

  async calculateTaxForPeriod(year: number, period: number): Promise<TaxCalculation | null> {
    const company = this.companyService.activeCompany();
    if (!company) return null;

    const { startDate, endDate } = this.getPeriodDates(year, period);

    try {
      // Buscar todas as faturas do trimestre
      const { data: invoices, error } = await this.supabase.db
        .from('invoices')
        .select('total, date')
        .eq('company_id', company.id)
        .neq('status', 'rascunho')
        .neq('status', 'anulada')
        .gte('date', startDate)
        .lte('date', endDate);

      if (error) throw error;

      // Calcular total de vendas do trimestre
      const totalSales = this.fromCents((invoices || []).reduce((sum, inv) => sum + this.toCents(inv.total), 0));

      // Buscar vendas anuais até este trimestre para determinar a taxa correta
      const yearStart = `${year}-01-01`;
      const { data: yearInvoices, error: yearError } = await this.supabase.db
        .from('invoices')
        .select('total, date')
        .eq('company_id', company.id)
        .neq('status', 'rascunho')
        .neq('status', 'anulada')
        .gte('date', yearStart)
        .lte('date', endDate);

      if (yearError) throw yearError;

      const annualSalesBeforeQuarter = (yearInvoices || [])
        .filter(inv => inv.date < startDate)
        .reduce((sum, inv) => sum + this.toCents(inv.total), 0) / 100;

      const annualSalesToDate = (yearInvoices || [])
        .reduce((sum, inv) => sum + this.toCents(inv.total), 0) / 100;

      // Determinar a taxa baseada no tipo de atividade e volume anual
      const configuredActivity = await this.getConfiguredActivityRate(company);
      const baseRate = configuredActivity.baseRate;
      const isScaleActivity = configuredActivity.isScaleActivity;

      // Calcular ISPC
      let ispcAmount = 0;
      let remaining = totalSales;
      let currentAcc = annualSalesBeforeQuarter;
      const ispcSplits: IspcSplit[] = [];

      // For scale activities (sale of goods): progressive 1M, 2.5M, 4M thresholds (3%, 4%, 5%, 20%)
      // For flat-rate activities (services 12% or 15%): single threshold of 4M MZN (12%/15% up to 4M, 20% excess)
      const thresholds = isScaleActivity ? [1000000, 2500000, 4000000] : [4000000];
      const rates = isScaleActivity ? [3, 4, 5, 20] : [baseRate, 20];

      let newVolume = company.business_volume;

      // Percorrer os escalões
      for (let i = 0; i < thresholds.length; i++) {
        if (remaining <= 0) break;

        if (currentAcc < thresholds[i]) {
          const chunk = Math.min(remaining, thresholds[i] - currentAcc);
          const chunkAmount = (chunk * rates[i]) / 100;
          ispcAmount += chunkAmount;
          
          ispcSplits.push({
            base: chunk,
            rate: rates[i],
            amount: chunkAmount,
            isExcess: rates[i] === 20,
            label: rates[i] === 20 ? 'Excesso de Limite ISPC' : `Base Tributável (${rates[i]}%)`
          });

          remaining -= chunk;
          currentAcc += chunk;
        }
      }

      // Valor excedente ao último threshold (4M)
      if (remaining > 0) {
        const excessRate = rates[rates.length - 1]; // 20%
        const chunkAmount = (remaining * excessRate) / 100;
        ispcAmount += chunkAmount;
        
        ispcSplits.push({
          base: remaining,
          rate: excessRate,
          amount: chunkAmount,
          isExcess: true,
          label: 'Excesso de Limite ISPC'
        });

        currentAcc += remaining;
      }

      // Determinar o novo volume sugerido baseado no acumulado
      const maxThreshold = thresholds[thresholds.length - 1];
      if (isScaleActivity) {
        if (currentAcc > thresholds[2]) newVolume = '20';
        else if (currentAcc > thresholds[1]) newVolume = '5';
        else if (currentAcc > thresholds[0]) newVolume = '4';
        else newVolume = '3';
      } else {
        if (currentAcc > maxThreshold) newVolume = '20';
        else newVolume = baseRate.toString();
      }

      // NOTE: Overwriting company.business_volume dynamically in the DB is disabled to prevent
      // corrupting the company's default registration category (3%, 12%, 15%).
      // The progressive calculation already correctly handles brackets using annual accumulated sales.

      const precisePeriod = this.calculateSplits(totalSales, annualSalesBeforeQuarter, baseRate, isScaleActivity);
      const preciseAnnual = this.calculateSplits(annualSalesToDate, 0, baseRate, isScaleActivity);

      const { data: serverCalculation, error: serverCalculationError } = await this.supabase.db.rpc(
        'calculate_ispc_for_period',
        {
          p_company_id: company.id,
          p_start_date: startDate,
          p_end_date: endDate,
          p_base_rate: baseRate,
          p_is_scale_activity: isScaleActivity
        }
      );

      if (serverCalculationError) throw serverCalculationError;
      if (Math.abs(Number(serverCalculation?.tax ?? 0) - precisePeriod.amount) > 0.01) {
        throw new Error('Divergência entre o cálculo fiscal do cliente e do servidor');
      }
      const normalPeriod = precisePeriod.splits.filter(split => !split.isExcess);
      const excessPeriod = precisePeriod.splits.filter(split => split.isExcess);
      const normalAnnual = preciseAnnual.splits.filter(split => !split.isExcess);
      const excessAnnual = preciseAnnual.splits.filter(split => split.isExcess);
      const ispcRate = precisePeriod.splits.at(-1)?.rate ?? baseRate;
      const model30Data: Model30Data = {
        ispc_splits: precisePeriod.splits,
        annual_sales: annualSalesToDate,
        annual_normal_tax: normalAnnual.reduce((sum, split) => sum + split.amount, 0),
        annual_excess_base: excessAnnual.reduce((sum, split) => sum + split.base, 0),
        annual_excess_tax: excessAnnual.reduce((sum, split) => sum + split.amount, 0),
        annual_tax: preciseAnnual.amount,
        effective_rate: annualSalesToDate > 0 ? (preciseAnnual.amount / annualSalesToDate) * 100 : 0,
        normal_tax_period: normalPeriod.reduce((sum, split) => sum + split.amount, 0),
        excess_base_period: excessPeriod.reduce((sum, split) => sum + split.base, 0),
        excess_tax_period: excessPeriod.reduce((sum, split) => sum + split.amount, 0)
      };

      return {
        period,
        year,
        startDate,
        endDate,
        totalSales,
        ispcBase: totalSales,
        ispcRate,
        ispcAmount: precisePeriod.amount,
        invoiceCount: invoices?.length || 0,
        ispcSplits: precisePeriod.splits,
        model30Data
      };
    } catch (error) {
      console.error('Erro ao calcular impostos:', error);
      return null;
    }
  }

  isEndOfQuarter(year: number, period: number): boolean {
    const today = new Date();
    const periodEndMonth = period * 3 - 1; // 0-indexed: 2, 5, 8, 11
    const lastDay = new Date(year, periodEndMonth + 1, 0);
    return today >= lastDay;
  }

  async createDeclaration(calculation: TaxCalculation, notes?: string): Promise<TaxDeclaration | null> {
    const company = this.companyService.activeCompany();
    if (!company) return null;

    try {
      const dueDate = this.calculateDueDate(calculation.year, calculation.period);
      const isExpired = this.isEndOfQuarter(calculation.year, calculation.period);
      const status = isExpired ? 'pendente' : 'rascunho';

      // Check for existing declaration to upsert
      const { data: existing } = await this.supabase.db
        .from('tax_declarations')
        .select('id, status, notes, model_30_data')
        .eq('company_id', company.id)
        .eq('period', calculation.period)
        .eq('year', calculation.year)
        .maybeSingle();

      const declarationData = {
        company_id: company.id,
        period: calculation.period,
        year: calculation.year,
        start_date: calculation.startDate,
        end_date: calculation.endDate,
        total_sales: calculation.totalSales,
        ispc_base: calculation.ispcBase,
        ispc_rate: calculation.ispcRate,
        ispc_amount: calculation.ispcAmount,
        due_date: dueDate,
        status: existing?.status === 'paga' || existing?.status === 'submetida' ? existing.status : status,
        notes: notes || existing?.notes,
        model_30_data: { ...existing?.model_30_data, ...calculation.model30Data }
      };

      let result;
      if (existing) {
        result = await this.supabase.db
          .from('tax_declarations')
          .update(declarationData)
          .eq('id', existing.id)
          .select()
          .single();
      } else {
        result = await this.supabase.db
          .from('tax_declarations')
          .insert(declarationData)
          .select()
          .single();
      }

      const { data, error } = result;

      if (error) throw error;

      await this.auditLogService.log(
        'Criou Declaração Fiscal',
        'declarations',
        { year: data.year, period: data.period, amount: data.ispc_amount },
        data.id,
        `${data.period}º Trim ${data.year}`,
        company.id
      );

      await this.loadDeclarations();
      return data;
    } catch (error) {
      console.error('Erro ao criar declaração:', error);
      return null;
    }
  }

  async updateDeclarationStatus(
    declarationId: string,
    status: 'pendente' | 'submetida' | 'paga' | 'atrasada',
    dates?: { submission_date?: string; payment_date?: string }
  ): Promise<boolean> {
    try {
      const updates: any = { status };
      if (dates?.submission_date) updates.submission_date = dates.submission_date;
      if (dates?.payment_date) updates.payment_date = dates.payment_date;

      const { error } = await this.supabase.db
        .from('tax_declarations')
        .update(updates)
        .eq('id', declarationId);

      if (error) throw error;

      const decl = this.declarations().find(d => d.id === declarationId);
      await this.auditLogService.log(
        status === 'submetida' ? 'Submeteu Declaração Fiscal' : 'Atualizou Estado da Declaração',
        'declarations',
        { status, dates },
        declarationId,
        decl ? `${decl.period}º Trim ${decl.year}` : undefined,
        decl?.company_id
      );

      await this.loadDeclarations();
      return true;
    } catch (error) {
      console.error('Erro ao atualizar status:', error);
      return false;
    }
  }

  async addPayment(
    declarationId: string,
    amount: number,
    paymentDate: string,
    paymentMethod?: string,
    reference?: string,
    receiptUrl?: string,
    notes?: string
  ): Promise<boolean> {
    try {
      const { error } = await this.supabase.db
        .from('tax_payments')
        .insert({
          tax_declaration_id: declarationId,
          amount,
          payment_date: paymentDate,
          payment_method: paymentMethod,
          reference,
          receipt_url: receiptUrl,
          notes
        });

      if (error) throw error;

      const declaration = this.declarations().find(d => d.id === declarationId);
      if (declaration) {
        const totalPaid = (declaration.payments || []).reduce((sum, p) => sum + p.amount, 0) + amount;

        if (totalPaid >= declaration.ispc_amount) {
          await this.updateDeclarationStatus(declarationId, 'paga', {
            payment_date: paymentDate
          });
        }
      }

      await this.auditLogService.log(
        'Registou Pagamento de Imposto',
        'payments',
        { amount, paymentDate, reference, paymentMethod },
        declarationId,
        declaration ? `${declaration.period}º Trim ${declaration.year}` : undefined,
        declaration?.company_id
      );

      await this.loadDeclarations();
      return true;
    } catch (error) {
      console.error('Erro ao adicionar pagamento:', error);
      return false;
    }
  }

  async getDeclarationPayments(declarationId: string): Promise<TaxPayment[]> {
    try {
      const { data, error } = await this.supabase.db
        .from('tax_payments')
        .select('*')
        .eq('tax_declaration_id', declarationId)
        .order('payment_date', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Erro ao carregar pagamentos:', error);
      return [];
    }
  }

  async getTaxSummary(year?: number): Promise<TaxSummary> {
    const currentYear = year || new Date().getFullYear();
    const declarations = this.declarations().filter(d => d.year === currentYear);

    const yearToDate = declarations.reduce((sum, d) => sum + d.ispc_amount, 0);

    const currentQuarter = Math.ceil((new Date().getMonth() + 1) / 3);
    const currentQuarterDecl = declarations.find(d => d.period === currentQuarter);
    const currentQuarterAmount = currentQuarterDecl?.ispc_amount || 0;

    const today = new Date().toISOString().split('T')[0];
    const overdue = declarations
      .filter(d => d.status !== 'paga' && d.due_date && d.due_date < today)
      .reduce((sum, d) => {
        const paid = (d.payments || []).reduce((s, p) => s + p.amount, 0);
        return sum + (d.ispc_amount - paid);
      }, 0);

    const nextDueDecl = declarations
      .filter(d => d.status !== 'paga' && d.due_date && d.due_date >= today)
      .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))[0];
    const nextDue = nextDueDecl ? nextDueDecl.ispc_amount : 0;

    const totalPaid = declarations
      .filter(d => d.status === 'paga')
      .reduce((sum, d) => sum + d.ispc_amount, 0);

    const pendingDeclarations = declarations.filter(d => d.status === 'pendente').length;

    return {
      yearToDate,
      currentQuarter: currentQuarterAmount,
      overdue,
      nextDue,
      totalPaid,
      pendingDeclarations
    };
  }

  getPeriodDates(year: number, period: number): { startDate: string; endDate: string } {
    const quarters = [
      { start: `${year}-01-01`, end: `${year}-03-31` },
      { start: `${year}-04-01`, end: `${year}-06-30` },
      { start: `${year}-07-01`, end: `${year}-09-30` },
      { start: `${year}-10-01`, end: `${year}-12-31` }
    ];

    return {
      startDate: quarters[period - 1].start,
      endDate: quarters[period - 1].end
    };
  }

  calculateDueDate(year: number, period: number): string {
    const dueDates = [
      `${year}-04-30`,
      `${year}-07-31`,
      `${year}-10-31`,
      `${year + 1}-01-31`
    ];
    return dueDates[period - 1];
  }

  getPeriodName(period: number): string {
    return `${period}º Trimestre`;
  }

  getStatusLabel(status: string): string {
    const labels: { [key: string]: string } = {
      'rascunho': 'Rascunho',
      'pendente': 'Pendente',
      'submetida': 'Submetida',
      'paga': 'Paga',
      'atrasada': 'Em Atraso'
    };
    return labels[status] || status;
  }

  getStatusColor(status: string): string {
    const colors: { [key: string]: string } = {
      'rascunho': 'default',
      'pendente': 'warn',
      'submetida': 'primary',
      'paga': 'success',
      'atrasada': 'error'
    };
    return colors[status] || 'default';
  }
}
