import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSelectModule } from '@angular/material/select';
import { InvoiceService } from '../../core/services/invoice.service';
import { CompanyService } from '../../core/services/company.service';

interface SalesReport {
  totalSales: number;
  totalInvoices: number;
  paidAmount: number;
  pendingAmount: number;
  averageInvoiceValue: number;
  invoicesByStatus: {
    pendente: number;
    paga: number;
    vencida: number;
  };
  topClients: {
    clientName: string;
    totalAmount: number;
    invoiceCount: number;
  }[];
  dailySales: {
    date: string;
    amount: number;
    invoiceCount: number;
  }[];
}

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatSelectModule
  ],
  template: `
    <div class="p-6 max-w-7xl mx-auto">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">Relatórios</h1>
        <p class="text-gray-600">Análise detalhada de vendas e faturamento</p>
      </div>

      <mat-card class="mb-6">
        <mat-card-content class="!pt-6">
          <form [formGroup]="filterForm" class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
              <mat-form-field appearance="outline">
                <mat-label>Período</mat-label>
                <mat-select formControlName="period" (selectionChange)="onPeriodChange()">
                  <mat-option value="custom">Personalizado</mat-option>
                  <mat-option value="today">Hoje</mat-option>
                  <mat-option value="yesterday">Ontem</mat-option>
                  <mat-option value="this_week">Esta Semana</mat-option>
                  <mat-option value="last_week">Semana Passada</mat-option>
                  <mat-option value="this_month">Este Mês</mat-option>
                  <mat-option value="last_month">Mês Passado</mat-option>
                  <mat-option value="this_quarter">Este Trimestre</mat-option>
                  <mat-option value="last_quarter">Trimestre Passado</mat-option>
                  <mat-option value="this_year">Este Ano</mat-option>
                  <mat-option value="last_year">Ano Passado</mat-option>
                </mat-select>
              </mat-form-field>

              @if (filterForm.get('period')?.value === 'custom') {
                <mat-form-field appearance="outline">
                  <mat-label>Data Inicial</mat-label>
                  <input matInput [matDatepicker]="startPicker" formControlName="startDate">
                  <mat-datepicker-toggle matIconSuffix [for]="startPicker"></mat-datepicker-toggle>
                  <mat-datepicker #startPicker></mat-datepicker>
                </mat-form-field>

                <mat-form-field appearance="outline">
                  <mat-label>Data Final</mat-label>
                  <input matInput [matDatepicker]="endPicker" formControlName="endDate">
                  <mat-datepicker-toggle matIconSuffix [for]="endPicker"></mat-datepicker-toggle>
                  <mat-datepicker #endPicker></mat-datepicker>
                </mat-form-field>
              }

              <button
                mat-raised-button
                class="!bg-moz-green !text-white"
                (click)="generateReport()"
                [disabled]="isLoading() || filterForm.invalid"
              >
                <mat-icon>assessment</mat-icon>
                Gerar Relatório
              </button>
            </div>
          </form>
        </mat-card-content>
      </mat-card>

      @if (isLoading()) {
        <div class="flex justify-center items-center py-12">
          <mat-spinner diameter="50"></mat-spinner>
        </div>
      } @else if (report()) {
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <mat-card>
            <mat-card-content class="!pt-6">
              <div class="flex items-start justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Total de Vendas</p>
                  <h3 class="text-2xl font-bold text-gray-900">
                    {{ formatCurrency(report()!.totalSales) }}
                  </h3>
                </div>
                <div class="bg-green-100 p-3 rounded-lg">
                  <mat-icon class="!text-green-600">trending_up</mat-icon>
                </div>
              </div>
            </mat-card-content>
          </mat-card>

          <mat-card>
            <mat-card-content class="!pt-6">
              <div class="flex items-start justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Total de Faturas</p>
                  <h3 class="text-2xl font-bold text-gray-900">
                    {{ report()!.totalInvoices }}
                  </h3>
                </div>
                <div class="bg-blue-100 p-3 rounded-lg">
                  <mat-icon class="!text-blue-600">receipt</mat-icon>
                </div>
              </div>
            </mat-card-content>
          </mat-card>

          <mat-card>
            <mat-card-content class="!pt-6">
              <div class="flex items-start justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Valor Recebido</p>
                  <h3 class="text-2xl font-bold text-green-600">
                    {{ formatCurrency(report()!.paidAmount) }}
                  </h3>
                </div>
                <div class="bg-green-100 p-3 rounded-lg">
                  <mat-icon class="!text-green-600">paid</mat-icon>
                </div>
              </div>
            </mat-card-content>
          </mat-card>

          <mat-card>
            <mat-card-content class="!pt-6">
              <div class="flex items-start justify-between">
                <div>
                  <p class="text-sm text-gray-600 mb-1">Valor Pendente</p>
                  <h3 class="text-2xl font-bold text-orange-600">
                    {{ formatCurrency(report()!.pendingAmount) }}
                  </h3>
                </div>
                <div class="bg-orange-100 p-3 rounded-lg">
                  <mat-icon class="!text-orange-600">schedule</mat-icon>
                </div>
              </div>
            </mat-card-content>
          </mat-card>
        </div>

        <mat-card class="mb-6">
          <mat-card-header class="!pt-6">
            <mat-card-title>Análise por Status</mat-card-title>
          </mat-card-header>
          <mat-card-content class="!pt-4">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div class="border border-gray-200 rounded-lg p-4">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-sm text-gray-600">Pendentes</span>
                  <mat-icon class="!text-yellow-600">schedule</mat-icon>
                </div>
                <p class="text-2xl font-bold text-gray-900">
                  {{ report()!.invoicesByStatus.pendente }}
                </p>
              </div>

              <div class="border border-gray-200 rounded-lg p-4">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-sm text-gray-600">Pagas</span>
                  <mat-icon class="!text-green-600">check_circle</mat-icon>
                </div>
                <p class="text-2xl font-bold text-gray-900">
                  {{ report()!.invoicesByStatus.paga }}
                </p>
              </div>

              <div class="border border-gray-200 rounded-lg p-4">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-sm text-gray-600">Vencidas</span>
                  <mat-icon class="!text-red-600">error</mat-icon>
                </div>
                <p class="text-2xl font-bold text-gray-900">
                  {{ report()!.invoicesByStatus.vencida }}
                </p>
              </div>
            </div>
          </mat-card-content>
        </mat-card>

        @if (report()!.topClients.length > 0) {
          <mat-card class="mb-6">
            <mat-card-header class="!pt-6">
              <mat-card-title>Top Clientes</mat-card-title>
            </mat-card-header>
            <mat-card-content class="!pt-4">
              <table mat-table [dataSource]="report()!.topClients" class="w-full">
                <ng-container matColumnDef="client">
                  <th mat-header-cell *matHeaderCellDef>Cliente</th>
                  <td mat-cell *matCellDef="let item" class="font-medium">
                    {{ item.clientName }}
                  </td>
                </ng-container>

                <ng-container matColumnDef="invoices">
                  <th mat-header-cell *matHeaderCellDef class="!text-center">Faturas</th>
                  <td mat-cell *matCellDef="let item" class="!text-center">
                    {{ item.invoiceCount }}
                  </td>
                </ng-container>

                <ng-container matColumnDef="total">
                  <th mat-header-cell *matHeaderCellDef class="!text-right">Total</th>
                  <td mat-cell *matCellDef="let item" class="!text-right font-semibold">
                    {{ formatCurrency(item.totalAmount) }}
                  </td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="topClientsColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: topClientsColumns;"></tr>
              </table>
            </mat-card-content>
          </mat-card>
        }

        @if (report()!.dailySales.length > 0) {
          <mat-card class="mb-6">
            <mat-card-header class="!pt-6">
              <mat-card-title>Vendas Diárias</mat-card-title>
            </mat-card-header>
            <mat-card-content class="!pt-4">
              <table mat-table [dataSource]="report()!.dailySales" class="w-full">
                <ng-container matColumnDef="date">
                  <th mat-header-cell *matHeaderCellDef>Data</th>
                  <td mat-cell *matCellDef="let item">
                    {{ formatDate(item.date) }}
                  </td>
                </ng-container>

                <ng-container matColumnDef="invoices">
                  <th mat-header-cell *matHeaderCellDef class="!text-center">Faturas</th>
                  <td mat-cell *matCellDef="let item" class="!text-center">
                    {{ item.invoiceCount }}
                  </td>
                </ng-container>

                <ng-container matColumnDef="amount">
                  <th mat-header-cell *matHeaderCellDef class="!text-right">Total</th>
                  <td mat-cell *matCellDef="let item" class="!text-right font-semibold">
                    {{ formatCurrency(item.amount) }}
                  </td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="dailySalesColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: dailySalesColumns;"></tr>
              </table>
            </mat-card-content>
          </mat-card>
        }

        <div class="flex justify-end gap-4">
          <button mat-stroked-button (click)="exportToCSV()">
            <mat-icon>download</mat-icon>
            Exportar CSV
          </button>
          <button mat-stroked-button (click)="printReport()">
            <mat-icon>print</mat-icon>
            Imprimir
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    @media print {
      .no-print {
        display: none !important;
      }
    }
  `]
})
export class ReportsComponent implements OnInit {
  filterForm: FormGroup;
  report = signal<SalesReport | null>(null);
  isLoading = signal(false);

