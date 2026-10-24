import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export interface AnnulReceiptDialogData {
  receiptNumber: string;
  amount: string;
}

/**
 * Pede o motivo da anulação de um recibo. Devolve o motivo, ou nada se o
 * utilizador cancelar.
 */
@Component({
  selector: 'app-annul-receipt-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title class="flex items-center gap-2">
      <mat-icon class="!text-red-600">block</mat-icon>
      {{ 'payments.annul.title' | t: { number: data.receiptNumber } }}
    </h2>

    <mat-dialog-content>
      <p class="text-sm text-gray-600 mb-4">
        {{ 'payments.annul.description' | t: { amount: data.amount } }}
      </p>

      <mat-form-field appearance="outline" class="w-full">
        <mat-label>{{ 'payments.annul.reason' | t }}</mat-label>
        <textarea matInput rows="3" maxlength="500" required cdkFocusInitial
          [ngModel]="reason()" (ngModelChange)="reason.set($event)"
          [placeholder]="'payments.annul.reasonPlaceholder' | t"></textarea>
        <mat-hint align="end">{{ reason().length }}/500</mat-hint>
      </mat-form-field>
    </mat-dialog-content>

    <mat-dialog-actions align="end" class="!px-6 !pb-4">
      <button mat-button mat-dialog-close>{{ 'common.actions.cancel' | t }}</button>
      <button mat-raised-button color="warn" [disabled]="reason().trim().length < 3" (click)="confirm()">
        {{ 'payments.annul.confirm' | t }}
      </button>
    </mat-dialog-actions>
  `
})
export class AnnulReceiptDialogComponent {
  data = inject<AnnulReceiptDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<AnnulReceiptDialogComponent, string>);

  reason = signal('');

  confirm() {
    const reason = this.reason().trim();
    if (reason.length >= 3) this.dialogRef.close(reason);
  }
}
