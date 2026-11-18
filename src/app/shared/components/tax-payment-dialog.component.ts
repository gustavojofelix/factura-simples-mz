import { Component, Inject, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PROOF_ACCEPT, TaxDeclaration, TaxService } from '../../core/services/tax.service';
import { t, currentLocale } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DialogShellComponent } from '../ui/dialog-shell.component';

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
    MatIconModule,
    MatProgressSpinnerModule,
    DialogShellComponent,
    TranslatePipe
  ],
  template: `
    <app-dialog-shell [title]="'taxes.paymentDialog.title' | t" icon="account_balance" (closed)="cancel()">
      <div class="mb-4 grid grid-cols-2 gap-2">
        <div class="p-3 bg-gray-50 rounded-xl min-w-0">
          <p class="text-xs text-gray-600">{{ 'taxes.paymentDialog.declaration' | t }}</p>
          <p class="font-semibold text-sm">{{ 'taxes.calculator.periodOfYear' | t: { period: getPeriodLabel(), year: data.declaration.year } }}</p>
        </div>
        <div class="p-3 bg-gray-50 rounded-xl min-w-0">
          <p class="text-xs text-gray-600">{{ 'taxes.paymentDialog.totalAmount' | t }}</p>
          <p class="font-semibold tabular-nums">{{ formatCurrency(data.declaration.ispc_amount) }}</p>
        </div>
      </div>

      <mat-form-field appearance="outline" class="w-full">
        <mat-label>{{ 'taxes.paymentDialog.amountPaid' | t }}</mat-label>
        <input
          matInput
          type="number"
          inputmode="decimal"
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

      <!-- Comprovativo de pagamento (opcional; pode ser anexado mais tarde) -->
      <div class="mb-5">
        <p class="text-sm font-medium text-gray-700 mb-1">{{ 'taxes.proof.label' | t }}</p>
        <input #proofInput type="file" class="hidden" [accept]="proofAccept" (change)="onProofSelected($event)">
        @if (proofFile(); as file) {
          <div class="flex items-center gap-3 p-3 rounded-xl border border-green-200 bg-green-50">
            <mat-icon class="!text-green-600 shrink-0">{{ file.type === 'application/pdf' ? 'picture_as_pdf' : 'image' }}</mat-icon>
            <span class="flex-1 min-w-0 text-sm text-gray-800 truncate">{{ file.name }}</span>
            <button mat-button type="button" (click)="proofInput.click()" [disabled]="saving()">{{ 'taxes.proof.replace' | t }}</button>
            <button mat-icon-button type="button" (click)="clearProof(proofInput)" [disabled]="saving()" [attr.aria-label]="'common.actions.remove' | t">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        } @else {
          <button type="button" (click)="proofInput.click()"
            class="w-full flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-gray-300 text-sm text-gray-600 hover:border-ispc-orange hover:text-ispc-orange transition-colors">
            <mat-icon>attach_file</mat-icon>
            {{ 'taxes.proof.choose' | t }}
          </button>
        }
        <p class="text-xs text-gray-500 mt-1">{{ 'taxes.proof.hint' | t }}</p>
        @if (proofError()) {
          <p class="text-xs text-red-600 mt-1">{{ proofError() }}</p>
        }
      </div>

      <mat-form-field appearance="outline" class="w-full">
        <mat-label>{{ 'taxes.paymentDialog.notes' | t }}</mat-label>
        <textarea
          matInput
          [(ngModel)]="notes"
          rows="3"
          [placeholder]="'taxes.paymentDialog.notesPlaceholder' | t"></textarea>
      </mat-form-field>

      <div shellFooter class="flex gap-2 sm:justify-end">
        <button mat-stroked-button type="button" class="flex-1 sm:flex-none !h-12 !rounded-xl" (click)="cancel()" [disabled]="saving()">
          {{ 'common.actions.cancel' | t }}
        </button>
        <button
          mat-flat-button
          type="button"
          class="flex-1 sm:flex-none !h-12 !rounded-xl !bg-ispc-orange !text-white"
          (click)="save()"
          [disabled]="!isValid() || saving()">
          @if (saving()) {
            <mat-spinner diameter="18" class="inline-block mr-2"></mat-spinner>
          }
          {{ 'common.actions.save' | t }}
        </button>
      </div>
    </app-dialog-shell>
  `
})
export class TaxPaymentDialogComponent {
  amount = signal(this.data.declaration.ispc_amount);
  paymentDate = signal(new Date());
  paymentMethod = signal('transferencia');
  reference = signal('');
  notes = signal('');
  proofFile = signal<File | null>(null);
  proofError = signal<string | null>(null);
  saving = signal(false);
  readonly proofAccept = PROOF_ACCEPT;

  private taxService = inject(TaxService);

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

  onProofSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const error = this.taxService.validateProofFile(file);
    this.proofError.set(error);
    this.proofFile.set(error ? null : file);
    input.value = '';
  }

  clearProof(input: HTMLInputElement) {
    this.proofFile.set(null);
    this.proofError.set(null);
    input.value = '';
  }

  cancel() {
    this.dialogRef.close();
  }

  async save() {
    if (!this.isValid() || this.saving()) return;

    const paymentDateStr = this.paymentDate()?.toISOString().split('T')[0];

    // O comprovativo é carregado antes de fechar, para que uma falha deixe o
    // utilizador tentar de novo (ou gravar sem ficheiro) sem perder o formulário.
    let receiptUrl: string | undefined;
    const file = this.proofFile();
    if (file) {
      this.saving.set(true);
      this.proofError.set(null);
      try {
        receiptUrl = await this.taxService.uploadPaymentProof(this.data.declaration.company_id, file);
      } catch (error: any) {
        this.proofError.set(error?.message || t('taxes.proof.uploadFailed'));
        this.saving.set(false);
        return;
      }
      this.saving.set(false);
    }

    this.dialogRef.close({
      amount: this.amount(),
      paymentDate: paymentDateStr,
      paymentMethod: this.paymentMethod() || undefined,
      reference: this.reference() || undefined,
      receiptUrl,
      notes: this.notes() || undefined
    });
  }
}
