import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';

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
  model_30_data?: any;
  notes?: string;
  created_at: string;
  updated_at: string;
  payments?: TaxPayment[];
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
    private companyService: CompanyService
  ) {}

  async loadDeclarations(): Promise<void> {
    const company = this.companyService.activeCompany();
    if (!company) return;

    this.isLoading.set(true);

    try {
      const { data, error } = await this.supabase.db
        .from('tax_declarations')
        .select('*')
        .eq('company_id', company.id)
        .order('year', { ascending: false })
        .order('period', { ascending: false });

      if (error) throw error;

      const declarationsWithPayments = await Promise.all(
        (data || []).map(async (declaration) => {
          const payments = await this.getDeclarationPayments(declaration.id);
          return { ...declaration, payments };
        })
      );

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
  private calculateISPCRate(company: any): number {
    const cat2 = company.category2;
    
    if (cat2 === 'servicos_nao_liberais') return 12;
    if (cat2 === 'servicos_liberais') return 15;
    
    return parseInt(company.business_volume || '3');
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
        .gte('date', startDate)
        .lte('date', endDate);

      if (error) throw error;

      // Calcular total de vendas do trimestre
      const totalSales = invoices?.reduce((sum, inv) => sum + (inv.total || 0), 0) || 0;

      // Buscar vendas anuais até este trimestre para determinar a taxa correta
      const yearStart = `${year}-01-01`;
      const { data: yearInvoices, error: yearError } = await this.supabase.db
        .from('invoices')
        .select('total, date')
        .eq('company_id', company.id)
        .gte('date', yearStart)
        .lte('date', endDate);

      if (yearError) throw yearError;

      const annualSalesBeforeQuarter = (yearInvoices || [])
        .filter(inv => inv.date < startDate)
        .reduce((sum, inv) => sum + (inv.total || 0), 0);
      
      const annualSales = (yearInvoices || [])
        .reduce((sum, inv) => sum + (inv.total || 0), 0);

      // Determinar a taxa baseada no tipo de atividade e volume anual
      const ispcRate = this.calculateISPCRate(company);

      // Calcular ISPC
      let ispcAmount = 0;
      const threshold = 4000000;

      if (annualSales <= threshold) {
        // Todo o volume do trimestre está dentro do limite normal
        ispcAmount = (totalSales * ispcRate) / 100;
      } else if (annualSalesBeforeQuarter >= threshold) {
        // Já ultrapassou o limite no trimestre anterior, tudo a 20%
        ispcAmount = (totalSales * 20) / 100;
      } else {
        // Ultrapassou o limite NESTE trimestre
        const portionNormal = threshold - annualSalesBeforeQuarter;
        const portionExcess = totalSales - portionNormal;
        
        ispcAmount = ((portionNormal * ispcRate) / 100) + ((portionExcess * 20) / 100);
      }

      return {
        period,
        year,
        startDate,
        endDate,
        totalSales,
        ispcBase: totalSales,
        ispcRate: annualSales > threshold ? 20 : ispcRate,
        ispcAmount,
        invoiceCount: invoices?.length || 0
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
        .select('id, status, notes')
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
        notes: notes || existing?.notes
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
