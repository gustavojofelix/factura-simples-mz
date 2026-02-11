import { Component, OnInit, signal, effect } from '@angular/core';
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

  years: number[] = [];
  periods = [
    { value: 1, label: '1º Trimestre (Jan-Mar)' },
    { value: 2, label: '2º Trimestre (Abr-Jun)' },
    { value: 3, label: '3º Trimestre (Jul-Set)' },
    { value: 4, label: '4º Trimestre (Out-Dez)' }
  ];

  displayedColumns = ['period', 'dates', 'amount', 'status', 'due_date', 'actions'];

  constructor(
    public taxService: TaxService,
    public companyService: CompanyService,
    private dialog: MatDialog
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
    await this.loadData();
  }

  async loadData() {
    await this.taxService.loadDeclarations();
    await this.updateSummary();
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
    this.dialog.open(Model30Component, {
      width: '900px',
      maxWidth: '95vw',
      data: { declaration }
    });
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
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-MZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
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
