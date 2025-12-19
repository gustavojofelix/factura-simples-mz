import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';

export interface InvoiceItem {
  id?: string;
  invoice_id?: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  ispc_rate: number;
  ispc_amount: number;
  subtotal: number;
  total: number;
}

export interface Invoice {
  id: string;
  company_id: string;
  client_id: string;
  invoice_number: string;
  date: string;
  due_date?: string;
  subtotal: number;
  ispc_amount: number;
  total: number;
  amount_paid: number;
  amount_pending: number;
  status: string;
  notes?: string;
  created_at: string;
  client?: {
    name: string;
    nuit?: string;
    email?: string;
    phone?: string;
    address?: string;
    document_type?: string;
  };
  items?: InvoiceItem[];
}

@Injectable({
  providedIn: 'root'
})
export class InvoiceService {
  invoices = signal<Invoice[]>([]);
  isLoading = signal(false);

  constructor(
    private supabase: SupabaseService,
    private companyService: CompanyService
  ) {}

  async loadInvoices() {
    const company = this.companyService.activeCompany();
    if (!company) return;

    this.isLoading.set(true);

    try {
      const { data, error } = await this.supabase.db
        .from('invoices')
        .select(`
          *,
          client:clients (name, nuit, email, phone, address, document_type)
        `)
        .eq('company_id', company.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const invoicesWithStatus = (data || []).map(invoice => ({
        ...invoice,
        status: this.calculateInvoiceStatus(invoice)
      }));

      await this.updateInvoiceStatusesIfNeeded(invoicesWithStatus);

      this.invoices.set(invoicesWithStatus);
    } catch (error) {
      console.error('Erro ao carregar facturas:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private calculateInvoiceStatus(invoice: any): string {
    if (invoice.amount_paid >= invoice.total) {
      return 'paga';
    }

    if (invoice.due_date) {
      const dueDate = new Date(invoice.due_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      dueDate.setHours(0, 0, 0, 0);

      if (dueDate < today && invoice.amount_paid < invoice.total) {
        return 'vencida';
      }
    }

    return 'pendente';
  }

  private async updateInvoiceStatusesIfNeeded(invoices: any[]) {
    const updates = invoices
      .filter(inv => inv.status !== this.calculateInvoiceStatus(inv))
      .map(inv => ({
        id: inv.id,
        status: this.calculateInvoiceStatus(inv)
      }));

    for (const update of updates) {
      try {
        await this.supabase.db
          .from('invoices')
          .update({ status: update.status })
          .eq('id', update.id);
      } catch (error) {
        console.error('Erro ao actualizar status:', error);
      }
    }
  }

  async getInvoiceWithItems(invoiceId: string): Promise<Invoice | null> {
    try {
      const { data: invoice, error: invoiceError } = await this.supabase.db
        .from('invoices')
        .select(`
          *,
          client:clients (name, nuit, email, phone, address, document_type)
        `)
        .eq('id', invoiceId)
        .single();

      if (invoiceError) throw invoiceError;

      const { data: items, error: itemsError } = await this.supabase.db
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', invoiceId);

      if (itemsError) throw itemsError;

      const invoiceWithStatus = {
        ...invoice,
        status: this.calculateInvoiceStatus(invoice),
        items: items || []
      };

      return invoiceWithStatus;
    } catch (error) {
      console.error('Erro ao carregar factura:', error);
      return null;
    }
  }

  canEditInvoice(invoice: Invoice): boolean {
    return invoice.status !== 'paga';
  }

  canDeleteInvoice(invoice: Invoice): boolean {
    return invoice.status !== 'paga';
  }

  getStatusLabel(status: string): string {
    const labels: { [key: string]: string } = {
      'pendente': 'Pendente',
      'paga': 'Paga',
      'vencida': 'Vencida'
    };
    return labels[status] || status;
  }

  getStatusColor(status: string): string {
    const colors: { [key: string]: string } = {
      'pendente': 'bg-yellow-100 text-yellow-800',
      'paga': 'bg-green-100 text-green-800',
      'vencida': 'bg-red-100 text-red-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  }

  async createInvoice(
    clientId: string,
    items: Omit<InvoiceItem, 'id' | 'invoice_id'>[],
    dueDate?: string,
    notes?: string
  ): Promise<Invoice | null> {
    const company = this.companyService.activeCompany();
    if (!company) return null;

    try {
      const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
      const ispcAmount = items.reduce((sum, item) => sum + item.ispc_amount, 0);
      const total = subtotal + ispcAmount;

      const invoiceNumber = `${company.invoice_prefix}${String(company.invoice_number).padStart(5, '0')}`;

      const { data: invoice, error: invoiceError } = await this.supabase.db
        .from('invoices')
        .insert({
          company_id: company.id,
          client_id: clientId,
          invoice_number: invoiceNumber,
          date: new Date().toISOString().split('T')[0],
          due_date: dueDate,
          subtotal,
          ispc_amount: ispcAmount,
          total,
          amount_paid: 0,
          amount_pending: total,
          status: 'pendente',
          notes
        })
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      const itemsToInsert = items.map(item => ({
        invoice_id: invoice.id,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        ispc_rate: item.ispc_rate,
        ispc_amount: item.ispc_amount,
        subtotal: item.subtotal,
        total: item.total
      }));

      const { error: itemsError } = await this.supabase.db
        .from('invoice_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      const updateSuccess = await this.companyService.updateCompany(company.id, {
        invoice_number: company.invoice_number + 1
      });

      if (!updateSuccess) {
        console.error('Erro ao actualizar número da factura');
      }

      await this.loadInvoices();

      return invoice;
    } catch (error) {
      console.error('Erro ao criar factura:', error);
      return null;
    }
  }

  async deleteInvoice(invoiceId: string): Promise<boolean> {
    const invoice = this.invoices().find(inv => inv.id === invoiceId);
    if (invoice && !this.canDeleteInvoice(invoice)) {
      console.error('Não é possível eliminar facturas pagas');
      return false;
    }
    try {
      const { error: itemsError } = await this.supabase.db
        .from('invoice_items')
        .delete()
        .eq('invoice_id', invoiceId);

      if (itemsError) throw itemsError;

      const { error } = await this.supabase.db
        .from('invoices')
        .delete()
        .eq('id', invoiceId);

      if (error) throw error;

      this.invoices.update(invoices => invoices.filter(inv => inv.id !== invoiceId));
      return true;
    } catch (error) {
      console.error('Erro ao eliminar factura:', error);
      return false;
    }
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
