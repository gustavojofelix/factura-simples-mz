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
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CompanyService } from '../../../core/services/company.service';
import { ClientService } from '../../../core/services/client.service';
import { ExportService } from '../../../core/services/export.service';
import { AuditLogService } from '../../../core/services/audit-log.service';
import {
  ClientStatement,
  MovementKind,
  StatementMovement,
  StatementService
} from '../../../core/services/statement.service';
import { formatIsoDate, parseIsoDate, quarterRange, toIsoDate } from '../../../core/utils/date.util';
import { PreferencesService } from '../../../core/services/preferences.service';
import { ReportsNavComponent } from '../reports-nav.component';
import { t } from '../../../core/i18n/i18n';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import {
  StatementPreviewDialogComponent,
  StatementPreviewData
} from '../../../shared/components/statement-preview-dialog.component';
import { ReceiptDetailComponent } from '../../../shared/components/receipt-detail.component';

/**
 * Extracto de um cliente: facturas e recibos do período, com saldo anterior
 * e saldo corrido.
 *
 * O período vai no URL (?inicio=AAAA-MM-DD&fim=AAAA-MM-DD) para que o
 * extracto geral abra este ecrã no mesmo período e o link possa ser guardado.
 */
@Component({
  selector: 'app-client-statement-detail',
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
    MatButtonToggleModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatSnackBarModule,
    ReportsNavComponent,
    TranslatePipe
  ],
  templateUrl: './client-statement-detail.component.html'
})
export class ClientStatementDetailComponent implements OnInit {
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
  /** Formato de data de Configurações > Sistema. */
  private preferences = inject(PreferencesService);

  filterForm = this.fb.group({
    clientId: ['', Validators.required],
    startDate: [null as Date | null, Validators.required],
    endDate: [null as Date | null, Validators.required],
    quarter: ['none'],
    year: [new Date().getFullYear(), [Validators.required, Validators.min(2000)]]
  });

  notes = signal('');
  movementFilter = signal<'all' | MovementKind>('all');
  isLoading = signal(false);
  errorMessage = signal('');

  statement = signal<ClientStatement | null>(null);
  period = signal<{ start: string; end: string } | null>(null);

  showBalance = computed(() => this.movementFilter() === 'all');

  visibleMovements = computed(() => {
    const statement = this.statement();
    if (!statement) return [];
    const filter = this.movementFilter();
    return filter === 'all' ? statement.movements : statement.movements.filter(m => m.kind === filter);
  });

  totals = computed(() => {
    const statement = this.statement();
    return statement ? this.statementService.clientTotals(statement) : { invoiced: 0, paid: 0, balance: 0 };
  });

  ngOnInit() {
    this.clientService.loadClients();

    this.route.paramMap.subscribe(params => {
      const query = this.route.snapshot.queryParamMap;
      const today = new Date();
      const start = parseIsoDate(query.get('inicio')) ?? new Date(today.getFullYear(), today.getMonth(), 1);
      const end = parseIsoDate(query.get('fim')) ?? today;

      this.filterForm.patchValue({
        clientId: params.get('clientId') || '',
        startDate: start,
        endDate: end,
        quarter: 'none'
      });

      this.generate();
    });
  }

  onQuarterChange() {
    const quarter = Number(this.filterForm.value.quarter);
    const year = Number(this.filterForm.value.year);
    if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4 || !Number.isInteger(year)) return;

