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

      await this.logPaymentAudit('Registou Pagamento', data);

      return data;
    } catch (error) {
      console.error('Erro ao criar pagamento:', error);
      return null;
    }
  }

  /**
   * Reads the invoice AFTER the payments trigger has recalculated amount_paid / amount_pending,
   * syncs the invoice status and writes a complete audit entry for the payment.
   */
  private async logPaymentAudit(action: string, payment: Payment): Promise<void> {
    const amount = Number(payment.amount) || 0;
    const invoice = await this.syncInvoiceAfterPayment(payment.invoice_id);
    const company = this.companyService.activeCompany();

    const details: Record<string, any> = {
      amount,
      payment_method: payment.payment_method,
      payment_date: payment.payment_date,
      reference: payment.reference || undefined,
      notes: payment.notes || undefined,
      invoice_id: payment.invoice_id
    };

    if (invoice) {
      details['invoice_number'] = invoice.invoice_number;
      details['invoice_total'] = Number(invoice.total) || 0;
      details['amount_paid'] = Number(invoice.amount_paid) || 0;
      details['amount_pending'] = Number(invoice.amount_pending) || 0;
      details['status'] = invoice.status;
    }

    await this.auditLogService.log(
      action,
      'payments',
      details,
      payment.id,
      invoice?.invoice_number
        ? `${invoice.invoice_number} · ${this.formatCurrency(amount)}`
        : `PAG-${this.formatCurrency(amount)}`,
      invoice?.company_id || company?.id
    );
  }

  /**
   * Fetches the invoice with the totals already updated by the database trigger and
   * persists the resulting status (paga / pendente / vencida) so it does not wait for the
   * next invoice list refresh.
   */
  private async syncInvoiceAfterPayment(invoiceId: string): Promise<{
    id: string;
    company_id: string;
    invoice_number: string;
    total: number;
    amount_paid: number;
    amount_pending: number;
    status: string;
  } | null> {
    try {
      const { data: invoice, error } = await this.supabase.db
        .from('invoices')
        .select('id, company_id, invoice_number, total, amount_paid, amount_pending, status, due_date')
        .eq('id', invoiceId)
        .single();

      if (error || !invoice) return null;

      const currentStatus = (invoice.status || '').toLowerCase();
      if (currentStatus === 'rascunho' || currentStatus === 'anulada') {
        return invoice;
      }

      const total = Number(invoice.total) || 0;
      const paid = Number(invoice.amount_paid) || 0;
      let newStatus = 'pendente';

      if (total > 0 && paid >= total) {
        newStatus = 'paga';
      } else if (invoice.due_date) {
        const dueDate = new Date(invoice.due_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        dueDate.setHours(0, 0, 0, 0);
        if (dueDate < today) newStatus = 'vencida';
      }

      if (newStatus !== currentStatus) {
        const { error: updateError } = await this.supabase.db
          .from('invoices')
          .update({ status: newStatus })
          .eq('id', invoiceId);

        if (updateError) {
          console.error('Erro ao actualizar estado da factura após pagamento:', updateError);
        } else {
          invoice.status = newStatus;
        }
      }

      return invoice;
    } catch (error) {
      console.error('Erro ao sincronizar factura após pagamento:', error);
      return null;
    }
  }

  async deletePayment(paymentId: string): Promise<boolean> {
    try {
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
        await this.logPaymentAudit('Eliminou Pagamento', payment);
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
