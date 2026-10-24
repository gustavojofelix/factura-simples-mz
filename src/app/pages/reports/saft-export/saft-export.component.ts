import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CompanyService } from '../../../core/services/company.service';
import { ExportService } from '../../../core/services/export.service';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { SaftCompany, SaftResult, SaftService } from '../../../core/services/saft.service';
import { formatIsoDate, quarterRange, toIsoDate } from '../../../core/utils/date.util';
import { ReportsNavComponent } from '../reports-nav.component';
import { t, currentLocale } from '../../../core/i18n/i18n';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

type PeriodMode = 'mensal' | 'trimestral' | 'anual';
type SaftFormat = 'xml' | 'xlsx' | 'csv';

/** Nomes dos meses na língua da interface (com maiúscula inicial). */
function monthNames(): string[] {
  const fmt = new Intl.DateTimeFormat(currentLocale(), { month: 'long' });
  return Array.from({ length: 12 }, (_, i) => {
    const name = fmt.format(new Date(2000, i, 1));
    return name.charAt(0).toLocaleUpperCase(currentLocale()) + name.slice(1);
  });
}

/** Exportação do ficheiro SAF-T (MZ) da empresa activa para um período. */
@Component({
  selector: 'app-saft-export',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    ReportsNavComponent,
    TranslatePipe
  ],
  template: `
    <div class="p-4 sm:p-6 max-w-7xl mx-auto">
      <div class="mb-4">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">{{ 'reports.page.title' | t }}</h1>
        <p class="text-gray-600">{{ 'reports.saft.subtitle' | t: { company: companyService.activeCompany()?.name } }}</p>
      </div>

      <app-reports-nav></app-reports-nav>

      <div class="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
        <mat-icon class="shrink-0 text-amber-600">info</mat-icon>
        <div class="text-sm">
          <p class="font-semibold mb-1">{{ 'reports.saft.noticeTitle' | t }}</p>
          <p>
            {{ 'reports.saft.noticeText' | t }}
          </p>
        </div>
      </div>

      @if (featureEnabled() === false) {
        <mat-card class="mb-6">
          <mat-card-content class="!pt-6 text-center text-gray-600">
            <mat-icon class="!text-[40px] !w-10 !h-10 text-gray-400">lock</mat-icon>
            <p class="mt-2">{{ 'reports.saft.lockedBefore' | t }} <strong>{{ 'reports.page.title' | t }}</strong>{{ 'reports.saft.lockedAfter' | t }}</p>
          </mat-card-content>
        </mat-card>
      } @else {
        <mat-card class="mb-6">
          <mat-card-content class="!pt-6">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <mat-form-field appearance="outline">
                <mat-label>{{ 'reports.saft.period' | t }}</mat-label>
                <mat-select [ngModel]="mode()" (ngModelChange)="setMode($event)">
                  <mat-option value="mensal">{{ 'reports.saft.monthly' | t }}</mat-option>
                  <mat-option value="trimestral">{{ 'reports.saft.quarterly' | t }}</mat-option>
                  <mat-option value="anual">{{ 'reports.saft.annual' | t }}</mat-option>
                </mat-select>
              </mat-form-field>

              @if (mode() === 'mensal') {
                <mat-form-field appearance="outline">
                  <mat-label>{{ 'reports.saft.month' | t }}</mat-label>
                  <mat-select [ngModel]="month()" (ngModelChange)="month.set($event); reset()">
                    @for (name of months; track $index) {
                      <mat-option [value]="$index + 1">{{ name }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              } @else if (mode() === 'trimestral') {
                <mat-form-field appearance="outline">
                  <mat-label>{{ 'reports.filters.quarter' | t }}</mat-label>
                  <mat-select [ngModel]="quarter()" (ngModelChange)="quarter.set($event); reset()">
                    <mat-option [value]="1">{{ 'reports.filters.q1' | t }}</mat-option>
                    <mat-option [value]="2">{{ 'reports.filters.q2' | t }}</mat-option>
                    <mat-option [value]="3">{{ 'reports.filters.q3' | t }}</mat-option>
                    <mat-option [value]="4">{{ 'reports.filters.q4' | t }}</mat-option>
                  </mat-select>
                </mat-form-field>
              }

              <mat-form-field appearance="outline">
                <mat-label>{{ 'reports.saft.fiscalYear' | t }}</mat-label>
                <mat-select [ngModel]="year()" (ngModelChange)="year.set($event); reset()">
                  @for (y of years; track y) {
                    <mat-option [value]="y">{{ y }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>

            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-2">
              <p class="text-sm text-gray-600">
                {{ 'reports.saft.periodLabel' | t }} <strong>{{ formatIsoDate(range().start) }}</strong> {{ 'reports.saft.periodTo' | t }} <strong>{{ formatIsoDate(range().end) }}</strong>
              </p>
              <button mat-raised-button type="button" class="!bg-ispc-orange !text-white"
                [disabled]="isGenerating() || !companyService.activeCompany()" (click)="generate()">
                @if (isGenerating()) {
                  <mat-spinner diameter="18" class="inline-block mr-2"></mat-spinner>
                } @else {
                  <mat-icon>settings</mat-icon>
                }
                {{ (isGenerating() ? 'reports.saft.generating' : 'reports.saft.generate') | t }}
              </button>
            </div>
          </mat-card-content>
        </mat-card>

        @if (result(); as res) {
          <mat-card class="mb-6">
            <mat-card-content class="!pt-6">
              <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div class="rounded-lg bg-gray-50 p-4">
                  <p class="text-xs uppercase text-gray-500">{{ 'reports.saft.invoices' | t }}</p>
                  <p class="text-2xl font-bold text-gray-900">{{ res.summary.invoices }}</p>
                  <p class="text-xs text-gray-500">{{ 'reports.saft.annulledInvoices' | t: { count: res.summary.annulledInvoices } }}</p>
                </div>
                <div class="rounded-lg bg-gray-50 p-4">
                  <p class="text-xs uppercase text-gray-500">{{ 'reports.saft.invoicedTotal' | t }}</p>
                  <p class="text-2xl font-bold text-gray-900">{{ formatCurrency(res.summary.invoicesTotal) }}</p>
                  <p class="text-xs text-gray-500">{{ 'reports.saft.excludingCancelled' | t }}</p>
                </div>
                <div class="rounded-lg bg-gray-50 p-4">
                  <p class="text-xs uppercase text-gray-500">{{ 'reports.saft.receipts' | t }}</p>
                  <p class="text-2xl font-bold text-gray-900">{{ res.summary.payments }}</p>
                  <p class="text-xs text-gray-500">{{ 'reports.saft.annulledReceipts' | t: { count: res.summary.annulledPayments } }}</p>
                </div>
                <div class="rounded-lg bg-gray-50 p-4">
                  <p class="text-xs uppercase text-gray-500">{{ 'reports.saft.receivedTotal' | t }}</p>
                  <p class="text-2xl font-bold text-gray-900">{{ formatCurrency(res.summary.paymentsTotal) }}</p>
                  <p class="text-xs text-gray-500">{{ 'reports.saft.customersAndProducts' | t: { customers: res.summary.customers, products: res.summary.products } }}</p>
                </div>
              </div>

              @if (res.warnings.length) {
                <div class="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                  <p class="font-semibold text-yellow-900 mb-2 flex items-center gap-2">
                    <mat-icon class="text-yellow-600">warning</mat-icon> {{ 'reports.saft.warnings' | t: { count: res.warnings.length } }}
                  </p>
                  <ul class="list-disc pl-6 text-sm text-yellow-900 space-y-1">
                    @for (warning of res.warnings; track $index) {
                      <li>{{ warning }}</li>
                    }
                  </ul>
                </div>
              }

              <div class="flex flex-col sm:flex-row sm:justify-end gap-3">
                <button mat-stroked-button type="button" [disabled]="isDownloading()" (click)="download('csv')">
                  <mat-icon>table_rows</mat-icon> {{ 'reports.saft.downloadCsv' | t }}
                </button>
                <button mat-stroked-button type="button" [disabled]="isDownloading()" (click)="download('xlsx')">
                  <mat-icon>grid_on</mat-icon> {{ 'reports.saft.downloadExcel' | t }}
                </button>
                <button mat-raised-button color="primary" type="button" [disabled]="isDownloading()" (click)="download('xml')">
                  <mat-icon>download</mat-icon> {{ 'reports.saft.downloadXml' | t }}
                </button>
              </div>
              <p class="mt-3 text-xs text-gray-500 sm:text-right">
                {{ 'reports.saft.downloadHint' | t }}
              </p>
            </mat-card-content>
          </mat-card>
        }
      }
    </div>
  `
})
export class SaftExportComponent {
  private snackBar = inject(MatSnackBar);
  private exportService = inject(ExportService);
  private auditLogService = inject(AuditLogService);
  private saftService = inject(SaftService);
  companyService = inject(CompanyService);

