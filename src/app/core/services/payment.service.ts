import { Injectable, inject, signal } from '@angular/core';
import { friendlyErrorMessage } from '../utils/error-message';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';
import { AuditLogService } from './audit-log.service';
import { PreferencesService } from './preferences.service';

export interface Payment {
  id: string;
  invoice_id: string;
  /** Atribuídos pela base de dados ao inserir (série sequencial por empresa). */
  company_id?: string;
  receipt_number?: string;
  status?: 'emitido' | 'anulado';
  annulled_at?: string | null;
  annulment_reason?: string | null;
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
  /** Motivo (já traduzido) da última operação de escrita falhada. */
  lastError: string | null = null;

  payments = signal<Payment[]>([]);
  isLoading = signal(false);

  private preferences = inject(PreferencesService);

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

      // A entrada de auditoria é escrita pelo trigger zz_audit_payment_insert.
      await this.syncInvoiceAfterPayment(data.invoice_id);

      return data;
    } catch (error) {
      console.error('Erro ao criar pagamento:', error);
      this.lastError = friendlyErrorMessage(error, 'Não foi possível registar o pagamento.');
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
      receipt_number: payment.receipt_number || undefined,
      amount,
      reason: payment.annulment_reason || undefined,
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

  /**
   * Anula um recibo. Os recibos não são eliminados, para que a série não
   * fique com buracos. A anulação é feita no servidor (annul_payment), que
   * valida o papel do utilizador e recalcula os totais e o estado da factura.
   */
  async annulPayment(paymentId: string, reason: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase.db.rpc('annul_payment', {
        p_payment_id: paymentId,
        p_reason: reason
      });

      if (error) throw error;

      const { data: payment } = await this.supabase.db
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();

      if (payment) {
        await this.logPaymentAudit('Anulou Recibo', payment);
      }

      return { success: true };
    } catch (error: any) {
      console.error('Erro ao anular recibo:', error);
      return { success: false, error: error?.message };
    }
  }

  isAnnulled(payment: Pick<Payment, 'status'>): boolean {
    return payment.status === 'anulado';
  }

  /**
   * Número do recibo atribuído pela base de dados (ex.: REC00031).
   * O formato antigo, derivado do identificador, só serve de recurso para
   * pagamentos ainda sem número.
   */
  getReceiptNumber(payment: Pick<Payment, 'id' | 'receipt_number'>): string {
    return payment.receipt_number
      || `REC-${(payment.id || '').substring(0, 8).toUpperCase()}`;
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

  /** Data segundo Configurações > Sistema (datas 'AAAA-MM-DD' sem conversão de fuso). */
  formatDate(dateString: string): string {
    return this.preferences.formatDate(dateString);
  }
}
