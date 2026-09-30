import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CompanyService } from '../../../core/services/company.service';
import { ClientService } from '../../../core/services/client.service';
import { ExportService } from '../../../core/services/export.service';
import { AuditLogService } from '../../../core/services/audit-log.service';
import {
  ClientStatementSummaryRow,
  StatementService,
  StatementStatus
} from '../../../core/services/statement.service';
import { formatIsoDate, parseIsoDate, quarterRange, toIsoDate } from '../../../core/utils/date.util';
import { ReportsNavComponent } from '../reports-nav.component';
import {
  StatementPreviewDialogComponent,
  StatementPreviewData
} from '../../../shared/components/statement-preview-dialog.component';

type SortKey = 'client_code' | 'client_name' | 'opening_balance' | 'total_invoiced' | 'total_paid' | 'balance';

/**
 * Extracto geral: posição de todos os clientes (ou dos seleccionados) da
 * empresa activa num período.
 */
@Component({
  selector: 'app-client-statements',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSelectModule,
    MatTableModule,
    MatSortModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatSnackBarModule,
    ReportsNavComponent
  ],
  templateUrl: './client-statements.component.html'
})
export class ClientStatementsComponent implements OnInit {
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private exportService = inject(ExportService);
  private auditLogService = inject(AuditLogService);
  companyService = inject(CompanyService);
  clientService = inject(ClientService);
  statementService = inject(StatementService);

  readonly columns = ['client_code', 'client_name', 'opening_balance', 'total_invoiced', 'total_paid', 'balance', 'status'];

  filterForm = this.fb.group({
    startDate: [null as Date | null, Validators.required],
    endDate: [null as Date | null, Validators.required],
    quarter: ['none'],
    year: [new Date().getFullYear(), [Validators.required, Validators.min(2000)]],
    clientIds: [[] as string[]]
  });

  notes = signal('');
  isLoading = signal(false);

  /** Resultado do servidor e o período a que corresponde. */
  rows = signal<ClientStatementSummaryRow[]>([]);
  period = signal<{ start: string; end: string } | null>(null);

  search = signal('');
  statusFilter = signal<'all' | StatementStatus | 'com_saldo'>('all');
  hideInactive = signal(true);
  sort = signal<Sort>({ active: 'client_code', direction: 'asc' });