    const { start, end } = quarterRange(quarter, year);
    this.filterForm.patchValue({ startDate: start, endDate: end });
  }

  onDateChange() {
    this.filterForm.patchValue({ quarter: 'none' }, { emitEvent: false });
  }

  /** Mudar de cliente ou de período actualiza o URL e volta a carregar. */
  applyFilters() {
    if (this.filterForm.invalid) return;
    const clientId = this.filterForm.value.clientId!;

    this.router.navigate(['/relatorios/extractos', clientId], {
      queryParams: {
        inicio: toIsoDate(this.filterForm.value.startDate),
        fim: toIsoDate(this.filterForm.value.endDate)
      },
      replaceUrl: true
    });

    // A mesma rota com outros parâmetros de consulta não volta a emitir paramMap.
    if (clientId === this.route.snapshot.paramMap.get('clientId')) {
      this.generate();
    }
  }

  async generate() {
    const company = this.companyService.activeCompany();
    if (!company || this.filterForm.invalid) return;

    const clientId = this.filterForm.value.clientId!;
    const start = toIsoDate(this.filterForm.value.startDate);
    const end = toIsoDate(this.filterForm.value.endDate);
    if (start > end) {
      this.snackBar.open(t('reports.statements.messages.invalidRange'), t('common.actions.close'), { duration: 4000 });
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');
    try {
      const statement = await this.statementService.getClientStatement(company.id, clientId, start, end);
      this.statement.set(statement);
      this.period.set({ start, end });

      this.auditLogService.log(
        'Gerou Extracto do Cliente',
        'reports',
        { start_date: start, end_date: end, records_count: statement.movements.length },
        statement.client.id,
        statement.client.name,
        company.id
      );
    } catch (error) {
      console.error('Erro ao gerar o extracto do cliente:', error);
      this.statement.set(null);
      this.errorMessage.set(t('reports.statements.messages.clientGenerateError'));
    } finally {
      this.isLoading.set(false);
    }
  }

  backToSummary() {
    const period = this.period();
    this.router.navigate(['/relatorios/extractos'], {
      queryParams: period ? { inicio: period.start, fim: period.end } : {}
    });
  }

  openDocument(movement: StatementMovement) {
    if (movement.kind === 'recibo' && movement.payment_id) {
      this.dialog.open(ReceiptDetailComponent, {
        data: { paymentId: movement.payment_id, invoiceId: movement.invoice_id },
        width: '900px',
        maxWidth: '95vw',
        maxHeight: '95vh'
      });
      return;
    }
    this.router.navigate(['/facturas', movement.invoice_id]);
  }

  openPreview() {
    const company = this.companyService.activeCompany();
    const statement = this.statement();
    const period = this.period();
    if (!company || !statement || !period) return;

    const data: StatementPreviewData = {
      kind: 'client',
      company,
      statement,
      filter: this.movementFilter(),
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
    const statement = this.statement();
    const period = this.period();
    if (!company || !statement || !period) return;

    const showBalance = this.showBalance();
    const totals = this.totals();
    const col = {
      date: t('common.fields.date'),
      document: t('reports.statements.detail.document'),
      description: t('common.fields.description'),
      invoiced: t('reports.statements.excel.invoiced'),
      paid: t('reports.statements.excel.paid'),
      balance: t('reports.statements.excel.balance')
    };
    const data: Record<string, string | number>[] = [];
    if (showBalance) {
      data.push({
        [col.date]: formatIsoDate(period.start, this.preferences.dateFormat()),
        [col.document]: '',
        [col.description]: t('reports.statements.openingBalance'),
        [col.invoiced]: '',
        [col.paid]: '',
        [col.balance]: statement.opening_balance
      });
    }

    for (const m of this.visibleMovements()) {
      const line: Record<string, string | number> = {
        [col.date]: formatIsoDate(m.date, this.preferences.dateFormat()),
        [col.document]: m.document,
        [col.description]: this.statementService.movementLabel(m),
        [col.invoiced]: m.invoiced || '',
        [col.paid]: m.paid || ''
      };
      if (showBalance) line[col.balance] = m.balance;
      data.push(line);
    }

    data.push({});
    data.push({ [col.description]: t('reports.statements.totalInvoiced'), [col.invoiced]: totals.invoiced });
    data.push({ [col.description]: t('reports.statements.totalPaid'), [col.paid]: totals.paid });
    data.push({ [col.description]: t('reports.statements.outstandingBalance'), [showBalance ? col.balance : col.paid]: totals.balance });
    data.push({});
    data.push({ [col.date]: t('reports.statements.excel.client', { name: `${statement.client.client_code || ''} ${statement.client.name}`.trim() }) });
    data.push({ [col.date]: t('reports.statements.excel.company', { name: company.name }) });
    data.push({ [col.date]: t('reports.statements.excel.period', { start: formatIsoDate(period.start, this.preferences.dateFormat()), end: formatIsoDate(period.end, this.preferences.dateFormat()) }) });
    if (this.notes().trim()) data.push({ [col.date]: t('reports.statements.excel.notes', { notes: this.notes().trim() }) });

    const id = (statement.client.client_code || statement.client.name).replace(/[^\w-]+/g, '_');
    this.exportService.exportToExcel(data, `Extracto_${id}_${period.start}_a_${period.end}`, t('reports.statements.excel.clientSheet'));

    this.auditLogService.log(
      'Exportou Extracto do Cliente para Excel',
      'reports',
      { start_date: period.start, end_date: period.end, records_count: statement.movements.length },
      statement.client.id,
      statement.client.name,
      company.id
    );
  }

  formatCurrency(value: number): string {
    return this.statementService.formatCurrency(value);
  }

  formatDate(iso: string): string {
    return formatIsoDate(iso, this.preferences.dateFormat());
  }
}
