import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';
import { AuditLogService } from './audit-log.service';

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  reference?: string;
  notes?: string;
  created_at: string;
  created_by?: string;
}

export interface CreatePaymentData {
  invoice_id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  reference?: string;
  notes?: string;
}

@Injectable({
  providedIn: 'root'
})
export class PaymentService {
  payments = signal<Payment[]>([]);
  isLoading = signal(false);

  constructor(
    private supabase: SupabaseService,
    private companyService: CompanyService,
    private auditLogService: AuditLogService
  ) {}

  async loadPaymentsByInvoice(invoiceId: string): Promise<Payment[]> {
    try {
      const { data, error } = await this.supabase.db
        .from('payments')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('payment_date', { ascending: false });

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Erro ao carregar pagamentos:', error);
      return [];
    }
  }

  async createPayment(paymentData: CreatePaymentData): Promise<Payment | null> {
    try {
      const { data: user } = await this.supabase.db.auth.getUser();

      const { data, error } = await this.supabase.db
        .from('payments')
        .insert({
          ...paymentData,
          created_by: user.user?.id
        })
        .select()
        .single();

      if (error) throw error;

      const activeCompany = this.companyService.activeCompany();
      await this.auditLogService.log(
        'Registou Pagamento',
        'payments',
        { amount: data.amount, invoice_id: data.invoice_id },
        data.id,
        `PAG-${data.amount} MZN`,
        activeCompany?.id
      );

      return data;
    } catch (error) {
      console.error('Erro ao criar pagamento:', error);
      return null;
    }
  }

  async deletePayment(paymentId: string): Promise<boolean> {
    try {
      const activeCompany = this.companyService.activeCompany();
      const { data: payment } = await this.supabase.db
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();

      const { error } = await this.supabase.db
        .from('payments')
        .delete()
        .eq('id', paymentId);

      if (error) throw error;

      if (payment) {
        await this.auditLogService.log(
          'Eliminou Pagamento',
          'payments',
          { amount: payment.amount, invoice_id: payment.invoice_id },
          paymentId,
          `PAG-${payment.amount} MZN`,
          activeCompany?.id
        );
      }

      return true;
    } catch (error) {
      console.error('Erro ao eliminar pagamento:', error);
      return false;
    }
  }

  getPaymentMethodLabel(method: string): string {
    const methods: { [key: string]: string } = {
      'dinheiro': 'Dinheiro',
      'transferencia': 'Transferência Bancária',
      'cheque': 'Cheque',
      'carteira_movel': 'Carteira Móvel',
      'outro': 'Outro'
    };
    return methods[method] || method;
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-MZ', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value) + ' MZN';
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-MZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }
}
