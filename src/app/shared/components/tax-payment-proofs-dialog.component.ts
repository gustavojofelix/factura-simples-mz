import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PROOF_ACCEPT, TaxDeclaration, TaxPayment, TaxService } from '../../core/services/tax.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { currentLocale, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/**
 * Pagamentos registados de uma declaração, com o respectivo comprovativo:
 * abrir, anexar (se ainda não tiver) ou substituir.
 */
@Component({
  selector: 'app-tax-payment-proofs-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ 'taxes.proof.dialogTitle' | t }}</h2>
    <mat-dialog-content class="sm:min-w-[480px]">
      <p class="text-sm text-gray-600 mb-4">
        {{ 'taxes.calculator.periodOfYear' | t: { period: periodLabel, year: declaration().year } }}
      </p>

      <input #fileInput type="file" class="hidden" [accept]="proofAccept" (change)="onFileSelected($event)">

      @if (payments().length === 0) {
        <p class="text-sm text-gray-500 py-6 text-center">{{ 'taxes.proof.noPayments' | t }}</p>
      }

      <div class="space-y-3">
        @for (payment of payments(); track payment.id) {
          <div class="p-3 rounded-xl border border-gray-200">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="font-semibold text-gray-900">{{ formatCurrency(payment.amount) }}</p>
                <p class="text-xs text-gray-500">
                  {{ formatDate(payment.payment_date) }}
                  @if (payment.payment_method) {
                    · {{ ('taxes.paymentDialog.methods.' + payment.payment_method) | t }}
                  }
                  @if (payment.reference) {
                    · {{ payment.reference }}
                  }
                </p>
              </div>
              @if (payment.receipt_url) {
                <span class="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5 shrink-0">
                  <mat-icon class="!text-sm !w-4 !h-4 !leading-4">check_circle</mat-icon>
                  {{ 'taxes.proof.attached' | t }}
                </span>
              } @else {
                <span class="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
                  {{ 'taxes.proof.missing' | t }}
                </span>
              }
            </div>

            <div class="mt-3 flex flex-wrap gap-2">
              @if (payment.receipt_url) {
                <button mat-stroked-button type="button" (click)="open(payment)" [disabled]="busyId() !== null">
                  <mat-icon>visibility</mat-icon>
                  {{ 'taxes.proof.view' | t }}
                </button>
              }
              <button mat-stroked-button color="primary" type="button" (click)="pick(payment, fileInput)" [disabled]="busyId() !== null">
                @if (busyId() === payment.id) {
                  <mat-spinner diameter="18" class="inline-block mr-1"></mat-spinner>
                } @else {
                  <mat-icon>{{ payment.receipt_url ? 'sync' : 'attach_file' }}</mat-icon>
                }
                {{ (payment.receipt_url ? 'taxes.proof.replace' : 'taxes.proof.attach') | t }}
              </button>
            </div>
          </div>
        }
      </div>

      <p class="text-xs text-gray-500 mt-3">{{ 'taxes.proof.hint' | t }}</p>
      @if (error()) {
        <p class="text-sm text-red-600 mt-2">{{ error() }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">{{ 'common.actions.close' | t }}</button>
    </mat-dialog-actions>
  `
})
export class TaxPaymentProofsDialogComponent {
  private readonly data = inject<{ declaration: TaxDeclaration }>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<TaxPaymentProofsDialogComponent>);
  private readonly taxService = inject(TaxService);
  private readonly preferences = inject(PreferencesService);

  /** Lê do serviço, para reflectir o comprovativo acabado de anexar. */
  readonly declaration = computed(() =>
    this.taxService.declarations().find(d => d.id === this.data.declaration.id) ?? this.data.declaration
  );
  readonly payments = computed(() =>
    [...(this.declaration().payments || [])].sort((a, b) => b.payment_date.localeCompare(a.payment_date))
  );

  readonly busyId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly proofAccept = PROOF_ACCEPT;
  readonly periodLabel = this.taxService.getPeriodName(this.data.declaration.period);

  private target: TaxPayment | null = null;

  pick(payment: TaxPayment, input: HTMLInputElement) {
    this.target = payment;
    this.error.set(null);
    input.click();
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const payment = this.target;
    if (!file || !payment) return;

    const invalid = this.taxService.validateProofFile(file);
    if (invalid) {
      this.error.set(invalid);
      return;
    }

    this.busyId.set(payment.id);
    try {
      const ok = await this.taxService.attachPaymentProof(payment, this.declaration(), file);
      if (!ok) this.error.set(t('taxes.proof.attachFailed'));
    } catch (error: any) {
      this.error.set(error?.message || t('taxes.proof.uploadFailed'));
    } finally {
      this.busyId.set(null);
    }
  }

  async open(payment: TaxPayment) {
    if (!payment.receipt_url) return;
    // Abre a janela já, durante o clique: depois de um await os browsers bloqueiam o pop-up.
    const win = window.open('', '_blank');
    const url = await this.taxService.getPaymentProofUrl(payment.receipt_url);
    if (!url) {
      win?.close();
      this.error.set(t('taxes.proof.openFailed'));
      return;
    }
    if (win) {
      win.location.href = url;
    } else {
      window.location.href = url;
    }
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat(currentLocale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0) + ' MZN';
  }

  formatDate(date: string): string {
    return this.preferences.formatDate(date) || date;
  }
}
