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
  total: number;
  amount_paid: number;
  amount_pending: number;
  status: string;
  notes?: string;
  created_at: string;
  created_by?: string;
  issuer_name?: string;
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
          client:clients (name, nuit, email, phone, address, document_type),
          issuer:profiles (full_name)
        `)
        .eq('company_id', company.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const invoicesWithStatus = (data || []).map(invoice => ({
        ...invoice,
        status: this.calculateInvoiceStatus(invoice),
        issuer_name: (invoice.issuer as any)?.full_name
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
    const currentStatus = (invoice.status || '').toLowerCase();
    
    // Drafts and Annulled are terminal or special states that shouldn't be auto-recalculated by date/payment
    if (currentStatus === 'rascunho' || currentStatus === 'anulada') {
      return currentStatus;
    }

    if (invoice.amount_paid >= invoice.total) {
      return 'paga';
    }

    if (invoice.due_date) {
      const dueDate = new Date(invoice.due_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      dueDate.setHours(0, 0, 0, 0);

      if (dueDate < today && (invoice.amount_paid || 0) < invoice.total) {
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
          client:clients (name, nuit, email, phone, address, document_type),
          issuer:profiles (full_name)
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
        items: items || [],
        issuer_name: (invoice.issuer as any)?.full_name
      };

      return invoiceWithStatus;
    } catch (error) {
      console.error('Erro ao carregar factura:', error);
      return null;
    }
  }

  canEditInvoice(invoice: Invoice): boolean {
    // Can edit only if it's a draft
    return invoice.status === 'rascunho';
  }

  canDeleteInvoice(invoice: Invoice): boolean {
    // Can delete only if it's a draft
    return invoice.status === 'rascunho';
  }

  canAnnulInvoice(invoice: Invoice): boolean {
    // Can annul if it's not a draft and not already annulled
    return invoice.status !== 'rascunho' && invoice.status !== 'anulada';
  }

  canManagePayments(invoice: Invoice): boolean {
    // Can manage payments if not already fully paid and not a draft
    return invoice.status !== 'paga' && invoice.status !== 'rascunho' && invoice.amount_pending > 0;
  }

  getStatusLabel(status: string): string {
    const labels: { [key: string]: string } = {
      'rascunho': 'Rascunho',
      'pendente': 'Pendente',
      'paga': 'Paga',
      'vencida': 'Vencida',
      'anulada': 'Anulada'
    };
    return labels[status] || status;
  }

  getStatusColor(status: string): string {
    const s = (status || '').toLowerCase();
    const colors: { [key: string]: string } = {
      'rascunho': 'bg-gray-100 text-gray-800 border-gray-300',
      'pendente': 'bg-blue-100 text-blue-800 border-blue-200',
      'paga': 'bg-green-100 text-green-800 border-green-200',
      'vencida': 'bg-red-100 text-red-800 border-red-200',
      'anulada': 'bg-red-600 text-white'
    };
    return colors[s] || 'bg-gray-100 text-gray-800';
  }

  async createInvoice(
    clientId: string,
    items: Omit<InvoiceItem, 'id' | 'invoice_id'>[],
    dueDate?: string,
    notes?: string,
    status: string = 'pendente'
  ): Promise<Invoice | null> {
    const company = this.companyService.activeCompany();
    if (!company) return null;

    try {
      const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
      const total = subtotal;

      let invoiceNumber = '';
      if (status === 'rascunho') {
        invoiceNumber = `RSC-${Date.now().toString().slice(-6)}`;
      } else {
        invoiceNumber = `${company.invoice_prefix}${String(company.invoice_number).padStart(5, '0')}`;
      }

      const { data: invoice, error: invoiceError } = await this.supabase.db
        .from('invoices')
        .insert({
          company_id: company.id,
          client_id: clientId,
          invoice_number: invoiceNumber,
          date: new Date().toISOString().split('T')[0],
          due_date: dueDate,
          subtotal,
          total,
          amount_paid: 0,
          amount_pending: total,
          status,
          notes,
          created_by: (await this.supabase.auth.getUser()).data.user?.id
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
        subtotal: item.subtotal,
        total: item.total
      }));

      const { error: itemsError } = await this.supabase.db
        .from('invoice_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;
      
      // Stock management: Decrement stock if not a draft
      if (status !== 'rascunho') {
        await this.handleStockUpdate(items, 'decrement');
      }

      if (status !== 'rascunho') {
        const updateSuccess = await this.companyService.updateCompany(company.id, {
          invoice_number: company.invoice_number + 1
        });

        if (!updateSuccess) {
          console.error('Erro ao actualizar número da factura');
        }
      }

      await this.loadInvoices();

      return invoice;
    } catch (error) {
      console.error('Erro ao criar factura:', error);
      return null;
    }
  }

  async emitInvoice(invoiceId: string): Promise<boolean> {
    const invoice = this.invoices().find(i => i.id === invoiceId);
    if (!invoice || invoice.status !== 'rascunho') return false;

    const company = this.companyService.activeCompany();
    if (!company) return false;

    const invoiceNumber = `${company.invoice_prefix}${String(company.invoice_number).padStart(5, '0')}`;

    try {
      const { error } = await this.supabase.db
        .from('invoices')
        .update({
          status: 'pendente',
          invoice_number: invoiceNumber,
          date: new Date().toISOString().split('T')[0]
        })
        .eq('id', invoiceId);

      if (error) throw error;

      await this.companyService.updateCompany(company.id, {
        invoice_number: company.invoice_number + 1
      });

      // Stock management: Decrement stock when emitting draft
      const { data: items } = await this.supabase.db
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', invoiceId);
      
      if (items && items.length > 0) {
        await this.handleStockUpdate(items, 'decrement');
      }

      await this.loadInvoices();
      return true;
    } catch (error) {
      console.error('Erro ao emitir factura:', error);
      return false;
    }
  }

  async updateInvoice(
    id: string,
    clientId: string,
    items: Omit<InvoiceItem, 'id' | 'invoice_id'>[],
    dueDate?: string,
    notes?: string
  ): Promise<Invoice | null> {
    const invoice = this.invoices().find(i => i.id === id);
    if (!invoice || !this.canEditInvoice(invoice)) {
      console.error('Factura não pode ser editada');
      return null;
    }

    try {
      const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
      const total = subtotal;

      // Update Header
      const { data: updatedInvoice, error: updateError } = await this.supabase.db
        .from('invoices')
        .update({
          client_id: clientId,
          due_date: dueDate,
          subtotal,
          total,
          amount_pending: total - invoice.amount_paid,
          notes
        })
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      // Stock management: Restore old items stock if not a draft
      if (invoice.status !== 'rascunho') {
        const { data: oldItems } = await this.supabase.db
          .from('invoice_items')
          .select('*')
          .eq('invoice_id', id);
        
        if (oldItems && oldItems.length > 0) {
          await this.handleStockUpdate(oldItems, 'increment');
        }
      }

      // Replace Items (Delete all and Insert new)
      const { error: deleteItemsError } = await this.supabase.db
        .from('invoice_items')
        .delete()
        .eq('invoice_id', id);

      if (deleteItemsError) throw deleteItemsError;

      const itemsToInsert = items.map(item => ({
        invoice_id: id,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        subtotal: item.subtotal,
        total: item.total
      }));

      const { error: insertItemsError } = await this.supabase.db
        .from('invoice_items')
        .insert(itemsToInsert);

      if (insertItemsError) throw insertItemsError;

      // Stock management: Decrement new items stock if not a draft
      if (invoice.status !== 'rascunho') {
        await this.handleStockUpdate(items, 'decrement');
      }

      await this.loadInvoices();
      return updatedInvoice;
    } catch (error) {
      console.error('Erro ao actualizar factura:', error);
      return null;
    }
  }

  async deleteInvoice(invoiceId: string): Promise<boolean> {
    const invoice = this.invoices().find(inv => inv.id === invoiceId);
    if (invoice && !this.canDeleteInvoice(invoice)) {
      console.error('Não é possível eliminar facturas emitidas. Utilize a opção "Anular" em vez disso.');
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

  async annulInvoice(id: string): Promise<boolean> {
    try {
      const { data: invoice, error: fetchError } = await this.supabase.client
        .from('invoices')
        .select('*, items:invoice_items(*)')
        .eq('id', id)
        .single();

      if (fetchError || !invoice) throw fetchError || new Error('Factura não encontrada');

      // 1. Update status to 'anulada'
      const { error: updateError } = await this.supabase.db
        .from('invoices')
        .update({ 
          status: 'anulada',
          amount_paid: 0,
          amount_pending: 0
        })
        .eq('id', id);

      if (updateError) throw updateError;

      // 2. Restore stock for items
      if (invoice.items && invoice.items.length > 0) {
        await this.handleStockUpdate(invoice.items, 'increment');
      }

      await this.loadInvoices();
      return true;
    } catch (error) {
      console.error('Erro ao anular factura:', error);
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

  async getDetailedInvoices(startDate?: string, endDate?: string): Promise<Invoice[]> {
    const company = this.companyService.activeCompany();
    if (!company) return [];

    let query = this.supabase.db
      .from('invoices')
      .select(`
        *,
        client:clients (*),
        items:invoice_items (*),
        issuer:profiles (full_name)
      `)
      .eq('company_id', company.id)
      .order('date', { ascending: false });

    if (startDate) {
      query = query.gte('date', startDate);
    }
    if (endDate) {
      query = query.lte('date', endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao procurar facturas detalhadas:', error);
      return [];
    }

    return (data || []).map(inv => ({
      ...inv,
      issuer_name: inv.issuer?.full_name || '-',
      status: this.calculateStatus(inv)
    }));
  }

  private calculateStatus(invoice: any): string {
    return this.calculateInvoiceStatus(invoice);
  }

  private async handleStockUpdate(items: any[], type: 'decrement' | 'increment') {
    for (const item of items) {
      if (!item.product_id) continue;

      // Fetch product to check type and current stock
      // We do this inside the loop to get the most recent stock for each item
      const { data: product, error } = await this.supabase.db
        .from('products')
        .select('type, stock')
        .eq('id', item.product_id)
        .single();

      if (error || !product || product.type !== 'produto') continue;

      // If stock is null, we assume it's not being tracked or is 0
      const currentStock = product.stock || 0;
      const newStock = type === 'decrement' 
        ? currentStock - item.quantity 
        : currentStock + item.quantity;

      await this.supabase.db
        .from('products')
        .update({ stock: newStock })
        .eq('id', item.product_id);
    }
  }
}