  readonly months = monthNames();
  readonly formatIsoDate = formatIsoDate;

  private readonly today = new Date();
  readonly years = Array.from({ length: 6 }, (_, i) => this.today.getFullYear() - i);

  mode = signal<PeriodMode>('mensal');
  month = signal(this.today.getMonth() + 1);
  quarter = signal(Math.floor(this.today.getMonth() / 3) + 1);
  year = signal(this.today.getFullYear());

  isGenerating = signal(false);
  isDownloading = signal(false);
  featureEnabled = signal<boolean | null>(null);
  result = signal<SaftResult | null>(null);
  /** Período e empresa para os quais o resultado actual foi gerado. */
  private resultContext: { start: string; end: string; company: SaftCompany & { id: string } } | null = null;
  /** Empresa cujo plano foi verificado por último (evita respostas fora de ordem). */
  private checkedCompanyId: string | null = null;

  constructor() {
    // A empresa activa é carregada de forma assíncrona e pode mudar (troca de empresa):
    // reverifica o plano e descarta o resultado anterior sempre que mudar.
    effect(() => {
      const companyId = this.companyService.activeCompany()?.id ?? null;
      untracked(() => this.onCompanyChange(companyId));
    });
  }

  /** Intervalo do período escolhido, sempre dentro do mesmo ano fiscal. */
  range = computed(() => {
    const year = this.year();
    if (this.mode() === 'anual') {
      return { start: `${year}-01-01`, end: `${year}-12-31` };
    }
    if (this.mode() === 'trimestral') {
      const { start, end } = quarterRange(this.quarter(), year);
      return { start: toIsoDate(start), end: toIsoDate(end) };
    }
    const month = this.month();
    return {
      start: toIsoDate(new Date(year, month - 1, 1)),
      end: toIsoDate(new Date(year, month, 0))
    };
  });