  visibleRows = computed(() => {
    const term = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    const hideInactive = this.hideInactive();

    const filtered = this.rows().filter(row => {
      if (hideInactive && this.statementService.isInactive(row)) return false;
      if (status === 'com_saldo' && row.status === 'pago') return false;
      if (status !== 'all' && status !== 'com_saldo' && row.status !== status) return false;
      if (term) {
        const haystack = `${row.client_code || ''} ${row.client_name} ${row.client_nuit || ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });

    const { active, direction } = this.sort();
    if (!direction) return filtered;

    const key = active as SortKey;
    const factor = direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return String(va ?? '').localeCompare(String(vb ?? ''), 'pt', { numeric: true }) * factor;
    });
  });

  totals = computed(() => this.statementService.totals(this.visibleRows()));
  debtorCount = computed(() => this.visibleRows().filter(r => r.status !== 'pago').length);
  overdueCount = computed(() => this.visibleRows().filter(r => r.status === 'vencido').length);

  ngOnInit() {
    this.clientService.loadClients();

    // Ao voltar do extracto de um cliente, o período vem no URL.
    const query = this.route.snapshot.queryParamMap;
    const start = parseIsoDate(query.get('inicio'));
    const end = parseIsoDate(query.get('fim'));

    const today = new Date();
    this.filterForm.patchValue({
      startDate: start ?? new Date(today.getFullYear(), today.getMonth(), 1),
      endDate: end ?? today
    });

    if (start && end) this.generate();
  }

  openClient(row: ClientStatementSummaryRow) {
    const period = this.period();
    this.router.navigate(['/relatorios/extractos', row.client_id], {
      queryParams: period ? { inicio: period.start, fim: period.end } : {}
    });
  }

  onQuarterChange() {
    const quarter = Number(this.filterForm.value.quarter);
    const year = Number(this.filterForm.value.year);
    if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4 || !Number.isInteger(year)) return;

    const { start, end } = quarterRange(quarter, year);
    this.filterForm.patchValue({ startDate: start, endDate: end });
  }

  /** Alterar as datas à mão deixa de corresponder a um trimestre. */
  onDateChange() {
    this.filterForm.patchValue({ quarter: 'none' }, { emitEvent: false });
  }

  async generate() {
    const company = this.companyService.activeCompany();
    if (!company || this.filterForm.invalid) return;

    const start = toIsoDate(this.filterForm.value.startDate);
    const end = toIsoDate(this.filterForm.value.endDate);
    if (start > end) {
      this.snackBar.open('A data inicial não pode ser posterior à data final.', 'Fechar', { duration: 4000 });
      return;
    }

    const clientIds = this.filterForm.value.clientIds || [];

    this.isLoading.set(true);
    try {
      const rows = await this.statementService.getSummary(company.id, start, end, clientIds);
      this.rows.set(rows);
      this.period.set({ start, end });

      this.auditLogService.log(
        'Gerou Extracto Geral de Clientes',
        'reports',
        { start_date: start, end_date: end, records_count: rows.length, selected_clients: clientIds.length || undefined },
        undefined,
        undefined,
        company.id
      );
    } catch (error) {
      console.error('Erro ao gerar o extracto geral:', error);
      this.snackBar.open('Não foi possível gerar o extracto.', 'Fechar', { duration: 4000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  clearClientSelection() {
    this.filterForm.patchValue({ clientIds: [] });
  }

  openPreview() {
    const company = this.companyService.activeCompany();
    const period = this.period();
    if (!company || !period || this.visibleRows().length === 0) return;

    const data: StatementPreviewData = {
      kind: 'summary',
      company,
      rows: this.visibleRows(),
      start: period.start,
      end: period.end,
      notes: this.notes().trim()
    };

    this.dialog.open(StatementPreviewDialogComponent, {
      data,
      width: '1000px',
      maxWidth: '95vw',
      maxHeight: '95vh'
    });
  }

  exportExcel() {
    const company = this.companyService.activeCompany();
    const period = this.period();
    const rows = this.visibleRows();
    if (!company || !period || rows.length === 0) return;

    const totals = this.totals();
    const data: Record<string, string | number>[] = rows.map(row => ({
      'ID': row.client_code || '',
      'Cliente': row.client_name,
      'NUIT': row.client_nuit || '',
      'Saldo anterior (MZN)': row.opening_balance,
      'Total facturado (MZN)': row.total_invoiced,
      'Total pago (MZN)': row.total_paid,
      'Saldo (MZN)': row.balance,
      'Estado': this.statementService.getStatusLabel(row.status)
    }));

    data.push({});
    data.push({
      'Cliente': 'TOTAL',
      'Saldo anterior (MZN)': totals.opening_balance,
      'Total facturado (MZN)': totals.total_invoiced,
      'Total pago (MZN)': totals.total_paid,
      'Saldo (MZN)': totals.balance
    });
    data.push({});
    data.push({ 'ID': `Empresa: ${company.name}` });
    data.push({ 'ID': `Período: ${formatIsoDate(period.start)} a ${formatIsoDate(period.end)}` });
    if (this.notes().trim()) {
      data.push({ 'ID': `Observações: ${this.notes().trim()}` });
    }

    this.exportService.exportToExcel(
      data,
      `Extracto_Clientes_${period.start}_a_${period.end}`,
      'Extracto geral'
    );

    this.auditLogService.log(
      'Exportou Extracto Geral para Excel',
      'reports',
      { start_date: period.start, end_date: period.end, records_count: rows.length },
      undefined,
      undefined,
      company.id
    );
  }

  statusClass(status: StatementStatus): string {
    switch (status) {
      case 'pago': return 'bg-green-100 text-green-700';
      case 'vencido': return 'bg-red-100 text-red-700';
      default: return 'bg-amber-100 text-amber-700';
    }
  }

  formatCurrency(value: number): string {
    return this.statementService.formatCurrency(value);
  }

  formatDate(iso: string): string {
    return formatIsoDate(iso);
  }
}
