import { Component, Inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SubscriptionService, SubscriptionPlan } from '../../../core/services/subscription.service';

export interface PaymentDialogData {
  companyId: string;
  subscriptionId?: string;
  plan: SubscriptionPlan;
  billingCycle: 'monthly' | 'yearly';
}

@Component({
  selector: 'app-payment-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  template: `
    <div class="p-6 max-w-md w-full bg-slate-900 text-white rounded-2xl border border-slate-800 shadow-2xl">
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-slate-800 pb-4 mb-5">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
            <mat-icon>credit_card</mat-icon>
          </div>
          <div>
            <h2 class="text-lg font-bold text-white leading-tight">Pagamento da Subscrição</h2>
            <p class="text-xs text-slate-400">Plano {{ data.plan.name }} • {{ data.plan.monthly_price | number:'1.0-0' }} MZN</p>
          </div>
        </div>
        <button mat-icon-button (click)="dialogRef.close(false)" [disabled]="loading()" class="!text-slate-400 hover:!text-white">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <!-- Payment Method Selection -->
      <div class="space-y-4 mb-6">
        <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider">Selecione a Carteira Móvel</label>
        <div class="grid grid-cols-2 gap-3">
          <!-- M-Pesa Option -->
          <button type="button"
            (click)="selectMethod('mpesa')"
            [class]="selectedMethod() === 'mpesa'
              ? 'border-red-500 bg-red-950/40 text-white ring-2 ring-red-500/30'
              : 'border-slate-800 bg-slate-800/40 text-slate-400 hover:border-slate-700'"
            class="p-4 rounded-xl border flex flex-col items-center justify-center gap-2 transition-all cursor-pointer">
            <div class="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center text-white font-black text-xs shadow-md">
              M
            </div>
            <span class="text-sm font-bold">M-Pesa</span>
            <span class="text-[10px] text-slate-400">Vodacom (84/85)</span>
          </button>

          <!-- e-Mola Option -->
          <button type="button"
            (click)="selectMethod('emola')"
            [class]="selectedMethod() === 'emola'
              ? 'border-amber-500 bg-amber-950/40 text-white ring-2 ring-amber-500/30'
              : 'border-slate-800 bg-slate-800/40 text-slate-400 hover:border-slate-700'"
            class="p-4 rounded-xl border flex flex-col items-center justify-center gap-2 transition-all cursor-pointer">
            <div class="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center text-slate-950 font-black text-xs shadow-md">
              e
            </div>
            <span class="text-sm font-bold">e-Mola</span>
            <span class="text-[10px] text-slate-400">Movitel (86/87)</span>
          </button>
        </div>
      </div>

      <!-- Phone Number Input Form -->
      <form [formGroup]="paymentForm" (ngSubmit)="onSubmit()" class="space-y-5">
        <div>
          <mat-form-field appearance="outline" class="w-full !m-0 custom-dark-form-field">
            <mat-label class="!text-slate-300">Número de Telefone M-Pesa / e-Mola</mat-label>
            <input matInput type="tel" formControlName="phone" placeholder="84 123 4567" class="!text-white">
            <mat-icon matPrefix class="!text-orange-400">phone_iphone</mat-icon>
            <mat-hint class="!text-slate-400">Insira o número da carteira móvel para receber o prompt de confirmação.</mat-hint>
            @if (getErrorMessage('phone')) {
              <mat-error class="!text-rose-400 font-semibold">{{ getErrorMessage('phone') }}</mat-error>
            }
          </mat-form-field>
        </div>

        <!-- Total Summary Box -->
        <div class="p-4 rounded-xl bg-slate-950 border border-slate-800 flex justify-between items-center">
          <div>
            <span class="text-xs text-slate-400 block">Total a Pagar</span>
            <span class="text-lg font-black text-white">{{ (data.billingCycle === 'monthly' ? data.plan.monthly_price : data.plan.yearly_price) | number:'1.0-0' }} MZN</span>
          </div>
          <div class="text-right">
            <span class="text-[11px] px-2.5 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 font-bold uppercase">
              Plano {{ data.plan.name }}
            </span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-3 pt-2">
          <button mat-button type="button" (click)="dialogRef.close(false)" [disabled]="loading()" class="!text-slate-400 hover:!text-white flex-1">
            Cancelar
          </button>
          <button mat-raised-button type="submit"
            [class]="selectedMethod() === 'mpesa' ? '!bg-red-600 hover:!bg-red-500' : '!bg-amber-500 hover:!bg-amber-400 !text-slate-950'"
            class="flex-1 !h-11 !font-bold !rounded-xl !shadow-lg transition-all flex items-center justify-center gap-2"
            [disabled]="loading()">
            @if (loading()) {
              <div class="flex items-center gap-2">
                <mat-spinner diameter="18" class="!text-white white-spinner"></mat-spinner>
                <span>A enviar...</span>
              </div>
            } @else {
              <div class="flex items-center justify-center gap-2">
                <span>Pagar via {{ selectedMethod() === 'mpesa' ? 'M-Pesa' : 'e-Mola' }}</span>
                <mat-icon class="!text-sm !w-4 !h-4">send</mat-icon>
              </div>
            }
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    ::ng-deep .custom-dark-form-field .mdc-text-field--outlined {
      --mdc-outlined-text-field-container-color: rgba(15, 23, 42, 0.6) !important;
      --mdc-outlined-text-field-outline-color: rgba(51, 65, 85, 0.8) !important;
      --mdc-outlined-text-field-hover-outline-color: rgba(249, 115, 22, 0.5) !important;
      --mdc-outlined-text-field-focus-outline-color: #f97316 !important;
    }
    ::ng-deep .custom-dark-form-field .mat-mdc-form-field-flex {
      border-radius: 0.75rem !important;
    }
    ::ng-deep .white-spinner circle {
      stroke: white !important;
    }
  `]
})
export class PaymentDialogComponent {
  paymentForm: FormGroup;
  selectedMethod = signal<'mpesa' | 'emola'>('mpesa');
  loading = signal(false);

  constructor(
    public dialogRef: MatDialogRef<PaymentDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PaymentDialogData,
    private fb: FormBuilder,
    private subscriptionService: SubscriptionService,
    private snackBar: MatSnackBar
  ) {
    this.paymentForm = this.fb.group({
      phone: ['', [Validators.required, Validators.pattern(/^(?:258)?(?:84|85|86|87)\d{7}$/)]]
    });
  }

  selectMethod(method: 'mpesa' | 'emola') {
    this.selectedMethod.set(method);
  }

  async onSubmit() {
    if (this.paymentForm.invalid) {
      this.paymentForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);

    const phone = this.paymentForm.value.phone;
    const method = this.selectedMethod();
    const amount = this.data.plan.monthly_price || 7500;

    const result = await this.subscriptionService.processMobilePayment(
      this.data.companyId,
      this.data.subscriptionId,
      this.data.plan.name,
      this.data.billingCycle,
      amount,
      method,
      phone
    );

    this.loading.set(false);

    if (result.success) {
      this.snackBar.open(
        result.message || `Pedido de pagamento enviado para ${phone}!`,
        'Fechar',
        { duration: 5000 }
      );
      this.dialogRef.close(true);
    } else {
      this.snackBar.open(
        result.error || 'Erro ao efetuar pedido de pagamento',
        'Fechar',
        { duration: 6000 }
      );
    }
  }

  getErrorMessage(field: string): string {
    const control = this.paymentForm.get(field);
    if (!control || !control.touched) return '';

    if (control.hasError('required')) {
      return 'O número de telefone é obrigatório';
    }
    if (control.hasError('pattern')) {
      return 'Número de telefone inválido (ex: 841234567 ou 861234567)';
    }
    return '';
  }
}
