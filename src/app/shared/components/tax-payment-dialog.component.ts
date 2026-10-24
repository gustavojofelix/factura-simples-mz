import { Component, Inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { TaxDeclaration } from '../../core/services/tax.service';
import { t, currentLocale } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-tax-payment-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSelectModule,
    TranslatePipe
  ],
  template: `
    <h2 mat-dialog-title>{{ 'taxes.paymentDialog.title' | t }}</h2>
    <mat-dialog-content class="min-w-[500px]">
      <div class="mb-4 p-4 bg-gray-50 rounded">
        <p class="text-sm text-gray-600">{{ 'taxes.paymentDialog.declaration' | t }}</p>
        <p class="font-semibold">{{ 'taxes.calculator.periodOfYear' | t: { period: getPeriodLabel(), year: data.declaration.year } }}</p>
        <p class="text-sm text-gray-600 mt-2">{{ 'taxes.paymentDialog.totalAmount' | t }}</p>
        <p class="font-semibold text-lg">{{ formatCurrency(data.declaration.ispc_amount) }}</p>
      </div>

      <mat-form-field appearance="outline" class="w-full">
        <mat-label>{{ 'taxes.paymentDialog.amountPaid' | t }}</mat-label>
        <input
          matInput
          type="number"
          step="0.01"
          [(ngModel)]="amount"
          required>
        <span matSuffix>MZN</span>
      </mat-form-field>

      <mat-form-field appearance="outline" class="w-full">
        <mat-label>{{ 'taxes.paymentDialog.paymentDate' | t }}</mat-label>
        <input
          matInput
          [matDatepicker]="picker"
          [(ngModel)]="paymentDate"
          required>
        <mat-datepicker-toggle matSuffix [for]="picker"></mat-datepicker-toggle>
        <mat-datepicker #picker></mat-datepicker>
      </mat-form-field>

      <mat-form-field appearance="outline" class="w-full">
        <mat-label>{{ 'taxes.paymentDialog.paymentMethod' | t }}</mat-label>
        <mat-select [(ngModel)]="paymentMethod">
          <mat-option value="transferencia">{{ 'taxes.paymentDialog.methods.transferencia' | t }}</mat-option>
          <mat-option value="cheque">{{ 'taxes.paymentDialog.methods.cheque' | t }}</mat-option>
          <mat-option value="dinheiro">{{ 'taxes.paymentDialog.methods.dinheiro' | t }}</mat-option>
          <mat-option value="carteira_movel">{{ 'taxes.paymentDialog.methods.carteira_movel' | t }}</mat-option>
          <mat-option value="outro">{{ 'taxes.paymentDialog.methods.outro' | t }}</mat-option>
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline" class="w-full">
        <mat-label>{{ 'taxes.paymentDialog.reference' | t }}</mat-label>
        <input
          matInput
          [(ngModel)]="reference"
          [placeholder]="'taxes.paymentDialog.referencePlaceholder' | t">
      </mat-form-field>

      <mat-form-field appearance="outline" class="w-full">
        <mat-label>{{ 'taxes.paymentDialog.receiptUrl' | t }}</mat-label>
        <input
          matInput
          [(ngModel)]="receiptUrl"
          placeholder="https://...">
        <mat-hint>{{ 'taxes.paymentDialog.receiptUrlHint' | t }}</mat-hint>
      </mat-form-field>

      <mat-form-field appearance="outline" class="w-full">
        <mat-label>{{ 'taxes.paymentDialog.notes' | t }}</mat-label>
        <textarea
          matInput
          [(ngModel)]="notes"
          rows="3"
          [placeholder]="'taxes.paymentDialog.notesPlaceholder' | t"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">{{ 'common.actions.cancel' | t }}</button>
      <button
        mat-raised-button
        color="primary"
        (click)="save()"
        [disabled]="!isValid()">
        {{ 'common.actions.save' | t }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      padding: 20px 24px;
    }
  `]
})
export class TaxPaymentDialogComponent {
  amount = signal(this.data.declaration.ispc_amount);
  paymentDate = signal(new Date());
  paymentMethod = signal('transferencia');
  reference = signal('');
  receiptUrl = signal('');
  notes = signal('');

  constructor(
    public dialogRef: MatDialogRef<TaxPaymentDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { declaration: TaxDeclaration }
  ) {}

  isValid(): boolean {
    return this.amount() > 0 && !!this.paymentDate();
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat(currentLocale(), {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value) + ' MZN';
  }

  getPeriodLabel(): string {
    const period = this.data.declaration.period;
    return t('taxes.periodName', { period });
  }

  cancel() {
    this.dialogRef.close();
  }

  save() {
    if (!this.isValid()) return;

    const paymentDateStr = this.paymentDate()?.toISOString().split('T')[0];

    this.dialogRef.close({
      amount: this.amount(),
      paymentDate: paymentDateStr,
      paymentMethod: this.paymentMethod() || undefined,
      reference: this.reference() || undefined,
      receiptUrl: this.receiptUrl() || undefined,
      notes: this.notes() || undefined
    });
  }
}
