import { Component, OnInit, signal, effect, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
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
import { TaxService } from '../../core/services/tax.service';
import { AuthService } from '../../core/services/auth.service';
import { AuditLogService, AuditLogEntry } from '../../core/services/audit-log.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { getAuditCategoryLabel, getAuditCategoryBadge, getAuditCategoryIcon } from '../../core/utils/audit-formatter.util';

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
  issuer_name?: string;
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
  readonly lastUpdatedAt = signal<Date | null>(null);
  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
  });
  readonly userName = computed(() => {
    const user = this.authService.currentUser();
    return user?.user_metadata?.['full_name'] || user?.email?.split('@')[0] || 'Utilizador';
  });
  readonly userRole = computed(() => {
    const role = this.companyService.activeRole();
    if (!role) return 'A carregar…';
    return role === 'owner' ? 'Administrador' : role === 'manager' ? 'Gestor' : 'Vendedor';
  });
  readonly quarterPeriod = computed(() => {
    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), quarter * 3, 1);
    const end = new Date(now.getFullYear(), quarter * 3 + 3, 0);
    return `${this.formatShortDate(start)} — ${this.formatShortDate(end)}`;
  });
  metrics = signal<DashboardMetrics>({
    quarterSales: 0,
    ispcToPay: 0,
    pendingInvoices: 0,
    activeClients: 0
  });

  recentInvoices = signal<RecentInvoice[]>([]);
  isLoading = signal(true);

  displayedColumns = ['invoice_number', 'client', 'issuer_name', 'date', 'total', 'status'];

  recentActivities = signal<AuditLogEntry[]>([]);
  activityColumns = ['when', 'action', 'user'];
  /** Mirrors the audit_logs RLS policy: only company owners/admins can read the log. */
  readonly canSeeActivity = computed(() => ['owner', 'admin'].includes(this.companyService.activeRole() ?? ''));
  /** Formato de data e fuso horário de Configurações > Sistema. */
  private preferences = inject(PreferencesService);

  constructor(
    public companyService: CompanyService,
    public subscriptionService: SubscriptionService,
    public invoiceService: InvoiceService,
    public taxService: TaxService,
    public authService: AuthService,
    private supabase: SupabaseService,
    private dialog: MatDialog,
    private auditLogService: AuditLogService,
    public router: Router
  ) {
    effect(() => {
      const company = this.companyService.activeCompany();
      if (company) {
        this.loadDashboardData(company.id);
      }
    });

    // Separate effect: activeRole may still be null on the first run, so re-load once it resolves.
    effect(() => {
      const company = this.companyService.activeCompany();
      const canSee = this.canSeeActivity();
      if (company && canSee) {
        this.loadRecentActivities(company.id);
      } else {
        this.recentActivities.set([]);
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
      this.lastUpdatedAt.set(new Date());
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadRecentActivities(companyId: string) {
    if (!this.canSeeActivity()) {
      this.recentActivities.set([]);
      return;
    }
    try {
      const rows = await this.auditLogService.getRecentLogs(companyId, 6);
      // Ignore stale responses if the user switched company while the request was in flight.
      if (this.companyService.activeCompany()?.id === companyId) {
        this.recentActivities.set(rows);
      }
    } catch (error) {
      console.warn('Não foi possível carregar as actividades recentes:', error);
      if (this.companyService.activeCompany()?.id === companyId) {
        this.recentActivities.set([]);
      }
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
    const currentQuarter = Math.floor(currentMonthIndex / 3) + 1;
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

    // Fetch precise ISPC calculation from TaxService to take into account cumulative sales and excesses
    const taxCalc = await this.taxService.calculateTaxForPeriod(currentYear, currentQuarter);
    
    const totalQuarterSales = taxCalc ? taxCalc.totalSales : quarterInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
    const estimatedIspc = taxCalc ? taxCalc.ispcAmount : totalQuarterSales * 0.03;

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
    const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
    return new Intl.NumberFormat('pt-MZ', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(safeValue) + ' MZN';
  }

  formatAmount(value: number): string {
    const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
    return new Intl.NumberFormat('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safeValue);
  }

  formatShortDate(date: Date): string {
    return new Intl.DateTimeFormat('pt-MZ', { day: '2-digit', month: 'short' }).format(date).replace('.', '');
  }

  formatLastUpdated(): string {
    const value = this.lastUpdatedAt();
    if (!value) return 'A sincronizar';
    return `Hoje, ${this.preferences.formatTime(value)}`;
  }

  formatDate(dateString: string): string {
    return this.preferences.formatDate(dateString);
  }

  getStatusColor(status: string): string {
    return this.invoiceService.getStatusColor(status);
  }

  getStatusLabel(status: string): string {
    return this.invoiceService.getStatusLabel(status);
  }

  categoryLabel(category: string): string {
    return getAuditCategoryLabel(category);
  }

  categoryBadge(category: string): string {
    return getAuditCategoryBadge(category);
  }

  categoryIcon(category: string): string {
    return getAuditCategoryIcon(category);
  }

  formatRelativeTime(iso: string): string {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '-';
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);
    const time = this.preferences.formatTime(date);

    if (minutes < 1) return 'Agora mesmo';
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `há ${hours} h`;

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (this.preferences.formatDate(date) === this.preferences.formatDate(yesterday)) return `Ontem, ${time}`;

    return `${this.formatDate(iso)} ${time}`;
  }

  formatFullTimestamp(iso: string): string {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    return this.preferences.formatDateTime(date, true);
  }

  openInvoice(invoice: RecentInvoice) {
    this.router.navigate(['/facturas', invoice.id]);
  }

  openActivity(log: AuditLogEntry) {
    // Only invoice entries carry the invoice id in entity_id (payments carry the payment id).
    // Deletions point to a record that no longer exists, so they go to the audit log instead.
    if (log.category === 'invoices' && log.entity_id && !log.action.startsWith('Eliminou')) {
      this.router.navigate(['/facturas', log.entity_id]);
    } else {
      this.router.navigate(['/auditoria']);
    }
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
          this.loadRecentActivities(company.id);
        }
      }
    });
  }
}
