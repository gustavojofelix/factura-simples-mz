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
import { InvoiceDialogComponent } from '../../shared/components/invoice-dialog.component';
import { Invoice } from '../../core/services/invoice.service';

interface DashboardMetrics {
  monthSales: number;
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
    monthSales: 0,
    ispcToPay: 0,
    pendingInvoices: 0,
    activeClients: 0
  });

  recentInvoices = signal<RecentInvoice[]>([]);
  isLoading = signal(true);

  displayedColumns = ['invoice_number', 'client', 'date', 'total', 'status'];

  constructor(
    public companyService: CompanyService,
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
        this.loadRecentInvoices(companyId)
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
      .select('total, ispc_amount, status, date')
      .eq('company_id', companyId);

    const { data: clients } = await this.supabase.db
      .from('clients')
      .select('id')
      .eq('company_id', companyId);

    const monthInvoices = invoices?.filter(inv =>
      inv.date?.startsWith(currentMonth)
    ) || [];

    const pendingInvoices = invoices?.filter(inv =>
      inv.status === 'pendente'
    ) || [];

    this.metrics.set({
      monthSales: monthInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0),
      ispcToPay: monthInvoices.reduce((sum, inv) => sum + (inv.ispc_amount || 0), 0),
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
        clients (name)
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
          status: inv.status
        }))
      );
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

  getStatusColor(status: string): string {
    const colors: { [key: string]: string } = {
      'paga': 'success',
      'pendente': 'warn',
      'vencida': 'error'
    };
    return colors[status] || 'default';
  }

  getStatusLabel(status: string): string {
    const labels: { [key: string]: string } = {
      'paga': 'PAGA',
      'pendente': 'PENDENTE',
      'vencida': 'VENCIDA'
    };
    return labels[status] || status.toUpperCase();
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
