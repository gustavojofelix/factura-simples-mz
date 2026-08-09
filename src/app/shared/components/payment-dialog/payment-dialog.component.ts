import { Component, Inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SubscriptionService, SubscriptionPlan } from '../../../core/services/subscription.service';
import { VoucherService, VoucherValidationResult } from '../../../core/services/voucher.service';
import { SupabaseService } from '../../../core/services/supabase.service';

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
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  template: `
    <div class="p-6 max-w-md w-full bg-slate-900 text-white rounded-2xl border border-slate-800 shadow-2xl space-y-5">
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-slate-800 pb-4">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
            <mat-icon>credit_card</mat-icon>
          </div>
          <div>
            <h2 class="text-lg font-bold text-white leading-tight">Ativação da Subscrição</h2>
            <p class="text-xs text-slate-400">Plano {{ data.plan.name }} • {{ getOriginalPrice() | number:'1.0-0' }} MZN/{{ data.billingCycle === 'monthly' ? 'mês' : 'ano' }}</p>
          </div>
        </div>
        <button mat-icon-button (click)="dialogRef.close(false)" [disabled]="loading()" class="!text-slate-400 hover:!text-white">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <!-- VOUCHER CODE SECTION -->
      <div class="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <mat-icon class="!text-sm !w-4 !h-4 text-amber-400">card_giftcard</mat-icon>
            Tem um Voucher / Cupom?
          </span>
          <span *ngIf="voucherResult()?.valid" class="text-[11px] font-bold text-green-400 flex items-center gap-1">
            <mat-icon class="!text-xs !w-3.5 !h-3.5">check_circle</mat-icon> Aplicado
          </span>
        </div>

        <div class="flex gap-2">
          <input
            type="text"
            [(ngModel)]="voucherInput"
            placeholder="Ex: BEMVINDO20"
            [disabled]="loading() || (voucherResult()?.valid || false)"
            class="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono uppercase font-bold text-amber-300 focus:ring-2 focus:ring-amber-500 outline-none placeholder:font-sans placeholder:font-normal placeholder:text-slate-500"
          >
          <button
            *ngIf="!voucherResult()?.valid"
            type="button"
            (click)="applyVoucher()"
            [disabled]="loading() || validatingVoucher() || !voucherInput.trim()"
            class="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg transition-all disabled:opacity-50 flex items-center gap-1"
          >
            <mat-spinner *ngIf="validatingVoucher()" diameter="14" class="white-spinner"></mat-spinner>
            <span>Aplicar</span>
          </button>
          <button
            *ngIf="voucherResult()?.valid"
            type="button"
            (click)="removeVoucher()"
            class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg transition-all"
          >
            Remover
          </button>
        </div>

        <!-- Voucher Message / Feedback -->
        <div *ngIf="voucherMessage" [class.text-green-400]="voucherResult()?.valid" [class.text-rose-400]="!voucherResult()?.valid" class="text-xs font-medium flex items-start gap-1">
          <span>{{ voucherMessage }}</span>
        </div>
      </div>

      <!-- PRICE SUMMARY BOX -->
      <div class="p-4 rounded-xl bg-slate-950 border border-slate-800 flex justify-between items-center">
        <div>
          <span class="text-xs text-slate-400 block">Valor Final a Pagar</span>
          <div class="flex items-baseline gap-2">
            <span *ngIf="voucherResult()?.valid && (voucherResult()?.discountAmount || 0) > 0" class="text-xs text-slate-400 line-through">
              {{ getOriginalPrice() | number:'1.0-0' }} MZN
            </span>
            <span class="text-xl font-black text-white">
              {{ getFinalPrice() | number:'1.0-0' }} MZN
            </span>
          </div>
        </div>
        <div class="text-right">
          <span class="text-[11px] px-2.5 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 font-bold uppercase">
            Plano {{ data.plan.name }}
          </span>
        </div>
      </div>

      <!-- IF FINAL PRICE IS 0 MZN (FREE ACTIVATION WITH VOUCHER) -->
      <div *ngIf="getFinalPrice() === 0" class="space-y-4 pt-2">
        <div class="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-300 text-xs font-medium flex items-center gap-2">
          <mat-icon class="text-green-400">verified</mat-icon>
          <span>O voucher cobre 100% do valor! Pode ativar a subscrição imediatamente sem custo.</span>
        </div>

        <div class="flex items-center gap-3">
          <button mat-button type="button" (click)="dialogRef.close(false)" [disabled]="loading()" class="!text-slate-400 hover:!text-white flex-1">
            Cancelar
          </button>
          <button
            type="button"
            (click)="onActivateFreeWithVoucher()"
            [disabled]="loading()"
            class="flex-1 h-11 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
          >
            <mat-spinner *ngIf="loading()" diameter="18" class="white-spinner"></mat-spinner>
            <span *ngIf="!loading()">Ativar Subscrição Grátis</span>
          </button>
        </div>
      </div>

      <!-- IF FINAL PRICE > 0 MZN (MOBILE PAYMENT REQUIRED) -->
      <div *ngIf="getFinalPrice() > 0" class="space-y-4">
        <!-- Payment Method Selection -->
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider">Carteira Móvel para Pagamento</label>
          <div class="grid grid-cols-2 gap-3">
            <!-- M-Pesa Option -->
            <button type="button"
              (click)="selectMethod('mpesa')"
              [class]="selectedMethod() === 'mpesa'
                ? 'border-red-500 bg-red-950/40 text-white ring-2 ring-red-500/30'
                : 'border-slate-800 bg-slate-800/40 text-slate-400 hover:border-slate-700'"
              class="p-3 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer">
              <div class="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center text-white font-black text-xs shadow-md">
                M
              </div>
              <span class="text-xs font-bold">M-Pesa</span>
            </button>

            <!-- e-Mola Option -->
            <button type="button"
              (click)="selectMethod('emola')"
              [class]="selectedMethod() === 'emola'
                ? 'border-amber-500 bg-amber-950/40 text-white ring-2 ring-amber-500/30'
                : 'border-slate-800 bg-slate-800/40 text-slate-400 hover:border-slate-700'"
              class="p-3 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer">
              <div class="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-slate-950 font-black text-xs shadow-md">
                e
              </div>
              <span class="text-xs font-bold">e-Mola</span>
            </button>
          </div>
        </div>

        <!-- Phone Number Form -->
        <form [formGroup]="paymentForm" (ngSubmit)="onSubmit()" class="space-y-4">
          <div>
            <mat-form-field appearance="outline" class="w-full !m-0 custom-dark-form-field">
              <mat-label class="!text-slate-300">Número M-Pesa / e-Mola</mat-label>
              <input matInput type="tel" formControlName="phone" placeholder="84 123 4567" class="!text-white">
              <mat-icon matPrefix class="!text-orange-400">phone_iphone</mat-icon>
              @if (getErrorMessage('phone')) {
                <mat-error class="!text-rose-400 font-semibold">{{ getErrorMessage('phone') }}</mat-error>
              }
            </mat-form-field>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-3 pt-1">
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
                  <span>Pagar {{ getFinalPrice() | number:'1.0-0' }} MZN</span>
                  <mat-icon class="!text-sm !w-4 !h-4">send</mat-icon>
                </div>
              }
            </button>
          </div>
        </form>
      </div>
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
export class PaymentDialogComponent implements OnInit {
  paymentForm: FormGroup;
  selectedMethod = signal<'mpesa' | 'emola'>('mpesa');
  loading = signal(false);

  voucherInput = '';
  validatingVoucher = signal(false);
  voucherResult = signal<VoucherValidationResult | null>(null);
  voucherMessage = '';
  currentUserEmail = '';

  constructor(
    public dialogRef: MatDialogRef<PaymentDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PaymentDialogData,
    private fb: FormBuilder,
    private subscriptionService: SubscriptionService,
    private voucherService: VoucherService,
    private supabase: SupabaseService,
    private snackBar: MatSnackBar
  ) {
    this.paymentForm = this.fb.group({
      phone: ['', [Validators.required, Validators.pattern(/^(?:258)?(?:84|85|86|87)\d{7}$/)]]
    });
  }

  async ngOnInit() {
    try {
      const { data: sessionData } = await this.supabase.client.auth.getSession();
      this.currentUserEmail = sessionData?.session?.user?.email || '';
    } catch (e) {
      console.error('Error fetching session email:', e);
    }
  }

  selectMethod(method: 'mpesa' | 'emola') {
    this.selectedMethod.set(method);
  }

  getOriginalPrice(): number {
    return this.data.billingCycle === 'monthly'
      ? this.data.plan.monthly_price
      : this.data.plan.yearly_price;
  }

  getFinalPrice(): number {
    const vResult = this.voucherResult();
    if (vResult?.valid && vResult.finalPrice !== undefined) {
      return vResult.finalPrice;
    }
    return this.getOriginalPrice();
  }

  async applyVoucher() {
    const code = this.voucherInput.trim();
    if (!code) return;

    this.validatingVoucher.set(true);
    this.voucherMessage = '';

    try {
      const origPrice = this.getOriginalPrice();
      const res = await this.voucherService.validateVoucher(
        code,
        this.data.companyId,
        this.currentUserEmail,
        origPrice
      );

      this.voucherResult.set(res);
      this.voucherMessage = res.message;
    } catch (e: any) {
      this.voucherResult.set(null);
      this.voucherMessage = e.message || 'Erro ao validar voucher.';
    } finally {
      this.validatingVoucher.set(false);
    }
  }

  removeVoucher() {
    this.voucherInput = '';
    this.voucherResult.set(null);
    this.voucherMessage = '';
  }

  async onActivateFreeWithVoucher() {
    this.loading.set(true);
    const companyId = this.data.companyId;

    try {
      // 1. Upsert active subscription with 0 MZN
      const success = await this.subscriptionService.upsertSubscription(companyId, {
        plan_name: this.data.plan.name,
        billing_cycle: this.data.billingCycle,
        amount: 0,
        status: 'active'
      });

      // 2. Redeem voucher if applied
      const vResult = this.voucherResult();
      if (success && vResult?.voucher?.id) {
        const session = (await this.supabase.client.auth.getSession()).data?.session;
        await this.voucherService.redeemVoucher(
          vResult.voucher.id,
          companyId,
          session?.user?.id,
          vResult.discountAmount || 0
        );
      }

      this.loading.set(false);

      if (success) {
        this.snackBar.open('Subscrição ativada com sucesso via Voucher!', 'Fechar', { duration: 5000 });
        this.dialogRef.close(true);
      } else {
        this.snackBar.open('Erro ao ativar subscrição.', 'Fechar', { duration: 5000 });
      }
    } catch (e: any) {
      this.loading.set(false);
      this.snackBar.open(e.message || 'Erro inesperado ao ativar subscrição.', 'Fechar', { duration: 5000 });
    }
  }

  async onSubmit() {
    if (this.paymentForm.invalid) {
      this.paymentForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);

    const phone = this.paymentForm.value.phone;
    const method = this.selectedMethod();
    const finalAmount = this.getFinalPrice();

    const result = await this.subscriptionService.processMobilePayment(
      this.data.companyId,
      this.data.subscriptionId,
      this.data.plan.name,
      this.data.billingCycle,
      finalAmount,
      method,
      phone
    );

    if (result.success) {
      // Redeem voucher if applied
      const vResult = this.voucherResult();
      if (vResult?.voucher?.id) {
        const session = (await this.supabase.client.auth.getSession()).data?.session;
        await this.voucherService.redeemVoucher(
          vResult.voucher.id,
          this.data.companyId,
          session?.user?.id,
          vResult.discountAmount || 0
        );
      }

      this.loading.set(false);
      this.snackBar.open(
        result.message || `Pedido de pagamento enviado para ${phone}!`,
        'Fechar',
        { duration: 5000 }
      );
      this.dialogRef.close(true);
    } else {
      this.loading.set(false);
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
