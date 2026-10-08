import { Component, OnInit, signal, effect, inject } from '@angular/core';
import { PreferencesService } from '../../core/services/preferences.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TaxService, TaxCalculation, TaxDeclaration, TaxSummary } from '../../core/services/tax.service';
import { CompanyService } from '../../core/services/company.service';
import { TaxPaymentDialogComponent } from '../../shared/components/tax-payment-dialog.component';
import { Model30Component } from '../../shared/components/model30.component';
import { Model30ExcelService } from '../../core/services/model30-excel.service';
import { AuditLogService } from '../../core/services/audit-log.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { friendlyFunctionError } from '../../core/utils/error-message';

/** Lembrete de obrigação fiscal gerado por generate_tax_reminders(). */
export interface TaxReminder {
  id: string;
  year: number;
  quarter: number;
  kind: 'qend' | 'd15' | 'd7' | 'd1' | 'd0' | 'overdue';
  due_date: string;
  title: string;
  body: string;
  created_at: string;
  emailed_at: string | null;
  cancelled_at: string | null;
}

@Component({
  selector: 'app-taxes',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatTableModule,
    MatChipsModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatTooltipModule
  ],
  templateUrl: './taxes.component.html',
  styleUrls: ['./taxes.component.css']
})
export class TaxesComponent implements OnInit {
  selectedYear = signal(new Date().getFullYear());
  selectedPeriod = signal(Math.ceil((new Date().getMonth() + 1) / 3));
  calculation = signal<TaxCalculation | null>(null);
  isCalculating = signal(false);
  selectedTabIndex = signal(0);
  summary = signal<TaxSummary>({
    yearToDate: 0,
    currentQuarter: 0,
    overdue: 0,
    nextDue: 0,
    totalPaid: 0,
    pendingDeclarations: 0
  });
  reminders = signal<TaxReminder[]>([]);
  isSendingTestReminder = signal(false);
  exportingExcelId = signal<string | null>(null);

  years: number[] = [];
  periods = [
    { value: 1, label: '1º Trimestre (Jan-Mar)' },
    { value: 2, label: '2º Trimestre (Abr-Jun)' },
    { value: 3, label: '3º Trimestre (Jul-Set)' },
    { value: 4, label: '4º Trimestre (Out-Dez)' }
  ];

  displayedColumns = ['period', 'dates', 'amount', 'status', 'due_date', 'actions'];

  /** Formato de data e fuso horário de Configurações > Sistema. */
  private preferences = inject(PreferencesService);

  constructor(
    public taxService: TaxService,
    public companyService: CompanyService,
    private dialog: MatDialog,
    private auditLogService: AuditLogService,
    private supabase: SupabaseService,
    private model30Excel: Model30ExcelService
  ) {
    const currentYear = new Date().getFullYear();
    for (let i = currentYear; i >= currentYear - 5; i--) {
      this.years.push(i);
    }

    effect(() => {
      const company = this.companyService.activeCompany();
      if (company) {
        this.loadData();
      }
    });
  }

  async ngOnInit() {
    if (this.companyService.activeCompany()) {
      await this.loadData();
    }
  }

  async loadData() {
    await this.taxService.loadDeclarations();
    await this.updateSummary();
    await this.loadReminders();
  }

  /** Lembretes do Modelo 30 (prazos e incumprimentos), mais recentes primeiro. */
  async loadReminders() {
    const company = this.companyService.activeCompany();
    if (!company) {
      this.reminders.set([]);
      return;
    }

    const { data } = await this.supabase.db
      .from('tax_reminders')
      .select('id, year, quarter, kind, due_date, title, body, created_at, emailed_at, cancelled_at')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
      .limit(5);

    this.reminders.set((data ?? []) as TaxReminder[]);
  }

  getReminderStyle(kind: TaxReminder['kind']): { icon: string; classes: string } {
    switch (kind) {
      case 'overdue':
        return { icon: 'gavel', classes: 'bg-red-50 border-red-300 text-red-600' };
      case 'd0':
        return { icon: 'alarm', classes: 'bg-red-50 border-red-300 text-red-600' };
      case 'd1':
        return { icon: 'alarm', classes: 'bg-red-50 border-red-200 text-red-600' };
      case 'd7':
        return { icon: 'schedule', classes: 'bg-orange-50 border-orange-200 text-orange-600' };
      case 'qend':
        return { icon: 'event_available', classes: 'bg-blue-50 border-blue-200 text-blue-600' };
      default:
        return { icon: 'event', classes: 'bg-blue-50 border-blue-200 text-blue-600' };
    }
  }

