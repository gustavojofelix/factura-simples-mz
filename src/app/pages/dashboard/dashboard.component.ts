import { Component, OnInit, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CompanyService } from '../../core/services/company.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { SubscriptionService } from '../../core/services/subscription.service';
import { InvoiceDialogComponent } from '../../shared/components/invoice-dialog.component';
import { InvoiceService, Invoice } from '../../core/services/invoice.service';

interface DashboardMetrics {
  quarterSales: number;
  ispcToPay: number;
  pendingInvoices: number;
  activeClients: number;
}

interface RecentInvoice {
  id: string;
  invoice_number: string;
  client_name: string;
  date: string;
  total: number;
  status: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatDialogModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  metrics = signal<DashboardMetrics>({
    quarterSales: 0,
    ispcToPay: 0,
    pendingInvoices: 0,
    activeClients: 0
  });

  recentInvoices = signal<RecentInvoice[]>([]);
  isLoading = signal(true);

  displayedColumns = ['invoice_number', 'client', 'issuer_name', 'date', 'total', 'status'];

  constructor(
    public companyService: CompanyService,
    public subscriptionService: SubscriptionService,
    public invoiceService: InvoiceService,
    private supabase: SupabaseService,
    private dialog: MatDialog
  ) {
    effect(() => {
      const company = this.companyService.activeCompany();
      if (company) {
        this.loadDashboardData(company.id);
      }
    });
  }

  ngOnInit() {
    const company = this.companyService.activeCompany();
    if (company) {
      this.loadDashboardData(company.id);
    }
  }

  async loadDashboardData(companyId: string) {
    this.isLoading.set(true);

    try {
      await Promise.all([
        this.loadMetrics(companyId),
        this.loadRecentInvoices(companyId),
        this.subscriptionService.loadSubscription(companyId)
      ]);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadMetrics(companyId: string) {
    const currentMonth = new Date().toISOString().slice(0, 7);

    const { data: invoices } = await this.supabase.db
      .from('invoices')
      .select('total, status, date, amount_paid, due_date')
      .eq('company_id', companyId)
      .neq('status', 'rascunho')
      .neq('status', 'anulada');

    const { data: clients } = await this.supabase.db
      .from('clients')
      .select('id')
      .eq('company_id', companyId)
      .eq('is_active', true);

    // Calculate actual status for each invoice (same logic as InvoiceService)
    const invoicesWithCalculatedStatus = (invoices || []).map(inv => {
      let calculatedStatus = inv.status;
      
      // If fully paid, status is 'paga'
      if (inv.amount_paid >= inv.total) {
        calculatedStatus = 'paga';
      }
      // If has due date and is overdue and not fully paid
      else if (inv.due_date) {
        const dueDate = new Date(inv.due_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        dueDate.setHours(0, 0, 0, 0);
        
        if (dueDate < today && inv.amount_paid < inv.total) {
          calculatedStatus = 'vencida';
        }
      }
      
      return { ...inv, calculatedStatus };
    });

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthIndex = now.getMonth();
    const quarterStartMonth = Math.floor(currentMonthIndex / 3) * 3;

    const quarterInvoices = invoicesWithCalculatedStatus.filter(inv => {
      if (!inv.date) return false;
      const invDate = new Date(inv.date);
      return invDate.getFullYear() === currentYear && 
             invDate.getMonth() >= quarterStartMonth &&
             invDate.getMonth() <= quarterStartMonth + 2;
    });

    const pendingInvoices = invoicesWithCalculatedStatus.filter(inv =>
      inv.calculatedStatus === 'pendente'
    );

    // ISPC is calculated quarterly based on annual volume, not per invoice
    // We estimate 3% of quarterly sales as a placeholder
    const totalQuarterSales = quarterInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
    const estimatedIspc = totalQuarterSales * 0.03;

    this.metrics.set({
      quarterSales: totalQuarterSales,
      ispcToPay: estimatedIspc,
      pendingInvoices: pendingInvoices.length,
      activeClients: clients?.length || 0
    });
  }

  async loadRecentInvoices(companyId: string) {
    const { data } = await this.supabase.db
      .from('invoices')
      .select(`
        id,
        invoice_number,
        date,
        total,
        status,
        amount_paid,
        due_date,
        clients (name),
        issuer:profiles (full_name)
      `)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (data) {
      this.recentInvoices.set(
        data.map(inv => ({
          id: inv.id,
          invoice_number: inv.invoice_number,
          client_name: (inv.clients as any)?.name || 'Cliente',
          date: inv.date,
          total: inv.total,
          status: this.calculateRecentInvoiceStatus(inv),
          issuer_name: (inv.issuer as any)?.full_name
        }))
      );
    }
  }

  private calculateRecentInvoiceStatus(invoice: any): string {
    const currentStatus = (invoice.status || '').toLowerCase();

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

  getStatusColor(status: string): string {
    return this.invoiceService.getStatusColor(status);
  }

  getStatusLabel(status: string): string {
    return this.invoiceService.getStatusLabel(status);
  }

  openNewInvoiceDialog() {
    const dialogRef = this.dialog.open(InvoiceDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      disableClose: true
    });

    dialogRef.afterClosed().subscribe((invoice: Invoice) => {
      if (invoice) {
        const company = this.companyService.activeCompany();
        if (company) {
          this.loadDashboardData(company.id);
        }
      }
    });
  }
}
