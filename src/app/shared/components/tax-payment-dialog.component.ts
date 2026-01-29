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
    MatSelectModule
  ],
  template: `
    <h2 mat-dialog-title>Registar Pagamento de ISPC</h2>
    <mat-dialog-content class="min-w-[500px]">
      <div class="mb-4 p-4 bg-gray-50 rounded">
        <p class="text-sm text-gray-600">Declaração</p>
        <p class="font-semibold">{{ getPeriodLabel() }} de {{ data.declaration.year }}</p>
        <p class="text-sm text-gray-600 mt-2">Valor Total</p>
        <p class="font-semibold text-lg">{{ formatCurrency(data.declaration.ispc_amount) }}</p>
      </div>

      <mat-form-field appearance="outline" class="w-full">
        <mat-label>Valor Pago</mat-label>
        <input
          matInput
          type="number"
          step="0.01"
          [(ngModel)]="amount"
          required>
        <span matSuffix>MZN</span>
      </mat-form-field>

      <mat-form-field appearance="outline" class="w-full">
        <mat-label>Data de Pagamento</mat-label>
        <input
          matInput
          [matDatepicker]="picker"
          [(ngModel)]="paymentDate"
          required>
        <mat-datepicker-toggle matSuffix [for]="picker"></mat-datepicker-toggle>
        <mat-datepicker #picker></mat-datepicker>
      </mat-form-field>

      <mat-form-field appearance="outline" class="w-full">
        <mat-label>Método de Pagamento</mat-label>
        <mat-select [(ngModel)]="paymentMethod">
          <mat-option value="transferencia">Transferência Bancária</mat-option>
          <mat-option value="cheque">Cheque</mat-option>
          <mat-option value="dinheiro">Dinheiro</mat-option>
          <mat-option value="carteira_movel">Carteira Móvel</mat-option>
          <mat-option value="outro">Outro</mat-option>
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline" class="w-full">
        <mat-label>Referência</mat-label>
        <input
          matInput
          [(ngModel)]="reference"
          placeholder="Número de referência do pagamento">
      </mat-form-field>

      <mat-form-field appearance="outline" class="w-full">
        <mat-label>URL do Comprovativo</mat-label>
        <input
          matInput
          [(ngModel)]="receiptUrl"
          placeholder="https://...">
        <mat-hint>Link para o comprovativo de pagamento</mat-hint>
      </mat-form-field>

      <mat-form-field appearance="outline" class="w-full">
        <mat-label>Notas</mat-label>
        <textarea
          matInput
          [(ngModel)]="notes"
          rows="3"
          placeholder="Observações adicionais"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Cancelar</button>
      <button
        mat-raised-button
        color="primary"
        (click)="save()"
        [disabled]="!isValid()">
        Guardar
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
    return new Intl.NumberFormat('pt-MZ', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value) + ' MZN';
  }

  getPeriodLabel(): string {
    const period = this.data.declaration.period;
    return `${period}º Trimestre`;
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