  private async onCompanyChange(companyId: string | null) {
    if (companyId === this.checkedCompanyId) return;
    this.checkedCompanyId = companyId;
    this.reset();
    this.featureEnabled.set(null);
    if (!companyId) return;
    try {
      const enabled = await this.saftService.isEnabled(companyId);
      if (this.checkedCompanyId === companyId) this.featureEnabled.set(enabled);
    } catch (error) {
      console.error('Erro ao verificar o plano:', error);
      if (this.checkedCompanyId === companyId) this.featureEnabled.set(null);
    }
  }

  setMode(mode: PeriodMode) {
    this.mode.set(mode);
    this.reset();
  }

  reset() {
    this.result.set(null);
    this.resultContext = null;
  }

  async generate() {
    const company = this.companyService.activeCompany();
    if (!company) return;

    const { start, end } = this.range();
    this.isGenerating.set(true);
    this.reset();
    try {
      const result = await this.saftService.generate(company, start, end);
      // Ignora o resultado se a empresa activa mudou durante a geração.
      if (this.companyService.activeCompany()?.id !== company.id) return;
      this.result.set(result);
      this.resultContext = { start, end, company };
    } catch (error: any) {
      console.error('Erro ao gerar SAF-T:', error);
      this.snackBar.open(error?.message || t('reports.saft.generateError'), t('common.actions.close'), { duration: 5000 });
    } finally {
      this.isGenerating.set(false);
    }
  }

  async download(format: SaftFormat) {
    const result = this.result();
    if (!result || !this.resultContext || this.isDownloading()) return;

    const { start, end, company } = this.resultContext;
    this.isDownloading.set(true);
    try {
      if (format === 'xml') {
        this.exportService.downloadFile(
          result.xml,
          this.saftService.fileName(company, start, end),
          'application/xml;charset=utf-8'
        );
      } else if (format === 'xlsx') {
        await this.saftService.downloadExcel(result, company, start, end);
      } else {
        const zip = await this.saftService.buildCsvZip(result);
        this.exportService.downloadBlob(zip, `${this.saftService.fileBaseName(company, start, end)}_CSV.zip`);
      }
    } catch (error) {
      console.error('Erro ao descarregar SAF-T:', error);
      this.snackBar.open(t('reports.saft.downloadError'), t('common.actions.close'), { duration: 5000 });
      return;
    } finally {
      this.isDownloading.set(false);
    }

    await this.auditLogService.log(
      'Exportou Ficheiro SAF-T',
      'reports',
      {
        format,
        start,
        end,
        invoices: result.summary.invoices,
        payments: result.summary.payments,
        warnings: result.warnings.length
      },
      undefined,
      undefined,
      company.id
    );
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat(currentLocale(), {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value || 0) + ' MZN';
  }
}