  topClientsColumns = ['client', 'invoices', 'total'];
  dailySalesColumns = ['date', 'invoices', 'amount'];

  constructor(
    private fb: FormBuilder,
    private invoiceService: InvoiceService,
    private companyService: CompanyService
  ) {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    this.filterForm = this.fb.group({
      period: ['this_month'],
      startDate: [firstDayOfMonth, Validators.required],
      endDate: [today, Validators.required]
    });
  }

  ngOnInit() {
    this.onPeriodChange();
    this.generateReport();
  }

  onPeriodChange() {
    const period = this.filterForm.get('period')?.value;
    if (period === 'custom') return;

    const { startDate, endDate } = this.calculatePeriodDates(period);
    this.filterForm.patchValue({ startDate, endDate }, { emitEvent: false });
  }

  calculatePeriodDates(period: string): { startDate: Date; endDate: Date } {
    const today = new Date();
    let endDate = new Date();
    let startDate = new Date();

    switch (period) {
      case 'today':
        startDate = new Date(today);
        break;
      case 'yesterday':
        startDate = new Date(today);
        startDate.setDate(today.getDate() - 1);
        endDate.setDate(today.getDate() - 1);
        break;
      case 'this_week':
        startDate = new Date(today);
        startDate.setDate(today.getDate() - today.getDay());
        break;
      case 'last_week':
        startDate = new Date(today);
        startDate.setDate(today.getDate() - today.getDay() - 7);
        endDate.setDate(today.getDate() - today.getDay() - 1);
        break;
      case 'this_month':
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case 'last_month':
        startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        endDate.setDate(0);
        break;
      case 'this_quarter':
        const currentQuarter = Math.floor(today.getMonth() / 3);
        startDate = new Date(today.getFullYear(), currentQuarter * 3, 1);
        break;
      case 'last_quarter':
        const lastQuarter = Math.floor(today.getMonth() / 3) - 1;
        startDate = new Date(today.getFullYear(), lastQuarter * 3, 1);
        endDate = new Date(today.getFullYear(), lastQuarter * 3 + 3, 0);
        break;
      case 'this_year':
        startDate = new Date(today.getFullYear(), 0, 1);
        break;
      case 'last_year':
        startDate = new Date(today.getFullYear() - 1, 0, 1);
        endDate.setFullYear(today.getFullYear() - 1, 11, 31);
        break;
    }

    return { startDate, endDate };
  }