  /** Só o proprietário pode pedir um lembrete de teste (enviado para o seu próprio email). */
  canSendTestReminder(): boolean {
    const company = this.companyService.activeCompany();
    return !!company && this.companyService.isOwner(company.id);
  }

  /** Envia para o email do proprietário um lembrete "[TESTE]" com a data de hoje. Não regista nada. */
  async sendTestReminder() {
    const company = this.companyService.activeCompany();
    if (!company || this.isSendingTestReminder()) return;

    this.isSendingTestReminder.set(true);
    try {
      const { data, error } = await this.supabase.client.functions.invoke('send-tax-reminders', {
        body: { mode: 'test', company_id: company.id, sample: true }
      });
      if (error) throw error;
      window.alert(
        data?.message ||
        (data?.ok ? 'Lembrete de teste enviado para o seu email.' : 'Não foi possível enviar o lembrete de teste.')
      );
    } catch (error) {
      console.error('Erro ao enviar lembrete de teste:', error);
      window.alert(await friendlyFunctionError(error, 'Não foi possível enviar o lembrete de teste.'));
    } finally {
      this.isSendingTestReminder.set(false);
    }
  }

  async updateSummary() {
    const summary = await this.taxService.getTaxSummary(this.selectedYear());
    this.summary.set(summary);
  }

  async calculateTax() {
    this.isCalculating.set(true);
    try {
      const calc = await this.taxService.calculateTaxForPeriod(
        this.selectedYear(),
        this.selectedPeriod()
      );
      this.calculation.set(calc);
    } finally {
      this.isCalculating.set(false);
    }
  }

  async createDeclaration() {
    const calc = this.calculation();
    if (!calc) return;

    const result = await this.taxService.createDeclaration(calc);
    if (result) {
      this.calculation.set(null);
      await this.updateSummary();
      this.selectedTabIndex.set(1); // Switch to "Declarações" tab
    }
  }

  async submitDeclaration(declaration: TaxDeclaration) {
    const today = new Date().toISOString().split('T')[0];
    await this.taxService.updateDeclarationStatus(declaration.id, 'submetida', {
      submission_date: today
    });
    await this.updateSummary();
  }

  openPaymentDialog(declaration: TaxDeclaration) {
    const dialogRef = this.dialog.open(TaxPaymentDialogComponent, {
      width: '600px',
      data: { declaration }
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) {
        await this.taxService.addPayment(
          declaration.id,
          result.amount,
          result.paymentDate,
          result.paymentMethod,
          result.reference,
          result.receiptUrl,
          result.notes
        );
        await this.updateSummary();
      }
    });
  }

  openModel30(declaration: TaxDeclaration) {
    this.auditLogService.log(
      'Gerou Modelo 30',
      'declarations',
      { year: declaration.year, period: declaration.period },
      declaration.id,
      `${declaration.period}º Trim ${declaration.year}`,
      declaration.company_id
    );

    this.dialog.open(Model30Component, {
      width: '100vw',
      height: '100vh',
      maxWidth: '100vw',
      maxHeight: '100vh',
      panelClass: 'fullscreen-dialog',
      data: { declaration }
    });
  }

  async exportModel30Excel(declaration: TaxDeclaration) {
    if (this.exportingExcelId()) return;
    const company = this.companyService.activeCompany();
    if (!company) return;

    this.exportingExcelId.set(declaration.id);
    try {
      // O registo de auditoria é feito pelo serviço após exportação bem-sucedida.
      await this.model30Excel.exportModel30(declaration, company);
    } catch (error) {
      console.error('Erro ao gerar o Excel do Modelo 30:', error);
      window.alert('Não foi possível gerar o Excel. Por favor, tente novamente.');
    } finally {
      this.exportingExcelId.set(null);
    }
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-MZ', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value) + ' MZN';
  }

  formatDate(dateString?: string): string {
    if (!dateString) return '-';
    return this.preferences.formatDate(dateString) || '-';
  }

  getPeriodLabel(period: number): string {
    return this.taxService.getPeriodName(period);
  }

  getStatusLabel(status: string): string {
    return this.taxService.getStatusLabel(status);
  }

  getStatusColor(status: string): string {
    return this.taxService.getStatusColor(status);
  }

  isOverdue(declaration: TaxDeclaration): boolean {
    if (declaration.status === 'paga') return false;
    if (!declaration.due_date) return false;
    const today = new Date().toISOString().split('T')[0];
    return declaration.due_date < today;
  }

  getTotalPaid(declaration: TaxDeclaration): number {
    return (declaration.payments || []).reduce((sum, p) => sum + p.amount, 0);
  }

  getAmountPending(declaration: TaxDeclaration): number {
    return declaration.ispc_amount - this.getTotalPaid(declaration);
  }
}
