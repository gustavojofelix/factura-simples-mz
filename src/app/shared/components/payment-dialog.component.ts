import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { PaymentService } from '../../core/services/payment.service';
import { ReceiptDetailComponent } from './receipt-detail.component';

export interface PaymentDialogData {
  invoiceId: string;
  invoiceNumber: string;
  totalAmount: number;
  amountPaid: number;
  amountPending: number;
}

@Component({
  selector: 'app-payment-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule
  ],
  template: `
    <h2 mat-dialog-title>Registar Pagamento</h2>
    <mat-dialog-content>
      <div class="mb-4">
        <p class="text-sm text-gray-600">Factura: <span class="font-medium">{{ data.invoiceNumber }}</span></p>
        <p class="text-sm text-gray-600">Total: <span class="font-medium">{{ formatCurrency(data.totalAmount) }}</span></p>
        <p class="text-sm text-gray-600">Pago: <span class="font-medium text-green-600">{{ formatCurrency(data.amountPaid) }}</span></p>
        <p class="text-sm text-gray-600">Pendente: <span class="font-medium text-orange-600">{{ formatCurrency(data.amountPending) }}</span></p>
      </div>

      <form [formGroup]="paymentForm" class="flex flex-col gap-4">
        <mat-form-field>
          <mat-label>Valor do Pagamento</mat-label>
          <input matInput type="number" formControlName="amount" step="0.01" min="0.01" [max]="data.amountPending">
          <span matSuffix>MZN</span>
          @if (paymentForm.get('amount')?.hasError('required')) {
            <mat-error>Campo obrigatório</mat-error>
          }
          @if (paymentForm.get('amount')?.hasError('min')) {
            <mat-error>Valor deve ser maior que zero</mat-error>
          }
          @if (paymentForm.get('amount')?.hasError('max')) {
            <mat-error>Valor não pode ser maior que o pendente</mat-error>
          }
        </mat-form-field>

        <div class="flex gap-2">
          <button type="button" mat-stroked-button class="flex-1" (click)="setPartialPayment()">
            Pagamento Parcial
          </button>
          <button type="button" mat-stroked-button class="flex-1" (click)="setFullPayment()">
            Pagamento Total
          </button>
        </div>

        <mat-form-field>
          <mat-label>Data do Pagamento</mat-label>
          <input matInput [matDatepicker]="picker" formControlName="payment_date">
          <mat-datepicker-toggle matIconSuffix [for]="picker"></mat-datepicker-toggle>
          <mat-datepicker #picker></mat-datepicker>
          @if (paymentForm.get('payment_date')?.hasError('required')) {
            <mat-error>Campo obrigatório</mat-error>
          }
        </mat-form-field>

        <mat-form-field>
          <mat-label>Método de Pagamento</mat-label>
          <mat-select formControlName="payment_method">
            <mat-option value="dinheiro">Dinheiro</mat-option>
            <mat-option value="transferencia">Transferência Bancária</mat-option>
            <mat-option value="cheque">Cheque</mat-option>
            <mat-option value="carteira_movel">Carteira Móvel</mat-option>
            <mat-option value="outro">Outro</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Referência (Opcional)</mat-label>
          <input matInput formControlName="reference" placeholder="Nº de transação, cheque, etc.">
        </mat-form-field>

        <mat-form-field>
          <mat-label>Observações (Opcional)</mat-label>
          <textarea matInput formControlName="notes" rows="3"></textarea>
        </mat-form-field>
      </form>

      @if (errorMessage()) {
        <div class="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {{ errorMessage() }}
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Cancelar</button>
      <button mat-raised-button color="primary" (click)="save()" [disabled]="!paymentForm.valid || isSaving()">
        {{ isSaving() ? 'A guardar...' : 'Registar Pagamento' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      min-width: 400px;
    }
  `]
})
export class PaymentDialogComponent {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<PaymentDialogComponent>);
  data = inject<PaymentDialogData>(MAT_DIALOG_DATA);
  private paymentService = inject(PaymentService);
  private dialog = inject(MatDialog);

  isSaving = signal(false);
  errorMessage = signal('');

  paymentForm = this.fb.group({
    amount: [0, [Validators.required, Validators.min(0.01), Validators.max(this.data.amountPending)]],
    payment_date: [new Date(), Validators.required],
    payment_method: ['dinheiro', Validators.required],
    reference: [''],
    notes: ['']
  });

  setPartialPayment() {
    const halfAmount = this.data.amountPending / 2;
    this.paymentForm.patchValue({ amount: halfAmount });
  }

  setFullPayment() {
    this.paymentForm.patchValue({ amount: this.data.amountPending });
  }

  async save() {
    if (this.paymentForm.invalid) return;

    this.isSaving.set(true);
    this.errorMessage.set('');

    try {
      const formValue = this.paymentForm.value;
      const paymentDate = formValue.payment_date as Date;

      const payment = await this.paymentService.createPayment({
        invoice_id: this.data.invoiceId,
        amount: formValue.amount!,
        payment_date: paymentDate.toISOString().split('T')[0],
        payment_method: formValue.payment_method!,
        reference: formValue.reference || undefined,
        notes: formValue.notes || undefined
      });

      if (payment) {
        this.dialogRef.close(true);

        setTimeout(() => {
          this.dialog.open(ReceiptDetailComponent, {
            width: '800px',
            maxWidth: '95vw',
            data: {
              paymentId: payment.id,
              invoiceId: this.data.invoiceId
            }
          });
        }, 300);
      } else {
        this.errorMessage.set('Erro ao registar pagamento. Tente novamente.');
      }
    } catch (error) {
      this.errorMessage.set('Erro ao registar pagamento. Tente novamente.');
    } finally {
      this.isSaving.set(false);
    }
  }

  cancel() {
    this.dialogRef.close(false);
  }

  formatCurrency(value: number): string {
    return this.paymentService.formatCurrency(value);
  }
}