  async generateReport() {
    if (this.filterForm.invalid) return;

    const company = this.companyService.activeCompany();
    if (!company) return;

    this.isLoading.set(true);

    try {
      const startDate = this.formatDateForDB(this.filterForm.get('startDate')?.value);
      const endDate = this.formatDateForDB(this.filterForm.get('endDate')?.value);

      await this.invoiceService.loadInvoices();
      const allInvoices = this.invoiceService.invoices();

      const filteredInvoices = allInvoices.filter(inv => {
        return inv.date >= startDate && inv.date <= endDate;
      });

      const totalSales = filteredInvoices.reduce((sum, inv) => sum + inv.total, 0);
      const totalInvoices = filteredInvoices.length;
      const paidAmount = filteredInvoices.reduce((sum, inv) => sum + inv.amount_paid, 0);
      const pendingAmount = filteredInvoices.reduce((sum, inv) => sum + inv.amount_pending, 0);
      const averageInvoiceValue = totalInvoices > 0 ? totalSales / totalInvoices : 0;

      const invoicesByStatus = {
        pendente: filteredInvoices.filter(inv => inv.status === 'pendente').length,
        paga: filteredInvoices.filter(inv => inv.status === 'paga').length,
        vencida: filteredInvoices.filter(inv => inv.status === 'vencida').length
      };

      const clientsMap = new Map<string, { name: string; total: number; count: number }>();
      filteredInvoices.forEach(inv => {
        const clientName = inv.client?.name || 'Cliente Desconhecido';
        const existing = clientsMap.get(clientName) || { name: clientName, total: 0, count: 0 };
        existing.total += inv.total;
        existing.count += 1;
        clientsMap.set(clientName, existing);
      });

      const topClients = Array.from(clientsMap.values())
        .map(c => ({
          clientName: c.name,
          totalAmount: c.total,
          invoiceCount: c.count
        }))
        .sort((a, b) => b.totalAmount - a.totalAmount)
        .slice(0, 10);

      const dailyMap = new Map<string, { amount: number; count: number }>();
      filteredInvoices.forEach(inv => {
        const existing = dailyMap.get(inv.date) || { amount: 0, count: 0 };
        existing.amount += inv.total;
        existing.count += 1;
        dailyMap.set(inv.date, existing);
      });

      const dailySales = Array.from(dailyMap.entries())
        .map(([date, data]) => ({
          date,
          amount: data.amount,
          invoiceCount: data.count
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const report: SalesReport = {
        totalSales,
        totalInvoices,
        paidAmount,
        pendingAmount,
        averageInvoiceValue,
        invoicesByStatus,
        topClients,
        dailySales
      };

      this.report.set(report);
    } catch (error) {
      console.error('Erro ao gerar relatório:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  formatDateForDB(date: Date): string {
    if (!date) return '';
    const d = new Date(date);
    return d.toISOString().split('T')[0];
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-MZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-MZ', {
      style: 'currency',
      currency: 'MZN',
      minimumFractionDigits: 2
    }).format(value);
  }

  exportToCSV() {
    const report = this.report();
    if (!report) return;

    let csv = 'Relatório de Vendas\n\n';
    csv += 'Resumo\n';
    csv += 'Total de Vendas,' + report.totalSales + '\n';
    csv += 'Total de Faturas,' + report.totalInvoices + '\n';
    csv += 'Valor Recebido,' + report.paidAmount + '\n';
    csv += 'Valor Pendente,' + report.pendingAmount + '\n\n';

    csv += 'Top Clientes\n';
    csv += 'Cliente,Faturas,Total\n';
    report.topClients.forEach(client => {
      csv += `${client.clientName},${client.invoiceCount},${client.totalAmount}\n`;
    });

    csv += '\nVendas Diárias\n';
    csv += 'Data,Faturas,Total\n';
    report.dailySales.forEach(day => {
      csv += `${this.formatDate(day.date)},${day.invoiceCount},${day.amount}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio_vendas_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  }

  printReport() {
    window.print();
  }
}
